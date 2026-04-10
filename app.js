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

          <div class="breakdown-block">
            <div class="breakdown-title">항목별 점수</div>
            <div class="breakdown-list">
              ${stock.breakdown
                .map(
                  (item) => `
                    <div class="breakdown-item">
                      <div class="breakdown-row">
                        <span>${item.shortTitle}</span>
                        <strong>${item.available ? `${item.points}/${item.weight}` : `데이터 없음 / ${item.weight}`}</strong>
                      </div>
                      <p>${item.summary}</p>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
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
