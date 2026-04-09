const principles = [
  {
    title: "싸지만 싸구려는 아닌가",
    weight: 20,
    description:
      "PER, PBR이 낮더라도 이익 체력이 너무 약하면 밸류 트랩일 수 있습니다. 낮은 가격 자체보다 낮을 이유가 적은지를 봅니다.",
  },
  {
    title: "ROE와 수익성이 유지되는가",
    weight: 18,
    description:
      "높은 ROE와 괜찮은 영업이익률은 자본 효율과 사업 체력을 동시에 보여줍니다.",
  },
  {
    title: "재평가 계기가 있는가",
    weight: 18,
    description:
      "지배구조 개편, 자사주 정책, 자산 재평가, 업황 회복 같은 촉매가 있어야 싼 기업이 계속 싼 채로 남는 위험을 줄일 수 있습니다.",
  },
  {
    title: "재무가 버텨주는가",
    weight: 14,
    description:
      "현금이 있거나 부채 부담이 과하지 않아야 기다릴 시간이 생깁니다.",
  },
  {
    title: "설명이 단순한가",
    weight: 12,
    description:
      "두세 문장으로 투자 논리가 정리되지 않으면, 흔들릴 때 보유가 어렵습니다.",
  },
  {
    title: "내 확신 수준이 과장되지 않았는가",
    weight: 18,
    description:
      "확신도는 정보량과 추적 기간에서 나와야 합니다. 느낌만 강한 확신은 감점입니다.",
  },
];

const sampleCsv = document.querySelector("#csv-input").value.trim();
const principleList = document.querySelector("#principle-list");
const csvInput = document.querySelector("#csv-input");
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const shortlist = document.querySelector("#shortlist");
const minScoreInput = document.querySelector("#min-score");
const minScoreValue = document.querySelector("#min-score-value");
const catalystFilter = document.querySelector("#must-have-catalyst");
const confidenceFilter = document.querySelector("#must-have-confidence");
const topNFilter = document.querySelector("#top-n");
const universeUrl = document.querySelector("#universe-url");
const csvFileInput = document.querySelector("#csv-file");

function renderPrinciples() {
  principleList.innerHTML = principles
    .map(
      (item) => `
        <article class="principle-item">
          <div class="principle-title">
            <span>${item.title}</span>
            <span class="badge">${item.weight}점</span>
          </div>
          <p>${item.description}</p>
        </article>
      `,
    )
    .join("");
}

function toNumber(value) {
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

function normalizeWord(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseBoolean(value) {
  return ["true", "yes", "y", "1"].includes(normalizeWord(value));
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
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
    } else if (per !== null || pbr !== null) {
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

function passesFilters(stock) {
  const minScore = Number(minScoreInput.value);
  if (stock.score < minScore) {
    return false;
  }

  if (
    catalystFilter.value === "yes" &&
    !["strong", "medium"].includes(stock.raw.catalyst) &&
    !["strong", "medium"].includes(stock.raw.governance)
  ) {
    return false;
  }

  if (confidenceFilter.value === "medium" && stock.raw.confidence === "low") {
    return false;
  }

  if (confidenceFilter.value === "high" && stock.raw.confidence !== "high") {
    return false;
  }

  return true;
}

function scoreClass(score) {
  if (score >= 75) return "";
  if (score >= 55) return "score-mid";
  return "score-low";
}

function renderResults() {
  const stocks = parseCsv(csvInput.value).map(scoreStock).sort((a, b) => b.score - a.score);
  const filtered = stocks.filter(passesFilters);
  const topN = Number(topNFilter.value);
  const shortlisted = filtered.slice(0, topN);

  summary.textContent = `전체 ${stocks.length}개 중 ${filtered.length}개가 현재 필터를 통과했고, 그중 상위 ${shortlisted.length}개를 우선 후보로 보여줍니다. 점수는 입력된 정보 범위 안에서 계산한 적합도이며, 정보 충실도도 함께 확인하는 편이 좋습니다.`;

  if (filtered.length === 0) {
    shortlist.innerHTML = "";
    results.innerHTML = `<div class="empty-state">통과한 종목이 없습니다. 최소 점수를 낮추거나 확신도, 촉매 필터를 완화해 보세요.</div>`;
    return;
  }

  shortlist.innerHTML = shortlisted
    .map(
      (stock, index) => `
        <article class="short-card">
          <div class="short-rank">Top ${index + 1}</div>
          <h3>${stock.name || "이름 없음"} · ${stock.score}점</h3>
          <p>${stock.market || "시장 미기재"} · ${stock.sector || "섹터 미기재"} / 정보 충실도 ${stock.completeness}% / 촉매 ${stock.catalyst || "미입력"}</p>
        </article>
      `,
    )
    .join("");

  results.innerHTML = shortlisted
    .map(
      (stock) => `
        <article class="stock-card">
          <div class="stock-card-header">
            <div>
              <h3>${stock.name || "이름 없음"}</h3>
              <div class="meta">${stock.market || "시장 미기재"} · ${stock.sector || "섹터 미기재"} · 정보 충실도 ${stock.completeness}% · 확신도 ${stock.confidence || "미입력"}</div>
            </div>
            <div class="score-pill ${scoreClass(stock.score)}">${stock.score}점</div>
          </div>

          <div class="metrics-grid">
            <div class="metric"><span class="metric-label">시가총액</span><span class="metric-value">${stock.marketCap || "-"}</span></div>
            <div class="metric"><span class="metric-label">PER</span><span class="metric-value">${stock.per || "-"}</span></div>
            <div class="metric"><span class="metric-label">ROE</span><span class="metric-value">${stock.roe || "-"}%</span></div>
            <div class="metric"><span class="metric-label">PBR</span><span class="metric-value">${stock.pbr || "-"}</span></div>
            <div class="metric"><span class="metric-label">부채비율</span><span class="metric-value">${stock.debtRatio || "-"}%</span></div>
            <div class="metric"><span class="metric-label">영업이익률</span><span class="metric-value">${stock.opMargin || "-"}%</span></div>
          </div>

          <ul class="reason-list">
            ${stock.reasons.map((reason) => `<li>${reason}</li>`).join("")}
          </ul>
        </article>
      `,
    )
    .join("");
}

document.querySelector("#run-screening").addEventListener("click", renderResults);
document.querySelector("#load-sample").addEventListener("click", () => {
  csvInput.value = sampleCsv;
  renderResults();
});
document.querySelector("#fetch-universe").addEventListener("click", async () => {
  const url = universeUrl.value.trim();
  if (!url) {
    summary.textContent = "먼저 CSV URL을 입력해 주세요.";
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    csvInput.value = await response.text();
    renderResults();
    summary.textContent = `외부 유니버스를 불러왔습니다. ${summary.textContent}`;
  } catch (error) {
    summary.textContent = `URL 불러오기에 실패했습니다. 브라우저 CORS 설정이나 CSV 주소를 확인해 주세요. (${error.message})`;
  }
});
csvFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  if (!file) {
    return;
  }

  csvInput.value = await file.text();
  renderResults();
  summary.textContent = `로컬 CSV 파일을 불러왔습니다. ${summary.textContent}`;
});
minScoreInput.addEventListener("input", () => {
  minScoreValue.textContent = `${minScoreInput.value}점`;
  renderResults();
});
catalystFilter.addEventListener("change", renderResults);
confidenceFilter.addEventListener("change", renderResults);
topNFilter.addEventListener("change", renderResults);

renderPrinciples();
renderResults();
