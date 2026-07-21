const express = require('express');
const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PINTEREST_EMAIL = process.env.PINTEREST_EMAIL || '';
const PINTEREST_PASSWORD = process.env.PINTEREST_PASSWORD || '';
const STATE_FILE = path.join(__dirname, 'pinterest_auth.json');

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

const RANDOM_WORDS = [
  'daily','best','top','trending','popular','amazing','beautiful','cool',
  'awesome','epic','great','wonderful','fantastic','incredible','perfect',
  'stunning','gorgeous','lovely','nice','super','mega','ultra','fresh',
  'new','hot','viral','modern','classic','unique','special','premium',
];

function buildFreshQuery(query) {
  // Sprinkle random unique garbage to force Pinterest to serve different results
  // Pinterest treats "quotes x7k2" as a different search from "quotes m9p1"
  const suffix = Math.random().toString(36).substring(2, 6);
  const word = RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
  return `${query} ${word} ${suffix}`;
}

async function searchPinterest(query, limit = 10, bookmark = null, pageNum = 1) {
  const maxResults = Math.min(limit, 50);
  const allPins = [];
  let nextBookmark = null;

  // Build the ACTUAL Pinterest search query with freshness injection
  // The user query is the niche, but we add noise so every request is different
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
            if (allPins.length >= maxResults) break;
            let image = pin.images?.orig?.url || pin.images?.['564x']?.url || pin.images?.['736x']?.url || pin.images?.['236x']?.url || '';
            allPins.push({
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

    // Build search URL with optional bookmark for pagination
    // Use the FRESHENED query so Pinterest never caches
    let searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(freshPinterestQuery)}&rs=typed`;
    if (bookmark) {
      searchUrl += `&bookmark=${encodeURIComponent(bookmark)}`;
    }

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);

    // Scroll to load more pins
    const scrollsToDo = pageNum > 1 && !bookmark ? Math.min(pageNum * 2, 15) : 5;
    for (let i = 0; i < scrollsToDo && allPins.length < maxResults; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1500);
    }

    // If API interception didn't work, try extracting from DOM
    if (allPins.length === 0) {
      console.log('API interception empty, trying DOM extraction...');
      const domPins = await page.evaluate((maxRes) => {
        const pins = [];
        const images = document.querySelectorAll('img[src*="pinimg"]');
        for (const img of images) {
          if (pins.length >= maxRes) break;
          const link = img.closest('a');
          pins.push({
            id: '',
            title: img.alt || '',
            description: '',
            image: img.src || '',
            link: link ? (link.href.startsWith('http') ? link.href : 'https://www.pinterest.com' + link.href) : '',
          });
        }
        return pins;
      }, maxResults);
      allPins.push(...domPins);
    }

    await context.close();
    await browser.close();
    return { pins: allPins.slice(0, maxResults), bookmark: nextBookmark };
  } catch (err) {
    console.error('Search error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return { pins: allPins, bookmark: nextBookmark };
  }
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
    const page = parseInt(req.query.page || '1', 10);
    const bookmark = req.query.bookmark || null;

    console.log(`🔍 Searching: "${query}" (count: ${count}, page: ${page})`);

    const result = await searchPinterest(query, count, bookmark, page);

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
      page,
      hasMore: !!result.bookmark,
      bookmark: result.bookmark || '',
      data,
    });
  } catch (err) {
    console.error('Search endpoint error:', err.message);
    res.json({ success: true, query: req.query.q || '', count: 0, page: 1, hasMore: false, bookmark: '', data: [] });
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

app.post('/api/pinterest/ocr', async (req, res) => {
  try {
    const imageUrl = req.body?.url;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'Missing "url"' });
    if (!ocrWorker) ocrWorker = await createWorker('eng');
    const { data } = await ocrWorker.recognize(imageUrl);
    res.json({ success: true, text: data.text?.trim() || '', confidence: data.confidence || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: 'OCR failed', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 'alive', name: 'Pinterest API', version: '1.1.0', loggedIn,
    note: 'Set PINTEREST_EMAIL & PINTEREST_PASSWORD in env for search',
    endpoints: {
      search: 'GET /api/pinterest/search?q=YOUR_QUERY&count=10&size=medium&page=1',
      nextPage: 'Use the "bookmark" from response as &bookmark=YOUR_BOOKMARK to get next page',
      download: 'GET /api/pinterest/download?url=IMAGE_URL',
      ocr: 'POST /api/pinterest/ocr { "url": "IMAGE_URL" }',
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
