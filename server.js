const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { createWorker } = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const PINTEREST_EMAIL = process.env.PINTEREST_EMAIL || '';
const PINTEREST_PASSWORD = process.env.PINTEREST_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'pinterest_auth.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json({ limit: '5mb' }));

let loggedIn = false;

// ──────────────────────────────────────────────
// Pinterest Login
// ──────────────────────────────────────────────

async function loginToPinterest() {
  if (!PINTEREST_EMAIL || !PINTEREST_PASSWORD) {
    console.log('⚠️  Pinterest credentials not set. Search may not work.');
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    console.log('🔑 Logging into Pinterest...');
    await page.goto('https://www.pinterest.com/login/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Fill credentials
    await page.evaluate(({ email, password }) => {
      const emailInput = document.querySelector('input#email') || document.querySelector('input[type="email"]');
      const passInput = document.querySelector('input#password') || document.querySelector('input[type="password"]');
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = password;
    }, { email: PINTEREST_EMAIL, password: PINTEREST_PASSWORD });

    await page.waitForTimeout(500);

    // Click login button
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });

    await page.waitForTimeout(5000);
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

    // Check if login succeeded
    const currentUrl = page.url();
    if (currentUrl.includes('login') && !currentUrl.includes('search')) {
      console.log('❌ Login failed - still on login page');
      // Save cookies anyway (might have partial session)
    } else {
      console.log('✅ Pinterest login successful!');
    }

    // Save cookies
    const cookies = await context.cookies();
    fs.writeFileSync(STATE_FILE, JSON.stringify(cookies, null, 2));
    loggedIn = true;

    await context.close();
    await browser.close();
  } catch (err) {
    console.error('❌ Login error:', err.message);
    if (browser) await browser.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────
// Pinterest Search
// ──────────────────────────────────────────────

// HUGE pool of real search terms — every combination returns real Pinterest results
const RELATED_TERMS = [
  'aesthetic','art','beautiful','best','bold','bright','calm','chill','classic',
  'cool','creative','cute','daily','deep','dream','epic','famous','fantastic',
  'free','fresh','funny','glow','golden','good','gorgeous','great','happy',
  'hard','healthy','heart','heaven','holy','honest','hope','hot','humble',
  'iconic','ideal','inspired','intense','kind','legendary','light','lit',
  'lovely','lucky','magic','mega','minimal','modern','mood','motivated',
  'natural','neat','new','nice','noble','open','peace','perfect','positive',
  'power','pro','pure','quiet','radiant','rare','raw','real','rich','royal',
  'sacred','safe','savage','serene','sharp','shine','short','simple','sincere',
  'sleek','smart','smooth','soft','solid','soul','spark','spiritual','star',
  'steady','stellar','still','striking','strong','stunning','subtle','sugar',
  'sunny','super','supreme','sweet','swift','tender','thought','tough','true',
  'trust','ultimate','unique','united','vibes','vibrant','viral','vivid',
  'warm','wholesome','wild','wise','wonder','worthy','zen',
];

let searchCounter = Date.now();
let lastPickedIndex = -1;

function buildFreshQuery(query) {
  // NEVER let Pinterest see the same query twice.
  // We use the user's query as the niche, then append a real word that
  // Pinterest actually has results for - plus a rotating timestamp.

  // Pick a word different from the last one
  let idx;
  do {
    idx = Math.floor(Math.random() * RELATED_TERMS.length);
  } while (idx === lastPickedIndex && RELATED_TERMS.length > 1);
  lastPickedIndex = idx;

  const word = RELATED_TERMS[idx];
  searchCounter++;

  // Pinterest treats "quotes" as the main query and ignores extra text
  // But the unique number forces Pinterest's CDN to serve fresh results
  // instead of returning cached JSON
  return `${query} ${word} ${searchCounter}`;
}

// Track seen pin IDs to avoid duplicates across requests in the same session
const seenPinIds = new Set();
let sessionFreshnessCounter = 0;

async function searchPinterest(query, limit = 10, bookmark = null) {
  const maxResults = Math.min(limit, 50);
  let allPins = [];
  let nextBookmark = null;

  // Try up to 3 times with different queries if we keep getting seen pins
  for (let attempt = 0; attempt < 3 && allPins.length < maxResults; attempt++) {
    // Build the ACTUAL Pinterest search query with freshness injection
    const freshPinterestQuery = buildFreshQuery(query);

    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      // Load saved cookies
      if (fs.existsSync(STATE_FILE)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
          await context.addCookies(cookies);
        } catch (e) {}
      }

      const page = await context.newPage();
      let attemptPins = [];

      // Intercept Pinterest's internal API to capture search responses
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('BaseSearchResource/get') && response.status() === 200) {
          try {
            const json = await response.json();
            const resourceData = json?.resource_response?.data;
            const results = resourceData?.results || [];

            // Capture the bookmark for pagination
            if (resourceData?.bookmark) {
              nextBookmark = resourceData.bookmark;
            }

            for (const pin of results) {
              if (attemptPins.length >= maxResults * 2) break;
              let image = pin.images?.orig?.url || pin.images?.['564x']?.url || pin.images?.['736x']?.url || pin.images?.['236x']?.url || '';
              attemptPins.push({
                id: pin.id || '',
                title: pin.title || pin.grid_title || '',
                description: pin.description || pin.pin_description || '',
                image,
                link: pin.link || `https://www.pinterest.com/pin/${pin.id}/`,
              });
            }
          } catch (e) {}
        }
      });

      // Build search URL
      let searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(freshPinterestQuery)}&rs=typed`;
      if (bookmark) {
        searchUrl += `&bookmark=${encodeURIComponent(bookmark)}`;
      }

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(5000);

      // Scroll to load more pins
      for (let i = 0; i < 5 && attemptPins.length < maxResults; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1500);
      }

      await context.close();
      await browser.close();

      // Filter out already-seen pins
      for (const pin of attemptPins) {
        if (allPins.length >= maxResults) break;
        if (pin.id && !seenPinIds.has(pin.id)) {
          seenPinIds.add(pin.id);
          allPins.push(pin);
        }
      }

      console.log(`Attempt ${attempt + 1}: got ${attemptPins.length} pins, ${allPins.length} new`);
    } catch (err) {
      console.error(`Search attempt ${attempt + 1} error:`, err.message);
      if (browser) await browser.close().catch(() => {});
    }
  }

  // Clear seen IDs periodically so memory doesn't grow forever (~200KB per 5000 IDs)
  if (seenPinIds.size > 5000) {
    seenPinIds.clear();
    console.log('Cleared seen pin cache (5000 limit reached)');
  }

  return { pins: allPins.slice(0, maxResults), bookmark: nextBookmark };
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

app.get('/api/pinterest/search', async (req, res) => {
  try {
    const query = req.query.q || req.query.query || req.query.search;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    }

    const count = parseInt(req.query.count || req.query.limit || '10', 10);
    const size = req.query.size || 'medium';
    const bookmark = req.query.bookmark || null;

    console.log(`🔍 Searching: "${query}" (count: ${count})`);

    const result = await searchPinterest(query, count, bookmark);

    // Apply image size
    const data = result.pins.map(pin => {
      let img = pin.image;
      if (img) {
        if (size === 'small') img = img.replace(/\/\d+x\//, '/236x/');
        else if (size === 'medium') img = img.replace(/\/\d+x\//, '/564x/');
      }
      return { ...pin, image: img };
    });

    res.json({
      success: true,
      query,
      count: data.length,
      hasMore: !!result.bookmark,
      bookmark: result.bookmark || '',
      data,
    });
  } catch (err) {
    console.error('Search endpoint error:', err.message);
    res.json({ success: true, query: req.query.q || '', count: 0, hasMore: false, bookmark: '', data: [] });
  }
});

app.get('/api/pinterest/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing ?url=' });

    const https = require('https');
    https.get(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.pinterest.com/',
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return res.redirect(response.headers.location);
      }
      if (response.statusCode !== 200) {
        return res.status(500).json({ success: false, error: 'Download failed' });
      }
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
      response.pipe(res);
    }).on('error', () => res.status(500).json({ success: false, error: 'Download failed' }));
  } catch {
    res.status(500).json({ success: false, error: 'Download failed' });
  }
});

// ──────────────────────────────────────────────
// Google Lens Text Extraction
// ──────────────────────────────────────────────

async function extractTextViaLens(imageUrl) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    const page = await context.newPage();

    const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
    console.log(`🔍 Google Lens: ${imageUrl.substring(0, 50)}...`);
    await page.goto(lensUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Handle cookie consent if it appears
    try {
      const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Accept all"), button:has-text("I agree"), button[aria-label*="Accept"]').first();
      if (await cookieBtn.count() > 0) { await cookieBtn.click({ timeout: 5000 }); await page.waitForTimeout(1000); }
    } catch (e) {}

    // Wait for Lens to process the image (spinner goes away / results appear)
    // This can take 5-15 seconds
    let processed = false;
    for (let i = 0; i < 30; i++) {
      const hasSpinner = await page.evaluate(() => {
        // Check for various loading indicators
        const spinners = document.querySelectorAll('[role="progressbar"], [class*="spinner"], [class*="loading"], [aria-busy="true"]');
        const textElements = document.querySelectorAll('.S3t8J, .Vf0PKf, [class*="text-detected"], [class*="text-block"], [class*="lensText"], [data-test="text-results"]');
        // If we have text results, we're done
        if (textElements.length > 0) return false;
        // If spinner is gone and page loaded, check text
        if (spinners.length === 0) {
          const body = document.body?.innerText || '';
          // If we see content (not just spinner text), we're good
          if (body.length > 300) return false;
        }
        return true; // still loading
      });
      if (!hasSpinner) { processed = true; break; }
      await page.waitForTimeout(1000);
    }

    if (!processed) {
      console.log('⚠️ Lens processing timed out, trying to extract anyway');
    }

    // Now extract the detected text
    let lensText = await page.evaluate(() => {
      // Multiple extraction strategies

      // Strategy 1: Google Lens text result elements
      const selectors = [
        '.S3t8J', '.Vf0PKf',
        '[class*="text-detected"]',
        '[class*="text-block"]',
        '[class*="lensText"]',
        '[data-test="text-results"] span',
        'div[role="tabpanel"] span',
        'div[jsname] span',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const texts = Array.from(els).map(el => el.textContent?.trim()).filter(Boolean);
          if (texts.length > 0) return texts.join('\n');
        }
      }

      // Strategy 2: Try clicking "Text" tab first then re-extract
      const tabs = document.querySelectorAll('button, [role="tab"]');
      for (const tab of tabs) {
        if (tab.textContent?.toLowerCase().includes('text')) {
          tab.click();
          break;
        }
      }

      // Strategy 3: Get all visible text
      const body = document.body?.innerText || '';
      return body.trim();
    });

    // Clean the text
    lensText = lensText
      .replace(/\s+/g, ' ')
      .trim()
      // Remove common Lens UI text that's not the actual result
      .replace(/Text\s*Search\s*Translate\s*Homework\s*(Web|Images|Shopping|Videos|News|Maps|Books)/gi, '')
      .replace(/Send feedback|About Google|Privacy|Terms|Help|Learn more|Feedback/gi, '')
      .replace(/Google Lens.*?lens\s*\.\s*google/i, '')
      .trim();

    await context.close();
    await browser.close();

    if (lensText && lensText.length > 20) {
      console.log(`✅ Lens text (${lensText.length} chars): ${lensText.substring(0, 80)}...`);
      return { text: lensText, source: 'google_lens' };
    }

    // Fallback: if Lens gave us nothing useful, try Google Images reverse search
    console.log('⚠️ Lens gave short/no text, trying Google Images...');
    try {
      const { text: fallbackText } = await extractTextViaGoogleImages(imageUrl);
      if (fallbackText) {
        return { text: fallbackText, source: 'google_images' };
      }
    } catch (e) {}

    return { text: lensText || '', source: 'google_lens' };

  } catch (err) {
    console.error('❌ Lens error:', err.message?.substring(0, 80));
    if (browser) await browser.close().catch(() => {});
    // Fallback to Google Images
    try {
      const { text: fallbackText } = await extractTextViaGoogleImages(imageUrl);
      if (fallbackText) return { text: fallbackText, source: 'google_images' };
    } catch (e) {}
    return { text: '', source: 'google_lens', error: err.message };
  }
}

// ──────────────────────────────────────────────
// Google Images Reverse Search (Fallback)
// ──────────────────────────────────────────────

async function extractTextViaGoogleImages(imageUrl) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--window-size=1920,1080'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    const page = await context.newPage();

    await page.goto(`https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Wait for results to load
    for (let i = 0; i < 20; i++) {
      const ready = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.length > 500 && !text.includes('loading');
      });
      if (ready) break;
      await page.waitForTimeout(1000);
    }

    // Extract text snippets from the page — Google Images shows visually similar images
    // and sometimes text snippets from the image
    const text = await page.evaluate(() => {
      // Get all text from the results section
      const results = document.querySelectorAll('[data-hveid], .yG4QQe, .TbwUpd, .i0X6df, .LC20lb, .VwiC3b, span.st');
      const texts = Array.from(results).map(el => el.textContent?.trim()).filter(Boolean);
      return texts.join('\n');
    });

    await context.close();
    await browser.close();
    return { text };

  } catch (err) {
    console.error('❌ Google Images error:', err.message?.substring(0, 80));
    if (browser) await browser.close().catch(() => {});
    return { text: '' };
  }
}

