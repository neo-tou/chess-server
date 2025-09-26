# Use official Node.js image
FROM node:20-slim

# Install Chromium and dependencies for puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
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

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies (full puppeteer will download its own Chromium too)
RUN npm install --production

# Copy server code
COPY . .

# Set Chromium path for puppeteer
ENV CHROME_PATH=/usr/bin/chromium

# Expose port
EXPOSE 10000

# Start the server
CMD ["npm", "start"]
