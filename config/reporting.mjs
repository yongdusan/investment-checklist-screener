export const REPORT_CONFIG = Object.freeze({
  timeZone: "Asia/Seoul",
  defaultYearOffset: 1,
  defaultUniverseLimit: 100,
  minScore: 60,
  topN: 10,
  reportDir: "./reports",
  latestUniversePath: "./data/universe.latest.csv",
  enrichedUniversePath: "./data/universe.enriched.csv",
  manualOverridesPath: "./data/manual-overrides.csv",
  historyIndexPath: "./reports/index.md",
});

export function getSeoulDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getReportYear(env = process.env, date = new Date()) {
  const fallback = date.getFullYear() - REPORT_CONFIG.defaultYearOffset;
  return Number(env.REPORT_YEAR || fallback);
}

export function getReportMinScore(env = process.env) {
  return Number(env.REPORT_MIN_SCORE || REPORT_CONFIG.minScore);
}

export function getReportTopN(env = process.env) {
  return Number(env.REPORT_TOP_N || REPORT_CONFIG.topN);
}

export function getReportLimit(env = process.env) {
  return Number(env.REPORT_LIMIT || REPORT_CONFIG.defaultUniverseLimit);
}
