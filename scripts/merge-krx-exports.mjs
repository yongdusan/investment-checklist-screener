import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readKrxCsv } from "../lib/krx-csv.mjs";

const [dartPathArg, basicPathArg, valuationPathArg, marketCapPathArg, outputPathArg] =
  process.argv.slice(2);

if (!dartPathArg || !basicPathArg || !valuationPathArg || !marketCapPathArg) {
  console.error(
    "사용법: node ./scripts/merge-krx-exports.mjs <dart.csv> <basic.csv> <valuation.csv> <marketcap.csv> [output.csv]",
  );
  process.exit(1);
}

const dartPath = resolve(dartPathArg);
const basicPath = resolve(basicPathArg);
const valuationPath = resolve(valuationPathArg);
const marketCapPath = resolve(marketCapPathArg);
const outputPath = resolve(outputPathArg || "./data/universe.enriched.csv");
const REQUIRED_DART_HEADERS = [
  "name",
  "stockCode",
  "market",
  "sector",
  "roe",
  "debtRatio",
  "opMargin",
];

function timestamp() {
  return new Date().toISOString();
}

function logStep(message, extra = "") {
  console.log(`[${timestamp()}] ${message}${extra ? ` ${extra}` : ""}`);
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  return dataRows.map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[String(header).replace(/^\uFEFF/, "").trim()] = (cells[index] ?? "").trim();
    });
    return obj;
  });
}

function parseCsvWithHeaders(text) {
  const rows = [];
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) => String(header).replace(/^\uFEFF/, "").trim());
  const parsedRows = dataRows.map((cells) => {
    const obj = {};
    normalizedHeaders.forEach((header, index) => {
      obj[header] = (cells[index] ?? "").trim();
    });
    return obj;
  });
  return { headers: normalizedHeaders, rows: parsedRows };
}

function ensureHeaders(headers, requiredHeaders, label) {
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`${label} 필수 헤더 누락: ${missing.join(", ")}`);
  }
}

