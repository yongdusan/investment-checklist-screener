import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const year = process.env.REPORT_YEAR || new Date().getFullYear() - 1;
const minScore = process.env.REPORT_MIN_SCORE || "60";
const topN = process.env.REPORT_TOP_N || "10";

const dartOutput = resolve("./data/universe.latest.csv");
const enrichedOutput = resolve("./data/universe.enriched.csv");
const reportOutput = resolve(`./reports/${getSeoulDate()}-daily-shortlist.md`);

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
