// server.js
import express from "express";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Browserless config
const BROWSERLESS_API_KEY = process.env.BROWSERLESS_KEY || "<YOUR_API_KEY>";
const BROWSERLESS_URL = `wss://chrome.browserless.io?token=${BROWSERLESS_API_KEY}`;

// Helper to connect browser
async function getBrowser() {
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: BROWSERLESS_URL,
      defaultViewport: null,
    });
    return browser;
  } catch (err) {
    console.error("❌ Failed to connect to Browserless:", err.message);
    throw new Error("Browserless connection failed");
  }
}

// PGN extractor
async function getPgn(url) {
  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();

    console.log("🌐 Navigating to", url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    await page.waitForSelector(".main-line-row", { timeout: 20000 });
    const moves = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".main-line-row")).flatMap(row => {
        const white = row.querySelector(".white-move .node-highlight-content")?.innerText?.trim();
        const black = row.querySelector(".black-move .node-highlight-content")?.innerText?.trim();
        return [white, black].filter(Boolean);
      })
    );

    if (!moves.length) {
      console.warn("⚠️ No moves found on the page");
      return null;
    }

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }
    return pgn.trim();
  } catch (err) {
    console.error("❌ Error extracting PGN:", err.message);
    throw err;
  } finally {
    if (page) try { await page.close(); } catch {}
    if (browser) try { await browser.close(); } catch {}
  }
}

// API route
app.post("/fetch-pgn", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });

  try {
    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });
    res.json({ ok: true, pgn });
  } catch (err) {
    res.status(500).json({ ok: false, error: "server error", message: err.message });
  }
});

// Cleanup
process.on("SIGINT", async () => process.exit());
process.on("exit", async () => {});

// Start server
app.listen(PORT, () => console.log(`✅ Browserless PGN server running on port ${PORT}`));
