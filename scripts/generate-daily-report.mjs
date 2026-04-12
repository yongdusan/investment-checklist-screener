import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  REPORT_CONFIG,
  getReportMinScore,
  getReportTopN,
  getSeoulDate,
} from "../config/reporting.mjs";
import { principles, scoreStock, summarizeShortlistFailure, toNumber } from "../lib/scoring.mjs";

const inputPath = resolve(process.argv[2] || REPORT_CONFIG.enrichedUniversePath);
const outputPath = resolve(
  process.argv[3] || `${REPORT_CONFIG.reportDir}/daily-shortlist-${getSeoulDate()}.md`,
);
const minScore = Number(process.argv[4] || getReportMinScore());
const topN = Number(process.argv[5] || getReportTopN());
const manualOverridesPath = resolve(process.argv[6] || REPORT_CONFIG.manualOverridesPath);

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

function formatNumber(value) {
  const num = toNumber(value);
  return num === null ? "-" : new Intl.NumberFormat("ko-KR").format(num);
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

    for (const field of ["catalyst", "governance", "confidence", "netCash", "market", "sector"]) {
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
  if (toNumber(stock.per) !== null || toNumber(stock.pbr) !== null) automatic.push("밸류에이션");
  if (toNumber(stock.roe) !== null || toNumber(stock.opMargin) !== null) automatic.push("수익성");
  if (toNumber(stock.debtRatio) !== null || String(stock.netCash || "").trim()) automatic.push("재무안정성");
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
  const csvText = await readFile(inputPath, "utf8");
  let baseStocks = parseCsv(csvText);
  let appliedOverrides = 0;

  if (await exists(manualOverridesPath)) {
    const overrideText = await readFile(manualOverridesPath, "utf8");
    const overrideRows = parseCsv(overrideText);
    const merged = mergeManualOverrides(baseStocks, overrideRows);
    baseStocks = merged.stocks;
    appliedOverrides = merged.appliedCount;
  }

  const stocks = baseStocks.map(scoreStock).sort((a, b) => b.score - a.score);
  const shortlist = stocks.filter((stock) => stock.score >= minScore).slice(0, topN);
  const fieldCoverage = {
    marketCap: stocks.filter((stock) => toNumber(stock.marketCap) !== null).length,
    per: stocks.filter((stock) => toNumber(stock.per) !== null).length,
    pbr: stocks.filter((stock) => toNumber(stock.pbr) !== null).length,
    market: stocks.filter((stock) => String(stock.market || "").trim()).length,
    sector: stocks.filter((stock) => String(stock.sector || "").trim()).length,
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
    lines.push(`- 시가총액: ${formatNumber(stock.marketCap)}`);
    lines.push(`- PER / PBR: ${stock.per || "-"} / ${stock.pbr || "-"}`);
    lines.push(`- ROE / 영업이익률: ${stock.roe || "-"} / ${stock.opMargin || "-"}`);
    lines.push(`- 부채비율 / 배당수익률: ${stock.debtRatio || "-"} / ${stock.dividendYield || "-"}`);
    lines.push(`- 촉매 / 확신도: ${stock.catalyst || "-"} / ${stock.confidence || "-"}`);
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
  console.log(`완료: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
