import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "./data/universe.latest.csv");
const mode = process.argv[3] || "latest";

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

function ensureHeaders(headers, requiredHeaders, modeLabel) {
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`${modeLabel} CSV 필수 헤더 누락: ${missing.join(", ")}`);
  }
}

async function main() {
  const text = await readFile(inputPath, "utf8");
  const { headers, rows } = parseCsv(text);

  if (rows.length === 0) {
    throw new Error(`유니버스 CSV 데이터 행이 없습니다: ${inputPath}`);
  }

  const latestRequired = ["name", "stockCode", "market", "sector", "roe", "debtRatio", "opMargin"];
  const enrichedRequired = [...latestRequired, "per", "pbr", "marketCap", "dividendYield"];

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

  console.log(
    `검증 완료: ${mode} / rows=${rows.length} / market=${marketCount} / sector=${sectorCount}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
