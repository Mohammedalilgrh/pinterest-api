# Pinterest API — Search, Download & Extract Text from Images

A **self-hosted Node.js API** that searches Pinterest, downloads images, and extracts text using Google Lens OCR. Built for **n8n**, **Make (Integromat)**, or any HTTP client.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Docker](https://img.shields.io/badge/deploy-docker-blueviolet)

---

## 🚀 Quick Deploy (Render — Free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/new?type=web)

### 1. Fork / Clone this Repo

```bash
git clone https://github.com/YOUR_USERNAME/pinterest-api.git
cd pinterest-api
```

### 2. Deploy on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. Connect your GitHub repo
3. Use these settings:

| Field | Value |
|---|---|
| **Name** | `pinterest-api` |
| **Runtime** | **Docker** ⚠️ (Must be Docker, not Node) |
| **Branch** | `main` |
| **Plan** | **Free** |

4. Add **Environment Variables**:

| Key | Required | Description |
|---|---|---|
| `PINTEREST_EMAIL` | ✅ | Your Pinterest login email |
| `PINTEREST_PASSWORD` | ✅ | Your Pinterest login password |
| `PORT` | ❌ | Defaults to `3000` |

5. Click **Create Web Service** and wait 3–5 minutes for the build.
6. Your URL: `https://pinterest-api.onrender.com`

> ⚠️ **Important:** Pinterest requires a logged-in account to show search results. Create a **free throwaway Pinterest account** and use those credentials.

### 3. Keep It Alive (UptimeRobot)

Render free plan **sleeps after 15 minutes of inactivity**. Use UptimeRobot to ping every 5 minutes:

1. Go to [uptimerobot.com](https://uptimerobot.com) (free)
2. **Add New Monitor** → HTTP(s) → URL: `https://pinterest-api.onrender.com/`
3. Interval: **5 minutes**

---

## 📡 API Endpoints — Full Reference

### 1. Search Pinterest 🔍

```
GET /api/pinterest/search?q=KEYWORD&count=10&size=medium&bookmark=
```

#### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | The search keyword / niche |
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

Pass the `bookmark` from one response to the next request to get the exact next page:

```bash
# First request
GET /api/pinterest/search?q=quotes&count=5
# → "bookmark": "WyJQSU4iLDE3MzI5ODk..."

# Second request (next page)
GET /api/pinterest/search?q=quotes&count=5&bookmark=WyJQSU4iLDE3MzI5ODk...
```

---

### 2. Download Image 🖼️

Download any Pinterest image as binary data.

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

Extract text from any image using **Google Lens**. Much more accurate than Tesseract — handles stylized fonts, handwriting, and complex backgrounds.

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

Alias for the OCR endpoint — same functionality.

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

### 5. Search with OCR 🔍+🔎

Searches Pinterest and **automatically runs OCR on each pin image**, re-searching until it finds pins with meaningful text.

```
GET /api/pinterest/search-with-ocr?q=KEYWORD&count=10&size=medium
```

#### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | **required** | Search keyword |
| `count` | int | `10` | Number of meaningful results |
| `size` | string | `medium` | Image size |

#### Response

```json
{
  "success": true,
  "query": "motivational quotes",
  "count": 5,
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
      "lenstext_full": "Believe you can and you're halfway there.\n- Theodore Roosevelt"
    }
  ]
}
```

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
    "bookmark": "Pass &bookmark=VALUE from previous response for next page",
    "download": "GET /api/pinterest/download?url=IMAGE_URL",
    "ocr": "POST /api/pinterest/ocr { \"url\": \"IMAGE_URL\" }",
    "lens": "POST /api/pinterest/lens { \"url\": \"IMAGE_URL\" }",
    "searchWithOcr": "GET /api/pinterest/search-with-ocr?q=YOUR_QUERY&count=10&size=medium"
  }
}
```

---

## 🔧 n8n Workflow Examples

### Workflow 1: Search Pinterest & Get Quote Images

```text
[HTTP Request] → Search Pinterest
       ↓
[Item Lists → Split Out Items]
       ↓
[Loop Over Items] for each pin
       ├── → [HTTP Request] Download image
       └── → [HTTP Request] Extract text via Lens
       ↓
[Google Sheets / Telegram / Notion] → Save results
```

**Step 1 — HTTP Request Node (Search):**

| Setting | Value |
|---|---|
| Method | `GET` |
| URL | `https://pinterest-api.onrender.com/api/pinterest/search?q=your+keyword&count=10&size=large` |
| Response Format | `JSON` |

Output path: `$json.data` — an array of pins.

**Step 2 — Split Out Items:**

Use **Item Lists → Split Out Items** to process each pin individually.

