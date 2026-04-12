export const principles = [
  {
    key: "valuation",
    title: "업종 대비 싸면서도 이유를 설명할 수 있는가",
    shortTitle: "상대 저평가",
    weight: 18,
    description:
      "절대 PBR/PER만으로는 업종 차이를 놓치기 쉽습니다. 같은 섹터 안에서 할인돼 있는지와 과도한 밸류 함정은 아닌지를 함께 봅니다.",
    rule: "업종 중위값 대비 할인율에 EV/EBITDA, FCF Yield를 보조 반영",
  },
  {
    key: "profitability",
    title: "수익성의 질이 유지되는가",
    shortTitle: "수익성",
    weight: 17,
    description:
      "ROE 대신 ROIC와 현금전환율을 함께 보면 레버리지로 부풀린 수익성을 덜 속아 넘어갑니다.",
    rule: "ROIC, 영업이익률, 영업현금흐름/순이익 비율과 3년 추세를 조합",
  },
  {
    key: "catalyst",
    title: "재평가 계기가 구조적으로 존재하는가",
    shortTitle: "재평가 계기",
    weight: 20,
    description:
      "한국 시장에서는 싼 기업보다 비싸질 이유가 생긴 기업이 움직입니다. 구조조정, Value-up, 커버리지, 수급 재인식 신호를 함께 봅니다.",
    rule: "체크리스트 신호 수와 정성 catalyst/governance를 함께 반영",
  },
  {
    key: "balanceSheet",
    title: "버틸 재무 체력이 있는가",
    shortTitle: "재무 안정성",
    weight: 12,
    description:
      "부채비율 하나보다 이자 감당 능력과 순현금 여부가 실제 방어력을 더 잘 보여줍니다.",
    rule: "이자보상배율, 부채비율, 순현금을 함께 반영",
  },
  {
    key: "shareholderReturn",
    title: "주주환원 의지가 보이는가",
    shortTitle: "주주환원",
    weight: 15,
    description:
      "Value-up 이후 리레이팅의 핵심은 주주환원입니다. 배당만이 아니라 자사주 매입·소각과 환원 의지까지 같이 봅니다.",
    rule: "배당수익률과 환원 체크리스트를 함께 반영",
  },
  {
    key: "context",
    title: "설명 구조가 단순한가",
    shortTitle: "설명 가능성",
    weight: 10,
    description:
      "업종과 시장 문맥까지 붙어야 투자 아이디어를 짧고 흔들림 없이 설명할 수 있습니다.",
    rule: "회사명과 시장/업종 정보가 함께 있으면 가점",
  },
  {
    key: "confidence",
    title: "확신은 검증에 비례하는가",
    shortTitle: "확신도",
    weight: 8,
    description:
      "확신도는 보조 지표로만 쓰고, 정량 지표보다 과하게 점수를 흔들지 않도록 비중을 줄입니다.",
    rule: "confidence high/medium를 보조 점수로 반영",
  },
];

const principleMap = new Map(principles.map((item) => [item.key, item]));
const RELATIVE_BENCHMARK_MIN_SIZE = 3;

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

function sanitizeMetric(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const num = toNumber(value);
  if (num === null) {
    return null;
  }
  if (num < min || num > max) {
    return null;
  }
  return num;
}

function fmt(value, digits = 2) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(digits);
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
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

export function getScoreMax() {
  return principles.reduce((total, item) => total + item.weight, 0);
}

function buildSectorBenchmarks(stocks) {
  const sectorBuckets = new Map();

  stocks.forEach((stock) => {
    const sector = String(stock.sector || "").trim();
    if (!sector) {
      return;
    }

    if (!sectorBuckets.has(sector)) {
      sectorBuckets.set(sector, { per: [], pbr: [] });
    }

    const bucket = sectorBuckets.get(sector);
    const per = sanitizeMetric(stock.per, { min: 0.01, max: 1000 });
    const pbr = sanitizeMetric(stock.pbr, { min: 0.01, max: 100 });

    if (per !== null) {
      bucket.per.push(per);
    }
    if (pbr !== null) {
      bucket.pbr.push(pbr);
    }
  });

  const benchmarks = new Map();
  sectorBuckets.forEach((bucket, sector) => {
    benchmarks.set(sector, {
      perMedian: bucket.per.length >= RELATIVE_BENCHMARK_MIN_SIZE ? median(bucket.per) : null,
      pbrMedian: bucket.pbr.length >= RELATIVE_BENCHMARK_MIN_SIZE ? median(bucket.pbr) : null,
      sampleSize: Math.max(bucket.per.length, bucket.pbr.length),
    });
  });
  return benchmarks;
}