function ensureAnyHeader(headers, candidates, label) {
  if (!candidates.some((header) => headers.includes(header))) {
    throw new Error(`${label} 후보 헤더 누락: ${candidates.join(", ")}`);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeCode(value) {
  return String(value ?? "")
    .replace(/[^\d]/g, "")
    .padStart(6, "0")
    .slice(-6);
}

function normalizeNumber(value) {
  const cleaned = String(value ?? "").replaceAll(",", "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "N/A") {
    return "";
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : "";
}

function readField(row, candidates) {
  for (const key of candidates) {
    if (key in row && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function inferCatalyst(existing, pbr, roe, marketCap) {
  if (existing) {
    return existing;
  }
  if (pbr !== "" && pbr <= 0.8 && roe !== "" && roe >= 12) {
    return "medium";
  }
  if (marketCap !== "" && marketCap >= 1000000000000 && roe !== "" && roe >= 15) {
    return "medium";
  }
  return "";
}

function inferConfidence(existing, roe, opMargin, marketCap) {
  if (existing) {
    return existing;
  }
  if (roe !== "" && opMargin !== "" && roe >= 15 && opMargin >= 10 && marketCap !== "") {
    return "medium";
  }
  return "";
}

function inferShareholderReturn(existing, dividendYield) {
  if (existing) {
    return existing;
  }
  if (dividendYield !== "" && dividendYield >= 4) {
    return "strong";
  }
  if (dividendYield !== "" && dividendYield >= 2) {
    return "medium";
  }
  return "";
}

function computeEvToEbitda(marketCap, totalBorrowings, cashAndEquivalents, ebitda) {
  if (marketCap === "" || ebitda === "" || Number(ebitda) <= 0) {
    return "";
  }
  const enterpriseValue =
    Number(marketCap) + Number(totalBorrowings || 0) - Number(cashAndEquivalents || 0);
  if (!Number.isFinite(enterpriseValue) || enterpriseValue <= 0) {
    return "";
  }
  return normalizeNumber(enterpriseValue / Number(ebitda));
}

function computeFcfYield(marketCap, fcf) {
  if (marketCap === "" || fcf === "" || Number(marketCap) <= 0) {
    return "";
  }
  return normalizeNumber((Number(fcf) / Number(marketCap)) * 100);
}

async function main() {
  logStep("KRX 병합 시작");
  const [dartText, basicText, valuationText, marketCapText] = await Promise.all([
    readFile(dartPath, "utf8"),
    readKrxCsv(basicPath),
    readKrxCsv(valuationPath),
    readKrxCsv(marketCapPath),
  ]);

  const { headers: dartHeaders, rows: dartRows } = parseCsvWithHeaders(dartText);
  const { headers: basicHeaders, rows: basicRows } = parseCsvWithHeaders(basicText);
  const { headers: valuationHeaders, rows: valuationRows } = parseCsvWithHeaders(valuationText);
  const { headers: marketCapHeaders, rows: marketCapRows } = parseCsvWithHeaders(marketCapText);

  ensureHeaders(dartHeaders, REQUIRED_DART_HEADERS, "DART CSV");
  ensureAnyHeader(basicHeaders, ["종목코드", "단축코드", "표준코드"], "KRX basic 종목코드");
  ensureAnyHeader(valuationHeaders, ["종목코드", "단축코드", "표준코드"], "KRX valuation 종목코드");
  ensureAnyHeader(valuationHeaders, ["PER", "주가수익비율"], "KRX valuation PER");
  ensureAnyHeader(valuationHeaders, ["PBR", "주가순자산비율"], "KRX valuation PBR");
  ensureAnyHeader(marketCapHeaders, ["종목코드", "단축코드", "표준코드"], "KRX marketcap 종목코드");
  ensureAnyHeader(
    marketCapHeaders,
    ["시가총액", "상장시가총액", "자기주식제외시가총액", "자기주식 제외 시가총액(A*B)", "자기주식 제외 시가총액"],
    "KRX marketcap 시가총액",
  );
  logStep("KRX 병합 입력 스키마 검증 완료");

  const basicMap = new Map(
    basicRows.map((row) => [
      normalizeCode(readField(row, ["종목코드", "단축코드", "표준코드"])),
      row,
    ]),
  );
  const valuationMap = new Map(
    valuationRows.map((row) => [
      normalizeCode(readField(row, ["종목코드", "단축코드", "표준코드"])),
      row,
    ]),
  );
  const marketCapMap = new Map(
    marketCapRows.map((row) => [
      normalizeCode(readField(row, ["종목코드", "단축코드", "표준코드"])),
      row,
    ]),
  );

  const enriched = dartRows.map((row) => {
    const stockCode = normalizeCode(row.stockCode || row.stock_code || row.종목코드);
    const basic = basicMap.get(stockCode) || {};
    const valuation = valuationMap.get(stockCode) || {};
    const marketCap = marketCapMap.get(stockCode) || {};

    const sector = readField(basic, ["업종", "소속부", "산업", "업종명"]) || row.sector || "";
    const market = readField(basic, ["시장구분", "시장", "소속시장"]);
    const per = normalizeNumber(readField(valuation, ["PER", "주가수익비율"]));
    const pbr = normalizeNumber(readField(valuation, ["PBR", "주가순자산비율"]));
    const dividendYield = normalizeNumber(readField(valuation, ["배당수익률"]));
    const marketCapValue = normalizeNumber(
      readField(marketCap, [
        "시가총액",
        "상장시가총액",
        "자기주식제외시가총액",
        "자기주식 제외 시가총액(A*B)",
        "자기주식 제외 시가총액",
      ]),
    );
    const roe = normalizeNumber(row.roe);
    const opMargin = normalizeNumber(row.opMargin);
    const totalBorrowings = normalizeNumber(row.totalBorrowings);
    const cashAndEquivalents = normalizeNumber(row.cashAndEquivalents);
    const ebitda = normalizeNumber(row.ebitda);
    const fcf = normalizeNumber(row.fcf);

    return {
      ...row,
      stockCode,
      sector,
      market,
      per,
      pbr,
      marketCap: marketCapValue,
      dividendYield,
      evToEbitda: computeEvToEbitda(marketCapValue, totalBorrowings, cashAndEquivalents, ebitda),
      fcfYield: computeFcfYield(marketCapValue, fcf),
      shareholderReturn: inferShareholderReturn(row.shareholderReturn, dividendYield),
      catalyst: inferCatalyst(row.catalyst, pbr, roe, marketCapValue),
      confidence: inferConfidence(row.confidence, roe, opMargin, marketCapValue),
    };
  });

  const header = [
    "name",
    "stockCode",
    "corpCode",
    "market",
    "sector",
    "marketCap",
    "per",
    "roe",
    "roic",
    "pbr",
    "evToEbitda",
    "fcfYield",
    "debtRatio",
    "opMargin",
    "roicTrend3Y",
    "opMarginTrend3Y",
    "interestCoverage",
    "ocfToNetIncome",
    "dividendYield",
    "totalBorrowings",
    "cashAndEquivalents",
    "ebitda",
    "fcf",
    "netCash",
    "catalyst",
    "governance",
    "shareholderReturn",
    "valueUp",
    "buyback",
    "treasuryCancellation",
    "payoutRaise",
    "assetSale",
    "spinOff",
    "insiderBuying",
    "foreignOwnershipRebound",
    "coverageInitiation",
    "confidence",
    "source",
  ];

  const lines = [
    header.join(","),
    ...enriched.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ];

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  logStep(`완료: ${enriched.length}개 종목을 ${outputPath} 로 병합했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
