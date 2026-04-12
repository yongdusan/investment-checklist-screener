import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  REPORT_CONFIG,
  getReportMinScore,
  getReportTopN,
  getSeoulDate,
} from "../config/reporting.mjs";
import { principles, scoreStocks, summarizeShortlistFailure, toNumber } from "../lib/scoring.mjs";

const inputPath = resolve(process.argv[2] || REPORT_CONFIG.enrichedUniversePath);
const outputPath = resolve(
  process.argv[3] || `${REPORT_CONFIG.reportDir}/daily-shortlist-${getSeoulDate()}.md`,
);
const minScore = Number(process.argv[4] || getReportMinScore());
const topN = Number(process.argv[5] || getReportTopN());
const manualOverridesPath = resolve(process.argv[6] || REPORT_CONFIG.manualOverridesPath);
const REQUIRED_INPUT_HEADERS = ["name", "stockCode", "market", "sector", "roe", "debtRatio", "opMargin"];

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

function formatNumber(value) {
  const num = toNumber(value);
  return num === null ? "-" : new Intl.NumberFormat("ko-KR").format(num);
}

function fmt(value, digits = 2) {
  const num = toNumber(value);
  return num === null ? "-" : num.toFixed(digits);
}

function fmtMktCap(value) {
  const num = toNumber(value);
  return num === null ? "-" : `${Math.round(num / 100000000).toLocaleString("ko-KR")}억원`;
}

function normalizeCode(value) {
  return String(value ?? "")
    .replace(/[^\d]/g, "")
    .padStart(6, "0")
    .slice(-6);
}

function exists(path) {
  return access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function mergeManualOverrides(stocks, overrideRows) {
  if (overrideRows.length === 0) {
    return { stocks, appliedCount: 0 };
  }

  const overridesByCode = new Map();
  const overridesByName = new Map();

  overrideRows.forEach((row) => {
    const code = normalizeCode(row.stockCode || row.종목코드 || row.단축코드);
    const name = String(row.name || row.종목명 || "").trim();
    if (code) {
      overridesByCode.set(code, row);
    }
    if (name) {
      overridesByName.set(name, row);
    }
  });

  let appliedCount = 0;
  const merged = stocks.map((stock) => {
    const override =
      overridesByCode.get(normalizeCode(stock.stockCode)) ||
      overridesByName.get(String(stock.name || "").trim());

    if (!override) {
      return stock;
    }

    const overrideFields = [];
    const next = { ...stock };

    for (const field of [
      "catalyst",
      "governance",
      "confidence",
      "netCash",
      "market",
      "sector",
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
    ]) {
      const value = String(override[field] ?? "").trim();
      if (value) {
        next[field] = value;
        overrideFields.push(field);
      }
    }

    const note = String(override.note || override.memo || override.메모 || "").trim();
    if (note) {
      next.overrideNote = note;
      overrideFields.push("note");
    }

    if (overrideFields.length > 0) {
      appliedCount += 1;
      next.overrideFields = overrideFields.filter((field, index, items) => items.indexOf(field) === index);
    }

    return next;
  });

  return { stocks: merged, appliedCount };
}

async function updateHistoryIndex(reportDirPath) {
  const entries = await readdir(reportDirPath, { withFileTypes: true });
  const reportFiles = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-daily-shortlist\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const indexLines = [
    "# 리포트 히스토리",
    "",
    "자동 생성된 일간 투자 후보 리포트 목록입니다.",
    "",
  ];

  if (reportFiles.length === 0) {
    indexLines.push("아직 생성된 리포트가 없습니다.");
  } else {
    reportFiles.forEach((fileName, index) => {
      const date = fileName.replace("-daily-shortlist.md", "");
      indexLines.push(`${index + 1}. [${date} 리포트](./${fileName})`);
    });
  }

  await writeFile(resolve(reportDirPath, "index.md"), `${indexLines.join("\n")}\n`, "utf8");
}

function parsePreviousReportSummary(markdown) {
  const lines = markdown.split(/\r?\n/);
  const summaries = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+\d+\.\s+(.+)$/);
    if (headingMatch) {
      if (current) {
        summaries.push(current);
      }
      current = { name: headingMatch[1].trim() };
      continue;
    }

    if (!current) {
      continue;
    }

    const scoreMatch = line.match(/^- 점수: (\d+)점$/);
    if (scoreMatch) {
      current.score = Number(scoreMatch[1]);
      continue;
    }

    const completenessMatch = line.match(/^- 정보 충실도: (\d+)%$/);
    if (completenessMatch) {
      current.completeness = Number(completenessMatch[1]);
    }
  }

  if (current) {
    summaries.push(current);
  }

  return summaries;
}