function collectChecklistSignals(stock) {
  const booleans = {
    valueUp: parseBoolean(stock.valueUp),
    buyback: parseBoolean(stock.buyback),
    treasuryCancellation: parseBoolean(stock.treasuryCancellation),
    payoutRaise: parseBoolean(stock.payoutRaise),
    assetSale: parseBoolean(stock.assetSale),
    spinOff: parseBoolean(stock.spinOff),
    insiderBuying: parseBoolean(stock.insiderBuying),
    foreignOwnershipRebound: parseBoolean(stock.foreignOwnershipRebound),
    coverageInitiation: parseBoolean(stock.coverageInitiation),
  };

  const catalystSignals = [
    booleans.valueUp && "기업가치 제고 계획",
    booleans.assetSale && "비핵심 자산 매각",
    booleans.spinOff && "사업 재편 또는 분리",
    booleans.insiderBuying && "대주주/내부자 매수",
    booleans.foreignOwnershipRebound && "외국인 지분 반등",
    booleans.coverageInitiation && "애널리스트 커버리지",
  ].filter(Boolean);

  const shareholderSignals = [
    booleans.valueUp && "Value-up 참여",
    booleans.buyback && "자사주 매입",
    booleans.treasuryCancellation && "자사주 소각",
    booleans.payoutRaise && "배당성향 상향",
  ].filter(Boolean);

  return { booleans, catalystSignals, shareholderSignals };
}

function formatDiscountLabel(metric, value, medianValue) {
  if (value === null || medianValue === null || medianValue === 0) {
    return null;
  }
  const discount = Math.round((1 - value / medianValue) * 100);
  return `${metric} 업종 대비 ${discount > 0 ? `${discount}% 할인` : `${Math.abs(discount)}% 프리미엄`}`;
}

