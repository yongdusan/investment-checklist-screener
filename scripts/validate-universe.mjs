import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readKrxCsv } from "../lib/krx-csv.mjs";

const inputPath = resolve(process.argv[2] || "./data/universe.latest.csv");
const mode = process.argv[3] || "latest";
const LOW_COMPLETENESS_THRESHOLD = 60;

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
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) => String(header).replace(/^\uFEFF/, "").trim());
  const parsedRows = dataRows.map((cells) => {
    const obj = {};
    normalizedHeaders.forEach((header, index) => {
      obj[header] = String(cells[index] ?? "").trim();
    });
    return obj;
  });

  return { headers: normalizedHeaders, rows: parsedRows };
}

function countFilled(rows, field) {
  return rows.filter((row) => String(row[field] ?? "").trim() !== "").length;
}

function countAnyFilled(rows, fields) {
  return rows.filter((row) => fields.some((field) => String(row[field] ?? "").trim() !== "")).length;
}

function ensureHeaders(headers, requiredHeaders, modeLabel) {
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`${modeLabel} CSV 필수 헤더 누락: ${missing.join(", ")}`);
  }
}

function ensureAnyHeader(headers, candidates, modeLabel, label) {
  if (!candidates.some((header) => headers.includes(header))) {
    throw new Error(`${modeLabel} CSV에 ${label} 헤더가 없습니다. 후보: ${candidates.join(", ")}`);
  }
}

function logCoverage(rows, fields) {
  return fields
    .map((field) => `${field}=${countFilled(rows, field)}`)
    .join(" / ");
}

async function main() {
  const text =
    mode.startsWith("krx-") ? await readKrxCsv(inputPath) : await readFile(inputPath, "utf8");
  const { headers, rows } = parseCsv(text);

  if (rows.length === 0) {
    throw new Error(`유니버스 CSV 데이터 행이 없습니다: ${inputPath}`);
  }

  const latestRequired = ["name", "stockCode", "market", "sector", "roe", "debtRatio", "opMargin"];
  const enrichedRequired = [...latestRequired, "per", "pbr", "marketCap", "dividendYield"];

  if (mode === "krx-basic") {
    ensureAnyHeader(headers, ["종목코드", "단축코드", "표준코드", "종목 코드"], mode, "종목코드");
    ensureAnyHeader(headers, ["종목명", "한글 종목명", "회사명"], mode, "종목명");
    ensureAnyHeader(headers, ["시장구분", "시장", "소속시장", "시장 구분"], mode, "시장");
    ensureAnyHeader(headers, ["업종", "업종명", "소속부", "증권구분"], mode, "업종");
    console.log(`검증 완료: ${mode} / rows=${rows.length}`);
    return;
  }

  if (mode === "krx-valuation") {
    ensureAnyHeader(headers, ["종목코드", "단축코드", "표준코드"], mode, "종목코드");
    ensureAnyHeader(headers, ["PER", "주가수익비율"], mode, "PER");
    ensureAnyHeader(headers, ["PBR", "주가순자산비율"], mode, "PBR");
    console.log(`검증 완료: ${mode} / rows=${rows.length}`);
    return;
  }

  if (mode === "krx-marketcap") {
    ensureAnyHeader(headers, ["종목코드", "단축코드", "표준코드"], mode, "종목코드");
    ensureAnyHeader(
      headers,
      [
        "시가총액",
        "상장시가총액",
        "자기주식제외시가총액",
        "자기주식 제외 시가총액(A*B)",
        "자기주식 제외 시가총액",
      ],
      mode,
      "시가총액",
    );
    console.log(`검증 완료: ${mode} / rows=${rows.length}`);
    return;
  }

  if (mode === "enriched") {
    ensureHeaders(headers, enrichedRequired, "enriched");
    const valuationCount = rows.filter(
      (row) =>
        String(row.per ?? "").trim() !== "" ||
        String(row.pbr ?? "").trim() !== "" ||
        String(row.marketCap ?? "").trim() !== "",
    ).length;
    if (valuationCount === 0) {
      throw new Error(`enriched CSV에 valuation/marketCap 값이 비어 있습니다: ${inputPath}`);
    }
  } else {
    ensureHeaders(headers, latestRequired, "latest");
  }

  const marketCount = countFilled(rows, "market");
  const sectorCount = countFilled(rows, "sector");
  const shareholderCoverage = countAnyFilled(rows, ["shareholderReturn", "dividendYield"]);
  const lowCompletenessCount = rows.filter((row) => {
    const completeness = Number(row.completeness ?? "");
    return Number.isFinite(completeness) && completeness < LOW_COMPLETENESS_THRESHOLD;
  }).length;

  console.log(
    `검증 완료: ${mode} / rows=${rows.length} / market=${marketCount} / sector=${sectorCount} / ${logCoverage(rows, ["roe", "roic", "debtRatio", "opMargin", "interestCoverage", "ocfToNetIncome"])}${mode === "enriched" ? ` / ${logCoverage(rows, ["per", "pbr", "marketCap", "dividendYield"])} / shareholderSignals=${shareholderCoverage}` : ""}${lowCompletenessCount ? ` / completeness<${LOW_COMPLETENESS_THRESHOLD}=${lowCompletenessCount}` : ""}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
