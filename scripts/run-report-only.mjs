import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  REPORT_CONFIG,
  getReportMinScore,
  getReportTopN,
  getSeoulDate,
} from "../config/reporting.mjs";

const minScore = String(getReportMinScore());
const topN = String(getReportTopN());
const latestUniverse = resolve(REPORT_CONFIG.latestUniversePath);
const enrichedUniverse = resolve(REPORT_CONFIG.enrichedUniversePath);
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

async function updateHistoryIndex(reportDirPath) {
  const entries = await readdir(reportDirPath, { withFileTypes: true });
  const reportFiles = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-daily-shortlist\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const lines = [
    "# 리포트 히스토리",
    "",
    "자동 생성된 일간 투자 후보 리포트 목록입니다.",
    "",
  ];

  if (reportFiles.length === 0) {
    lines.push("아직 생성된 리포트가 없습니다.");
  } else {
    reportFiles.forEach((fileName, index) => {
      const date = fileName.replace("-daily-shortlist.md", "");
      lines.push(`${index + 1}. [${date} 리포트](./${fileName})`);
    });
  }

  await writeFile(resolve(reportDirPath, "index.md"), `${lines.join("\n")}\n`, "utf8");
}

async function writeMissingDataReport() {
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeZone: REPORT_CONFIG.timeZone,
  }).format(new Date());

  const lines = [
    "# 일간 투자 후보 리포트",
    "",
    `- 생성일: ${dateLabel}`,
    `- 입력 파일: 없음`,
    `- 최소 점수: ${minScore}`,
    `- 상위 후보 수: ${topN}`,
    `- 통과 종목 수: 0`,
    "",
    "## 데이터 상태",
    "",
    "- 전체 종목 수: 0",
    "- 평균 정보 충실도: 0%",
    "- 최고 점수: 0점",
    "",
    "## 요약",
    "",
    "현재 기준으로 최소 점수 조건을 평가할 입력 유니버스 CSV가 없습니다.",
    "",
    "## 왜 후보가 없었나",
    "",
    "- `data/universe.enriched.csv` 와 `data/universe.latest.csv` 둘 다 존재하지 않습니다.",
    "- 먼저 `Refresh Stock Universe` 워크플로를 실행해 데이터 파일을 만들어 주세요.",
    "",
  ];

  await mkdir(dirname(reportOutput), { recursive: true });
  await writeFile(reportOutput, `${lines.join("\n")}\n`, "utf8");
  await updateHistoryIndex(dirname(reportOutput));
  console.log(`보류 리포트 생성: ${reportOutput}`);
}

async function main() {
  const hasEnriched = await exists(enrichedUniverse);
  const hasLatest = await exists(latestUniverse);

  if (hasEnriched) {
    runNode("./scripts/validate-universe.mjs", [
      enrichedUniverse,
      "enriched",
    ]);
    runNode("./scripts/generate-daily-report.mjs", [
      enrichedUniverse,
      reportOutput,
      minScore,
      topN,
    ]);
    return;
  }

  if (hasLatest) {
    runNode("./scripts/validate-universe.mjs", [
      latestUniverse,
      "latest",
    ]);
    runNode("./scripts/generate-daily-report.mjs", [
      latestUniverse,
      reportOutput,
      minScore,
      topN,
    ]);
    return;
  }

  await writeMissingDataReport();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
