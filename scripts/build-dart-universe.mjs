import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const API_KEY = process.env.OPENDART_API_KEY || process.env.DART_API_KEY;
const YEAR = Number(process.argv[2] || new Date().getFullYear() - 1);
const LIMIT = process.argv[3] ? Number(process.argv[3]) : null;
const OUTPUT = resolve(process.argv[4] || "./data/universe.latest.csv");
const REPORT_CODES = ["11011", "11014", "11012", "11013"];
const CONCURRENCY = 4;
const FETCH_RETRIES = 2;

if (!API_KEY) {
  console.error("OPENDART_API_KEY 또는 DART_API_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

function looksLikeOperatingCompany(corp) {
  const name = String(corp.corpName || "");

  if (!["Y", "K"].includes(corp.corpCls)) {
    return false;
  }

  const excludedPatterns = [
    /스팩/u,
    /기업인수목적/u,
    /리츠/u,
    /부동산투자회사/u,
    /투자회사/u,
    /유동화/u,
    /신탁/u,
    /위탁관리/u,
    /펀드/u,
  ];

  return !excludedPatterns.some((pattern) => pattern.test(name));
}

function sampleUniverse(universe, limit) {
  if (!limit || universe.length <= limit) {
    return universe;
  }

  const preferred = universe.filter(looksLikeOperatingCompany);
  const fallback = universe.filter((corp) => !looksLikeOperatingCompany(corp));
  const selected = preferred.slice(0, limit);

  if (selected.length < limit) {
    selected.push(...fallback.slice(0, limit - selected.length));
  }

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

  const matched = sorted.find((item) => {
    const accountName = normalizeAccountName(item.account_nm);
    return normalizedAliases.some(
      (alias) => accountName === alias || accountName.includes(alias),
    );
  });

  if (!matched) {
    return null;
  }

  return toNumber(matched[field]) ?? toNumber(matched.thstrm_amount);
}

function computeIndicators(accountList) {
  const equity = pickAccountAmount(accountList, "BS", ["자본총계", "자본"]);
  const previousEquity = pickAccountAmount(accountList, "BS", ["자본총계", "자본"], "frmtrm_amount");
  const liabilities = pickAccountAmount(accountList, "BS", ["부채총계", "부채"]);
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

  const averageEquity =
    equity !== null && previousEquity !== null ? (equity + previousEquity) / 2 : equity;
  const roe =
    netIncome !== null && averageEquity && averageEquity !== 0
      ? ((netIncome / averageEquity) * 100).toFixed(2)
      : "";
  const opMargin =
    operatingIncome !== null && revenue && revenue !== 0
      ? ((operatingIncome / revenue) * 100).toFixed(2)
      : "";
  const debtRatio =
    liabilities !== null && equity && equity !== 0
      ? ((liabilities / equity) * 100).toFixed(2)
      : "";

  return {
    roe: normalizeNumber(roe),
    opMargin: normalizeNumber(opMargin),
    debtRatio: normalizeNumber(debtRatio),
  };
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
        await sleep(250 * (attempt + 1));
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

async function fetchIndicators(corp) {
  const buildUrl = (year, reportCode) => {
    const url = new URL("https://opendart.fss.or.kr/api/fnlttSinglAcnt.json");
    url.searchParams.set("crtfc_key", API_KEY);
    url.searchParams.set("corp_code", corp.corpCode);
    url.searchParams.set("bsns_year", String(year));
    url.searchParams.set("reprt_code", reportCode);
    return url;
  };

  const candidateYears = [YEAR, YEAR - 1];
  const attempts = [];

  for (const year of candidateYears) {
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

      const { roe, opMargin, debtRatio } = computeIndicators(accountList);

      if (roe === "" && opMargin === "" && debtRatio === "") {
        attempts.push(`${year}/${reportCode}:account match missed`);
        continue;
      }

      return {
        name: corp.corpName,
        stockCode: corp.stockCode,
        corpCode: corp.corpCode,
        sector: "",
        per: "",
        roe,
        pbr: "",
        debtRatio,
        opMargin,
        netCash: "",
        catalyst: inferCatalyst(Number(roe || 0), debtRatio),
        governance: "",
        confidence: inferConfidence(Number(roe || 0), Number(opMargin || 0), debtRatio),
        source: `opendart-acnt:${year}:${reportCode}`,
      };
    }
  }

  throw new Error(attempts.slice(-4).join(" | "));
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
  console.log(
    `OpenDART 유니버스를 불러오는 중... 기준연도 ${YEAR}, 조회 대상 ${
      LIMIT ? `최대 ${LIMIT}개` : "전체 상장사"
    }`,
  );
  const universe = await fetchCorpUniverse();
  const selected = LIMIT ? sampleUniverse(universe, LIMIT) : universe;
  console.log(
    `실제 조회 대상: ${selected.length}개 (${selected.filter(looksLikeOperatingCompany).length}개 운영회사 우선)`,
  );
  const rows = await mapWithConcurrency(selected, fetchIndicators);
  const successful = rows.filter(
    (row) => row && !row.error && (row.roe !== "" || row.debtRatio !== "" || row.opMargin !== ""),
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

    console.log("수집 실패 요약:");
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
    "sector",
    "per",
    "roe",
    "pbr",
    "debtRatio",
    "opMargin",
    "netCash",
    "catalyst",
    "governance",
    "confidence",
    "source",
  ];

  const lines = [
    header.join(","),
    ...successful.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ];

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${lines.join("\n")}\n`, "utf8");
  console.log(`완료: ${successful.length}개 종목을 ${OUTPUT} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
