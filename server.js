import express from 'express';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import Lens from 'chrome-lens-ocr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealthPlugin());

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PINTEREST_EMAIL = process.env.PINTEREST_EMAIL || '';
const PINTEREST_PASSWORD = process.env.PINTEREST_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'pinterest_auth.json');

app.use(cors());
app.use(express.json({ limit: '5mb' }));

let loggedIn = false;

// Initialize Lens (chrome-lens-ocr v4.1.1 — working version)
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
  if (!text || text.trim().length < 3) return false;
  const hasLetters = /[a-zA-Z؀-ۿ]/.test(text);
  if (!hasLetters) return false;
  if (targetLang === 'arabic') return /[؀-ۿ]/.test(text) || /[a-zA-Z]/.test(text);
  if (targetLang === 'english') return /[a-zA-Z]/.test(text);
  return true;
}

// ──────────────────────────────────────────────
// OCR: Extract text from image using Google Lens (chrome-lens-ocr v4.1.1)
// ──────────────────────────────────────────────

async function extractTextWithLens(imageUrl) {
  try {
    console.log(`🔍 Lens OCR: ${imageUrl.substring(0, 60)}...`);
    const result = await lens.scanByURL(imageUrl);

    // Extract ALL text segments — each segment is text found in the image
    const text = result.segments.map(s => s.text).join('\n').trim();
    const language = result.language || 'unknown';

    if (text) {
      console.log(`✅ Lens OCR: ${text.length} chars — "${text.substring(0, 100)}..." (${language})`);
    } else {
      console.log(`⚠️  Lens OCR returned empty`);
    }

    return { text, language };
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

    await page.evaluate(({ email, password }) => {
      const emailInput = document.querySelector('input#email') || document.querySelector('input[type="email"]');
      const passInput = document.querySelector('input#password') || document.querySelector('input[type="password"]');
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = password;
    }, { email: PINTEREST_EMAIL, password: PINTEREST_PASSWORD });

    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });

    await page.waitForTimeout(5000);
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

    const currentUrl = page.url();
    if (currentUrl.includes('login') && !currentUrl.includes('search')) {
      console.log('❌ Login failed - still on login page');
    } else {
      console.log('✅ Pinterest login successful!');
    }

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

