import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "./data/universe.enriched.csv");
const outputPath = resolve(
  process.argv[3] || `./reports/daily-shortlist-${getSeoulDate()}.md`,
);
const minScore = Number(process.argv[4] || 60);
const topN = Number(process.argv[5] || 10);

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const principles = [
  {
    key: "valuation",
    title: "저평가",
    weight: 20,
    rule: "PER 8 이하와 PBR 1.5 이하를 가장 높게 평가",
  },
  {
    key: "profitability",
    title: "수익성",
    weight: 18,
    rule: "ROE 15 이상과 영업이익률 10 이상이면 강한 가점",
  },
  {
    key: "catalyst",
    title: "재평가 계기",
    weight: 18,
    rule: "catalyst 또는 governance가 strong/medium이면 가점",
  },
  {
    key: "balanceSheet",
    title: "재무 안정성",
    weight: 14,
    rule: "부채비율 100 이하 또는 순현금이면 우수",
  },
  {
    key: "context",
    title: "설명 가능성",
    weight: 12,
    rule: "회사명과 시장 또는 업종 정보가 있으면 가점",
  },
  {
    key: "confidence",
    title: "확신도",
    weight: 18,
    rule: "confidence high/medium를 정성 점수로 반영",
  },
];

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

function toNumber(value) {
  const num = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(num) ? num : null;
}

function normalizeWord(value) {
  return String(value || "").trim().toLowerCase();
}

function parseBoolean(value) {
  return ["true", "yes", "y", "1"].includes(normalizeWord(value));
}

function scoreStock(stock) {
  let score = 0;
  let availableMaxScore = 0;
  const reasons = [];

  const per = toNumber(stock.per);
  const roe = toNumber(stock.roe);
  const pbr = toNumber(stock.pbr);
  const debtRatio = toNumber(stock.debtRatio);
  const opMargin = toNumber(stock.opMargin);
  const marketCap = toNumber(stock.marketCap);
  const dividendYield = toNumber(stock.dividendYield);
  const netCash = parseBoolean(stock.netCash);
  const catalyst = normalizeWord(stock.catalyst);
  const governance = normalizeWord(stock.governance);
  const confidence = normalizeWord(stock.confidence);

  if (per !== null || pbr !== null) {
    availableMaxScore += 20;
    if (per !== null && pbr !== null && per <= 8 && pbr <= 1.5) {
      score += 20;
      reasons.push("낮은 밸류에이션에 비해 과열 신호가 적습니다.");
    } else if (per !== null && per <= 10) {
      score += 12;
      reasons.push("PER이 아주 부담스럽지는 않습니다.");
    } else {
      score += 4;
      reasons.push("밸류에이션 매력은 제한적입니다.");
    }
  }

  if (roe !== null || opMargin !== null) {
    availableMaxScore += 18;
    if (roe !== null && opMargin !== null && roe >= 15 && opMargin >= 10) {
      score += 18;
      reasons.push("ROE와 수익성이 둘 다 괜찮습니다.");
    } else if (roe !== null && roe >= 12) {
      score += 10;
      reasons.push("자본 효율은 무난하지만 추가 확인이 필요합니다.");
    } else if (opMargin !== null && opMargin >= 8) {
      score += 8;
      reasons.push("영업이익률은 양호하지만 자본 효율 추가 확인이 필요합니다.");
    }
  }

  if (catalyst || governance) {
    availableMaxScore += 18;
    if (catalyst === "strong" || governance === "strong") {
      score += 18;
      reasons.push("재평가를 부를 촉매가 비교적 뚜렷합니다.");
    } else if (catalyst === "medium" || governance === "medium") {
      score += 10;
      reasons.push("재평가 계기가 약하게나마 존재합니다.");
    }
  }

  if (debtRatio !== null || String(stock.netCash || "").trim()) {
    availableMaxScore += 14;
    if ((debtRatio !== null && debtRatio <= 100) || netCash) {
      score += 14;
      reasons.push("재무 부담이 과도해 보이지 않습니다.");
    } else if (debtRatio !== null && debtRatio <= 150) {
      score += 7;
      reasons.push("레버리지는 있지만 감당 가능한 수준일 수 있습니다.");
    }
  }

  if (stock.name || stock.sector) {
    availableMaxScore += 12;
    if (stock.name && (stock.sector || stock.market)) {
      score += 12;
      reasons.push("투자 논리를 간단히 설명할 수 있는 기본 정보가 있습니다.");
    } else if (stock.name) {
      score += 8;
      reasons.push("회사 식별 정보는 있으나 업종 문맥은 보강이 필요합니다.");
    }
  }

  if (confidence) {
    availableMaxScore += 18;
    if (confidence === "high") {
      score += 18;
      reasons.push("오래 추적한 후보로 가정할 수 있는 높은 확신도입니다.");
    } else if (confidence === "medium") {
      score += 10;
      reasons.push("좀 더 추적하면 확신을 높일 수 있는 단계입니다.");
    } else {
      reasons.push("확신도가 낮아 관찰용 후보에 가깝습니다.");
    }
  }

  if (marketCap !== null && marketCap >= 300000000000) {
    reasons.push("유동성과 추적 가능성을 기대할 수 있는 시가총액 규모입니다.");
  }

  if (dividendYield !== null && dividendYield >= 2) {
    reasons.push("배당수익률이 방어력을 일부 보완합니다.");
  }

  const maxScore = principles.reduce((total, item) => total + item.weight, 0);
  const normalizedScore = availableMaxScore
    ? Math.min(100, Math.round((score / availableMaxScore) * 100))
    : 0;
  const completeness = Math.round((availableMaxScore / maxScore) * 100);

  return {
    ...stock,
    score: normalizedScore,
    completeness,
    reasons,
  };
}

