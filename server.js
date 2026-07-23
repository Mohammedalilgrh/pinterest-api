import express from 'express';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import Lens from 'chrome-lens-ocr';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealthPlugin());

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PINTEREST_EMAIL = process.env.PINTEREST_EMAIL || '';
const PINTEREST_PASSWORD = process.env.PINTEREST_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'pinterest_auth.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json({ limit: '5mb' }));

let loggedIn = false;

// Initialize Lens instance
const lens = new Lens({
  chromeVersion: '124.0.6367.60',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
});

function containsArabic(text) {
  return /[؀-ۿ]/.test(text);
}

function containsEnglish(text) {
  return /[a-zA-Z]/.test(text);
}

function detectQueryLanguage(query) {
  return containsArabic(query) ? 'arabic' : 'english';
}

function checkIfMeaningful(text, targetLang = null) {
  const minWords = 5;
  const minChars = 20;
  const hasLetters = /[a-zA-Z؀-ۿ]/.test(text);
  const isMostlyAlphaNumeric = (text.replace(/[^a-zA-Z0-9؀-ۿ\s]/g, '').length / text.length) > 0.7;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (!(text.length >= minChars && wordCount >= minWords && hasLetters && isMostlyAlphaNumeric)) return false;

  if (targetLang === 'arabic') return containsArabic(text);
  if (targetLang === 'english') return containsEnglish(text);
  return true;
}

async function extractTextWithLens(imageUrl) {
  try {
    console.log(`🔍 Lens OCR: ${imageUrl.substring(0, 60)}...`);
    const result = await lens.scanByURL(imageUrl);
    const text = result.segments.map(s => s.text).join(' ').trim();
    console.log(`✅ Lens OCR: ${text.substring(0, 80)}... (lang: ${result.language || 'N/A'})`);
    return { text, language: result.language };
  } catch (err) {
    console.error('❌ Lens OCR error:', err.message?.substring(0, 80));
    return { text: '', language: '', error: err.message };
  }
}

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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 20000,
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
  const targetLang = detectQueryLanguage(query);

  // For Arabic queries — skip English filler words, use counter only
  if (targetLang === 'arabic') {
    searchCounter++;
    return `${query} ${searchCounter}`;
  }

  // For English queries — keep freshness words
  let idx;
  do {
    idx = Math.floor(Math.random() * RELATED_TERMS.length);
  } while (idx === lastPickedIndex && RELATED_TERMS.length > 1);
  lastPickedIndex = idx;

  const word = RELATED_TERMS[idx];
  searchCounter++;

  return `${query} ${word} ${searchCounter}`;
}

const seenPinIds = new Set();

async function searchPinterest(query, limit = 10, bookmark = null) {
  const maxResults = Math.min(limit, 50);
  let allPins = [];
  let nextBookmark = null;

  for (let attempt = 0; attempt < 3 && allPins.length < maxResults; attempt++) {
    const freshPinterestQuery = buildFreshQuery(query);

    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        timeout: 20000,
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      if (fs.existsSync(STATE_FILE)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
          await context.addCookies(cookies);
        } catch (e) {}
      }

      const page = await context.newPage();
      let attemptPins = [];

      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('BaseSearchResource/get') && response.status() === 200) {
          try {
            const json = await response.json();
            const resourceData = json?.resource_response?.data;
            const results = resourceData?.results || [];

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

      let searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(freshPinterestQuery)}&rs=typed`;
      if (bookmark) {
        searchUrl += `&bookmark=${encodeURIComponent(bookmark)}`;
      }

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(5000);

      for (let i = 0; i < 5 && attemptPins.length < maxResults; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1500);
      }

      await context.close();
      await browser.close();

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

app.post('/api/pinterest/ocr', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const result = await extractTextWithLens(imageUrl);
    res.json({
      success: !!result.text,
      text: result.text,
      language: result.language,
      error: result.error || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pinterest/lens', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const result = await extractTextWithLens(imageUrl);
    res.json({
      success: !!result.text,
      text: result.text,
      language: result.language,
      error: result.error || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/pinterest/search-with-ocr', async (req, res) => {
  try {
    const query = req.query.q || req.query.query || req.query.search;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    }

    const count = parseInt(req.query.count || req.query.limit || '10', 10);
    const size = req.query.size || 'medium';
    const targetLang = detectQueryLanguage(query);

    console.log(`🔍 Searching with OCR: "${query}" (count: ${count}, lang: ${targetLang})`);

    let attempts = 0;
    const maxAttempts = 10;
    let meaningfulPins = [];

    while (meaningfulPins.length < count && attempts < maxAttempts) {
      attempts++;
      const searchResult = await searchPinterest(query, 1, null);
      const pins = searchResult.pins;

      if (pins.length === 0) {
        console.log('No more pins found in search result. Ending attempts.');
        break;
      }

      for (const pin of pins) {
        if (meaningfulPins.length >= count) break;

        let imgUrl = pin.image;
        if (imgUrl) {
          if (size === 'small') imgUrl = imgUrl.replace(/\/\d+x\//, '/236x/');
          else if (size === 'medium') imgUrl = imgUrl.replace(/\/\d+x\//, '/564x/');
        }

        const ocrResult = await extractTextWithLens(imgUrl);
        const extractedText = ocrResult.text;

        const isMeaningful = checkIfMeaningful(extractedText, targetLang);

        if (isMeaningful) {
          console.log(`✅ ${targetLang} text found for pin ${pin.id}: ${extractedText.substring(0, 50)}...`);
          meaningfulPins.push({
            ...pin,
            image: imgUrl,
            extractedText: extractedText,
            language: ocrResult.language,
            langMatch: true,
            lenstext_full: extractedText,
          });
        } else {
          console.log(`❌ Text not meaningful for pin ${pin.id}: ${extractedText.substring(0, 50)}... Searching next...`);
        }
      }

      if (searchResult.bookmark) {
        bookmark = searchResult.bookmark;
      } else {
        console.log('No more pins to search. Ending attempts.');
        break;
      }
    }

    res.json({
      success: true,
      query,
      count: meaningfulPins.length,
      hasMore: meaningfulPins.length >= count,
      bookmark: bookmark || '',
      data: meaningfulPins,
    });
  } catch (err) {
    console.error('Search with OCR endpoint error:', err.message);
    res.status(500).json({ success: false, error: 'Search with OCR failed', details: err.message });
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
      ocr: 'POST /api/pinterest/ocr { "url": "IMAGE_URL" }',
      lens: 'POST /api/pinterest/lens { "url": "IMAGE_URL" } (Google Lens ONLY)',
      searchWithOcr: 'GET /api/pinterest/search-with-ocr?q=YOUR_QUERY&count=10&size=medium (Smart search with language-aware OCR filtering)',
    },
  });
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════╗`);
  console.log(`║  Pinterest API Server Active   ║`);
  console.log(`║  Port: ${PORT}                      ║`);
  console.log(`╚════════════════════════════════╝\n`);
  if (PINTEREST_EMAIL && PINTEREST_PASSWORD) {
    loginToPinterest().catch(err => {
      console.error('Background login failed (non-fatal):', err.message?.substring(0, 100));
    });
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

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught:', err.message?.substring(0, 100));
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled:', err.message?.substring(0, 100));
});
