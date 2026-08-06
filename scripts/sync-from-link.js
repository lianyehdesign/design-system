/**
 * 從 Figma 讀出來的變數對照表更新 tokens/ —— 不需要 API 權限。
 *
 *   npm run sync:link -- payload.json
 *   cat payload.json | npm run sync:link
 *
 * payload 接受兩種形狀:
 *
 *   1. Figma Dev Mode / MCP get_variable_defs 直接吐出來的:
 *      { "Color/Primary/060": "#003354" }
 *
 *   2. figma-plugin/ 產生的（多帶 description）:
 *      { "Color/Primary/060": { "value": "#003354", "description": "商品卡售價用色" } }
 *
 * 為什麼是「合併」而不是「覆蓋」:
 *   這種讀取通常只涵蓋畫面上選到的那部分，不是完整清單。
 *   直接覆蓋的話，沒被選到的 token 會靜默消失，下游 app 就編不過了。
 *   所以預設只更新 / 新增，不刪除，並把「這次沒出現的既有 token」列出來。
 *   確定 payload 是完整清單時再加 --replace。
 *
 * description 也是刻意保留的:
 *   get_variable_defs 不回傳 description，但那些使用說明是人工整理過的資產。
 *   合併時既有的 $description 會留著，只換 $value。
 */

import { readFile } from 'node:fs/promises';
import {
  isAllowedToken,
  whySkipped,
  toTokenPath,
  normalizeHex,
  readTokens,
  writeTokens,
  findCollisions,
  assertNoCollisions,
  reportDiff,
} from './lib/tokens.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const inputPath = args.find((a) => !a.startsWith('--'));

async function readPayload() {
  const raw = inputPath
    ? await readFile(inputPath, 'utf8')
    : await readFile(0, 'utf8'); // stdin

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`payload 不是合法 JSON:${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const payload = await readPayload();
  const entries = Object.entries(payload);

  if (!entries.length) {
    console.error('payload 是空的');
    process.exit(1);
  }

  // 白名單過濾兩層:非 Color/ 的（字型樣式、別的 UI kit 灰階），
  // 以及色名命名那一套（Blue/Salmon/Gray/…，與語意命名同色不同名）
  const colorNames = entries
    .map(([name]) => name)
    .filter((name) => isAllowedToken(name));

  const skipped = entries
    .map(([name]) => name)
    .filter((name) => !isAllowedToken(name));

  assertNoCollisions(findCollisions(colorNames));

  const before = await readTokens('color');
  const after = replace ? new Map() : new Map(before);
  const sourceKeys = new Set(); // 這次來源實際涵蓋到的 token
  const invalid = [];

  for (const name of colorNames) {
    const entry = payload[name];
    const isObject = entry !== null && typeof entry === 'object';
    const rawValue = isObject ? entry.value : entry;
    const sourceDescription = isObject ? entry.description : undefined;

    const hex = normalizeHex(rawValue);
    if (!hex) {
      invalid.push(`${name} → ${JSON.stringify(entry)}`);
      continue;
    }

    const key = toTokenPath(name).join('.');
    const token = { $type: 'color', $value: hex };

    // description 的優先順序:來源帶了就用來源的（那是 Figma 上的現況），
    // 沒帶才沿用既有的。
    //
    // 這兩種情況都會發生:
    //   figma-plugin 讀得到 description  → 以 Figma 為準
    //   MCP / Dev Mode 讀不到 description → 保留人工整理過的內容，不能被清掉
    const description = sourceDescription || before.get(key)?.$description;
    if (description) token.$description = description;

    after.set(key, token);
    sourceKeys.add(key);
  }

  if (invalid.length) {
    console.error(`\n✘ ${invalid.length} 個值不是合法 hex:`);
    invalid.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }

  await writeTokens('color', after);
  reportDiff(before, after, replace ? 'replace' : 'merge', sourceKeys);

  if (skipped.length) {
    console.log(`\n略過 ${skipped.length} 個項目:`);
    skipped.slice(0, 10).forEach((n) => console.log(`    ${n}（${whySkipped(n)}）`));
    if (skipped.length > 10) console.log(`    ...還有 ${skipped.length - 10} 個`);
  }

  if (replace) {
    console.log('\n（--replace:tokens/color.json 已整份重建）');
  }
}

main();
