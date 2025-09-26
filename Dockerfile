# Use official Node.js image
FROM node:20-slim

# Install Chromium for puppeteer-core
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-common \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy server code
COPY . .

# Expose app port
EXPOSE 10000

# Env var for puppeteer-core executable
ENV CHROME_PATH=/usr/bin/chromium

# Start app
CMD ["npm", "start"]
