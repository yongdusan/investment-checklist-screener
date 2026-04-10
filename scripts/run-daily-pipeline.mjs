import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  REPORT_CONFIG,
  getReportMinScore,
  getReportTopN,
  getReportYear,
  getSeoulDate,
} from "../config/reporting.mjs";

const year = getReportYear();
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

async function main() {
  runNode("./scripts/build-dart-universe.mjs", [String(year)]);

  const hasBasic = await exists("./data/krx-basic.csv");
  const hasValuation = await exists("./data/krx-valuation.csv");
  const hasMarketCap = await exists("./data/krx-marketcap.csv");

  let reportInput = dartOutput;
  if (hasBasic && hasValuation && hasMarketCap) {
    runNode("./scripts/merge-krx-exports.mjs", [
      dartOutput,
      "./data/krx-basic.csv",
      "./data/krx-valuation.csv",
      "./data/krx-marketcap.csv",
      enrichedOutput,
    ]);
    reportInput = enrichedOutput;
  }

  runNode("./scripts/generate-daily-report.mjs", [
    reportInput,
    reportOutput,
    minScore,
    topN,
  ]);

  console.log(
    `리포트 설정: 기준연도 ${year}, 최소점수 ${minScore}, 상위 후보 ${topN}개`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
