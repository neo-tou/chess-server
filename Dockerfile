# Use the official Puppeteer image which includes Chrome and deps
# Replace the tag with the Puppeteer version you're using (example: 22.10.0 -> adjust if needed)
FROM ghcr.io/puppeteer/puppeteer:22.10.0

# Set working directory
WORKDIR /usr/src/app

# Avoid Puppeteer downloading Chromium again
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# The path inside the Puppeteer base image (confirm path later if needed)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copy package files and install dependencies
COPY package*.json ./
# Use npm ci if you have package-lock.json for reproducible builds (faster)
RUN npm ci --production

# Copy app code
COPY . .

# Expose the port your app will listen on
EXPOSE 10000

# Start command (Render will run container CMD)
CMD ["node", "server.js"]
