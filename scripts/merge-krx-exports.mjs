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

async function main() {
  const [dartText, basicText, valuationText, marketCapText] = await Promise.all([
    readFile(dartPath, "utf8"),
    readKrxCsv(basicPath),
    readKrxCsv(valuationPath),
    readKrxCsv(marketCapPath),
  ]);

  const dartRows = parseCsv(dartText);
  const basicRows = parseCsv(basicText);
  const valuationRows = parseCsv(valuationText);
  const marketCapRows = parseCsv(marketCapText);

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

    return {
      ...row,
      stockCode,
      sector,
      market,
      per,
      pbr,
      marketCap: marketCapValue,
      dividendYield,
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
    "debtRatio",
    "opMargin",
    "interestCoverage",
    "ocfToNetIncome",
    "dividendYield",
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
  console.log(`완료: ${enriched.length}개 종목을 ${outputPath} 로 병합했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
