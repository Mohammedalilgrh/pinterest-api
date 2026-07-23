# Pinterest API - Dockerized for Render
# Uses Playwright with Chromium for Pinterest search

FROM node:20-slim

WORKDIR /app

# Copy package files first
COPY package.json ./

# Install Node dependencies
RUN npm install

# Install Chromium for Playwright with all system deps automatically
RUN npx playwright install --with-deps chromium

# Copy source code
COPY . .

EXPOSE 3000

# Use exec form — crucial for Render to properly signal the process
CMD ["node", "server.js"]
