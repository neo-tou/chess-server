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

// Build launch options. When running inside the Docker image, PUPPETEER_EXECUTABLE_PATH will be set.
const PUPPETEER_OPTIONS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process"
  ]
};

// If an executable path is provided in env (set in Docker/Render), include it
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  PUPPETEER_OPTIONS.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

let browser = null;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch(PUPPETEER_OPTIONS);
  }
  return browser;
}

async function getPgn(url) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    // small optimizations
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36");
    await page.setRequestInterception(true);
    page.on("request", req => {
      const t = req.resourceType();
      if (t === "image" || t === "stylesheet" || t === "font") return req.abort();
      req.continue();
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    // give dynamic stuff a bit extra time
    await page.waitForTimeout(1000);

    // selector may change; adapt if necessary
    await page.waitForSelector(".main-line-row", { timeout: 20000 });

    const moves = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".main-line-row")).flatMap(row => {
        const white = row.querySelector(".white-move .node-highlight-content")?.innerText?.trim();
        const black = row.querySelector(".black-move .node-highlight-content")?.innerText?.trim();
        return [white, black].filter(Boolean);
      });
    });

    if (!moves || moves.length === 0) return null;

    let pgn = "";
    for (let i = 0; i < moves.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      pgn += `${num}. ${moves[i] || ""} ${moves[i+1] || ""} `;
    }
    return pgn.trim();
  } finally {
    try { await page.close(); } catch {}
  }
}

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

app.get("/health", (req, res) => res.json({ ok: true, running: true }));

process.on("SIGINT", async () => { if (browser) await browser.close(); process.exit(); });
process.on("exit", async () => { if (browser) await browser.close(); });

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Puppeteer PGN server listening on ${PORT}`));
