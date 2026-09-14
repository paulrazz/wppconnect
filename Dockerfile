FROM node:20-slim

# Install Google Chrome Stable + all its deps (Puppeteer-recommended Docker approach)
RUN apt-get update && apt-get install -y wget gnupg ca-certificates --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip downloading its own Chrome bundle and use system Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Install root deps
COPY package*.json ./
RUN npm install

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
