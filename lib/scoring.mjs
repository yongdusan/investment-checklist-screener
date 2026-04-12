export const principles = [
  {
    key: "valuation",
    title: "싸지만 싸구려는 아닌가",
    shortTitle: "저평가",
    weight: 20,
    description:
      "PER, PBR이 낮더라도 이익 체력이 너무 약하면 밸류 트랩일 수 있습니다. 낮은 가격 자체보다 낮을 이유가 적은지를 봅니다.",
    rule: "PER 8 이하와 PBR 1.5 이하를 가장 높게 평가",
  },
  {
    key: "profitability",
    title: "ROE와 수익성이 유지되는가",
    shortTitle: "수익성",
    weight: 18,
    description:
      "높은 ROE와 괜찮은 영업이익률은 자본 효율과 사업 체력을 동시에 보여줍니다.",
    rule: "ROE 15 이상과 영업이익률 10 이상이면 강한 가점",
  },
  {
    key: "catalyst",
    title: "재평가 계기가 있는가",
    shortTitle: "재평가 계기",
    weight: 18,
    description:
      "지배구조 개편, 자사주 정책, 자산 재평가, 업황 회복 같은 촉매가 있어야 싼 기업이 계속 싼 채로 남는 위험을 줄일 수 있습니다.",
    rule: "catalyst 또는 governance가 strong/medium이면 가점",
  },
  {
    key: "balanceSheet",
    title: "재무가 버텨주는가",
    shortTitle: "재무 안정성",
    weight: 14,
    description:
      "현금이 있거나 부채 부담이 과하지 않아야 기다릴 시간이 생깁니다.",
    rule: "부채비율 100 이하 또는 순현금이면 우수",
  },
  {
    key: "context",
    title: "설명이 단순한가",
    shortTitle: "설명 가능성",
    weight: 12,
    description:
      "두세 문장으로 투자 논리가 정리되지 않으면, 흔들릴 때 보유가 어렵습니다.",
    rule: "회사명과 시장 또는 업종 정보가 있으면 가점",
  },
  {
    key: "confidence",
    title: "내 확신 수준이 과장되지 않았는가",
    shortTitle: "확신도",
    weight: 18,
    description:
      "확신도는 정보량과 추적 기간에서 나와야 합니다. 느낌만 강한 확신은 감점입니다.",
    rule: "confidence high/medium를 정성 점수로 반영",
  },
];

const principleMap = new Map(principles.map((item) => [item.key, item]));