let ocrWorker = null;

app.post('/api/pinterest/ocr', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    const method = req.body?.method || 'both'; // 'tesseract', 'google_lens', or 'both'
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });

    let texts = [];

    // Google Lens extraction
    if (method === 'google_lens' || method === 'both') {
      const lensResult = await extractTextViaLens(imageUrl);
      if (lensResult.text) {
        texts.push({ text: lensResult.text, source: 'google_lens' });
      }
    }

    // Tesseract OCR fallback
    if (method === 'tesseract' || method === 'both') {
      if (!ocrWorker) ocrWorker = await createWorker('eng');
      const { data } = await ocrWorker.recognize(imageUrl);
      if (data.text?.trim()) {
        texts.push({ text: data.text.trim(), source: 'tesseract', confidence: data.confidence || 0 });
      }
    }

    if (texts.length === 0) {
      return res.status(500).json({ success: false, error: 'No text extracted' });
    }

    // If both methods gave text, return the better one
    const response = { success: true, results: texts };
    // For backwards compatibility, if you just want the best text
    if (texts.length === 1 || req.body?.method !== 'both') {
      response.text = texts[0].text;
      response.source = texts[0].source;
      if (texts[0].confidence) response.confidence = texts[0].confidence;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, error: 'OCR failed', details: err.message });
  }
});

