// server.js
import express from "express";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * Puppeteer launch options
 * - Use PUPPETEER_EXECUTABLE_PATH if provided (container path to Chrome)
 * - Use headless 'new' where supported
 */
const PUPPETEER_OPTIONS = {
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    // optionally add more flags if you see crashes
    // '--disable-extensions',
    // '--disable-background-networking'
  ],
  defaultViewport: { width: 1280, height: 720 },
};

// prefer env var names used previously
const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
if (execPath) PUPPETEER_OPTIONS.executablePath = execPath;

/**
 * Keep a single browser instance and relaunch if it's closed/crashed.
 * This is resilient: if the browser dies, next getBrowser() will relaunch.
 */
let browser = null;
async function getBrowser() {
  try {
    if (browser && typeof browser.isConnected === "function" && browser.isConnected()) {
      return browser;
    }
    // if previous browser exists but not connected, try to close quietly
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
      browser = null;
    }
    // launch a fresh browser
    browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    console.log("✅ Puppeteer browser launched");
    return browser;
  } catch (err) {
    console.error("❌ Error launching Puppeteer:", err);
    // make sure browser is null so subsequent calls will retry
    browser = null;
    throw err;
  }
}

/** small helper to sleep without using page.waitForTimeout (compat) */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * getPgn(url)
 * - Opens a new page, blocks images/styles/fonts to save memory/time,
 * - Navigates to URL and extracts moves from .main-line-row selector.
 * - Defensive: timeouts, try/catch, and cleans up listeners and pages.
 */
async function getPgn(url) {
  if (!url || typeof url !== "string") throw new Error("Invalid URL");

  const b = await getBrowser();
  const page = await b.newPage();

  // set sensible timeouts
  page.setDefaultNavigationTimeout(45000);
  page.setDefaultTimeout(45000);

  // small performance/user-agent tweaks
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );
  } catch (e) {
    // ignore setUserAgent errors (very rare)
  }

  // request interception to block unnecessary resources
  let reqHandler = null;
  try {
    await page.setRequestInterception(true);
    reqHandler = (req) => {
      try {
        const t = req.resourceType();
        if (t === "image" || t === "stylesheet" || t === "font" || t === "media") {
          return req.abort();
        }
        return req.continue();
      } catch (e) {
        // if something goes wrong with interception, continue the request
        try { req.continue(); } catch {}
      }
    };
    page.on("request", reqHandler);
  } catch (e) {
    // some environments may not allow request interception; continue anyway
    console.warn("⚠️ request interception not enabled:", e?.message || e);
  }

  try {
    // navigate
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // small extra wait for dynamic content (compat replacement for waitForTimeout)
    await sleep(1000);

    // wait for the moves container (may throw if selector not found)
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    // evaluate moves in page context
    const moves = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".main-line-row"));
      return rows.flatMap((row) => {
        const white = row.querySelector(".white-move .node-highlight-content")?.innerText?.trim();
        const black = row.querySelector(".black-move .node-highlight-content")?.innerText?.trim();
        return [white, black].filter(Boolean);
      });
    });

    if (!moves || moves.length === 0) return null;

    // build PGN string
    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const moveNumber = Math.floor(i / 2) + 1;
      const white = moves[i] || "";
      const black = moves[i + 1] || "";
      pgn += `${moveNumber}. ${white} ${black} `;
    }
    return pgn.trim();
  } finally {
    // remove request listener and close page cleanly
    try {
      if (reqHandler) page.removeListener("request", reqHandler);
    } catch (e) {}
    try { await page.close(); } catch (e) {}
  }
}

/**
 * POST /fetch-pgn
 * Accepts: { "url": "<chess game url>" }
 */
app.post("/fetch-pgn", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });

    // Basic quick validation (helps avoid unnecessary Puppeteer runs)
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: "Invalid URL" });
    }

    // Attempt extraction with a timeout guard
    const pgn = await getPgn(url);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });

    return res.json({ ok: true, pgn });
  } catch (err) {
    console.error("❌ /fetch-pgn error:", err);
    // return helpful error message for debugging (safe to show message)
    return res.status(500).json({ ok: false, error: "server error", message: err.message });
  }
});

// health
app.get("/health", (req, res) => res.json({ ok: true, running: true }));

// graceful shutdown
process.on("SIGINT", async () => {
  console.log("SIGINT received, closing browser...");
  try { if (browser) await browser.close(); } catch (e) {}
  process.exit(0);
});
process.on("exit", async () => {
  try { if (browser) await browser.close(); } catch (e) {}
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Puppeteer PGN server listening on ${PORT}`));
