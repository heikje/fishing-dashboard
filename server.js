const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 12000;

const SOURCES = {
  fish: "https://fiskdata.se/raknare/live/live.php?locationId=17",
  snow: "https://www.smhi.se/vader/observationer/snodjup",
  tips: "https://www.ifiske.se/fisketips-byskealvens-fvo-vasterbottensdelen.htm?area=898&date1=2025-05-01+00%3A00&picker_date1=2025-05-01&date2=2025-06-08&picker_date2=2025-06-08&species=9&freetext=",
  water: "https://www.riverapp.net/en/station/5e2ca485473f4b7bee591672"
};

app.use(cors());
app.use(express.static(__dirname));

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        accept: "text/html,application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractNumbers(rawText) {
  const matches = rawText.match(/\b\d+(?:[.,]\d+)?\b/g) || [];
  return matches
    .map((match) => Number.parseFloat(match.replace(",", ".")))
    .filter((value) => Number.isFinite(value));
}

async function getFishMetric() {
  const html = await fetchText(SOURCES.fish);
  const nums = extractNumbers(html).filter((n) => n >= 0 && n < 20000);
  if (!nums.length) {
    throw new Error("No fish number found");
  }
  const best = Math.max(...nums);
  if (best > 8000) {
    throw new Error("Fish value out of range");
  }
  return {
    value: best,
    unit: "fish",
    source: SOURCES.fish
  };
}

async function getSnowMetric() {
  const html = await fetchText(SOURCES.snow);
  const $ = cheerio.load(html);
  const wholeText = $.text();
  const compact = wholeText.replace(/\s+/g, " ");

  const contextual = compact.match(/sn[öo]djup[^0-9]{0,40}(\d{1,3})\s*cm/iu);
  const stationContext = compact.match(/(?:station|m[äa]tplats|observationsplats)[^0-9]{0,80}(\d{1,3})\s*cm/iu);
  const generalCm = compact.match(/(\d{1,3})\s*cm/iu);
  const snowValue = contextual?.[1] || stationContext?.[1] || generalCm?.[1];
  const snowDepth = snowValue ? Number.parseInt(snowValue, 10) : null;

  if (!Number.isFinite(snowDepth) || snowDepth > 250) {
    throw new Error("No snow depth found");
  }

  return {
    value: snowDepth,
    unit: "cm",
    source: SOURCES.snow
  };
}

async function getWaterMetric() {
  const html = await fetchText(SOURCES.water);
  const $ = cheerio.load(html);
  const bodyText = $.text().replace(/\s+/g, " ");
  const keywordMatch = bodyText.match(/(water level|level|gauge|station|vattenst[åa]nd)[^0-9]{0,40}(\d{1,2}(?:[.,]\d{1,2})?)\s*m/iu);
  if (!keywordMatch) {
    throw new Error("No water level found");
  }
  const value = Number.parseFloat(keywordMatch[2].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0.05 || value > 8) {
    throw new Error("No water level found");
  }

  return {
    value: Number(value.toFixed(2)),
    unit: "m",
    source: SOURCES.water
  };
}

async function getTipsMetric() {
  const html = await fetchText(SOURCES.tips);
  const $ = cheerio.load(html);
  const heading = $("h1").first().text().trim() || $("title").first().text().trim();
  const paragraph = $("p")
    .map((_, el) => $(el).text().trim())
    .get()
    .find((line) => line.length > 30 && line.length < 200);

  return {
    value: paragraph || heading || "Tips loaded from iFiske.",
    unit: "text",
    source: SOURCES.tips
  };
}

function okPayload(metric) {
  return { ...metric, status: "live", error: null };
}

function fallbackPayload(source, unit, fallbackValue, error) {
  return { value: fallbackValue, unit, source, status: "fallback", error: error.message };
}

app.get("/api/metrics", async (_req, res) => {
  const fallback = {
    fish: 142,
    snow: 68,
    water: 1.74,
    tips: "Best bite early morning near moving current."
  };

  const [fishRes, snowRes, waterRes, tipsRes] = await Promise.allSettled([
    getFishMetric(),
    getSnowMetric(),
    getWaterMetric(),
    getTipsMetric()
  ]);

  const payload = {
    updatedAt: new Date().toISOString(),
    fish: fishRes.status === "fulfilled"
      ? okPayload(fishRes.value)
      : fallbackPayload(SOURCES.fish, "fish", fallback.fish, fishRes.reason),
    snow: snowRes.status === "fulfilled"
      ? okPayload(snowRes.value)
      : fallbackPayload(SOURCES.snow, "cm", fallback.snow, snowRes.reason),
    water: waterRes.status === "fulfilled"
      ? okPayload(waterRes.value)
      : fallbackPayload(SOURCES.water, "m", fallback.water, waterRes.reason),
    tips: tipsRes.status === "fulfilled"
      ? okPayload(tipsRes.value)
      : fallbackPayload(SOURCES.tips, "text", fallback.tips, tipsRes.reason)
  };

  res.json(payload);
});

app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
