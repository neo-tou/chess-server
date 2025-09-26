// server.js (hardened Browserless + puppeteer-core)
import express from "express";
import puppeteer from "puppeteer-core";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- Config ----------
const BROWSERLESS_KEY = process.env.BROWSERLESS_KEY;
if (!BROWSERLESS_KEY) {
  console.error("FATAL: BROWSERLESS_KEY is not set. Set env var BROWSERLESS_KEY and redeploy.");
  process.exit(1);
}
const BROWSERLESS_WSE = `wss://chrome.browserless.io?token=${BROWSERLESS_KEY}`;

const MAX_CONCURRENT_PAGES = parseInt(process.env.MAX_CONCURRENT_PAGES || "3", 10);
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT || "60000", 10);
const SELECTOR_TIMEOUT = parseInt(process.env.SELECTOR_TIMEOUT || "20000", 10);
const REQUEST_USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------- Simple concurrency semaphore ----------
let current = 0;
const queue = [];
function acquireSlot() {
  return new Promise((resolve) => {
    if (current < MAX_CONCURRENT_PAGES) {
      current++;
      return resolve();
    }
    queue.push(resolve);
  });
}
function releaseSlot() {
  current = Math.max(0, current - 1);
  if (queue.length > 0) {
    const next = queue.shift();
    current++;
    next();
  }
}

// ---------- Browser connection manager ----------
let browser = null;
let connecting = false;
async function connectBrowser(retries = 3, delay = 1000) {
  if (browser && browser.isConnected && browser.isConnected()) return browser;
  if (connecting) {
    // wait until connect finishes
    while (connecting) await new Promise((r) => setTimeout(r, 200));
    if (browser && browser.isConnected && browser.isConnected()) return browser;
  }
  connecting = true;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(new Date().toISOString(), `Connecting to Browserless (attempt ${attempt})...`);
      browser = await puppeteer.connect({
        browserWSEndpoint: BROWSERLESS_WSE,
        ignoreHTTPSErrors: true,
        defaultViewport: null,
      });
      console.log(new Date().toISOString(), "Connected to Browserless.");
      connecting = false;
      // Optional: handle disconnect event to null the browser
      browser.on && browser.on("disconnected", () => {
        console.warn(new Date().toISOString(), "Browser disconnected.");
        browser = null;
      });
      return browser;
    } catch (err) {
      console.error(new Date().toISOString(), `Browser connect failed: ${err.message || err}.`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * attempt));
        continue;
      } else {
        connecting = false;
        throw err;
      }
    }
  }
}

// ---------- Utility helpers ----------
function shortId() {
  return crypto.randomBytes(4).toString("hex");
}
function safeLog(id, ...args) {
  console.log(new Date().toISOString(), `[${id}]`, ...args);
}

// Block images/styles to speed up
async function setupPageOptimizations(page) {
  await page.setUserAgent(REQUEST_USER_AGENT);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (t === "image" || t === "stylesheet" || t === "font") return req.abort();
    req.continue();
  });
}

// ---------- PGN extraction ----------
async function extractMovesFromPage(page) {
  // Try multiple selectors; return array of moves strings
  const selectorsToTry = [
    ".main-line-row", // original
    ".move-row", // fallback
    ".move-list .move", // fallback
    ".moves .move", // fallback
  ];
  for (const sel of selectorsToTry) {
    const found = await page.$$(sel);
    if (found && found.length > 0) {
      // Evaluate with the active selector
      const moves = await page.evaluate((selector) => {
        const rows = Array.from(document.querySelectorAll(selector));
        return rows.flatMap((row) => {
          const white = row.querySelector(".white-move .node-highlight-content")?.innerText?.trim()
            || row.querySelector(".white")?.innerText?.trim();
          const black = row.querySelector(".black-move .node-highlight-content")?.innerText?.trim()
            || row.querySelector(".black")?.innerText?.trim();
          return [white, black].filter(Boolean);
        });
      }, sel);
      if (moves && moves.length) return moves;
      // else continue to next selector
    }
  }
  // Last resort: try to detect moves from generic move-list text
  const fallbackMoves = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("[class*='move']"));
    return nodes.map(n => (n.innerText || "").trim()).filter(Boolean);
  });
  return fallbackMoves;
}

async function getPgn(url, reqId) {
  await connectBrowser(); // ensure browser is connected (throws if cannot)
  await acquireSlot();
  let page = null;
  try {
    const b = browser;
    // create a new page
    page = await b.newPage();
    await setupPageOptimizations(page);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.setDefaultTimeout(Math.max(NAV_TIMEOUT, SELECTOR_TIMEOUT + 5000));

    safeLog(reqId, "Navigating to URL:", url);
    // add simple validation
    if (!/^https?:\/\//i.test(url)) throw new Error("Invalid URL (must include http/https)");

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT });
    } catch (navErr) {
      safeLog(reqId, "page.goto failed:", navErr.message || navErr);
      // try a fallback: goto with load event
      try {
        await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
      } catch (err2) {
        throw new Error(`Navigation failed: ${err2.message || err2}`);
      }
    }

    // give page some extra time to render dynamic moves
    await page.waitForTimeout(1500);

    // Wait for likely move container(s) with tolerant timeout
    try {
      await page.waitForSelector(".main-line-row, .move-row, .move-list, .moves", {
        timeout: SELECTOR_TIMEOUT,
      });
    } catch (selErr) {
      safeLog(reqId, "Selector(s) not found within timeout:", selErr.message || selErr);
      // continue — extractMovesFromPage will attempt fallback extraction
    }

    const moves = await extractMovesFromPage(page);
    if (!moves || moves.length === 0) {
      // For debugging, log a short page snapshot (avoid huge output)
      const snippet = (await page.content()).slice(0, 30_000);
      safeLog(reqId, "No moves found. Page snippet:", snippet.replace(/\s+/g, " ").slice(0, 3000));
      return null;
    }

    // Build PGN
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
      if (page) await page.close();
    } catch (e) {
      safeLog(reqId, "Error closing page:", e.message || e);
    }
    releaseSlot();
  }
}

// ---------- Routes ----------
app.get("/health", (req, res) => res.json({ ok: true, running: true, concurrency: current }));

app.post("/fetch-pgn", async (req, res) => {
  const reqId = shortId();
  const url = req.body?.url;
  safeLog(reqId, "Incoming request for", url);
  if (!url) return res.status(400).json({ ok: false, error: "Missing URL" });

  try {
    const pgn = await getPgn(url, reqId);
    if (!pgn) return res.status(404).json({ ok: false, error: "PGN not found" });
    res.json({ ok: true, pgn });
  } catch (err) {
    safeLog(reqId, "Error in handler:", err.stack || err.message || err);
    // classify errors
    if ((err.message || "").toLowerCase().includes("navigation failed")) {
      return res.status(502).json({ ok: false, error: "Upstream navigation failed" });
    }
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// ---------- Graceful shutdown ----------
async function shutdown() {
  console.log(new Date().toISOString(), "Shutting down...");
  try {
    if (browser && browser.isConnected && browser.isConnected()) {
      try {
        await browser.close();
        console.log(new Date().toISOString(), "Browser closed.");
      } catch (e) {
        console.warn(new Date().toISOString(), "Error closing browser:", e.message || e);
      }
    }
  } catch (e) {
    console.warn(new Date().toISOString(), "Shutdown error:", e.message || e);
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------- Start ----------
app.listen(PORT, "0.0.0.0", () => console.log(new Date().toISOString(), `✅ Browserless PGN server listening on port ${PORT}`));