function formatNumber(value) {
  const num = toNumber(value);
  return num === null ? "-" : new Intl.NumberFormat("ko-KR").format(num);
}

async function main() {
  const csvText = await readFile(inputPath, "utf8");
  const stocks = parseCsv(csvText).map(scoreStock).sort((a, b) => b.score - a.score);
  const shortlist = stocks.filter((stock) => stock.score >= minScore).slice(0, topN);

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
    `## 요약`,
    ``,
  ];

  if (shortlist.length === 0) {
    lines.push(`현재 기준으로 최소 점수 ${minScore}점을 넘는 종목이 없습니다.`);
  } else {
    shortlist.forEach((stock, index) => {
      lines.push(
        `${index + 1}. ${stock.name} (${stock.market || "시장 미기재"} / ${stock.sector || "섹터 미기재"}) - ${stock.score}점`,
      );
    });
  }

  lines.push("", "## 상세", "");

  lines.push("## 점수표", "");
  lines.push("| 항목 | 배점 | 기준 |");
  lines.push("| --- | ---: | --- |");
  principles.forEach((item) => {
    lines.push(`| ${item.title} | ${item.weight} | ${item.rule} |`);
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
    lines.push(`### ${index + 1}. ${stock.name}`);
    lines.push("");
    lines.push(`- 점수: ${stock.score}점`);
    lines.push(`- 정보 충실도: ${stock.completeness}%`);
    lines.push(`- 시장/업종: ${stock.market || "-"} / ${stock.sector || "-"}`);
    lines.push(`- 시가총액: ${formatNumber(stock.marketCap)}`);
    lines.push(`- PER / PBR: ${stock.per || "-"} / ${stock.pbr || "-"}`);
    lines.push(`- ROE / 영업이익률: ${stock.roe || "-"} / ${stock.opMargin || "-"}`);
    lines.push(`- 부채비율 / 배당수익률: ${stock.debtRatio || "-"} / ${stock.dividendYield || "-"}`);
    lines.push(`- 촉매 / 확신도: ${stock.catalyst || "-"} / ${stock.confidence || "-"}`);
    lines.push(`- 이유: ${stock.reasons.join(" / ")}`);
    lines.push("");
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`완료: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
