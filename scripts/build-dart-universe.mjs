import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readKrxCsv } from "../lib/krx-csv.mjs";

const API_KEY = process.env.OPENDART_API_KEY || process.env.DART_API_KEY;
const YEAR = Number(process.argv[2] || new Date().getFullYear() - 1);
const OUTPUT = resolve(process.argv[3] || "./data/universe.latest.csv");
const KRX_BASIC_PATH = resolve(process.env.KRX_BASIC_PATH || "./data/krx-basic.csv");
const KRX_VALUATION_PATH = resolve(process.env.KRX_VALUATION_PATH || "./data/krx-valuation.csv");
const KRX_MARKETCAP_PATH = resolve(process.env.KRX_MARKETCAP_PATH || "./data/krx-marketcap.csv");
const REPORT_CODES = ["11011", "11014", "11012", "11013"];

// Stage 1 필터 파라미터
const STAGE1_MIN_MARKETCAP = 50000000000;   // 시가총액 500억원 이상
const STAGE1_MAX_PBR = 2.0;                 // PBR 2.0 이하 (명백한 고평가 제외)
const STAGE1_MAX_API_CALLS = 300;           // API 호출 상한 (GitHub Actions 타임아웃 대비)
const CONCURRENCY = 4;
const FETCH_RETRIES = 2;
const FETCH_RETRY_BASE_DELAY_MS = 300;
const TREND_YEARS = 3;

