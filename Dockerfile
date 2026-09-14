FROM node:20-slim

# Install Google Chrome Stable for Puppeteer/WhatsApp
RUN apt-get update && apt-get install -y wget gnupg ca-certificates --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Copy and install server only
COPY server/package*.json ./server/
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends
RUN npm install --prefix server
RUN npm rebuild sqlite3 --prefix server --build-from-source

COPY server/ ./server/

EXPOSE 8080

CMD ["npm", "start", "--prefix", "server"]
