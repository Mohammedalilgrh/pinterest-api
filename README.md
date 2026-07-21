# Pinterest API — Search, Download & Extract Text from Images

A **self-hosted API** that searches Pinterest, downloads images, and extracts text from images (OCR). Designed for **n8n HTTP Request nodes**.

### What You Can Do
- 🔍 **Search** any niche on Pinterest → get image URLs, titles, pin links
- 🖼️ **Download** any image → save it locally or to cloud storage
- 📝 **OCR** → extract text/quotes from images (free, no API key needed)

---

## 🚀 Deploy to Render (Free — 10 minutes)

### Step 1: Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Create a repository called `pinterest-api` (or any name)
3. Run these commands in your terminal:

```bash
cd "C:\Users\lraq laptop\Desktop\pinterest-api"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pinterest-api.git
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** → **Web Service**
2. Connect your GitHub and select `pinterest-api`
3. Fill in these settings:

| Field | Value |
|---|---|
| **Name** | `pinterest-api` |
| **Runtime** | **Docker** (important — needed for Chromium) |
| **Branch** | `main` |
| **Plan** | **Free** (512 MB RAM, works perfectly with Playwright) |

4. Under **Environment Variables**, add these:

| Key | Value | Required? |
|---|---|---|
| `PINTEREST_EMAIL` | Your Pinterest account email | ✅ Yes for search |
| `PINTEREST_PASSWORD` | Your Pinterest account password | ✅ Yes for search |

5. Click **Deploy Web Service**
6. Wait 3-5 minutes for the build to finish
7. Your URL will be: `https://pinterest-api.onrender.com`

> ⚠️ **Note:** Pinterest requires a logged-in account to search. Create a free Pinterest account just for this API, then set the email/password in the Render environment variables.

### Step 3: Keep it Alive with UptimeRobot

1. Go to [uptimerobot.com](https://uptimerobot.com) (free plan)
2. Click **Add New Monitor**
3. Set:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Pinterest API
   - **URL:** `https://pinterest-api.onrender.com/`
   - **Interval:** 5 minutes
4. Click **Create Monitor**
5. Render free plan sleeps after 15 min of inactivity — UptimeRobot keeps it awake

---

## 📡 API Endpoints

### 1. Search Pinterest 🔍

```
GET /api/pinterest/search
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `q` (or `query`, `search`) | ✅ Yes | — | Your niche / keyword |
| `count` (or `limit`) | ❌ No | `10` | Number of results (1-50) |
| `size` | ❌ No | `medium` | `small` = 236px, `medium` = 564px, `large` = original |

**Example request:**
```
GET https://pinterest-api.onrender.com/api/pinterest/search?q=motivational+quotes&count=5&size=large
```

**Example response:**
```json
{
  "success": true,
  "query": "motivational quotes",
  "count": 5,
  "data": [
    {
      "id": "123456789",
      "title": "Believe in Yourself - Inspirational Quote",
      "description": "Believe you can and you're halfway there. - Theodore Roosevelt",
      "image": "https://i.pinimg.com/originals/abc123/image.jpg",
      "link": "https://www.pinterest.com/pin/123456789/"
    }
  ]
}
```

### 2. Download Image 🖼️

Download the actual image file (binary). The URL comes from the search results.

```
GET /api/pinterest/download?url=https://i.pinimg.com/...
```

**Example:**
```
GET https://pinterest-api.onrender.com/api/pinterest/download?url=https://i.pinimg.com/originals/abc123/image.jpg
```

> Response is binary image data. In n8n, set **Response Format → File** to save it.

### 3. OCR — Extract Text from Image 📝

Extract text/quotes from any image. Works great for quote graphics, signs, and screenshots.

```
POST /api/pinterest/ocr
Content-Type: application/json

{
  "url": "https://i.pinimg.com/originals/abc123/image.jpg"
}
```

**Response (1-3 seconds):**
```json
{
  "success": true,
  "text": "Believe you can and you're halfway there.\n- Theodore Roosevelt",
  "confidence": 0.92
}
```

### 4. Health Check 💚
```
GET /
```

Returns the server status and all available endpoints.

---

## 🔧 Using in n8n

### Workflow: Search Pinterest, Get Images & Extract Quotes

```
[HTTP Request] Search Pinterest
        ↓
[Loop Over Items] for each pin
        ├──→ [HTTP Request] Download image → [Write Binary File]
        └──→ [HTTP Request] OCR → [Filter] text not empty → [Save to DB / Google Sheets]
```

#### Step 1: HTTP Request Node — Search

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/search` |
| **Query Parameters** | `q` = `your search term`, `count` = `10`, `size` = `large` |
| **Response Format** | `JSON` |

Output: `{{ $json.data }}` is an array of pins with `id`, `title`, `description`, `image`, `link`

#### Step 2: Loop Over Items

```javascript
// In the Loop node's settings pane
const items = $input.all();
const loopItems = $json.data || [];
return loopItems;
```

#### Step 3: HTTP Request Node — Download (inside loop)

| Setting | Value |
|---|---|
| **Method** | `GET` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/download?url={{ $json.image }}` |
| **Response Format** | `File` |

#### Step 4: HTTP Request Node — OCR (inside loop)

| Setting | Value |
|---|---|
| **Method** | `POST` |
| **URL** | `https://pinterest-api.onrender.com/api/pinterest/ocr` |
| **Body** | `{ "url": "{{ $json.image }}" }` |
| **Headers** | `Content-Type`: `application/json` |
| **Response Format** | `JSON` |

---

## 🧪 Local Testing

Want to test before deploying?

```bash
cd "C:\Users\lraq laptop\Desktop\pinterest-api"
npm install
npm start
```

Then visit: `http://localhost:3000/`

To test search locally, set your Pinterest credentials:
```bash
set PINTEREST_EMAIL=your@email.com
set PINTEREST_PASSWORD=yourpassword
npm start
```

---

## 📁 Project Files

```
pinterest-api/
├── server.js          ← All API endpoints + Pinterest scraper
├── package.json       ← Dependencies
├── Dockerfile         ← Docker config for Render (installs Chromium)
├── .gitignore         ← Ignores node_modules
└── README.md          ← This file
```

---

## 📝 Notes & Tips

- **Search works best when logged in.** Pinterest requires authentication for search results. Create a free throwaway Pinterest account.
- **The server uses Playwright (Chromium).** It runs a headless browser to load Pinterest and intercept the internal API. Takes 3-5 seconds per search.
- **OCR is free** and runs locally using Tesseract.js. No API keys needed.
- **Image size:** Pinterest images have different resolutions:
  - `small` = 236px width (fast)
  - `medium` = 564px width (good balance)
  - `large` = Original resolution (best quality, larger file)
- **Rate limits:** Render free plan handles thousands of requests per day easily.
- **Cost:** $0/month — Render free plan + UptimeRobot free plan.

### Troubleshooting

| Problem | Solution |
|---|---|
| Search returns 0 results | Make sure `PINTEREST_EMAIL` and `PINTEREST_PASSWORD` are set in Render env vars |
| OCR returns empty text | The image may not have clear text. Try a different image. |
| Server slow on first request | Render cold starts after inactivity. UptimeRobot pings prevent this. |
| "Cannot find playwright" | Make sure you're using **Docker** runtime on Render, not Node. |
| Login keeps failing | Pinterest may block login from certain IPs. Use a US-based region on Render. |

---

## 📜 License

MIT — do whatever you want.
