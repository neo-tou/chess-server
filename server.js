﻿// server.js
import express from "express";
import puppeteer from "puppeteer-core"; // use puppeteer-core instead of puppeteer

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Puppeteer launch options
const PUPPETEER_OPTIONS = {
  headless: true,
  executablePath:
    process.env.CHROME_PATH || "/usr/bin/chromium-browser" || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--single-process",
  ],
};

let browser;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch(PUPPETEER_OPTIONS);
  }
  return browser;
}

// PGN extraction
async function getPgn(url) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // wait for move list container
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    const moves = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".main-line-row")).flatMap(
        (row) => {
          const white = row.querySelector(
            ".white-move .node-highlight-content"
          )?.innerText?.trim();
          const black = row.querySelector(
            ".black-move .node-highlight-content"
          )?.innerText?.trim();
          return [white, black].filter(Boolean);
        }
      );
    });

    if (!moves || moves.length === 0) return null;

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }

    return pgn.trim();
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

// API route
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ ok: false, error: "Missing URL" });
    }

    const pgn = await getPgn(url);
    if (!pgn) {
      return res.status(404).json({ ok: false, error: "PGN not found" });
    }

    res.json({ ok: true, pgn });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit();
});

process.on("exit", async () => {
  if (browser) await browser.close();
});

// Start server
app.listen(PORT, () =>
  console.log(`✅ Puppeteer PGN server running on port ${PORT}`)
);