if (!API_KEY) {
  console.error("OPENDART_API_KEY 또는 DART_API_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function timestamp() {
  return new Date().toISOString();
}

function logStep(message, extra = "") {
  console.log(`[${timestamp()}] ${message}${extra ? ` ${extra}` : ""}`);
}

function normalizeMetricLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(/\s+/g, "")
    .trim();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeNumber(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const cleaned = String(value).replaceAll(",", "").trim();
  if (!cleaned || cleaned === "-") {
    return "";
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : "";
}

function toNumber(value) {
  const normalized = normalizeNumber(value);
  return normalized === "" ? null : Number(normalized);
}

function normalizeCode(value) {
  return String(value ?? "")
    .replace(/[^\d]/g, "")
    .padStart(6, "0")
    .slice(-6);
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

function parseCorpXml(xmlText) {
  const rows = [...xmlText.matchAll(/<list>([\s\S]*?)<\/list>/g)];
  return rows
    .map(([, block]) => {
      const get = (tag) => {
        const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return match ? match[1].trim() : "";
      };

      return {
        corpCode: get("corp_code"),
        corpName: get("corp_name"),
        stockCode: get("stock_code"),
        corpCls: get("corp_cls"),
      };
    })
    .filter((item) => item.stockCode);
}

async function loadKrxSelection() {
  // --- Basic: 종목코드 / 시장 / 업종 ---
  const basicText = await readKrxCsv(KRX_BASIC_PATH).catch(() => null);
  if (!basicText) throw new Error(`KRX 기본정보 CSV를 읽지 못했습니다: ${KRX_BASIC_PATH}`);
  const basicRows = parseCsv(basicText);
  const basicMap = new Map();
  for (const row of basicRows) {
    const stockCode = normalizeCode(
      row["종목코드"] || row["단축코드"] || row["표준코드"] || row["종목 코드"],
    );
    if (!stockCode) continue;
    const market = row["시장구분"] || row["시장"] || row["소속시장"] || row["시장 구분"] || "";
    const isKospiKosdaq = ["KOSPI", "KOSDAQ"].some((m) => String(market).toUpperCase().startsWith(m));
    if (!isKospiKosdaq) continue;
    basicMap.set(stockCode, {
      stockCode,
      market,
      name: row["종목명"] || row["한글 종목명"] || row["회사명"] || "",
      sector: row["업종"] || row["업종명"] || row["소속부"] || row["증권구분"] || "",
    });
  }

  if (!basicMap.size) throw new Error(`KRX 기본정보 CSV에서 KOSPI/KOSDAQ 종목을 찾지 못했습니다: ${KRX_BASIC_PATH}`);
  logStep(`Stage 1 - KRX 기본정보 로드: ${basicMap.size}개 KOSPI/KOSDAQ 종목`);

  // --- MarketCap: 시가총액 ---
  const marketCapText = await readKrxCsv(KRX_MARKETCAP_PATH).catch(() => null);
  const marketCapMap = new Map();
  if (marketCapText) {
    for (const row of parseCsv(marketCapText)) {
      const stockCode = normalizeCode(row["종목코드"] || row["단축코드"] || row["표준코드"]);
      if (!stockCode) continue;
      const cap = toNumber(
        row["시가총액"] || row["상장시가총액"] ||
        row["자기주식제외시가총액"] || row["자기주식 제외 시가총액(A*B)"] ||
        row["자기주식 제외 시가총액"],
      );
      if (cap !== null) marketCapMap.set(stockCode, cap);
    }
    logStep(`Stage 1 - KRX 시가총액 로드: ${marketCapMap.size}개`);
  } else {
    logStep(`Stage 1 - krx-marketcap.csv 없음, 시가총액 필터 미적용`);
  }

  // --- Valuation: PBR ---
  const valuationText = await readKrxCsv(KRX_VALUATION_PATH).catch(() => null);
  const pbrMap = new Map();
  if (valuationText) {
    for (const row of parseCsv(valuationText)) {
      const stockCode = normalizeCode(row["종목코드"] || row["단축코드"] || row["표준코드"]);
      if (!stockCode) continue;
      const pbr = toNumber(row["PBR"] || row["주가순자산비율"]);
      if (pbr !== null) pbrMap.set(stockCode, pbr);
    }
    logStep(`Stage 1 - KRX 밸류에이션 로드: ${pbrMap.size}개`);
  } else {
    logStep(`Stage 1 - krx-valuation.csv 없음, PBR 필터 미적용`);
  }

  // --- Stage 1 필터 적용 ---
  let candidates = [...basicMap.values()];
  const beforeCount = candidates.length;

  // 시가총액 하한 필터 (데이터 있는 경우만)
  if (marketCapMap.size > 0) {
    candidates = candidates.filter((row) => {
      const cap = marketCapMap.get(row.stockCode);
      return cap === undefined || cap >= STAGE1_MIN_MARKETCAP;
    });
    logStep(`Stage 1 - 시가총액 ${Math.round(STAGE1_MIN_MARKETCAP / 100000000)}억원 이상 필터: ${beforeCount}개 → ${candidates.length}개`);
  }

  const afterMarketCap = candidates.length;

  // PBR 상한 필터 (데이터 있는 경우만)
  if (pbrMap.size > 0) {
    candidates = candidates.filter((row) => {
      const pbr = pbrMap.get(row.stockCode);
      return pbr === undefined || pbr <= STAGE1_MAX_PBR;
    });
    logStep(`Stage 1 - PBR ${STAGE1_MAX_PBR} 이하 필터: ${afterMarketCap}개 → ${candidates.length}개`);
  }

  // 시가총액 내림차순 정렬 후 API 호출 상한 적용
  if (marketCapMap.size > 0) {
    candidates.sort((a, b) => {
      const capA = marketCapMap.get(a.stockCode) ?? 0;
      const capB = marketCapMap.get(b.stockCode) ?? 0;
      return capB - capA;
    });
  }

  const selected = candidates.slice(0, STAGE1_MAX_API_CALLS);
  logStep(`Stage 1 완료: 최종 API 조회 대상 ${selected.length}개 (상한 ${STAGE1_MAX_API_CALLS}개)`);
  return selected;
}

function pickMetric(items, aliases) {
  const aliasSet = aliases.map(normalizeMetricLabel);
  const hit = items.find((item) => {
    const label = normalizeMetricLabel(item.idx_nm);
    return aliasSet.some((alias) => label === alias || label.includes(alias));
  });
  return hit ? normalizeNumber(hit.idx_val) : "";
}

function normalizeAccountName(value) {
  return String(value || "")
    .replaceAll(/\s+/g, "")
    .replaceAll("(", "")
    .replaceAll(")", "")
    .trim();
}

function pickAccountAmount(items, sjDiv, aliases, field = "thstrm_amount") {
  const normalizedAliases = aliases.map(normalizeAccountName);
  const sameStatement = items.filter((item) => item.sj_div === sjDiv);
  const sorted = [...sameStatement].sort((a, b) => {
    const rank = (fsDiv) => (fsDiv === "CFS" ? 0 : fsDiv === "OFS" ? 1 : 2);
    return rank(a.fs_div) - rank(b.fs_div);
  });

  const exactMatched = sorted.find((item) => {
    const accountName = normalizeAccountName(item.account_nm);
    return normalizedAliases.some((alias) => accountName === alias);
  });

  const matched =
    exactMatched ||
    sorted.find((item) => {
      const accountName = normalizeAccountName(item.account_nm);
      return normalizedAliases.some((alias) => accountName.includes(alias));
    });

  if (!matched) {
    return null;
  }

  return toNumber(matched[field]) ?? toNumber(matched.thstrm_amount);
}

function computeIndicators(accountList) {
  const equity = pickAccountAmount(accountList, "BS", ["자본총계"]);
  const previousEquity = pickAccountAmount(accountList, "BS", ["자본총계"], "frmtrm_amount");
  const liabilities = pickAccountAmount(accountList, "BS", ["부채총계"]);
  const cashAndEquivalents = pickAccountAmount(accountList, "BS", [
    "현금및현금성자산",
    "현금및현금등가물",
    "현금및현금등가물합계",
  ]);
  const shortTermBorrowings = pickAccountAmount(accountList, "BS", [
    "단기차입금",
    "단기금융부채",
    "유동성장기부채",
    "유동성사채",
  ]);
  const longTermBorrowings = pickAccountAmount(accountList, "BS", [
    "장기차입금",
    "사채",
    "장기금융부채",
    "장기리스부채",
    "비유동리스부채",
  ]);
  const revenue =
    pickAccountAmount(accountList, "IS", ["매출액"], "thstrm_add_amount") ??
    pickAccountAmount(accountList, "IS", ["영업수익"], "thstrm_add_amount");
  const operatingIncome = pickAccountAmount(
    accountList,
    "IS",
    ["영업이익", "영업이익손실"],
    "thstrm_add_amount",
  );
  const netIncome = pickAccountAmount(
    accountList,
    "IS",
    ["당기순이익", "당기순이익손실", "분기순이익", "반기순이익"],
    "thstrm_add_amount",
  );
  const profitBeforeTax = pickAccountAmount(
    accountList,
    "IS",
    ["법인세비용차감전순이익", "법인세비용차감전계속사업이익", "계속사업법인세비용차감전순이익"],
    "thstrm_add_amount",
  );
  const incomeTaxExpense = pickAccountAmount(
    accountList,
    "IS",
    ["법인세비용", "법인세비용수익", "당기법인세부담액"],
    "thstrm_add_amount",
  );
  const interestExpense = pickAccountAmount(
    accountList,
    "IS",
    ["이자비용", "금융원가", "이자비용및기타금융비용", "금융비용"],
    "thstrm_add_amount",
  );
  const operatingCashFlow = pickAccountAmount(accountList, "CF", [
    "영업활동으로인한현금흐름",
    "영업활동현금흐름",
    "영업활동으로부터의순현금유입",
    "영업활동으로인한순현금흐름",
  ]);
  const depreciationExpense = [
    pickAccountAmount(accountList, "IS", ["감가상각비", "감가상각비및상각비"], "thstrm_add_amount"),
    pickAccountAmount(accountList, "IS", ["유형자산감가상각비"], "thstrm_add_amount"),
    pickAccountAmount(accountList, "IS", ["무형자산상각비"], "thstrm_add_amount"),
  ]
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const tangibleCapex = pickAccountAmount(accountList, "CF", [
    "유형자산의취득",
    "유형자산취득",
    "유형자산의증가",
  ]);
  const intangibleCapex = pickAccountAmount(accountList, "CF", [
    "무형자산의취득",
    "무형자산취득",
    "무형자산의증가",
  ]);
  const investmentPropertyCapex = pickAccountAmount(accountList, "CF", [
    "투자부동산의취득",
    "투자부동산취득",
  ]);

  const averageEquity =
    equity !== null && previousEquity !== null ? (equity + previousEquity) / 2 : equity;
  const effectiveTaxRate =
    incomeTaxExpense !== null && profitBeforeTax !== null && profitBeforeTax !== 0
      ? Math.min(0.35, Math.max(0, Math.abs(incomeTaxExpense / profitBeforeTax)))
      : 0.25;
  const totalBorrowings =
    (shortTermBorrowings ?? 0) + (longTermBorrowings ?? 0) > 0
      ? (shortTermBorrowings ?? 0) + (longTermBorrowings ?? 0)
      : null;
  const investedCapital =
    operatingIncome !== null && equity !== null
      ? Math.max(
          1,
          totalBorrowings !== null
            ? equity + totalBorrowings - (cashAndEquivalents ?? 0)
            : equity + (liabilities ?? 0) - (cashAndEquivalents ?? 0),
        )
      : null;
  const roe =
    netIncome !== null && averageEquity && averageEquity !== 0
      ? ((netIncome / averageEquity) * 100).toFixed(2)
      : "";
  const roic =
    operatingIncome !== null && investedCapital
      ? (((operatingIncome * (1 - effectiveTaxRate)) / investedCapital) * 100).toFixed(2)
      : "";
  const opMargin =
    operatingIncome !== null && revenue && revenue !== 0
      ? ((operatingIncome / revenue) * 100).toFixed(2)
      : "";
  const debtRatio =
    liabilities !== null && equity && equity !== 0
      ? ((liabilities / equity) * 100).toFixed(2)
      : "";
  const interestCoverage =
    operatingIncome !== null && interestExpense !== null && interestExpense !== 0
      ? (operatingIncome / Math.abs(interestExpense)).toFixed(2)
      : "";
  const ocfToNetIncome =
    operatingCashFlow !== null && netIncome !== null && netIncome !== 0
      ? (operatingCashFlow / netIncome).toFixed(2)
      : "";
  const ebitda =
    operatingIncome !== null
      ? normalizeNumber(operatingIncome + Math.max(0, depreciationExpense))
      : "";
  const capex =
    tangibleCapex !== null || intangibleCapex !== null || investmentPropertyCapex !== null
      ? normalizeNumber(
          Math.abs(tangibleCapex ?? 0) +
            Math.abs(intangibleCapex ?? 0) +
            Math.abs(investmentPropertyCapex ?? 0),
        )
      : "";
  const fcf =
    operatingCashFlow !== null
      ? normalizeNumber(operatingCashFlow - Number(capex || 0))
      : "";

  return {
    roe: normalizeNumber(roe),
    roic: normalizeNumber(roic),
    opMargin: normalizeNumber(opMargin),
    debtRatio: normalizeNumber(debtRatio),
    interestCoverage: normalizeNumber(interestCoverage),
    ocfToNetIncome: normalizeNumber(ocfToNetIncome),
    totalBorrowings: normalizeNumber(totalBorrowings),
    cashAndEquivalents: normalizeNumber(cashAndEquivalents),
    ebitda,
    fcf,
  };
}

function computeTrend(currentValue, oldestValue) {
  if (currentValue === "" || oldestValue === "") {
    return "";
  }
  return normalizeNumber(Number(currentValue) - Number(oldestValue));
}

function inferCatalyst(roe, debtRatio) {
  if (roe >= 18 && debtRatio !== "" && debtRatio <= 120) {
    return "medium";
  }
  return "";
}

function inferConfidence(roe, opMargin, debtRatio) {
  if (roe >= 15 && opMargin >= 10 && debtRatio !== "" && debtRatio <= 120) {
    return "medium";
  }
  return "";
}

async function fetchJson(url, retries = FETCH_RETRIES) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const delayMs = FETCH_RETRY_BASE_DELAY_MS * (2 ** attempt);
        logStep("OpenDART 재시도 대기", `attempt=${attempt + 1}/${retries + 1} delay=${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function fetchCorpUniverse() {
  const tempDir = await mkdtemp(join(tmpdir(), "dart-universe-"));
  const zipPath = join(tempDir, "corpCode.zip");

  try {
    const response = await fetch(
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(API_KEY)}`,
    );
    if (!response.ok) {
      throw new Error(`corpCode fetch failed: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(zipPath, buffer);
    let xmlText = "";

    try {
      xmlText = execFileSync("unzip", ["-p", zipPath], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      // GitHub Actions can occasionally return a non-zero exit code from unzip
      // even when the XML payload is present on stdout. Reuse stdout only when
      // the payload looks complete enough to parse as a full corp universe.
      if (
        typeof error?.stdout === "string" &&
        error.stdout.includes("<result>") &&
        error.stdout.includes("</result>")
      ) {
        xmlText = error.stdout;
      } else {
        throw error;
      }
    }

    const parsed = parseCorpXml(xmlText);
    console.log(`회사코드 유니버스 로드 완료: ${parsed.length}개 상장사`);

    if (parsed.length < 1000) {
      throw new Error(
        `corp universe looks truncated: expected many listed companies, got ${parsed.length}`,
      );
    }

    return parsed;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fetchYearSnapshot(corp, year, attempts) {
  const buildUrl = (year, reportCode) => {
    const url = new URL("https://opendart.fss.or.kr/api/fnlttSinglAcnt.json");
    url.searchParams.set("crtfc_key", API_KEY);
    url.searchParams.set("corp_code", corp.corpCode);
    url.searchParams.set("bsns_year", String(year));
    url.searchParams.set("reprt_code", reportCode);
    return url;
  };

  for (const reportCode of REPORT_CODES) {
    let statement;

    try {
      statement = await fetchJson(buildUrl(year, reportCode));
    } catch (error) {
      attempts.push(`${year}/${reportCode}:fetch failed`);
      continue;
    }

    const status = statement.status || "900";
    const accountList = status === "000" && Array.isArray(statement.list) ? statement.list : [];

    attempts.push(`${year}/${reportCode}:status=${status}`);

    if (!accountList.length) {
      continue;
    }

    const indicators = computeIndicators(accountList);

    if (
      indicators.roe === "" &&
      indicators.roic === "" &&
      indicators.opMargin === "" &&
      indicators.debtRatio === "" &&
      indicators.interestCoverage === "" &&
      indicators.ocfToNetIncome === ""
    ) {
      attempts.push(`${year}/${reportCode}:account match missed`);
      continue;
    }

    return {
      year,
      reportCode,
      indicators,
    };
  }

  return null;
}

async function fetchIndicators(corp) {
  const attempts = [];
  const yearlySnapshots = [];

  for (let offset = 0; offset < TREND_YEARS; offset += 1) {
    const targetYear = YEAR - offset;
    const snapshot = await fetchYearSnapshot(corp, targetYear, attempts);
    if (snapshot) {
      yearlySnapshots.push(snapshot);
    }
  }

  if (yearlySnapshots.length === 0) {
    throw new Error(attempts.slice(-6).join(" | "));
  }

  const currentSnapshot = yearlySnapshots[0];
  const oldestSnapshot = yearlySnapshots[yearlySnapshots.length - 1];
  const current = currentSnapshot.indicators;

  return {
    name: corp.name || corp.corpName,
    stockCode: corp.stockCode,
    corpCode: corp.corpCode,
    market: corp.market || "",
    sector: corp.sector || "",
    per: "",
    roe: current.roe,
    roic: current.roic,
    roicTrend3Y: computeTrend(current.roic, oldestSnapshot.indicators.roic),
    pbr: "",
    debtRatio: current.debtRatio,
    opMargin: current.opMargin,
    opMarginTrend3Y: computeTrend(current.opMargin, oldestSnapshot.indicators.opMargin),
    interestCoverage: current.interestCoverage,
    ocfToNetIncome: current.ocfToNetIncome,
    dividendYield: "",
    totalBorrowings: current.totalBorrowings,
    cashAndEquivalents: current.cashAndEquivalents,
    ebitda: current.ebitda,
    fcf: current.fcf,
    netCash: "",
    catalyst: inferCatalyst(Number(current.roe || 0), current.debtRatio),
    governance: "",
    shareholderReturn: "",
    valueUp: "",
    buyback: "",
    treasuryCancellation: "",
    payoutRaise: "",
    assetSale: "",
    spinOff: "",
    insiderBuying: "",
    foreignOwnershipRebound: "",
    coverageInitiation: "",
    confidence: inferConfidence(Number(current.roe || 0), Number(current.opMargin || 0), current.debtRatio),
    source: `opendart-acnt:${currentSnapshot.year}:${currentSnapshot.reportCode}`,
  };
}

async function mapWithConcurrency(items, worker) {
  const results = [];
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { ...items[index], error: error.message };
      }

      await sleep(90);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return results;
}

async function main() {
  logStep(`OpenDART 유니버스를 불러오는 중... 기준연도 ${YEAR}`);
  const universe = await fetchCorpUniverse();
  const krxSelection = await loadKrxSelection();
  const corpByCode = new Map(universe.map((corp) => [normalizeCode(corp.stockCode), corp]));
  const selected = krxSelection
    .map((row) => {
      const corp = corpByCode.get(row.stockCode);
      return corp ? { ...corp, ...row } : null;
    })
    .filter(Boolean);

  logStep(`실제 조회 대상: ${selected.length}개 (KRX basic CSV 기준)`);

  if (!selected.length) {
    throw new Error("KRX 기본정보 CSV와 OpenDART 회사코드 매핑 결과가 0건입니다.");
  }
  const rows = await mapWithConcurrency(selected, fetchIndicators);
  const successful = rows.filter(
    (row) =>
      row &&
      !row.error &&
      (
        row.roe !== "" ||
        row.roic !== "" ||
        row.ebitda !== "" ||
        row.fcf !== "" ||
        row.debtRatio !== "" ||
        row.opMargin !== "" ||
        row.interestCoverage !== "" ||
        row.ocfToNetIncome !== ""
      ),
  );
  const failures = rows.filter((row) => row && row.error);

  successful.sort((a, b) => Number(b.roe || 0) - Number(a.roe || 0));

  if (failures.length > 0) {
    const errorCounts = failures.reduce((acc, row) => {
      acc[row.error] = (acc[row.error] || 0) + 1;
      return acc;
    }, {});
    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    logStep("수집 실패 요약:");
    topErrors.forEach(([message, count]) => {
      console.log(`- ${count}건: ${message}`);
    });
  }

  if (successful.length === 0) {
    throw new Error(
      "재무지표가 있는 종목을 한 건도 만들지 못했습니다. 표본 선정과 OpenDART 엔드포인트를 다시 확인하세요.",
    );
  }

  const header = [
    "name",
    "stockCode",
    "corpCode",
    "market",
    "sector",
    "per",
    "roe",
    "roic",
    "roicTrend3Y",
    "pbr",
    "debtRatio",
    "opMargin",
    "opMarginTrend3Y",
    "interestCoverage",
    "ocfToNetIncome",
    "dividendYield",
    "totalBorrowings",
    "cashAndEquivalents",
    "ebitda",
    "fcf",
    "netCash",
    "catalyst",
    "governance",
    "shareholderReturn",
    "valueUp",
    "buyback",
    "treasuryCancellation",
    "payoutRaise",
    "assetSale",
    "spinOff",
    "insiderBuying",
    "foreignOwnershipRebound",
    "coverageInitiation",
    "confidence",
    "source",
  ];

  const lines = [
    header.join(","),
    ...successful.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ];

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${lines.join("\n")}\n`, "utf8");
  logStep(`완료: ${successful.length}개 종목을 ${OUTPUT} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
