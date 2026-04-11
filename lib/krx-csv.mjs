import { readFile } from "node:fs/promises";

function looksDecoded(text) {
  const sample = text.slice(0, 400);
  if (!sample) {
    return false;
  }

  if (sample.includes("�")) {
    return false;
  }

  return /종목|시장|코드|주식|상장/u.test(sample);
}

export async function readKrxCsv(path) {
  const buffer = await readFile(path);

  const utf8 = buffer.toString("utf8");
  if (looksDecoded(utf8)) {
    return utf8;
  }

  const eucKr = new TextDecoder("euc-kr").decode(buffer);
  if (looksDecoded(eucKr)) {
    return eucKr;
  }

  return utf8;
}
