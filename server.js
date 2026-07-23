const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { createWorker } = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // For fetching image data as buffer
const sharp = require('sharp'); // For image preprocessing
const { ocrImage } = require('./utils/googleLensOcr');

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

let ocrWorker = null;

// ──────────────────────────────────────────────
// Simple Tesseract OCR (no native deps, works on Render)
// ──────────────────────────────────────────────

async function extractTextSimple(imageUrl) {
  try {
    if (!ocrWorker) ocrWorker = await createWorker('eng+ara');
    console.log(`🔍 OCR: ${imageUrl.substring(0, 60)}...`);

    // 1. Fetch the image as a buffer
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);

    // 2. Preprocess with Sharp
    const processedImageBuffer = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .toBuffer();

    // 3. Recognize with Tesseract.js
    const { data } = await ocrWorker.recognize(processedImageBuffer);
    const text = data.text?.trim() || '';
    console.log(`✅ OCR: ${text.substring(0, 80)}... (conf: ${Math.round(data.confidence || 0)})`);
    return { text, confidence: Math.round(data.confidence || 0) };
  } catch (err) {
    console.error('❌ OCR error:', err.message?.substring(0, 80));
    return { text: '', confidence: 0 };
  }
}

async function extractTextViaLens(imageUrl) {
  const ocrResult = await ocrImage(imageUrl);
  if (ocrResult.success) {
    return { text: ocrResult.text, confidence: 100 }; // Assuming high confidence if Google Lens succeeds
  }
  return { text: '', confidence: 0, error: ocrResult.error, code: ocrResult.code };
}

// Function to filter for "complete and meaningful sentences"
function lensText(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
        return null;
    }

    const qualifyingSentences = [];
    let currentSentence = [];
    const terminators = ['.', '!', '?', '\n']; // Explicit sentence terminators

    for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        currentSentence.push(char);

        // Check if the current character is a terminator
        if (terminators.includes(char)) {
            let sentence = currentSentence.join('').trim();
            if (sentence.length > 0) {

                // Apply filtering logic to 'sentence'
                if (!/[a-zA-Z0-9]/.test(sentence)) { // Ensure it has actual words/numbers
                    currentSentence = []; // Discard and reset
                    continue;
                }

                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                // Revert to stricter minimum length check
                if (words.length < 4) { // Minimum Length Check (e.g., 4 words)
                    currentSentence = [];
                    continue;
                }

                const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                const totalCount = sentence.length;

                if (totalCount > 10 && (alphanumericCount / totalCount < 0.7)) { // Less than 70% alphanumeric for longer sentences
                    currentSentence = [];
                    continue;
                }
                if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.85)) { // Less than 85% alphanumeric for shorter sentences
                    currentSentence = [];
                    continue;
                }

                const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                if (errorKeywords.some(keyword => sentence.includes(keyword))) { // Error Keyword Detection
                    currentSentence = [];
                    continue;
                }


                qualifyingSentences.push(sentence);
            }
            currentSentence = []; // Reset buffer after a terminator
        }
    }

    // Process any remaining text in currentSentence buffer if no terminator at end of string
    if (currentSentence.length > 0) {
        let sentence = currentSentence.join('').trim();
        if (sentence.length > 0) {
            // Apply filtering logic
            if (!/[a-zA-Z0-9]/.test(sentence)) {
                // do nothing
            } else {
                const words = sentence.split(/\s+/).filter(word => word.length > 0);
                // Revert to stricter minimum length check
                if (words.length >= 4) { // Minimum Length Check
                    const alphanumericCount = (sentence.match(/[a-zA-Z0-9]/g) || []).length;
                    const totalCount = sentence.length;

                    if (totalCount > 10 && (alphanumericCount / totalCount < 0.7)) {
                        // do nothing
                    } else if (totalCount <= 10 && totalCount > 0 && (alphanumericCount / totalCount < 0.85)) {
                        // do nothing
                    } else {
                        const errorKeywords = ['Error:', 'Traceback', 'def ', 'import ', 'function ', 'class ', 'SyntaxError', 'TypeError', 'HTTP ERROR', 'Failed'];
                        if (!errorKeywords.some(keyword => sentence.includes(keyword))) {
                            // Punctuation Check - more lenient for trailing sentence
                            if (!/[.!?]$/.test(sentence)) {
                                if (words.length >= 6) { // If long enough and meaningful without end punctuation
                                     qualifyingSentences.push(sentence);
                                }
                            } else {
                                qualifyingSentences.push(sentence); // Has punctuation, so it's good
                            }
                        }
                    }
                }
            }
        }
    }

    return qualifyingSentences.length > 0 ? qualifyingSentences.join('\n') : null;
}

