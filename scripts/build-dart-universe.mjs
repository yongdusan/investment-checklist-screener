import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const API_KEY = process.env.OPENDART_API_KEY || process.env.DART_API_KEY;
const YEAR = Number(process.argv[2] || new Date().getFullYear() - 1);
const LIMIT = process.argv[3] ? Number(process.argv[3]) : null;
const OUTPUT = resolve(process.argv[4] || "./data/universe.latest.csv");
const REPORT_CODE = "11011";
const CONCURRENCY = 4;

if (!API_KEY) {
  console.error("OPENDART_API_KEY 또는 DART_API_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeNumber(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const cleaned = String(value).replaceAll(",", "").trim();
  if (!cleaned || cleaned === "-") {
    return "";
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : "";
}

function parseCorpXml(xmlText) {
  const rows = [...xmlText.matchAll(/<list>([\s\S]*?)<\/list>/g)];
  return rows
    .map(([, block]) => {
      const get = (tag) => {
        const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return match ? match[1].trim() : "";
      };

      return {
        corpCode: get("corp_code"),
        corpName: get("corp_name"),
        stockCode: get("stock_code"),
      };
    })
    .filter((item) => item.stockCode);
}

function pickMetric(items, aliases) {
  const aliasSet = aliases.map((alias) => alias.toLowerCase());
  const hit = items.find((item) => aliasSet.includes(String(item.idx_nm || "").toLowerCase()));
  return hit ? normalizeNumber(hit.idx_val) : "";
}

function inferCatalyst(roe, debtRatio) {
  if (roe >= 18 && debtRatio !== "" && debtRatio <= 120) {
    return "medium";
  }
  return "";
}

function inferConfidence(roe, opMargin, debtRatio) {
  if (roe >= 15 && opMargin >= 10 && debtRatio !== "" && debtRatio <= 120) {
    return "medium";
  }
  return "";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchCorpUniverse() {
  const tempDir = await mkdtemp(join(tmpdir(), "dart-universe-"));
  const zipPath = join(tempDir, "corpCode.zip");

  try {
    const response = await fetch(
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(API_KEY)}`,
    );
    if (!response.ok) {
      throw new Error(`corpCode fetch failed: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(zipPath, buffer);
    const xmlText = execFileSync("unzip", ["-p", zipPath], { encoding: "utf8" });
    return parseCorpXml(xmlText);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fetchIndicators(corp) {
  const buildUrl = (idxClCode) => {
    const url = new URL("https://opendart.fss.or.kr/api/fnlttSinglIndx.json");
    url.searchParams.set("crtfc_key", API_KEY);
    url.searchParams.set("corp_code", corp.corpCode);
    url.searchParams.set("bsns_year", String(YEAR));
    url.searchParams.set("reprt_code", REPORT_CODE);
    url.searchParams.set("idx_cl_code", idxClCode);
    return url;
  };

  const [profitability, stability] = await Promise.all([
    fetchJson(buildUrl("M210000")),
    fetchJson(buildUrl("M220000")),
  ]);

  const profitabilityList = Array.isArray(profitability.list) ? profitability.list : [];
  const stabilityList = Array.isArray(stability.list) ? stability.list : [];

  const roe = pickMetric(profitabilityList, ["ROE", "Return on equity"]);
  const opMargin = pickMetric(profitabilityList, [
    "영업이익률",
    "Operating income margin",
    "Operating profit margin",
  ]);
  const debtRatio = pickMetric(stabilityList, ["부채비율", "Debt ratio"]);

  return {
    name: corp.corpName,
    stockCode: corp.stockCode,
    corpCode: corp.corpCode,
    sector: "",
    per: "",
    roe,
    pbr: "",
    debtRatio,
    opMargin,
    netCash: "",
    catalyst: inferCatalyst(Number(roe || 0), debtRatio),
    governance: "",
    confidence: inferConfidence(Number(roe || 0), Number(opMargin || 0), debtRatio),
    source: "opendart",
  };
}

async function mapWithConcurrency(items, worker) {
  const results = [];
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { ...items[index], error: error.message };
      }

      await sleep(90);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return results;
}

async function main() {
  console.log(
    `OpenDART 유니버스를 불러오는 중... 기준연도 ${YEAR}, 조회 대상 ${
      LIMIT ? `최대 ${LIMIT}개` : "전체 상장사"
    }`,
  );
  const universe = await fetchCorpUniverse();
  const selected = LIMIT ? universe.slice(0, LIMIT) : universe;
  const rows = await mapWithConcurrency(selected, fetchIndicators);
  const successful = rows.filter(
    (row) => row && !row.error && (row.roe !== "" || row.debtRatio !== "" || row.opMargin !== ""),
  );

  successful.sort((a, b) => Number(b.roe || 0) - Number(a.roe || 0));

  const header = [
    "name",
    "stockCode",
    "corpCode",
    "sector",
    "per",
    "roe",
    "pbr",
    "debtRatio",
    "opMargin",
    "netCash",
    "catalyst",
    "governance",
    "confidence",
    "source",
  ];

  const lines = [
    header.join(","),
    ...successful.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ];

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${lines.join("\n")}\n`, "utf8");
  console.log(`완료: ${successful.length}개 종목을 ${OUTPUT} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
