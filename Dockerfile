# Pinterest API - Dockerized for Render
FROM node:20-slim

WORKDIR /app

# Install system Chromium (needed by chrome-lens-ocr)
RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package.json ./

# Install Node dependencies
RUN npm install

# Install Chromium for Playwright (for Pinterest search)
RUN npx playwright install --with-deps chromium

# Copy source code
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
