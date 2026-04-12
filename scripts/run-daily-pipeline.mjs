import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  REPORT_CONFIG,
  getReportLimit,
  getReportMinScore,
  getReportTopN,
  getReportYear,
  getSeoulDate,
} from "../config/reporting.mjs";

const year = getReportYear();
const limit = getReportLimit();
const minScore = String(getReportMinScore());
const topN = String(getReportTopN());

const dartOutput = resolve(REPORT_CONFIG.latestUniversePath);
const enrichedOutput = resolve(REPORT_CONFIG.enrichedUniversePath);
const reportOutput = resolve(`${REPORT_CONFIG.reportDir}/${getSeoulDate()}-daily-shortlist.md`);

function exists(path) {
  return access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function runNode(script, args) {
  execFileSync("node", [script, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

function runStage(label, script, args) {
  console.log(`[pipeline] ${label} 시작`);
  try {
    runNode(script, args);
    console.log(`[pipeline] ${label} 완료`);
  } catch (error) {
    console.error(`[pipeline] ${label} 실패`, {
      script,
      args,
      message: error.message,
      status: error.status ?? null,
    });
    throw error;
  }
}

async function main() {
  runStage("OpenDART 유니버스 생성", "./scripts/build-dart-universe.mjs", [
    String(year),
    String(limit),
  ]);
  runStage("OpenDART 유니버스 검증", "./scripts/validate-universe.mjs", [dartOutput, "latest"]);

  const hasBasic = await exists("./data/krx-basic.csv");
  const hasValuation = await exists("./data/krx-valuation.csv");
  const hasMarketCap = await exists("./data/krx-marketcap.csv");

  let reportInput = dartOutput;
  if (hasBasic && hasValuation && hasMarketCap) {
    runStage("KRX 기본정보 검증", "./scripts/validate-universe.mjs", [
      "./data/krx-basic.csv",
      "krx-basic",
    ]);
    runStage("KRX 밸류에이션 검증", "./scripts/validate-universe.mjs", [
      "./data/krx-valuation.csv",
      "krx-valuation",
    ]);
    runStage("KRX 시가총액 검증", "./scripts/validate-universe.mjs", [
      "./data/krx-marketcap.csv",
      "krx-marketcap",
    ]);
    runStage("KRX 병합", "./scripts/merge-krx-exports.mjs", [
      dartOutput,
      "./data/krx-basic.csv",
      "./data/krx-valuation.csv",
      "./data/krx-marketcap.csv",
      enrichedOutput,
    ]);
    runStage("Enriched 유니버스 검증", "./scripts/validate-universe.mjs", [
      enrichedOutput,
      "enriched",
    ]);
    reportInput = enrichedOutput;
    console.log("KRX valuation/marketcap CSV를 함께 사용해 universe.enriched.csv를 생성합니다.");
  } else {
    const missing = [
      !hasBasic ? "krx-basic.csv" : null,
      !hasValuation ? "krx-valuation.csv" : null,
      !hasMarketCap ? "krx-marketcap.csv" : null,
    ].filter(Boolean);
    console.log(
      `추가 KRX CSV가 부족해 universe.latest.csv로 리포트를 생성합니다. 누락: ${missing.join(", ") || "없음"}`,
    );
  }

  runStage("일간 리포트 생성", "./scripts/generate-daily-report.mjs", [
    reportInput,
    reportOutput,
    minScore,
    topN,
  ]);

  console.log(
    `리포트 설정: 기준연도 ${year}, 대상 ${limit}개, 최소점수 ${minScore}, 상위 후보 ${topN}개`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
