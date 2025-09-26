// server.js
import express from "express";
import puppeteer from "puppeteer-core"; // use puppeteer-core with Browserless

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

// Browserless configuration
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_KEY || "2T7w2kaHQ7LUI253ac8ae133e2ef17c391b2d066e2a19e02a2T7w2kaHQ7LUI253ac8ae133e2ef17c391b2d066e2a19e02a";
const BROWSERLESS_URL = `wss://chrome.browserless.io?token=${BROWSERLESS_API_KEY}`;

async function getBrowser() {
  return puppeteer.connect({ browserWSEndpoint: BROWSERLESS_URL });
}

// PGN extractor
async function getPgn(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    const moves = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".main-line-row")).flatMap(row => {
        const white = row.querySelector(".white-move .node-highlight-content")?.innerText?.trim();
        const black = row.querySelector(".black-move .node-highlight-content")?.innerText?.trim();
        return [white, black].filter(Boolean);
      })
    );

    if (!moves?.length) return null;

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }
    return pgn.trim();
  } finally {
    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

// API route
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });

    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    res.json({ ok: true, pgn });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// Cleanup
process.on("SIGINT", async () => { process.exit(); });
process.on("exit", async () => {});

// Start server
app.listen(PORT, () => console.log(`✅ Browserless PGN server running on port ${PORT}`));