const ARABIC_TERMS = [
  'اقتباس','حكمة','مقولة','كلام','خواطر','عبارات','شعر','أدب','مواعظ',
  'نصيحة','تأمل','إلهام','تحفيز','نجاح','حياة','قوة','أمل','حب',
  'صباح','مساء','دينية','إسلامية','قرآن','ذكر','دعاء','عبادات',
  'فلسفة','منطق','علم','معرفة','فكر','عقل','روح','سلام','تفاؤل',
  'image','quote','text','calligraphy','arabic','islamic',
];

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

  if (targetLang === 'arabic') {
    const word = ARABIC_TERMS[Math.floor(Math.random() * ARABIC_TERMS.length)];
    searchCounter++;
    return `${query} ${word}`;
  }

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
              const image = pin.images?.orig?.url || pin.images?.['564x']?.url || pin.images?.['736x']?.url || pin.images?.['236x']?.url || '';
              attemptPins.push({
                id: pin.id || '',
                title: pin.title || pin.grid_title || '',
                description: pin.description || pin.pin_description || pin.rich_summary?.display_description || '',
                image,
                link: `https://www.pinterest.com/pin/${pin.id}/`,
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
    if (!query) return res.status(400).json({ success: false, error: 'Missing ?q parameter' });

    const count = parseInt(req.query.count || req.query.limit || '10', 10);
    const size = req.query.size || 'medium';
    const bookmark = req.query.bookmark || null;

    const result = await searchPinterest(query, count, bookmark);

    const data = result.pins.map(pin => {
      let img = pin.image;
      if (img) {
        if (size === 'small') img = img.replace(/\/\d+x\//, '/236x/');
        else if (size === 'medium') img = img.replace(/\/\d+x\//, '/564x/');
      }
      return { ...pin, image: img };
    });

    res.json({ success: true, query, count: data.length, hasMore: !!result.bookmark, bookmark: result.bookmark || '', data });
  } catch (err) {
    res.json({ success: true, query: req.query.q || '', count: 0, hasMore: false, bookmark: '', data: [] });
  }
});

app.get('/api/pinterest/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing ?url=' });

    https.get(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.pinterest.com/' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) return res.redirect(response.headers.location);
      if (response.statusCode !== 200) return res.status(500).json({ success: false, error: 'Download failed' });
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
    const pinUrl = req.body?.pinUrl;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const result = await extractTextWithLens(imageUrl, pinUrl);
    res.json({ success: !!result.text, text: result.text, language: result.language, error: result.error || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pinterest/lens', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    const pinUrl = req.body?.pinUrl;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const result = await extractTextWithLens(imageUrl, pinUrl);
    res.json({ success: !!result.text, text: result.text, language: result.language, error: result.error || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/pinterest/search-with-ocr', async (req, res) => {
  try {
    const query = req.query.q || req.query.query || req.query.search;
    if (!query) return res.status(400).json({ success: false, error: 'Missing ?q parameter' });

    const count = parseInt(req.query.count || req.query.limit || '5', 10);
    const size = req.query.size || 'medium';
    const targetLang = detectQueryLanguage(query);

    console.log(`🔍 Search+OCR: "${query}" (need: ${count}, lang: ${targetLang})`);

    let attempts = 0;
    const maxAttempts = 30;
    let meaningfulPins = [];
    let bookmark = req.query.bookmark || null;
    let noMorePages = false;

    while (meaningfulPins.length < count && attempts < maxAttempts && !noMorePages) {
      attempts++;

      const batchSize = Math.max(count * 3, 10);
      const searchResult = await searchPinterest(query, batchSize, bookmark);
      const pins = searchResult.pins;

      if (!pins || pins.length === 0) break;

      if (searchResult.bookmark) {
        bookmark = searchResult.bookmark;
      } else {
        noMorePages = true;
      }

      console.log(`Attempt ${attempts}: checking ${pins.length} pins...`);

      for (const pin of pins) {
        if (meaningfulPins.length >= count) break;
        if (!pin.image) continue;

        let displayImageUrl = pin.image;
        if (size === 'small') displayImageUrl = displayImageUrl.replace(/\/\d+x\//, '/236x/');
        else if (size === 'medium') displayImageUrl = displayImageUrl.replace(/\/\d+x\//, '/564x/');

        // Step 1: Use Google Lens directly on the image to extract ALL text
        // This reads the actual text in the image (Arabic, English, everything)
        console.log(`  🔍 Lens scanning pin ${pin.id}...`);
        const lensResult = await extractTextWithLens(pin.image);
        let extractedText = lensResult.text;

        // Step 2: If Lens gave us something, also append Pinterest description
        // for extra context (but Lens text is the primary source)
        if (extractedText && extractedText.length > 10) {
          const pinterestDesc = (pin.description || pin.title || '').trim();
          if (pinterestDesc && pinterestDesc.length > 10 && !extractedText.includes(pinterestDesc)) {
            extractedText = extractedText + '\n\n' + pinterestDesc;
            console.log(`  📝 Pin ${pin.id}: appended Pinterest description`);
          }
        }

        // Step 3: If Lens failed, fall back to Pinterest description
        if (!extractedText || extractedText.length < 5) {
          extractedText = (pin.description || pin.title || '').trim();
          if (extractedText) {
            console.log(`  📝 Pin ${pin.id}: using Pinterest description (Lens failed) — "${extractedText.substring(0, 80)}"`);
          }
        }

        // Skip if no text found
        if (!extractedText || extractedText.length < 5) {
          console.log(`  ⏭️  Pin ${pin.id}: no text at all`);
          continue;
        }

        // Check if text has real content (Arabic or English letters)
        const hasRealLetters = /[a-zA-Z؀-ۿ]/.test(extractedText);
        if (!hasRealLetters) {
          console.log(`  ⏭️  Pin ${pin.id}: no real letters`);
          continue;
        }

        // Detect language
        const detectedLang = containsArabic(extractedText) ? 'arabic' : 'english';
        console.log(`  ✅ Pin ${pin.id}: ${detectedLang} — "${extractedText.substring(0, 100)}..."`);

        meaningfulPins.push({
          ...pin,
          image: displayImageUrl,
          extractedText,
          language: lensResult.language || detectedLang,
          langMatch: true,
          lenstext_full: extractedText,
        });
      }
    }

    console.log(`Search complete: ${meaningfulPins.length}/${count} pins after ${attempts} attempts`);
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
    status: 'alive', name: 'Pinterest API', version: '1.2.0', loggedIn,
    note: 'Set PINTEREST_EMAIL & PINTEREST_PASSWORD in env for search',
    endpoints: {
      search: 'GET /api/pinterest/search?q=YOUR_QUERY&count=10&size=medium',
      bookmark: 'Pass &bookmark=VALUE from previous response for next page',
      download: 'GET /api/pinterest/download?url=IMAGE_URL',
      ocr: 'POST /api/pinterest/ocr { "url": "IMAGE_URL", "pinUrl": "PIN_PAGE_URL" }',
      lens: 'POST /api/pinterest/lens { "url": "IMAGE_URL", "pinUrl": "PIN_PAGE_URL" }',
      searchWithOcr: 'GET /api/pinterest/search-with-ocr?q=YOUR_QUERY&count=10&size=medium — full smart search with text extraction',
    },
  });
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
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
    console.log('   Set PINTEREST_EMAIL & PINTEREST_PASSWORD in Render Dashboard.');
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (err) => console.error('💥 Uncaught:', err.message?.substring(0, 100)));
process.on('unhandledRejection', (err) => console.error('💥 Unhandled:', err.message?.substring(0, 100)));