async function loadPreviousReportSummary(reportDirPath, currentOutputPath) {
  const entries = await readdir(reportDirPath, { withFileTypes: true });
  const currentFileName = basename(currentOutputPath);
  const previousFile = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-daily-shortlist\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name !== currentFileName)
    .sort((a, b) => b.localeCompare(a))[0];

  if (!previousFile) {
    return new Map();
  }

  const markdown = await readFile(resolve(reportDirPath, previousFile), "utf8");
  const previousEntries = parsePreviousReportSummary(markdown);
  return new Map(previousEntries.map((item, index) => [item.name, { ...item, rank: index + 1 }]));
}

function describeDataSources(stock) {
  const automatic = [];
  const manual = stock.overrideFields || [];

  if (toNumber(stock.marketCap) !== null) automatic.push("시가총액");
  if (
    toNumber(stock.per) !== null ||
    toNumber(stock.pbr) !== null ||
    toNumber(stock.evToEbitda) !== null ||
    toNumber(stock.fcfYield) !== null
  ) {
    automatic.push("밸류에이션");
  }
  if (
    toNumber(stock.roe) !== null ||
    toNumber(stock.roic) !== null ||
    toNumber(stock.opMargin) !== null ||
    toNumber(stock.ocfToNetIncome) !== null
  ) {
    automatic.push("수익성");
  }
  if (
    toNumber(stock.debtRatio) !== null ||
    toNumber(stock.interestCoverage) !== null ||
    String(stock.netCash || "").trim()
  ) {
    automatic.push("재무안정성");
  }
  if (toNumber(stock.dividendYield) !== null || String(stock.shareholderReturn || "").trim()) automatic.push("주주환원");
  if (String(stock.market || "").trim() || String(stock.sector || "").trim()) automatic.push("시장/업종");

  return {
    automaticLabel: automatic.length ? automatic.join(", ") : "핵심 자동 데이터 부족",
    manualLabel: manual.length ? manual.join(", ") : "없음",
  };
}

function describePreviousDelta(stock, index, previousSummary) {
  const previous = previousSummary.get(stock.name);
  if (!previous) {
    return "신규 진입";
  }

  const parts = [];
  parts.push(previous.rank === index + 1 ? "순위 유지" : `${previous.rank}위 → ${index + 1}위`);

  if (typeof previous.score === "number" && previous.score !== stock.score) {
    const scoreDelta = stock.score - previous.score;
    parts.push(`점수 ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`);
  }

  if (typeof previous.completeness === "number" && previous.completeness !== stock.completeness) {
    const completenessDelta = stock.completeness - previous.completeness;
    parts.push(`정보 ${completenessDelta > 0 ? "+" : ""}${completenessDelta}%p`);
  }

  return parts.join(" / ");
}