app.post('/api/pinterest/ocr', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const method = req.body?.method || 'tesseract'; // Default to tesseract

    let result;
    if (method === 'google_lens') {
      result = await extractTextViaLens(imageUrl);
    } else if (method === 'both') {
      const tesseractResult = await extractTextSimple(imageUrl);
      const lensResult = await extractTextViaLens(imageUrl);
      return res.json({
        success: tesseractResult.text || lensResult.text,
        results: [
          { text: tesseractResult.text, source: 'tesseract', confidence: tesseractResult.confidence },
          { text: lensResult.text, source: 'google_lens' }
        ]
      });
    } else {
      result = await extractTextSimple(imageUrl);
    }

    res.json({
      success: !!result.text,
      text: result.text,
      confidence: result.confidence,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'OCR failed', details: err.message });
  }
});

// ⭐ Lens endpoint
app.post('/api/pinterest/lens', async (req, res) => {

app.get('/api/pinterest/search-and-lens', async (req, res) => {
  try {
    const query = req.query.q || req.query.query || req.query.search;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    }

    const requestedCount = parseInt(req.query.count || req.query.limit || '10', 10);
    const imageSize = req.query.size || 'medium';
    let currentPage = parseInt(req.query.page || '1', 10); // Start page for Pinterest search
    let bookmark = req.query.bookmark || null;

    const finalLensedPins = [];
    const MAX_PINTEREST_PAGES_TO_SEARCH = 5; // Limit to prevent infinite loops

        for (let pageNum = 0; finalLensedPins.length < requestedCount && pageNum < MAX_PINTEREST_PAGES_TO_SEARCH; pageNum++) {
      console.log(`🔍 Search & Lens: Page ${currentPage}, Pins needed: ${requestedCount - finalLensedPins.length}`);
      const { pins, bookmark: newBookmark } = await searchPinterest(query, Math.max(requestedCount, 50), bookmark); // Fetch more pins to ensure enough qualifying ones
      bookmark = newBookmark; // Update bookmark for next iteration

      if (pins.length === 0) {
        console.log('No more pins found on Pinterest.');
        break; // No more pins to process
      }

      for (const pin of pins) {
        if (finalLensedPins.length >= requestedCount) break;

        let augmentedPin = { ...pin, lensedText: null, ocrError: null };

        if (pin.image) {
          const ocrResult = await extractTextViaLens(pin.image);
          if (ocrResult.success && ocrResult.text) {
            const lensedText = lensText(ocrResult.text);
            if (lensedText) {
              augmentedPin.lensedText = lensedText;
              finalLensedPins.push(augmentedPin);
            } else {
              // Pin did not qualify after lensing
              // console.log(`Skipped pin ${pin.id}: Text did not qualify after lensing.`);
            }
          } else {
            augmentedPin.ocrError = ocrResult.error || 'No text extracted or OCR failed.';
            // console.log(`Skipped pin ${pin.id}: OCR failed or no text. Error: ${augmentedPin.ocrError}`);
          }
        } else {
          // console.log(`Skipped pin ${pin.id}: No image URL.`);
        }
      }

      if (!bookmark) {
        console.log('No more pages to search on Pinterest.');
        break; // No more pages
      }
      currentPage++;
    }


    res.json({
      success: true,
      query,
      count: finalLensedPins.length,
      data: finalLensedPins,
    });

  } catch (err) {
    console.error('Search and Lens endpoint error:', err.message);
    res.status(500).json({ success: false, error: 'Search and Lens failed', details: err.message });
  }
});


  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    const ocrResult = await extractTextViaLens(imageUrl);
    const lensedText = ocrResult.text ? lensText(ocrResult.text) : null;
    res.json({
      success: !!lensedText,
      text: lensedText,
      source: 'google_lens',
      error: ocrResult.error || null,
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

// Prevent crashes from killing the server
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught:', err.message?.substring(0, 100));
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled:', err.message?.substring(0, 100));
});

module.exports = { lensText }; // Export lensText for testing and potential external use
