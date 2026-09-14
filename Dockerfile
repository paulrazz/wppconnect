FROM node:20-slim

# Install Chromium + all system libs it needs
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading its own Chrome bundle
# and use the system Chromium we just installed
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install root deps (concurrently etc.)
COPY package*.json ./
RUN npm install --omit=dev || npm install

# Install & build client
COPY client/package*.json ./client/
RUN npm install --prefix client
RUN npm run build --prefix client

# Install server deps
COPY server/package*.json ./server/
RUN npm install --prefix server

# Copy full source
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
