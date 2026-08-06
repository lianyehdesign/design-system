/**
 * 從 Figma 讀出來的變數對照表更新 tokens/ —— 不需要 API 權限。
 *
 *   npm run sync:link -- payload.json
 *   cat payload.json | npm run sync:link
 *
 * payload 就是 Figma Dev Mode / MCP get_variable_defs 直接吐出來的形狀:
 *
 *   {
 *     "Color/Primary/060": "#003354",
 *     "Color/Neutral/000": "#ffffff"
 *   }
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
  isAllowedGroup,
  groupOf,
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

  // 白名單過濾:色票 frame 上常混著字型樣式、別的 UI kit 的灰階等等
  const colorNames = entries
    .map(([name]) => name)
    .filter((name) => isAllowedGroup(name));

  const skipped = entries
    .map(([name]) => name)
    .filter((name) => !isAllowedGroup(name));

  assertNoCollisions(findCollisions(colorNames));

  const before = await readTokens('color');
  const after = replace ? new Map() : new Map(before);
  const sourceKeys = new Set(); // 這次來源實際涵蓋到的 token
  const invalid = [];

  for (const name of colorNames) {
    const hex = normalizeHex(payload[name]);
    if (!hex) {
      invalid.push(`${name} → ${JSON.stringify(payload[name])}`);
      continue;
    }

    const key = toTokenPath(name).join('.');
    const token = { $type: 'color', $value: hex };

    // 既有的 description 是人工整理的資產，不能被一次讀取蓋掉
    const existing = before.get(key);
    if (existing?.$description) token.$description = existing.$description;

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
    console.log(`\n略過 ${skipped.length} 個非 Color 項目:`);
    skipped.slice(0, 10).forEach((s) => console.log(`    ${s}`));
    if (skipped.length > 10) console.log(`    ...還有 ${skipped.length - 10} 個`);
  }

  if (replace) {
    console.log('\n（--replace:tokens/color.json 已整份重建）');
  }
}

main();