**Step 3 — HTTP Request Node (Download):**

| Setting | Value |
|---|---|
| Method | `GET` |
| URL | `https://pinterest-api.onrender.com/api/pinterest/download?url={{ $json.image }}` |
| Response Format | `File` |

**Step 4 — HTTP Request Node (Lens OCR):**

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `https://pinterest-api.onrender.com/api/pinterest/lens` |
| Body | `{ "url": "{{ $json.image }}" }` |
| Headers | `Content-Type: application/json` |
| Response Format | `JSON` |

Output: `$json.text` contains the extracted quote.

### Workflow 2: Multi-Page Search

Use an **n8n Loop** node to paginate through results:

1. **HTTP Request** → Search with `?q=quotes&count=10`
2. Extract `bookmark` from response
3. **Loop** → use bookmark from previous iteration in `&bookmark={{ $json.bookmark }}`
4. Continue until `hasMore` is `false`

### Workflow 3: Scheduled Quote Collector

1. **Schedule Trigger** (e.g., every 6 hours)
2. **HTTP Request** → `GET /api/pinterest/search-with-ocr?q=life+quotes&count=5`
3. **Item Lists** → filter out pins with empty `extractedText`
4. **Google Sheets** → append rows with title, quote, image URL, pin link

---

## 🧪 Local Development

### Prerequisites
- Node.js ≥ 18
- Playwright system dependencies (see Dockerfile)

### Setup

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/pinterest-api.git
cd pinterest-api

# Install dependencies
npm install

# Install Chromium for Playwright
npx playwright install chromium

# Set credentials (optional — search works without, but results are limited)
set PINTEREST_EMAIL=your@email.com
set PINTEREST_PASSWORD=yourpassword

# Start
npm start
```

Visit: `http://localhost:3000`

### Windows Users

If you get Playwright errors, install the browser manually:

```bash
npx playwright install chromium
```

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

---

## 📁 Project Structure

```
pinterest-api/
├── server.js            ← Main API server (all endpoints)
├── package.json         ← Dependencies & scripts
├── Dockerfile           ← Docker image (installs Chromium)
├── .gitignore           ← Ignores node_modules, .env, logs
├── .dockerignore        ← Ignores node_modules in Docker build
└── README.md            ← This file
```

---

## 🤔 How It Works

### Search
The server uses **Playwright (Chromium)** to launch a headless browser, navigate to Pinterest, and intercept Pinterest's internal API responses (`BaseSearchResource/get`). This gets you real Pinterest results without reverse-engineering their API.

### Fresh Results
Every search query is appended with a **random real word** + a **rotating counter** so Pinterest's CDN serves fresh results instead of returning cached JSON. The same keyword searched 10 times will produce 10 different sets of results.

### OCR via Google Lens
The `chrome-lens-ocr` package sends images to Google Lens and returns extracted text. Works on:
- Stylized quote graphics
- Screenshots
- Handwriting
- Signs & posters
- Complex backgrounds

### Anti-Duplicate
The server tracks seen pin IDs in memory and filters out duplicates. The cache clears at 5,000 pins to prevent memory bloat (~200 KB).

---

## 💡 Tips & Tricks

| Tip | Detail |
|---|---|
| **Best Results** | Use the `search-with-ocr` endpoint to get only pins with meaningful text |
| **Image Sizes** | Small (236px) for speed, Large (original quality) for best OCR accuracy |
| **Rate Limits** | Render free plan handles thousands of requests/day |
| **Cold Starts** | Render free plan sleeps after 15 min, takes ~10s to wake up |
| **Cost** | **$0/month** — Render free plan + UptimeRobot free plan |
| **Multiple Niches** | Each `q` parameter value can be a different niche: `?q=travel+quotes`, `?q=fitness+motivation` |

---

## ❗ Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| Search returns 0 results | Missing Pinterest credentials | Set `PINTEREST_EMAIL` and `PINTEREST_PASSWORD` in Render env vars |
| OCR returns empty text | Image has no clear text | Try a different image with more text |
| Server slow on first request | Render cold start | UptimeRobot pings prevent this |
| "Cannot find playwright" | Runtime set to Node, not Docker | Change Render service to **Docker** runtime |
| Login keeps failing | Pinterest blocking your IP | Try a US-based region on Render (Oregon) |
| Docker build fails on Windows | Volume path format | Use forward slashes in docker-compose paths |
| Playwright fails to launch | Missing system dependencies | The Dockerfile includes all required libs; use `FROM node:20-slim` |
| High memory usage | Playwright browser | Render free plan (512 MB) is enough for Playwright |

---

## 📝 License

MIT — do whatever you want. Contributions welcome!
