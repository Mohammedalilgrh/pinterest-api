# Pinterest API — Search, Download & Extract Text from Images 🌍

A **self-hosted Node.js API** that searches Pinterest, downloads images, and extracts text using **Google Lens OCR**. Built for **n8n**, **Make (Integromat)**, or any HTTP client. Supports **Arabic 🇸🇦** and **English 🇺🇸** with smart language detection.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Docker](https://img.shields.io/badge/deploy-docker-blueviolet)
![Lang](https://img.shields.io/badge/languages-Arabic%20%7C%20English-green)

---

## 📖 Table of Contents

- [🌟 Features](#-features)
- [🚀 Quick Deploy (Render — Free)](#-quick-deploy-render--free)
- [📡 API Endpoints — Full Reference](#-api-endpoints--full-reference)
  - [1. Search Pinterest 🔍](#1-search-pinterest-)
  - [2. Download Image 🖼️](#2-download-image-)
  - [3. OCR — Extract Text with Google Lens 🔎](#3-ocr--extract-text-with-google-lens-)
  - [4. Google Lens Endpoint 🔎](#4-google-lens-endpoint-)
  - [5. Search with OCR 🔍+🔎 (Smart & Language-Aware)](#5-search-with-ocr--smart--language-aware)
  - [6. Health Check 💚](#6-health-check-)
- [🧠 How Language Detection Works](#-how-language-detection-works)
- [🔧 n8n Workflow Examples](#-n8n-workflow-examples)
  - [Workflow 1: Search Arabic Quotes & Save to Google Sheets](#workflow-1-search-arabic-quotes--save-to-google-sheets)
  - [Workflow 2: Multi-Page Search (English)](#workflow-2-multi-page-search-english)
  - [Workflow 3: Scheduled Content Collector](#workflow-3-scheduled-content-collector)
- [🧪 Local Development](#-local-development)
- [🐳 Docker](#-docker)
- [📁 Project Structure](#-project-structure)
- [🤔 How It Works](#-how-it-works)
- [💡 Tips & Tricks](#-tips--tricks)
- [❌ Troubleshooting](#-troubleshooting)
- [📝 License](#-license)

---

## 🌟 Features

| Feature | Description |
|---|---|
| 🔍 **Pinterest Search** | Real Pinterest results via headless browser + API interception |
| 🌐 **Smart Language Detection** | Automatically detects if you searched in **Arabic** or **English** and filters results to match |
| 🔎 **Google Lens OCR** | Extract text from any image (quotes, signs, handwriting, posters) |
| ♻️ **Auto-Re-Search** | If a pin's image doesn't have meaningful text or the wrong language → skip it and search again |
| 🖼️ **Image Download** | Download any Pinterest image as binary |
| 📄 **Pagination** | Exact page control via bookmark cursor |
| 🚫 **Anti-Duplicate** | Tracks seen pins so you never get the same result twice |
| 🐳 **Docker Ready** | Deploy anywhere (Render, Railway, Fly.io, VPS) |
| 📦 **n8n Ready** | Works perfectly with HTTP Request nodes |

---

## 🚀 Quick Deploy (Render — Free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/new?type=web)

### Step 1: Fork / Clone this Repo

```bash
git clone https://github.com/YOUR_USERNAME/pinterest-api.git
cd pinterest-api
```

### Step 2: Deploy on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. Connect your GitHub repository
3. Use these exact settings:

| Field | Value |
|---|---|
| **Name** | `pinterest-api` |
| **Runtime** | **🐳 Docker** (⚠️ Must be Docker, NOT Node — Playwright/Chromium needs system libraries) |
| **Branch** | `main` |
| **Plan** | **Free** (512 MB RAM is enough) |

4. Add **Environment Variables**:

| Key | Required | Description |
|---|---|---|
| `PINTEREST_EMAIL` | ✅ Yes | Your Pinterest account **email** |
| `PINTEREST_PASSWORD` | ✅ Yes | Your Pinterest account **password** |
| `PORT` | ❌ No | Defaults to `3000` |

5. Click **Deploy Web Service**
6. Wait **3–5 minutes** for the build (Docker image + Chromium install)
7. Your URL will be: `https://pinterest-api.onrender.com`

> ⚠️ **Important:** Pinterest requires a logged-in account to show search results. Create a **free throwaway Pinterest account** just for this API. Don't use your personal account.

### Step 3: Keep It Alive (UptimeRobot)

Render free plan **sleeps after 15 minutes of inactivity**. Use UptimeRobot to ping it every 5 minutes:

1. Go to [uptimerobot.com](https://uptimerobot.com) (free plan)
2. **Add New Monitor**:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Pinterest API
   - **URL:** `https://pinterest-api.onrender.com/`
   - **Interval:** 5 minutes
3. Click **Create Monitor**

Your API will now stay awake 24/7 — **cost: $0/month**.

---

## 📡 API Endpoints — Full Reference

### 1. Search Pinterest 🔍

Returns raw Pinterest search results (images, titles, links). Good for browsing. For text extraction, use **Search with OCR** instead.

```
GET /api/pinterest/search?q=KEYWORD&count=10&size=medium&bookmark=
```

#### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | The search keyword / niche (Arabic or English) |
| `count` | int | `10` | Results per request (max 50) |
| `size` | string | `medium` | Image size: `small` (236px), `medium` (564px), `large` (original) |
| `bookmark` | string | — | Pagination cursor from previous response |

#### Example

```bash
curl "https://pinterest-api.onrender.com/api/pinterest/search?q=motivational+quotes&count=3&size=large"
```

#### Response

```json
{
  "success": true,
  "query": "motivational quotes",
  "count": 3,
  "hasMore": true,
  "bookmark": "WyJQSU4iLDE3MzI5ODk...",
  "data": [
    {
      "id": "123456789",
      "title": "Believe in Yourself",
      "description": "Believe you can and you're halfway there.",
      "image": "https://i.pinimg.com/originals/abc123/image.jpg",
      "link": "https://www.pinterest.com/pin/123456789/"
    }
  ]
}
```

#### Pagination

Pass the `bookmark` from one response to the next request for the exact next page:

```bash
# First call
GET /api/pinterest/search?q=quotes&count=5
# Response includes: "bookmark": "WyJQSU4iLDE3MzI5ODk..."

# Second call (next exact page)
GET /api/pinterest/search?q=quotes&count=5&bookmark=WyJQSU4iLDE3MzI5ODk...
```

---

### 2. Download Image 🖼️

Download any Pinterest image as binary data. Use the `image` URL from search results.

```
GET /api/pinterest/download?url=IMAGE_URL
```

#### Example

```bash
curl "https://pinterest-api.onrender.com/api/pinterest/download?url=https://i.pinimg.com/originals/abc123/image.jpg" --output image.jpg
```

In **n8n**: Set **Response Format** → `File` to save the binary.

---

### 3. OCR — Extract Text with Google Lens 🔎

Extract text from **any image URL** using Google Lens. Works on quote graphics, signs, screenshots, handwriting, and complex backgrounds. Much more accurate than Tesseract.

```
POST /api/pinterest/ocr
Content-Type: application/json

{
  "url": "https://i.pinimg.com/originals/abc123/image.jpg"
}
```

#### Example (cURL)

```bash
curl -X POST "https://pinterest-api.onrender.com/api/pinterest/ocr" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://i.pinimg.com/originals/abc123/image.jpg"}'
```

#### Response (1–3 seconds)

```json
{
  "success": true,
  "text": "Believe you can and you're halfway there.\n- Theodore Roosevelt",
  "language": "en",
  "error": null
}
```

---

### 4. Google Lens Endpoint 🔎

Alias for the OCR endpoint — identical functionality.

```
POST /api/pinterest/lens
Content-Type: application/json

{
  "url": "https://i.pinimg.com/originals/abc123/image.jpg"
}
```

#### Response (8–15 seconds)

```json
{
  "success": true,
  "text": "Believe you can and you're halfway there.\n- Theodore Roosevelt",
  "language": "en",
  "error": null
}
```

---

### 5. Search with OCR 🔍+🔎 (Smart & Language-Aware)

**This is the main endpoint you'll use.** It searches Pinterest, runs Google Lens OCR on every pin image, and **automatically filters**:

- ✅ **Pins with meaningful text** (at least 5 words, 20+ characters)
- ✅ **Text in the correct language** (Arabic if you searched in Arabic, English if you searched in English)
- ❌ Pins with short/meaningless text → **skipped automatically**, searches for another
- ❌ Pins in the wrong language → **skipped automatically**, searches for another

```
GET /api/pinterest/search-with-ocr?q=KEYWORD&count=10&size=medium
```

#### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | Search keyword in Arabic or English |
| `count` | int | `10` | Number of **meaningful** results to return |
| `size` | string | `medium` | Image size: `small` (236px), `medium` (564px), `large` (original) |

#### English Search Example

```bash
curl "https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=motivational+quotes&count=3&size=large"
```

#### Arabic Search Example

```bash
curl "https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=%D8%A7%D9%82%D8%AA%D8%A8%D8%A7%D8%B3%D8%A7%D8%AA+%D8%AA%D8%AD%D9%81%D9%8A%D8%B2%D9%8A%D8%A9&count=3&size=large"
```

> 💡 Tip: URL-encode Arabic text, or just paste the Arabic URL directly in your browser/n8n — it works.

#### Response

```json
{
  "success": true,
  "query": "اقتباسات تحفيزية",
  "count": 3,
  "hasMore": true,
  "bookmark": "WyJQSU4iLDE3MzI5ODk...",
  "data": [
    {
      "id": "123456789",
      "title": "Believe in Yourself",
      "description": "Believe you can and you're halfway there.",
      "image": "https://i.pinimg.com/originals/abc123/image.jpg",
      "link": "https://www.pinterest.com/pin/123456789/",
      "extractedText": "Believe you can and you're halfway there.\n- Theodore Roosevelt",
      "language": "en",
      "langMatch": "english",
      "lenstext_full": "Believe you can and you're halfway there.\n- Theodore Roosevelt"
    }
  ]
}
```

#### Key Fields for n8n:

| Field | Description |
|---|---|
| `extractedText` | The full text extracted by Google Lens |
| `language` | Language detected by Google Lens (e.g., "en", "ar") |
| `langMatch` | Which language the server was targeting (`"arabic"` or `"english"`) |
| `lenstext_full` | Same as `extractedText` — for backwards compatibility |
| `image` | Direct image URL (use with `/api/pinterest/download`) |
| `link` | Direct link to the Pinterest pin |

---

### 6. Health Check 💚

```
GET /
```

Returns server status, login state, and all available endpoints.

```json
{
  "status": "alive",
  "name": "Pinterest API",
  "version": "1.2.0",
  "loggedIn": true,
  "note": "Set PINTEREST_EMAIL & PINTEREST_PASSWORD in env for search",
  "endpoints": {
    "search": "GET /api/pinterest/search?q=YOUR_QUERY&count=10&size=medium",
    "download": "GET /api/pinterest/download?url=IMAGE_URL",
    "ocr": "POST /api/pinterest/ocr { \"url\": \"IMAGE_URL\" }",
    "lens": "POST /api/pinterest/lens { \"url\": \"IMAGE_URL\" }",
    "searchWithOcr": "GET /api/pinterest/search-with-ocr?q=YOUR_QUERY&count=10&size=medium"
  }
}
```

---

## ⚡ Quick Reference — All Full URLs & How to Use in n8n HTTP Request

> Replace `https://pinterest-api.onrender.com` with your actual Render URL after deployment.

### 🇺🇸 English — Copy & Paste URLs

| Purpose | Method | Full URL |
|---|---|---|
| 🔍 **Search pins** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search?q=motivational+quotes&count=5&size=large` |
| 🔍+🔎 **Search + OCR (smart)** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=motivational+quotes&count=5&size=large` |
| 🔍+🔎 **Life lessons** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=life+lessons&count=5&size=large` |
| 🔍+🔎 **Inspirational** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=inspirational+quotes&count=5&size=large` |

### 🇸🇦 Arabic — روابط جاهزة للنسخ واللصق

| وش تبي | الرابط كامل |
|---|---|
| 🔍 **بحث إنجليزي** | `GET /api/pinterest/search?q=love+quotes&count=10` |
| 🔍 **بحث عربي** | `GET /api/pinterest/search?q=أقوال+مأثورة&count=10` |
| 🔍+🔎 **بحث ذكي إنجليزي** | `GET /api/pinterest/search-with-ocr?q=life+lessons&count=5` |
| 🔍+🔎 **بحث ذكي عربي** | `GET /api/pinterest/search-with-ocr?q=حكم+وعبر&count=5` |
| 🖼️ **تحميل صورة** | `GET /api/pinterest/download?url=IMAGE_URL` |
| 🔎 **استخراج نص** | `POST /api/pinterest/lens` Body: `{"url":"IMAGE_URL"}` |
| 💚 **فحص السيرفر** | `GET /` |

> ⚠️ **ملاحظة:** استبدل `pinterest-api.onrender.com` باسم السيرفر حقك بعد ما تنشره.

### 🇸🇦 Arabic — Copy & Paste URLs

| Purpose | Method | Full URL |
|---|---|---|
| 🔍 **بحث** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search?q=اقتباسات+تحفيزية&count=5&size=large` |
| 🔍+🔎 **بحث + Lens + عربي** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=اقتباسات+تحفيزية&count=5&size=large` |
| 🔍+🔎 **حكم وعبر** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=حكم+وعبر&count=5&size=large` |
| 🔍+🔎 **أقوال مأثورة** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=أقوال+مأثورة&count=5&size=large` |

### 🖼️ Download & OCR — Copy & Paste URLs

| Purpose | Method | URL / Body |
|---|---|---|
| 🖼️ **Download image** | `GET` | `https://pinterest-api.onrender.com/api/pinterest/download?url=https://i.pinimg.com/564x/abc123/image.jpg` |
| 🔎 **OCR (extract text)** | `POST` | `https://pinterest-api.onrender.com/api/pinterest/ocr` — Body: `{ "url": "https://i.pinimg.com/abc123/image.jpg" }` |
| 🔎 **Lens (extract text)** | `POST` | `https://pinterest-api.onrender.com/api/pinterest/lens` — Body: `{ "url": "https://i.pinimg.com/abc123/image.jpg" }` |
| 💚 **Health check** | `GET` | `https://pinterest-api.onrender.com/` |

---

### 🔧 How to Use in n8n HTTP Request Node

#### Option A: Simple Search (no text extraction)

**Node settings:**

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/search?q=اقتباسات+تحفيزية&count=5&size=large` |
| **Response Format** | `JSON` |

**Output you get:**
- `{{ $json.data }}` → array of pins with `id`, `title`, `description`, `image`, `link`

---

#### Option B: 🔥 Search + OCR (Smart — returns only meaningful pins in correct language) ⭐

**Node settings — English:**

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=motivational+quotes&count=5&size=large` |
| **Response Format** | `JSON` |

**Node settings — Arabic:**

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=اقتباسات+تحفيزية&count=5&size=large` |
| **Response Format** | `JSON` |

**Output you get per pin:**
| n8n Expression | What it gives you |
|---|---|
| `{{ $json.data[0].extractedText }}` | النص المستخرج من الصورة (الاقتباس) |
| `{{ $json.data[0].image }}` | رابط الصورة |
| `{{ $json.data[0].link }}` | رابط pin على Pinterest |
| `{{ $json.data[0].title }}` | عنوان pin |
| `{{ $json.data[0].language }}` | اللغة (ar / en) |
| `{{ $json.data[0].langMatch }}` | التأكيد (arabic / english) |

---

#### Option C: Download Image (save binary file)

**Node settings:**

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/download?url={{ $json.image }}` |
| **Response Format** | `File` |

> Use this after getting `image` URL from search results.

---

#### Option D: OCR / Lens — Extract Text from Any Image

**Node settings:**

| Setting | Value |
|---|---|
| **Method** | `POST` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/lens` |
| **Headers** | `Content-Type: application/json` |
| **Body** | `{ "url": "{{ $json.image }}" }` |
| **Response Format** | `JSON` |

**Output:** `{{ $json.text }}` contains the extracted text.

---

### ⭐ Full n8n Workflow: Search Arabic → Split → Download → Telegram

```
1. [HTTP Request] ← Search with OCR
   Method: GET
   URL: https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=اقتباسات+تحفيزية&count=3&size=large
   Response: JSON

2. [Item Lists → Split Out Items]
   This splits each pin into its own item

3. [Loop Over Items] ← For each pin

4.    ├── [HTTP Request] ← Download the image
   │   Method: GET
   │   URL: https://pinterest-api.onrender.com/api/pinterest/download?url={{ $json.image }}
   │   Response: File
   │
   └── [Telegram / Discord / Google Sheets]
       Message: 📜 {{ $json.extractedText }}
```

---

## 🧠 How Language Detection Works

The server automatically detects whether you're searching in **Arabic** or **English** and filters results accordingly.

### Detection Logic

```
User searches: "اقتباسات تحفيزية"
                     ↓
         detectQueryLanguage()
         → contains Arabic? YES
         → targetLang = "arabic"
                     ↓
        For each pin found on Pinterest:
          1. Google Lens extracts text from image
          2. checkIfMeaningful(text, "arabic"):
             - Is text long enough? (≥20 chars, ≥5 words)
             - Does it contain Arabic letters? ✅
                     ↓
        ✅ Arabic text found → add to results
        ❌ No Arabic → skip, search for next pin
```

```
User searches: "motivational quotes"
                     ↓
         detectQueryLanguage()
         → contains Arabic? NO
         → targetLang = "english"
                     ↓
        For each pin found on Pinterest:
          1. Google Lens extracts text from image
          2. checkIfMeaningful(text, "english"):
             - Is text long enough? (≥20 chars, ≥5 words)
             - Does it contain English letters? ✅
                     ↓
        ✅ English text found → add to results
        ❌ No English → skip, search for next pin
```

### Mixed Language Images

If an image contains **both Arabic and English** text, it's accepted for either search — as long as the target language is present.

- "ثق بنفسك - Theodore Roosevelt" → ✅ accepted for **Arabic** search
- "ثق بنفسك - Theodore Roosevelt" → ✅ accepted for **English** search

### Query Building (Fresh Results)

- **English queries:** Appended with a random English word + counter to prevent Pinterest caching
- **Arabic queries:** Only a counter is appended (no English words mixed in)
- Every search is unique — Pinterest CDN always serves fresh results

---

## 🔧 n8n Workflow Examples

### Workflow 1: Search Arabic Quotes & Save to Google Sheets

**Goal:** Search for Arabic motivational quotes, extract text from images, and save to Google Sheets.

```
[Schedule Trigger] (every 6 hours)
       ↓
[HTTP Request] → Search with OCR (Arabic)
       ↓
[Item Lists → Split Out Items]
       ↓
[Google Sheets] → Append rows
```

**Step 1 — HTTP Request Node:**

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/search-with-ocr?q=اقتباسات+تحفيزية&count=5&size=large` |
| **Response Format** | `JSON` |

**Step 2 — Split Out Items:**

Use **Item Lists → Split Out Items** node — it outputs one item per pin.

**Step 3 — Google Sheets Node:**

Map these fields:
- `{{ $json.title }}` → Column A (Title)
- `{{ $json.extractedText }}` → Column B (Quote Text) ← **The extracted quote from the image**
- `{{ $json.image }}` → Column C (Image URL)
- `{{ $json.link }}` → Column D (Pin Link)

### Workflow 2: Multi-Page Search (English)

**Goal:** Collect 50+ pins by paginating through results.

1. **HTTP Request** → `GET /api/pinterest/search?q=quotes&count=10`
2. **Extract** `$json.bookmark` from the response
3. **Loop Node** → HTTP Request with `&bookmark={{ $json.bookmark }}`
4. **Continue** until `hasMore` is `false` or you have enough pins

### Workflow 3: Scheduled Content Collector

**Goal:** Run daily, collect pins with text, download images, store everything.

```
[Schedule Trigger] (daily at 8 AM)
       ↓
[HTTP Request] → GET /api/pinterest/search-with-ocr?q=quotes&count=5
       ↓
[Item Lists → Split Out Items]
       ↓
[HTTP Request] → GET /api/pinterest/download?url={{ $json.image }}
[Response Format: File]
       ↓
[Write Binary File] → Save image to local/cloud storage
       ↓
[Telegram / Discord] → Send image + extracted text
```

**Telegram message template:**
```
📜 {{ $json.extractedText }}
🔗 [View on Pinterest]({{ $json.link }})
```

---

## 🧪 Local Development

### Prerequisites
- Node.js ≥ 18
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/pinterest-api.git
cd pinterest-api

# Install dependencies
npm install

# Install Chromium for Playwright
npx playwright install chromium

# Set your Pinterest credentials (required for search)
# Windows (Command Prompt):
set PINTEREST_EMAIL=your@email.com
set PINTEREST_PASSWORD=yourpassword

# Windows (PowerShell):
$env:PINTEREST_EMAIL = "your@email.com"
$env:PINTEREST_PASSWORD = "yourpassword"

# macOS / Linux:
export PINTEREST_EMAIL=your@email.com
export PINTEREST_PASSWORD=yourpassword

# Start the server
npm start
```

Visit: **http://localhost:3000**

### Testing Locally

```bash
# English search
curl "http://localhost:3000/api/pinterest/search?q=quotes&count=3"

# Arabic search with OCR
curl "http://localhost:3000/api/pinterest/search-with-ocr?q=اقتباسات&count=3"

# OCR on any image
curl -X POST "http://localhost:3000/api/pinterest/ocr" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://i.pinimg.com/originals/abc123/image.jpg"}'

# Health check
curl "http://localhost:3000/"
```

### Windows Playwright Troubleshooting

If Playwright fails to launch, try:

```bash
# Force install Chromium
npx playwright install chromium --force

# Or use Playwright system-deps check
npx playwright install-deps chromium
```

If you have Chrome/Edge installed, Playwright can reuse it — no extra download needed.

---

## 🐳 Docker

### Build & Run Locally

```bash
docker build -t pinterest-api .
docker run -p 3000:3000 \
  -e PINTEREST_EMAIL=your@email.com \
  -e PINTEREST_PASSWORD=yourpassword \
  pinterest-api
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  pinterest-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PINTEREST_EMAIL=your@email.com
      - PINTEREST_PASSWORD=yourpassword
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

---

## 📁 Project Structure

```
pinterest-api/
├── .dockerignore        ← Ignores node_modules in Docker build
├── .gitignore           ← Ignores node_modules, .env, logs
├── Dockerfile           ← Docker image (Node 20-slim + Chromium)
├── package.json         ← Dependencies & scripts
├── package-lock.json    ← Locked dependency versions
├── server.js            ← 🎯 Main API server (all endpoints + logic)
└── README.md            ← This file
```

**Single-file architecture** — everything is in `server.js`. No complex folder structure, no configuration files. Deploy and go.

---

## 🤔 How It Works

### 1. Pinterest Search
The server uses **Playwright (Chromium)** — a headless browser — to navigate Pinterest and **intercept Pinterest's internal API responses** (`BaseSearchResource/get`). This gives you real Pinterest results without reverse-engineering their private API or dealing with rate limits.

### 2. Fresh Results (Anti-Cache)
Pinterest aggressively caches search results. To bypass this, every search query is modified:
- **English queries:** Appended with a **random real English word** (from a pool of 100+) + a **rotating counter**
- **Arabic queries:** Appended with only a **rotating counter** (no English filler words)
- Result: Searching "quotes" 10 times gives 10 different result sets

### 3. Smart Language Detection
The server checks if your query contains **Arabic Unicode characters**:
- If YES → `targetLang = "arabic"` → pins must have Arabic text to be accepted
- If NO → `targetLang = "english"` → pins must have English/Latin text to be accepted
- Pins in the wrong language are **automatically skipped**

### 4. Google Lens OCR
The `chrome-lens-ocr` package sends images to **Google Lens** and returns the extracted text. Unlike Tesseract, Lens handles:
- Stylized/artistic fonts (common on quote images)
- Handwriting
- Complex backgrounds
- Arabic calligraphy
- Text at angles

### 5. Meaningful Text Filter
After OCR, the server checks if the text is actually meaningful:
- ✅ At least **5 words**
- ✅ At least **20 characters**
- ✅ Contains actual **letters** (not just emojis/symbols)
- ✅ Contains the **correct language** (Arabic or English)
- If any check fails → **skip the pin, search for another**

### 6. Anti-Duplicate
The server tracks seen pin IDs in memory and filters out duplicates. The cache automatically clears at 5,000 pins to prevent memory bloat (~200 KB).

---

## 💡 Tips & Tricks

| Tip | Details |
|---|---|
| 🌍 **Arabic & English** | Search in either language — the API auto-detects and filters results |
| 🔍 **Use `search-with-ocr`** | The smart endpoint — returns only pins with meaningful text in the correct language |
| 📏 **Image Size** | `large` = best for OCR accuracy; `small` = fastest downloads |
| 📄 **Pagination** | Pass `bookmark` from previous response for exact page control |
| ⏱️ **Cold Starts** | Render free plan sleeps after 15 min → first request takes ~10s. UptimeRobot prevents this |
| 💰 **Cost** | **$0/month** — Render free plan + UptimeRobot free plan |
| 🔄 **Rate Limits** | Render free plan handles thousands of requests per day |
| 🔐 **Pinterest Login** | Required for search. Use a throwaway account. Create one at pinterest.com |
| 🐳 **Docker Runtime** | Must use Docker on Render (not Node) — Chromium needs system libraries |

---

## ❌ Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| Search returns 0 results | Missing Pinterest credentials | Set `PINTEREST_EMAIL` and `PINTEREST_PASSWORD` in Render env vars |
| Arabic search returns English pins only | Pinterest has limited Arabic results for that keyword | Try different Arabic keywords, increase `count` |
| Search always returns 0 for Arabic | Pinterest login failed with Arabic locale | Make sure your Pinterest account is confirmed and can access Arabic content |
| OCR returns empty text | Image has no clear text, or Lens failed | Try a different image with more prominent text |
| Server slow on first request | Render cold start | Use UptimeRobot to ping every 5 minutes |
| "Cannot find playwright" | Runtime set to Node instead of Docker | Change Render service to **Docker** runtime |
| Login keeps failing | Pinterest blocking login from your IP | Try a US-based region on Render (Oregon). Use a confirmed Pinterest account |
| Docker build fails | System dependency issue | The Dockerfile includes all required libs. Make sure you're using `FROM node:20-slim` |
| High memory usage | Playwright browser | Normal for Playwright. Render 512 MB plan is sufficient |
| Arabic OCR returns garbled text | Lens detected wrong language | Try a higher resolution image (`size=large`) |
| "bookmark" is empty in response | No more pages available | `hasMore` will be `false` — you've reached the end of results |

---

## 📝 License

MIT — do whatever you want. Contributions welcome!

---

> Built with ❤️ for n8n creators, content collectors, and quote enthusiasts.