async function main() {
  logStep("일간 리포트 생성 시작");
  const csvText = await readFile(inputPath, "utf8");
  const { headers: inputHeaders, rows: parsedStocks } = parseCsvWithHeaders(csvText);
  ensureHeaders(inputHeaders, REQUIRED_INPUT_HEADERS, "리포트 입력 CSV");
  let baseStocks = parsedStocks;
  let appliedOverrides = 0;
  logStep("리포트 입력 스키마 검증 완료");

  if (await exists(manualOverridesPath)) {
    const overrideText = await readFile(manualOverridesPath, "utf8");
    const { headers: overrideHeaders, rows: overrideRows } = parseCsvWithHeaders(overrideText);
    ensureHeaders(overrideHeaders, ["stockCode", "name"], "manual-overrides.csv");
    const merged = mergeManualOverrides(baseStocks, overrideRows);
    baseStocks = merged.stocks;
    appliedOverrides = merged.appliedCount;
    logStep("수동 오버레이 병합 완료", `applied=${appliedOverrides}`);
  }

  const stocks = scoreStocks(baseStocks).sort((a, b) => b.score - a.score);
  const shortlist = stocks.filter((stock) => stock.score >= minScore).slice(0, topN);
  const fieldCoverage = {
    marketCap: stocks.filter((stock) => toNumber(stock.marketCap) !== null).length,
    per: stocks.filter((stock) => toNumber(stock.per) !== null).length,
    pbr: stocks.filter((stock) => toNumber(stock.pbr) !== null).length,
    evToEbitda: stocks.filter((stock) => toNumber(stock.evToEbitda) !== null).length,
    fcfYield: stocks.filter((stock) => toNumber(stock.fcfYield) !== null).length,
    roic: stocks.filter((stock) => toNumber(stock.roic) !== null).length,
    roicTrend3Y: stocks.filter((stock) => toNumber(stock.roicTrend3Y) !== null).length,
    opMarginTrend3Y: stocks.filter((stock) => toNumber(stock.opMarginTrend3Y) !== null).length,
    interestCoverage: stocks.filter((stock) => toNumber(stock.interestCoverage) !== null).length,
    ocfToNetIncome: stocks.filter((stock) => toNumber(stock.ocfToNetIncome) !== null).length,
    market: stocks.filter((stock) => String(stock.market || "").trim()).length,
    sector: stocks.filter((stock) => String(stock.sector || "").trim()).length,
    shareholderReturn: stocks.filter(
      (stock) => String(stock.shareholderReturn || "").trim() || toNumber(stock.dividendYield) !== null,
    ).length,
  };
  const usesLatestUniverse = inputPath.endsWith("universe.latest.csv");
  const missingValuationData =
    stocks.length > 0 &&
    fieldCoverage.marketCap === 0 &&
    fieldCoverage.per === 0 &&
    fieldCoverage.pbr === 0;
  const reportDirPath = dirname(outputPath);
  const previousSummary = await loadPreviousReportSummary(reportDirPath, outputPath);

  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeZone: "Asia/Seoul",
  }).format(new Date());

  const lines = [
    `# 일간 투자 후보 리포트`,
    ``,
    `- 생성일: ${dateLabel}`,
    `- 입력 파일: \`${inputPath}\``,
    `- 최소 점수: ${minScore}`,
    `- 상위 후보 수: ${topN}`,
    `- 통과 종목 수: ${shortlist.length}`,
    ``,
    `## 데이터 상태`,
    ``,
    `- 전체 종목 수: ${stocks.length}`,
    `- 평균 정보 충실도: ${stocks.length ? Math.round(stocks.reduce((sum, stock) => sum + stock.completeness, 0) / stocks.length) : 0}%`,
    `- 최고 점수: ${stocks.length ? Math.max(...stocks.map((stock) => stock.score)) : 0}점`,
    `- 시장 정보 채워짐: ${fieldCoverage.market}/${stocks.length}`,
    `- 업종 정보 채워짐: ${fieldCoverage.sector}/${stocks.length}`,
    `- 시가총액 데이터 채워짐: ${fieldCoverage.marketCap}/${stocks.length}`,
    `- PER 데이터 채워짐: ${fieldCoverage.per}/${stocks.length}`,
    `- PBR 데이터 채워짐: ${fieldCoverage.pbr}/${stocks.length}`,
    `- EV/EBITDA 데이터 채워짐: ${fieldCoverage.evToEbitda}/${stocks.length}`,
    `- FCF Yield 데이터 채워짐: ${fieldCoverage.fcfYield}/${stocks.length}`,
    `- ROIC 데이터 채워짐: ${fieldCoverage.roic}/${stocks.length}`,
    `- ROIC 3년 추세 채워짐: ${fieldCoverage.roicTrend3Y}/${stocks.length}`,
    `- 영업이익률 3년 추세 채워짐: ${fieldCoverage.opMarginTrend3Y}/${stocks.length}`,
    `- 이자보상배율 데이터 채워짐: ${fieldCoverage.interestCoverage}/${stocks.length}`,
    `- 현금전환율 데이터 채워짐: ${fieldCoverage.ocfToNetIncome}/${stocks.length}`,
    `- 주주환원 데이터 채워짐: ${fieldCoverage.shareholderReturn}/${stocks.length}`,
    `- 수동 오버레이 반영 종목 수: ${appliedOverrides}/${stocks.length}`,
    ``,
  ];

  if (missingValuationData) {
    lines.push("## 데이터 참고", "");
    if (usesLatestUniverse) {
      lines.push(
        "- 현재 리포트는 `universe.latest.csv` 기준입니다. 이 파일은 OpenDART 재무지표 중심이라 시가총액/PER/PBR이 비어 있을 수 있습니다.",
      );
      lines.push(
        "- `data/krx-valuation.csv` 와 `data/krx-marketcap.csv` 를 함께 두면 `universe.enriched.csv`가 생성되고, 다음 리포트부터 해당 값이 자동 반영됩니다.",
      );
    } else {
      lines.push(
        "- 현재 입력 파일에서도 시가총액/PER/PBR 데이터가 비어 있습니다. KRX valuation/marketcap CSV 내용을 확인해 주세요.",
      );
    }
    lines.push("");
  }

  lines.push(`## 요약`, ``);

  if (shortlist.length === 0) {
    lines.push(`현재 기준으로 최소 점수 ${minScore}점을 넘는 종목이 없습니다.`);
    lines.push("");
    lines.push("## 왜 후보가 없었나", "");
    summarizeShortlistFailure(stocks, minScore, topN).forEach((line) => {
      lines.push(`- ${line}`);
    });
  } else {
    shortlist.forEach((stock, index) => {
      lines.push(
        `${index + 1}. ${stock.name} (${stock.market || "시장 미기재"} / ${stock.sector || "섹터 미기재"}) - ${stock.score}점`,
      );
    });
  }

  lines.push("## 점수표", "");
  lines.push("| 항목 | 배점 | 기준 |");
  lines.push("| --- | ---: | --- |");
  principles.forEach((item) => {
    lines.push(`| ${item.shortTitle} | ${item.weight} | ${item.rule} |`);
  });
  lines.push("");
  lines.push(
    "- 총점은 100점 만점입니다.",
  );
  lines.push(
    "- 점수는 입력된 정보 범위 안에서 계산되므로, 본문의 `정보 충실도`를 함께 봐야 합니다.",
  );
  lines.push("");
  lines.push("## 상세", "");

  shortlist.forEach((stock, index) => {
    const sources = describeDataSources(stock);
    lines.push(`### ${index + 1}. ${stock.name}`);
    lines.push("");
    lines.push(`- 점수: ${stock.score}점`);
    lines.push(`- 정보 충실도: ${stock.completeness}%`);
    lines.push(`- 전일 대비: ${describePreviousDelta(stock, index, previousSummary)}`);
    lines.push(`- 시장/업종: ${stock.market || "-"} / ${stock.sector || "-"}`);
    lines.push(`- 시가총액: ${fmtMktCap(stock.marketCap)}`);
    lines.push(`- PER / PBR / EV-EBITDA / FCF Yield: ${fmt(stock.per)} / ${fmt(stock.pbr)} / ${fmt(stock.evToEbitda)} / ${fmt(stock.fcfYield)}`);
    lines.push(`- ROE / ROIC / 영업이익률: ${fmt(stock.roe)} / ${fmt(stock.roic)} / ${fmt(stock.opMargin)}`);
    lines.push(`- 3년 추세(ROIC / 영업이익률): ${fmt(stock.roicTrend3Y)} / ${fmt(stock.opMarginTrend3Y)}`);
    lines.push(`- 이자보상배율 / 현금전환율: ${fmt(stock.interestCoverage)} / ${fmt(stock.ocfToNetIncome)}`);
    lines.push(`- 부채비율 / 배당수익률: ${fmt(stock.debtRatio, 0)} / ${fmt(stock.dividendYield)}`);
    lines.push(`- 촉매 / 주주환원 / 확신도: ${stock.catalyst || "-"} / ${stock.shareholderReturn || "-"} / ${stock.confidence || "-"}`);
    lines.push(
      `- 체크리스트: valueUp=${stock.valueUp || "-"}, buyback=${stock.buyback || "-"}, treasuryCancellation=${stock.treasuryCancellation || "-"}, payoutRaise=${stock.payoutRaise || "-"}, assetSale=${stock.assetSale || "-"}, spinOff=${stock.spinOff || "-"}, insiderBuying=${stock.insiderBuying || "-"}, foreignOwnershipRebound=${stock.foreignOwnershipRebound || "-"}, coverageInitiation=${stock.coverageInitiation || "-"}`,
    );
    lines.push(`- 데이터 출처: 자동(${sources.automaticLabel}) / 수동(${sources.manualLabel})`);
    if (stock.overrideFields?.length) {
      lines.push(`- 수동 오버레이: ${stock.overrideFields.join(", ")}`);
    }
    if (stock.overrideNote) {
      lines.push(`- 수동 메모: ${stock.overrideNote}`);
    }
    lines.push(`- 이유: ${stock.reasons.join(" / ")}`);
    lines.push("");
    lines.push("| 항목 | 점수 | 메모 |");
    lines.push("| --- | ---: | --- |");
    stock.breakdown.forEach((item) => {
      const scoreLabel = item.available ? `${item.points}/${item.weight}` : `데이터 없음 / ${item.weight}`;
      lines.push(`| ${item.shortTitle} | ${scoreLabel} | ${item.summary} |`);
    });
    lines.push("");
  });

  await mkdir(reportDirPath, { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  await updateHistoryIndex(reportDirPath);
  logStep(`완료: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
