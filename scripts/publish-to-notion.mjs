import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const reportPath = resolve(process.argv[2] || "./reports/daily-shortlist.md");
const reportDate = process.argv[3] || getSeoulDate();
const minScore = Number(process.argv[4] || 60);
const topN = Number(process.argv[5] || 10);
const inputFile = process.argv[6] || "./data/universe.enriched.csv";
const statusValue = process.argv[7] || "생성중";

if (!notionToken) {
  console.error("NOTION_API_KEY 또는 NOTION_TOKEN 환경변수가 필요합니다.");
  process.exit(1);
}

if (!databaseId) {
  console.error("NOTION_DATABASE_ID 환경변수가 필요합니다.");
  process.exit(1);
}

function getSeoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function textBlock(content) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function headingBlock(level, content) {
  const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
  return {
    object: "block",
    type,
    [type]: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function bulletedListItem(content) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function numberedListItem(content) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function codeBlock(content) {
  return {
    object: "block",
    type: "code",
    code: {
      language: "plain text",
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}

function chunkText(value, maxLength = 1800) {
  const text = String(value ?? "");
  const chunks = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks.length ? chunks : [""];
}

function parseSummary(mdText) {
  const lines = mdText.split(/\r?\n/);
  const summaryIndex = lines.findIndex((line) => line.trim() === "## 요약");
  if (summaryIndex === -1) {
    return [];
  }

  const summaryLines = [];
  for (let i = summaryIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("## ")) {
      break;
    }
    if (/^\d+\.\s/.test(trimmed) || trimmed.startsWith("- ")) {
      summaryLines.push(trimmed.replace(/^\d+\.\s/, "").replace(/^- /, ""));
    }
  }
  return summaryLines.slice(0, 3);
}

function markdownToBlocks(mdText) {
  const lines = mdText.split(/\r?\n/);
  const blocks = [];
  let codeFence = false;
  let codeLines = [];
  let tableLines = [];

  const flushTable = () => {
    if (tableLines.length) {
      blocks.push(codeBlock(tableLines.join("\n")));
      tableLines = [];
    }
  };

  const flushCode = () => {
    if (codeLines.length) {
      chunkText(codeLines.join("\n")).forEach((chunk) => blocks.push(codeBlock(chunk)));
      codeLines = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushTable();
      if (codeFence) {
        flushCode();
        codeFence = false;
      } else {
        codeFence = true;
      }
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      tableLines.push(trimmed);
      continue;
    }

    flushTable();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(headingBlock(1, trimmed.slice(2)));
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(headingBlock(2, trimmed.slice(3)));
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push(headingBlock(3, trimmed.slice(4)));
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      blocks.push(numberedListItem(trimmed.replace(/^\d+\.\s/, "")));
      continue;
    }
    if (trimmed.startsWith("- ")) {
      blocks.push(bulletedListItem(trimmed.slice(2)));
      continue;
    }

    chunkText(trimmed).forEach((chunk) => blocks.push(textBlock(chunk)));
  }

  flushTable();
  flushCode();
  return blocks;
}

async function notionRequest(path, body) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Notion API ${response.status}: ${message}`);
  }

  return response.json();
}

async function appendChildren(blockId, children) {
  const batchSize = 90;
  for (let i = 0; i < children.length; i += batchSize) {
    await notionRequest(`/blocks/${blockId}/children`, {
      children: children.slice(i, i + batchSize),
    });
  }
}

async function main() {
  const markdown = await readFile(reportPath, "utf8");
  const summaryItems = parseSummary(markdown);
  const candidatesLine = markdown.match(/통과 종목 수:\s*(\d+)/);
  const candidateCount = candidatesLine ? Number(candidatesLine[1]) : topN;

  const page = await notionRequest("/pages", {
    parent: { database_id: databaseId },
    properties: {
      이름: {
        title: [
          {
            type: "text",
            text: { content: `${reportDate} 투자 후보 리포트` },
          },
        ],
      },
      날짜: {
        date: { start: reportDate },
      },
      최소점수: { number: minScore },
      후보수: { number: candidateCount },
      요약: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                summaryItems.join(" | ") ||
                "자동 생성된 리포트입니다. 상세 본문을 확인해 주세요.",
            },
          },
        ],
      },
      입력파일: {
        rich_text: [{ type: "text", text: { content: inputFile } }],
      },
      상태: {
        select: { name: statusValue },
      },
    },
    children: [],
  });

  const blocks = markdownToBlocks(markdown);
  await appendChildren(page.id, blocks);
  console.log(JSON.stringify({ pageId: page.id, url: page.url }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