// ⭐ Google Lens only endpoint — faster, no Tesseract overhead
app.post('/api/pinterest/lens', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const result = await extractTextViaLens(imageUrl);
    res.json({
      success: !!result.text,
      text: result.text,
      source: 'google_lens',
      error: result.error || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'alive', name: 'Pinterest API', version: '1.1.0', loggedIn,
    note: 'Set PINTEREST_EMAIL & PINTEREST_PASSWORD in env for search',
    endpoints: {
      search: 'GET /api/pinterest/search?q=YOUR_QUERY&count=10&size=medium',
      bookmark: 'Pass &bookmark=VALUE from previous response for next page',
      download: 'GET /api/pinterest/download?url=IMAGE_URL',
      ocr: 'POST /api/pinterest/ocr { "url": "IMAGE_URL", "method": "both|tesseract|google_lens" }',
      lens: 'POST /api/pinterest/lens { "url": "IMAGE_URL" }  (⭐ Google Lens ONLY - cleaner text)',
    },
  });
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n╔════════════════════════════════╗`);
  console.log(`║  Pinterest API Server Active   ║`);
  console.log(`║  Port: ${PORT}                      ║`);
  console.log(`╚════════════════════════════════╝\n`);
  if (PINTEREST_EMAIL && PINTEREST_PASSWORD) {
    await loginToPinterest();
  } else {
    console.log('⚠️  Pinterest credentials not configured.');
    console.log('   Search needs these to return results.');
    console.log('   Set in Render Dashboard → Environment:');
    console.log('   PINTEREST_EMAIL  (your Pinterest login email)');
    console.log('   PINTEREST_PASSWORD (your Pinterest password)\n');
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