function isFinancialSector(sector) {
  const normalized = String(sector || "").replaceAll(/\s+/g, "").toLowerCase();
  return ["금융", "은행", "증권", "보험", "리츠", "부동산투자"].some((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
}

export function scoreStock(stock, context = {}) {
  let rawScore = 0;
  let availableMaxScore = 0;
  const reasons = [];
  const breakdown = [];

  const per = sanitizeMetric(stock.per, { min: 0.01, max: 1000 });
  const roe = sanitizeMetric(stock.roe, { min: -200, max: 200 });
  const roic = sanitizeMetric(stock.roic, { min: -200, max: 200 });
  const pbr = sanitizeMetric(stock.pbr, { min: 0.01, max: 100 });
  const evToEbitda = sanitizeMetric(stock.evToEbitda, { min: 0.01, max: 100 });
  const fcfYield = sanitizeMetric(stock.fcfYield, { min: -100, max: 100 });
  const debtRatio = sanitizeMetric(stock.debtRatio, { min: 0, max: 5000 });
  const opMargin = sanitizeMetric(stock.opMargin, { min: -100, max: 100 });
  const roicTrend3Y = sanitizeMetric(stock.roicTrend3Y, { min: -200, max: 200 });
  const opMarginTrend3Y = sanitizeMetric(stock.opMarginTrend3Y, { min: -100, max: 100 });
  const marketCap = sanitizeMetric(stock.marketCap, { min: 1 });
  const dividendYield = sanitizeMetric(stock.dividendYield, { min: 0, max: 100 });
  const interestCoverage = sanitizeMetric(stock.interestCoverage, { min: -100, max: 1000 });
  const ocfToNetIncome = sanitizeMetric(stock.ocfToNetIncome, { min: -20, max: 20 });
  const netCash = parseBoolean(stock.netCash);
  const catalyst = normalizeWord(stock.catalyst);
  const governance = normalizeWord(stock.governance);
  const confidence = normalizeWord(stock.confidence);
  const shareholderReturn = normalizeWord(stock.shareholderReturn);
  const checklist = collectChecklistSignals(stock);
  const sectorBenchmark = context.sectorBenchmarks?.get(String(stock.sector || "").trim()) || null;
  const financialSector = isFinancialSector(stock.sector);

  if (per !== null || pbr !== null || (!financialSector && (evToEbitda !== null || fcfYield !== null))) {
    availableMaxScore += principleMap.get("valuation").weight;
    const perMedian = sectorBenchmark?.perMedian ?? null;
    const pbrMedian = sectorBenchmark?.pbrMedian ?? null;
    const perDiscount = per !== null && perMedian ? 1 - per / perMedian : null;
    const pbrDiscount = pbr !== null && pbrMedian ? 1 - pbr / pbrMedian : null;
    const strongRelative =
      (per !== null && perMedian !== null && per <= 12 && perDiscount !== null && perDiscount >= 0.2) ||
      (pbr !== null && pbrMedian !== null && pbr <= 1.5 && pbrDiscount !== null && pbrDiscount >= 0.15) ||
      (per !== null && pbr !== null && per <= 8 && pbr <= 1.1) ||
      (!financialSector && evToEbitda !== null && evToEbitda <= 6 && fcfYield !== null && fcfYield >= 6);
    const mediumRelative =
      (per !== null && perMedian !== null && perDiscount !== null && perDiscount >= 0.1) ||
      (pbr !== null && pbrMedian !== null && pbrDiscount !== null && pbrDiscount >= 0.08) ||
      (per !== null && per <= 10) ||
      (pbr !== null && pbr <= 1.3) ||
      (!financialSector && evToEbitda !== null && evToEbitda <= 8) ||
      (!financialSector && fcfYield !== null && fcfYield >= 4);
    const discountParts = [
      formatDiscountLabel("PER", per, perMedian),
      formatDiscountLabel("PBR", pbr, pbrMedian),
      !financialSector && evToEbitda !== null ? `EV/EBITDA ${fmt(evToEbitda)}배` : null,
      !financialSector && fcfYield !== null ? `FCF Yield ${fmt(fcfYield)}%` : null,
    ].filter(Boolean);

    if (strongRelative) {
      rawScore += 18;
      reasons.push("업종 대비 할인 폭이 있으면서 절대 멀티플도 과하지 않습니다.");
      breakdown.push(
        createBreakdownItem(
          "valuation",
          18,
          true,
          discountParts.length
            ? `${discountParts.join(", ")} 수준입니다.`
            : "절대 PBR/PER 기준으로도 상단 저평가 구간입니다.",
        ),
      );
    } else if (mediumRelative) {
      rawScore += 10;
      reasons.push("밸류에이션 부담은 낮지만 업종 대비 추가 검토가 필요합니다.");
      breakdown.push(
        createBreakdownItem(
          "valuation",
          10,
          true,
          discountParts.length
            ? `${discountParts.join(", ")} 정도의 할인입니다.`
            : "절대 밸류는 무난하지만 상대가치 근거는 더 필요합니다.",
        ),
      );
    } else {
      rawScore += 3;
      breakdown.push(createBreakdownItem("valuation", 3, true, "업종 대비 할인 폭은 제한적입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("valuation", 0, false, "PER/PBR 데이터가 없습니다."));
  }

  if (roic !== null || opMargin !== null || ocfToNetIncome !== null || roe !== null) {
    availableMaxScore += principleMap.get("profitability").weight;
    const strongQuality =
      (roic !== null && roic >= 12 && opMargin !== null && opMargin >= 8) &&
      (ocfToNetIncome === null || ocfToNetIncome >= 0.8) &&
      (roicTrend3Y === null || roicTrend3Y >= 0) &&
      (opMarginTrend3Y === null || opMarginTrend3Y >= 0);
    const mediumQuality =
      (roic !== null && roic >= 10) ||
      (roe !== null && roe >= 12 && opMargin !== null && opMargin >= 8) ||
      (ocfToNetIncome !== null && ocfToNetIncome >= 0.9) ||
      (roicTrend3Y !== null && roicTrend3Y >= 1) ||
      (opMarginTrend3Y !== null && opMarginTrend3Y >= 1);

    if (strongQuality) {
      rawScore += 17;
      reasons.push("ROIC와 마진, 현금전환율이 함께 받쳐주는 편입니다.");
      breakdown.push(
        createBreakdownItem(
          "profitability",
          17,
          true,
          `수익성의 질까지 확인되는 구간입니다.${roicTrend3Y !== null || opMarginTrend3Y !== null ? ` 3년 추세: ROIC ${fmt(roicTrend3Y)}%p, 영업이익률 ${fmt(opMarginTrend3Y)}%p` : ""}`,
        ),
      );
    } else if (mediumQuality) {
      rawScore += 9;
      reasons.push("수익성은 무난하지만 현금화 또는 자본효율 추가 검토가 필요합니다.");
      breakdown.push(
        createBreakdownItem(
          "profitability",
          9,
          true,
          `ROIC/현금전환율 또는 3년 추세 중 일부만 확인됩니다.${roicTrend3Y !== null || opMarginTrend3Y !== null ? ` ROIC ${fmt(roicTrend3Y)}%p, 영업이익률 ${fmt(opMarginTrend3Y)}%p` : ""}`,
        ),
      );
    } else {
      breakdown.push(createBreakdownItem("profitability", 0, true, "수익성 지표가 약하거나 일관성이 부족합니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("profitability", 0, false, "ROIC/ROE/현금전환율 데이터가 없습니다."));
  }

  if (catalyst || governance || checklist.catalystSignals.length) {
    availableMaxScore += principleMap.get("catalyst").weight;
    const catalystSignalCount = checklist.catalystSignals.length;

    if (catalyst === "strong" || governance === "strong" || catalystSignalCount >= 2) {
      rawScore += 20;
      reasons.push("재평가를 부를 구조적 신호가 비교적 분명합니다.");
      breakdown.push(
        createBreakdownItem(
          "catalyst",
          20,
          true,
          checklist.catalystSignals.length
            ? `체크리스트 신호: ${checklist.catalystSignals.join(", ")}`
            : "강한 catalyst/governance 입력이 있습니다.",
        ),
      );
    } else if (catalyst === "medium" || governance === "medium" || catalystSignalCount === 1) {
      rawScore += 11;
      reasons.push("재평가 계기는 있으나 아직 확인할 트리거가 더 남아 있습니다.");
      breakdown.push(
        createBreakdownItem(
          "catalyst",
          11,
          true,
          checklist.catalystSignals.length
            ? `체크리스트 신호: ${checklist.catalystSignals.join(", ")}`
            : "정성 catalyst/governance 정보가 일부 있습니다.",
        ),
      );
    } else {
      breakdown.push(createBreakdownItem("catalyst", 0, true, "촉매 강도는 아직 약한 편입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("catalyst", 0, false, "재평가 체크리스트나 정성 촉매 정보가 없습니다."));
  }

  if (interestCoverage !== null || debtRatio !== null || String(stock.netCash || "").trim()) {
    availableMaxScore += principleMap.get("balanceSheet").weight;

    if (netCash || (interestCoverage !== null && interestCoverage >= 5) || (debtRatio !== null && debtRatio <= 100)) {
      rawScore += 12;
      reasons.push("이자 감당 능력이나 순현금 측면에서 방어력이 있습니다.");
      breakdown.push(createBreakdownItem("balanceSheet", 12, true, "재무 완충력이 우수한 편입니다."));
    } else if ((interestCoverage !== null && interestCoverage >= 2.5) || (debtRatio !== null && debtRatio <= 150)) {
      rawScore += 6;
      reasons.push("레버리지는 있지만 아직 감내 가능한 구간으로 보입니다.");
      breakdown.push(createBreakdownItem("balanceSheet", 6, true, "재무 부담이 아주 높지는 않지만 보수적 확인이 필요합니다."));
    } else {
      breakdown.push(createBreakdownItem("balanceSheet", 0, true, "실질 상환 능력 기준으로는 부담이 있습니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("balanceSheet", 0, false, "이자보상배율/부채비율/순현금 데이터가 없습니다."));
  }

  if (shareholderReturn || dividendYield !== null || checklist.shareholderSignals.length) {
    availableMaxScore += principleMap.get("shareholderReturn").weight;
    const signalCount = checklist.shareholderSignals.length;

    if (shareholderReturn === "strong" || signalCount >= 2 || (dividendYield !== null && dividendYield >= 4)) {
      rawScore += 15;
      reasons.push("주주환원 의지가 분명하거나 실제 환원 강도가 높은 편입니다.");
      breakdown.push(
        createBreakdownItem(
          "shareholderReturn",
          15,
          true,
          checklist.shareholderSignals.length
            ? `환원 신호: ${checklist.shareholderSignals.join(", ")}`
            : `배당수익률 ${fmt(dividendYield)}% 수준입니다.`,
        ),
      );
    } else if (shareholderReturn === "medium" || signalCount === 1 || (dividendYield !== null && dividendYield >= 2)) {
      rawScore += 8;
      reasons.push("주주환원은 보이지만 리레이팅 강도로 보기엔 추가 확인이 필요합니다.");
      breakdown.push(
        createBreakdownItem(
          "shareholderReturn",
          8,
          true,
          checklist.shareholderSignals.length
            ? `환원 신호: ${checklist.shareholderSignals.join(", ")}`
            : `배당수익률 ${fmt(dividendYield)}% 수준입니다.`,
        ),
      );
    } else {
      breakdown.push(createBreakdownItem("shareholderReturn", 0, true, "주주환원 강도는 아직 약한 편입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("shareholderReturn", 0, false, "주주환원 데이터가 없습니다."));
  }

  if (stock.name || stock.sector) {
    availableMaxScore += principleMap.get("context").weight;
    if (stock.name && (stock.sector || stock.market)) {
      rawScore += 10;
      reasons.push("시장과 업종 문맥 안에서 아이디어를 설명할 수 있습니다.");
      breakdown.push(createBreakdownItem("context", 10, true, "회사명과 시장/업종 정보가 함께 있습니다."));
    } else if (stock.name) {
      rawScore += 6;
      breakdown.push(createBreakdownItem("context", 6, true, "회사 식별은 가능하지만 업종 문맥이 부족합니다."));
    } else {
      breakdown.push(createBreakdownItem("context", 0, true, "설명용 기본 문맥이 부족합니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("context", 0, false, "회사명/시장/업종 정보가 부족합니다."));
  }

  if (confidence) {
    availableMaxScore += principleMap.get("confidence").weight;
    if (confidence === "high") {
      rawScore += 8;
      reasons.push("오래 추적한 후보로 볼 수 있는 높은 확신도입니다.");
      breakdown.push(createBreakdownItem("confidence", 8, true, "높은 확신도를 입력했습니다."));
    } else if (confidence === "medium") {
      rawScore += 4;
      breakdown.push(createBreakdownItem("confidence", 4, true, "추적 중인 후보로 볼 수 있습니다."));
    } else {
      breakdown.push(createBreakdownItem("confidence", 0, true, "확신도는 아직 낮은 편입니다."));
    }
  } else {
    breakdown.push(createBreakdownItem("confidence", 0, false, "확신도 정보가 없습니다."));
  }

  if (marketCap !== null && marketCap >= 300000000000) {
    reasons.push("유동성과 추적 가능성을 기대할 수 있는 시가총액 규모입니다.");
  }

  if (interestCoverage !== null && interestCoverage >= 5) {
    reasons.push("영업이익 기준 이자 감당 능력이 충분한 편입니다.");
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
      roic,
      roicTrend3Y,
      pbr,
      evToEbitda,
      fcfYield,
      debtRatio,
      opMargin,
      opMarginTrend3Y,
      netCash,
      catalyst,
      governance,
      confidence,
      shareholderReturn,
      marketCap,
      dividendYield,
      interestCoverage,
      ocfToNetIncome,
      ...checklist.booleans,
    },
  };
}

export function scoreStocks(stocks) {
  const sectorBenchmarks = buildSectorBenchmarks(stocks);
  return stocks.map((stock) => scoreStock(stock, { sectorBenchmarks }));
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
    (stock) => !stock.raw.catalyst && !stock.raw.governance && !stock.raw.valueUp && !stock.raw.assetSale && !stock.raw.spinOff,
  ).length;
  const missingShareholderCount = stocks.filter(
    (stock) => !stock.raw.shareholderReturn && !stock.raw.buyback && !stock.raw.treasuryCancellation && !stock.raw.payoutRaise,
  ).length;

  const lines = [
    `최고 점수는 ${bestScore}점이라 현재 최소 점수 ${minScore}점을 넘지 못했습니다.`,
    `평균 정보 충실도는 ${avgCompleteness}%입니다.`,
  ];

  if (avgCompleteness < 50) {
    lines.push("정량·정성 데이터가 전반적으로 부족해 점수가 보수적으로 계산됐을 가능성이 큽니다.");
  }

  if (missingCatalystCount === stocks.length) {
    lines.push("모든 종목에 재평가 체크리스트가 비어 있어 catalyst 점수가 거의 빠졌습니다.");
  }

  if (missingShareholderCount === stocks.length) {
    lines.push("주주환원 체크리스트가 비어 있어 Value-up 관점 가점이 제한됐습니다.");
  }

  if (bestScore >= minScore - 10) {
    lines.push(`최소 점수를 ${Math.max(0, minScore - 10)}점까지 낮추면 관찰 후보가 생길 수 있습니다.`);
  }

  lines.push(`요청한 상위 후보 수는 ${topN}개였지만 현재 조건에서는 통과 종목이 0개입니다.`);
  return lines;
}