export function toNumber(value) {
  const cleaned = String(value ?? "").replaceAll(",", "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "N/A") {
    return null;
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function normalizeWord(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function parseBoolean(value) {
  return ["true", "yes", "y", "1"].includes(normalizeWord(value));
}

export function getScoreMax() {
  return principles.reduce((total, item) => total + item.weight, 0);
}

function createBreakdownItem(key, points, available, summary) {
  const principle = principleMap.get(key);
  return {
    key,
    title: principle.title,
    shortTitle: principle.shortTitle,
    weight: principle.weight,
    points,
    available,
    summary,
  };
}

export function scoreStock(stock) {
  let rawScore = 0;
  let availableMaxScore = 0;
  const reasons = [];
  const breakdown = [];

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
    availableMaxScore += principleMap.get("valuation").weight;
    if (per !== null && pbr !== null && per <= 8 && pbr <= 1.5) {
      rawScore += 20;
      reasons.push("낮은 밸류에이션에 비해 과열 신호가 적습니다.");
      breakdown.push(createBreakdownItem("valuation", 20, true, "PER와 PBR이 모두 우수합니다."));
    } else if (per !== null && per <= 10) {
      rawScore += 12;
      reasons.push("PER이 아주 부담스럽지는 않습니다.");
      breakdown.push(createBreakdownItem("valuation", 12, true, "PER 기준으로는 무난한 저평가 구간입니다."));
    } else {
      rawScore += 4;
      reasons.push("밸류에이션 매력은 제한적입니다.");
      breakdown.push(createBreakdownItem("valuation", 4, true, "밸류에이션 할인 폭은 크지 않습니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("valuation", 0, false, "PER/PBR 데이터가 없습니다."));
  }

  if (roe !== null || opMargin !== null) {
    availableMaxScore += principleMap.get("profitability").weight;
    if (roe !== null && opMargin !== null && roe >= 15 && opMargin >= 10) {
      rawScore += 18;
      reasons.push("ROE와 수익성이 둘 다 괜찮습니다.");
      breakdown.push(createBreakdownItem("profitability", 18, true, "자본 효율과 마진이 모두 좋습니다."));
    } else if (roe !== null && roe >= 12) {
      rawScore += 10;
      reasons.push("자본 효율은 무난하지만 추가 확인이 필요합니다.");
      breakdown.push(createBreakdownItem("profitability", 10, true, "ROE는 괜찮지만 마진 확인이 더 필요합니다."));
    } else if (opMargin !== null && opMargin >= 8) {
      rawScore += 8;
      reasons.push("영업이익률은 양호하지만 자본 효율 추가 확인이 필요합니다.");
      breakdown.push(createBreakdownItem("profitability", 8, true, "마진은 양호하지만 ROE 보강이 필요합니다."));
    } else {
      breakdown.push(createBreakdownItem("profitability", 0, true, "수익성 지표가 약합니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("profitability", 0, false, "ROE/영업이익률 데이터가 없습니다."));
  }

  if (catalyst || governance) {
    availableMaxScore += principleMap.get("catalyst").weight;
    if (catalyst === "strong" || governance === "strong") {
      rawScore += 18;
      reasons.push("재평가를 부를 촉매가 비교적 뚜렷합니다.");
      breakdown.push(createBreakdownItem("catalyst", 18, true, "강한 촉매 또는 거버넌스 개선 신호가 있습니다."));
    } else if (catalyst === "medium" || governance === "medium") {
      rawScore += 10;
      reasons.push("재평가 계기가 약하게나마 존재합니다.");
      breakdown.push(createBreakdownItem("catalyst", 10, true, "재평가 포인트가 일부 보입니다."));
    } else {
      breakdown.push(createBreakdownItem("catalyst", 0, true, "촉매 강도는 약한 편입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("catalyst", 0, false, "정성 촉매 정보가 없습니다."));
  }

  if (debtRatio !== null || String(stock.netCash || "").trim()) {
    availableMaxScore += principleMap.get("balanceSheet").weight;
    if ((debtRatio !== null && debtRatio <= 100) || netCash) {
      rawScore += 14;
      reasons.push("재무 부담이 과도해 보이지 않습니다.");
      breakdown.push(createBreakdownItem("balanceSheet", 14, true, "재무 부담이 낮거나 순현금입니다."));
    } else if (debtRatio !== null && debtRatio <= 150) {
      rawScore += 7;
      reasons.push("레버리지는 있지만 감당 가능한 수준일 수 있습니다.");
      breakdown.push(createBreakdownItem("balanceSheet", 7, true, "레버리지는 있으나 아직 관리 가능한 수준입니다."));
    } else {
      breakdown.push(createBreakdownItem("balanceSheet", 0, true, "재무 부담이 높은 편입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("balanceSheet", 0, false, "부채비율/순현금 데이터가 없습니다."));
  }

  if (stock.name || stock.sector) {
    availableMaxScore += principleMap.get("context").weight;
    if (stock.name && (stock.sector || stock.market)) {
      rawScore += 12;
      reasons.push("투자 논리를 간단히 설명할 수 있는 기본 정보가 있습니다.");
      breakdown.push(createBreakdownItem("context", 12, true, "시장·업종 문맥까지 함께 있습니다."));
    } else if (stock.name) {
      rawScore += 8;
      reasons.push("회사 식별 정보는 있으나 업종 문맥은 보강이 필요합니다.");
      breakdown.push(createBreakdownItem("context", 8, true, "회사 식별은 되지만 설명 문맥이 약합니다."));
    } else {
      breakdown.push(createBreakdownItem("context", 0, true, "설명용 기본 정보가 부족합니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("context", 0, false, "회사명/시장/업종 정보가 부족합니다."));
  }

  if (confidence) {
    availableMaxScore += principleMap.get("confidence").weight;
    if (confidence === "high") {
      rawScore += 18;
      reasons.push("오래 추적한 후보로 가정할 수 있는 높은 확신도입니다.");
      breakdown.push(createBreakdownItem("confidence", 18, true, "높은 확신도를 입력했습니다."));
    } else if (confidence === "medium") {
      rawScore += 10;
      reasons.push("좀 더 추적하면 확신을 높일 수 있는 단계입니다.");
      breakdown.push(createBreakdownItem("confidence", 10, true, "추적은 됐지만 더 검증이 필요합니다."));
    } else {
      reasons.push("확신도가 낮아 관찰용 후보에 가깝습니다.");
      breakdown.push(createBreakdownItem("confidence", 0, true, "확신도가 낮습니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("confidence", 0, false, "확신도 정보가 없습니다."));
  }

  if (marketCap !== null && marketCap >= 300000000000) {
    reasons.push("유동성과 추적 가능성을 기대할 수 있는 시가총액 규모입니다.");
  }

  if (dividendYield !== null && dividendYield >= 2) {
    reasons.push("배당수익률이 방어력을 일부 보완합니다.");
  }

  const maxScore = getScoreMax();
  const normalizedScore = availableMaxScore
    ? Math.min(100, Math.round((rawScore / availableMaxScore) * 100))
    : 0;
  const completeness = Math.round((availableMaxScore / maxScore) * 100);

  return {
    ...stock,
    score: normalizedScore,
    completeness,
    reasons,
    breakdown,
    raw: {
      per,
      roe,
      pbr,
      debtRatio,
      opMargin,
      netCash,
      catalyst,
      governance,
      confidence,
      marketCap,
      dividendYield,
    },
  };
}

export function summarizeShortlistFailure(stocks, minScore, topN) {
  if (stocks.length === 0) {
    return [
      "입력 유니버스 CSV에 종목 행이 없어 후보를 계산하지 못했습니다.",
      "CSV 헤더와 데이터 행이 모두 들어 있는지 먼저 확인해 주세요.",
    ];
  }

  const bestScore = Math.max(...stocks.map((stock) => stock.score));
  const avgCompleteness = Math.round(
    stocks.reduce((sum, stock) => sum + stock.completeness, 0) / stocks.length,
  );
  const missingCatalystCount = stocks.filter(
    (stock) => !stock.raw.catalyst && !stock.raw.governance,
  ).length;
  const missingConfidenceCount = stocks.filter((stock) => !stock.raw.confidence).length;

  const lines = [
    `최고 점수는 ${bestScore}점이라 현재 최소 점수 ${minScore}점을 넘지 못했습니다.`,
    `평균 정보 충실도는 ${avgCompleteness}%입니다.`,
  ];

  if (avgCompleteness < 50) {
    lines.push("정량·정성 데이터가 전반적으로 부족해 점수가 보수적으로 계산됐을 가능성이 큽니다.");
  }

  if (missingCatalystCount === stocks.length) {
    lines.push("모든 종목에 촉매/거버넌스 정보가 비어 있어 재평가 항목이 전부 빠졌습니다.");
  }

  if (missingConfidenceCount === stocks.length) {
    lines.push("모든 종목에 확신도 정보가 없어 정성 점수가 크게 낮아졌습니다.");
  }

  if (bestScore >= minScore - 10) {
    lines.push(`최소 점수를 ${Math.max(0, minScore - 10)}점까지 낮추면 관찰 후보가 생길 수 있습니다.`);
  }

  lines.push(`요청한 상위 후보 수는 ${topN}개였지만 현재 조건에서는 통과 종목이 0개입니다.`);
  return lines;
}
