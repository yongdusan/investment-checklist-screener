import { principles, scoreStock } from "./lib/scoring.mjs";

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
const LOW_COMPLETENESS_THRESHOLD = 60;

function renderPrinciples() {
  principleList.replaceChildren(
    ...principles.map((item) => {
      const article = document.createElement("article");
      article.className = "principle-item";

      const title = document.createElement("div");
      title.className = "principle-title";

      const name = document.createElement("span");
      name.textContent = item.title;

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${item.weight}점`;

      title.append(name, badge);

      const description = document.createElement("p");
      description.textContent = item.description;

      article.append(title, description);
      return article;
    }),
  );
}

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
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  if (insideQuotes) {
    throw new Error("닫히지 않은 따옴표가 있는 CSV입니다.");
  }

  if (rows.length < 2) {
    return [];
  }

  const [headers, ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) =>
    String(header).replace(/^\uFEFF/, "").trim(),
  );

  return dataRows.map((cells) => {
    const row = {};
    normalizedHeaders.forEach((header, index) => {
      row[header] = String(cells[index] ?? "").trim();
    });
    return row;
  });
}

function createMetric(label, value) {
  const item = document.createElement("div");
  item.className = "metric";

  const metricLabel = document.createElement("span");
  metricLabel.className = "metric-label";
  metricLabel.textContent = label;

  const metricValue = document.createElement("span");
  metricValue.className = "metric-value";
  metricValue.textContent = value;

  item.append(metricLabel, metricValue);
  return item;
}

function createBreakdownItem(item) {
  const wrapper = document.createElement("div");
  wrapper.className = "breakdown-item";

  const row = document.createElement("div");
  row.className = "breakdown-row";

  const title = document.createElement("span");
  title.textContent = item.shortTitle;

  const score = document.createElement("strong");
  score.textContent = item.available ? `${item.points}/${item.weight}` : `데이터 없음 / ${item.weight}`;

  row.append(title, score);

  const description = document.createElement("p");
  description.textContent = item.summary;

  wrapper.append(row, description);
  return wrapper;
}

function createReasonList(reasons) {
  const list = document.createElement("ul");
  list.className = "reason-list";
  reasons.forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    list.append(item);
  });
  return list;
}

function isLowCompleteness(stock) {
  return Number(stock.completeness) < LOW_COMPLETENESS_THRESHOLD;
}

function createCompletenessBadge(stock) {
  const badge = document.createElement("span");
  badge.className = `badge ${isLowCompleteness(stock) ? "badge-warning" : "badge-neutral"}`;
  badge.textContent = isLowCompleteness(stock)
    ? `정보 부족 ${stock.completeness}%`
    : `정보 충실도 ${stock.completeness}%`;
  return badge;
}

function createShortCard(stock, index) {
  const article = document.createElement("article");
  article.className = "short-card";
  if (isLowCompleteness(stock)) {
    article.classList.add("short-card-warning");
  }

  const topRow = document.createElement("div");
  topRow.className = "short-card-top";

  const rank = document.createElement("div");
  rank.className = "short-rank";
  rank.textContent = `Top ${index + 1}`;

  topRow.append(rank, createCompletenessBadge(stock));

  const title = document.createElement("h3");
  title.textContent = `${stock.name || "이름 없음"} · ${stock.score}점`;

  const summaryLine = document.createElement("p");
  summaryLine.textContent = `${stock.market || "시장 미기재"} · ${stock.sector || "섹터 미기재"} / 촉매 ${stock.catalyst || "미입력"}`;

  article.append(topRow, title, summaryLine);

  if (isLowCompleteness(stock)) {
    const warning = document.createElement("p");
    warning.className = "completeness-warning";
    warning.textContent =
      "실데이터가 60% 미만입니다. 점수 해석 전에 누락된 재무 항목과 수동 오버레이를 먼저 확인하세요.";
    article.append(warning);
  }

  return article;
}

function createStockCard(stock) {
  const article = document.createElement("article");
  article.className = "stock-card";
  if (isLowCompleteness(stock)) {
    article.classList.add("stock-card-warning");
  }

  const header = document.createElement("div");
  header.className = "stock-card-header";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = stock.name || "이름 없음";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${stock.market || "시장 미기재"} · ${stock.sector || "섹터 미기재"} · 확신도 ${stock.confidence || "미입력"}`;

  const titleMetaRow = document.createElement("div");
  titleMetaRow.className = "title-meta-row";
  titleMetaRow.append(meta, createCompletenessBadge(stock));

  titleWrap.append(title, titleMetaRow);

  const score = document.createElement("div");
  score.className = `score-pill ${scoreClass(stock.score)}`.trim();
  score.textContent = `${stock.score}점`;

  header.append(titleWrap, score);

  const metrics = document.createElement("div");
  metrics.className = "metrics-grid";
  metrics.append(
    createMetric("시가총액", stock.marketCap || "-"),
    createMetric("PER", stock.per || "-"),
    createMetric("ROE", `${stock.roe || "-"}%`),
    createMetric("PBR", stock.pbr || "-"),
    createMetric("부채비율", `${stock.debtRatio || "-"}%`),
    createMetric("영업이익률", `${stock.opMargin || "-"}%`),
  );

  const breakdownBlock = document.createElement("div");
  breakdownBlock.className = "breakdown-block";

  const breakdownTitle = document.createElement("div");
  breakdownTitle.className = "breakdown-title";
  breakdownTitle.textContent = "항목별 점수";

  const breakdownList = document.createElement("div");
  breakdownList.className = "breakdown-list";
  breakdownList.append(...stock.breakdown.map(createBreakdownItem));

  breakdownBlock.append(breakdownTitle, breakdownList);

  article.append(header);

  if (isLowCompleteness(stock)) {
    const warning = document.createElement("p");
    warning.className = "completeness-warning";
    warning.textContent =
      "이 종목은 정보 충실도가 낮아 점수 신뢰도가 제한적입니다. 비어 있는 재무 항목을 먼저 확인하세요.";
    article.append(warning);
  }

  article.append(metrics, createReasonList(stock.reasons), breakdownBlock);
  return article;
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
  let stocks = [];
  try {
    stocks = parseCsv(csvInput.value).map(scoreStock).sort((a, b) => b.score - a.score);
  } catch (error) {
    shortlist.replaceChildren();
    results.replaceChildren();
    summary.textContent = `CSV 파싱에 실패했습니다. 따옴표나 쉼표 형식을 확인해 주세요. (${error.message})`;
    return;
  }
  const filtered = stocks.filter(passesFilters);
  const topN = Number(topNFilter.value);
  const shortlisted = filtered.slice(0, topN);
  const lowCompletenessCount = filtered.filter(isLowCompleteness).length;
  const shortlistedLowCompletenessCount = shortlisted.filter(isLowCompleteness).length;

  summary.textContent = `전체 ${stocks.length}개 중 ${filtered.length}개가 현재 필터를 통과했고, 그중 상위 ${shortlisted.length}개를 우선 후보로 보여줍니다. 점수는 입력된 정보 범위 안에서 계산한 적합도이며, 정보 충실도도 함께 확인하는 편이 좋습니다.${lowCompletenessCount > 0 ? ` 현재 필터 통과 종목 중 ${lowCompletenessCount}개, 상위 후보 중 ${shortlistedLowCompletenessCount}개는 정보 충실도 ${LOW_COMPLETENESS_THRESHOLD}% 미만입니다.` : ""}`;

  if (filtered.length === 0) {
    shortlist.replaceChildren();
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "통과한 종목이 없습니다. 최소 점수를 낮추거나 확신도, 촉매 필터를 완화해 보세요.";
    results.replaceChildren(emptyState);
    return;
  }

  shortlist.replaceChildren(...shortlisted.map(createShortCard));
  results.replaceChildren(...shortlisted.map(createStockCard));
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
