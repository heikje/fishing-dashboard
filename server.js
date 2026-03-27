const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = 12000;

const SOURCES = {
  fish: "https://fiskdata.se/raknare/live/live.php?locationId=17",
  fishChart: "https://fiskdata.se/raknare/live/ajax/liveChart.php?counterId=670&darkMode=true&lang=se",
  fishVideosLatest: "https://fiskdata.se/raknare/live/ajax/loadVideos.php?counterId=670&counterYear=2025&urval=0",
  smhiFlowXls: "https://vattenwebb.smhi.se/webservices/download/api/v1/excel/land/basin/bySubid/19497",
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

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
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
  const $ = cheerio.load(html);

  const table = $("#tableLiveTable");
  if (!table.length) {
    throw new Error("Fish table not found");
  }

  function parseRow(tr) {
    const tds = $(tr)
      .find("td")
      .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();

    if (tds.length < 4) {
      return null;
    }

    const label = tds[0].toLowerCase();
    const up = Number.parseInt(tds[1].replace(/\D/g, ""), 10);
    const down = Number.parseInt(tds[2].replace(/\D/g, ""), 10);
    const total = Number.parseInt(tds[3].replace(/\D/g, ""), 10);

    if (![up, down, total].every(Number.isFinite)) {
      return null;
    }

    return { label, up, down, total };
  }

  const rows = table.find("tr").toArray().map(parseRow).filter(Boolean);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));

  const today = byLabel["idag"];
  const yesterday = byLabel["igår"] || byLabel["igar"];
  const lastWeek = byLabel["senaste veckan"];
  const yearTotal = byLabel["totalt år"];

  if (!today || !yesterday || !lastWeek || !yearTotal) {
    throw new Error("Missing fish metrics rows");
  }

  const deltas = {
    vsYesterday: {
      up: today.up - yesterday.up,
      down: today.down - yesterday.down,
      total: today.total - yesterday.total
    },
    vsLastWeek: {
      up: today.up - lastWeek.up,
      down: today.down - lastWeek.down,
      total: today.total - lastWeek.total
    }
  };

  return {
    value: {
      today,
      yesterday,
      lastWeek,
      yearTotal,
      deltas
    },
    unit: "fishPassages",
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

function excelDateToIso(serial) {
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString();
}

async function getSmhiFlowMetric() {
  const workbookBuffer = await fetchBuffer(SOURCES.smhiFlowXls);
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheet = workbook.Sheets["Dygnsuppdaterade värden"];
  if (!sheet) {
    throw new Error("SMHI flow sheet missing");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const headerRowIdx = rows.findIndex((row) => Array.isArray(row) && String(row[1] || "").includes("Total vattenföring"));
  if (headerRowIdx < 0) {
    throw new Error("SMHI flow header missing");
  }

  const dataRows = rows
    .slice(headerRowIdx + 1)
    .filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && Number.isFinite(Number(row[1])))
    .map((row) => ({
      ts: excelDateToIso(Number(row[0])),
      flow: Number(row[1])
    }))
    .filter((r) => r.ts);

  if (!dataRows.length) {
    throw new Error("No SMHI flow values found");
  }

  const trend = dataRows.slice(-30);
  const latest = trend[trend.length - 1];
  return {
    value: {
      latestM3s: Number(latest.flow.toFixed(2)),
      latestAt: latest.ts,
      trend: trend.map((p) => [Date.parse(p.ts), Number(p.flow.toFixed(2))])
    },
    unit: "m3s",
    source: SOURCES.smhiFlowXls
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

function lastFiniteSeriesPoint(series) {
  const data = Array.isArray(series?.data) ? series.data : [];
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const point = data[i];
    const ts = Array.isArray(point) ? point[0] : null;
    const val = Array.isArray(point) ? point[1] : null;
    if (Number.isFinite(ts) && Number.isFinite(val)) {
      return { ts, val };
    }
  }
  return null;
}

function tailSeries(series, maxPoints) {
  const data = Array.isArray(series?.data) ? series.data : [];
  return data
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice(-maxPoints);
}

async function getRiverConditionsMetric() {
  const [chartText, videosText] = await Promise.all([
    fetchText(SOURCES.fishChart),
    fetchText(SOURCES.fishVideosLatest)
  ]);

  const chart = JSON.parse(chartText);
  if (!Array.isArray(chart) || chart.length < 2) {
    throw new Error("Fish chart payload invalid");
  }

  const tempSeries = chart.find((s) => (s?.name || "").toLowerCase().includes("vattentemperatur"));
  const flowSeries = chart.find((s) => (s?.name || "").toLowerCase().includes("vattenf"));
  if (!tempSeries || !flowSeries) {
    throw new Error("Temperature/flow series missing");
  }

  const lastTemp = lastFiniteSeriesPoint(tempSeries);
  const lastFlow = lastFiniteSeriesPoint(flowSeries);
  if (!lastTemp || !lastFlow) {
    throw new Error("Temperature/flow latest values missing");
  }

  const videos = JSON.parse(videosText);
  const latestVideo = Array.isArray(videos) && videos.length
    ? (() => {
        const v = videos[0];
        const videoPath = typeof v?.video === "string" ? v.video : null;
        const thumbPath = typeof v?.thumb === "string" ? v.thumb : null;
        return {
          dateTime: v?.DateTime ?? null,
          species: v?.NameSv ?? null,
          dir: v?.Dir ?? null,
          lengthCm: v?.Length_calc ?? null,
          url: videoPath ? `https://fiskdata.se${videoPath}` : null,
          thumbUrl: thumbPath ? `https://fiskdata.se${thumbPath}` : null
        };
      })()
    : null;

  return {
    value: {
      temperatureC: lastTemp.val,
      temperatureAt: new Date(lastTemp.ts).toISOString(),
      flowM3s: lastFlow.val,
      flowAt: new Date(lastFlow.ts).toISOString(),
      tempTrend: tailSeries(tempSeries, 24),
      flowTrend: tailSeries(flowSeries, 24),
      latestVideo
    },
    unit: "river",
    source: SOURCES.fishChart
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
    fish: {
      today: { up: 0, down: 0, total: 0 },
      yesterday: { up: 0, down: 0, total: 0 },
      lastWeek: { up: 0, down: 0, total: 0 },
      yearTotal: { up: 3434, down: 34, total: 3400 },
      deltas: {
        vsYesterday: { up: 0, down: 0, total: 0 },
        vsLastWeek: { up: 0, down: 0, total: 0 }
      }
    },
    river: {
      temperatureC: 8.0,
      temperatureAt: new Date().toISOString(),
      flowM3s: 60.0,
      flowAt: new Date().toISOString(),
      tempTrend: [],
      flowTrend: [],
      latestVideo: null
    },
    smhiFlow: {
      latestM3s: null,
      latestAt: null,
      trend: []
    },
    snow: null,
    water: 1.74,
    tips: "Best bite early morning near moving current."
  };

  const [fishRes, riverRes, smhiFlowRes, snowRes, waterRes, tipsRes] = await Promise.allSettled([
    getFishMetric(),
    getRiverConditionsMetric(),
    getSmhiFlowMetric(),
    getSnowMetric(),
    getWaterMetric(),
    getTipsMetric()
  ]);

  const payload = {
    updatedAt: new Date().toISOString(),
    fish: fishRes.status === "fulfilled"
      ? okPayload(fishRes.value)
      : fallbackPayload(SOURCES.fish, "fish", fallback.fish, fishRes.reason),
    river: riverRes.status === "fulfilled"
      ? okPayload(riverRes.value)
      : fallbackPayload(SOURCES.fishChart, "river", fallback.river, riverRes.reason),
    smhiFlow: smhiFlowRes.status === "fulfilled"
      ? okPayload(smhiFlowRes.value)
      : fallbackPayload(SOURCES.smhiFlowXls, "m3s", fallback.smhiFlow, smhiFlowRes.reason),
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
