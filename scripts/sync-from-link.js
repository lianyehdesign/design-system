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
  groupOf,
  toTokenPath,
  toToken,
  readTokens,
  writeTokens,
  findCollisions,
  assertNoCollisions,
  computeDiff,
  reportDiff,
  summaryMarkdown,
  writeStepSummary,
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

  const accepted = entries.map(([name]) => name).filter(isAllowedToken);
  const skipped = entries.map(([name]) => name).filter((n) => !isAllowedToken(n));

  assertNoCollisions(findCollisions(accepted));

  // 依分組拆開處理。tokens/ 是一個分組一個檔，
  // 而且每個分組的值怎麼解讀是不一樣的。
  const byGroup = new Map();
  for (const name of accepted) {
    const group = groupOf(name);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(name);
  }

  const mode = replace ? 'replace' : 'merge';
  const invalid = [];
  const results = [];

  for (const [group, names] of [...byGroup.entries()].sort()) {
    const before = await readTokens(group);
    const after = replace ? new Map() : new Map(before);
    const sourceKeys = new Set();

    for (const name of names) {
      const entry = payload[name];
      const isObject = entry !== null && typeof entry === 'object';
      const rawValue = isObject ? entry.value : entry;
      const sourceDescription = isObject ? entry.description : undefined;

      const key = toTokenPath(name).join('.');

      // description 的優先順序:來源帶了就用來源的（那是 Figma 上的現況），
      // 沒帶才沿用既有的。
      //
      // 這兩種情況都會發生:
      //   figma-plugin 讀得到 description  → 以 Figma 為準
      //   MCP / Dev Mode 讀不到 description → 保留人工整理過的內容，不能被清掉
      const description = sourceDescription || before.get(key)?.$description;

      const token = toToken(name, rawValue, description);
      if (!token) {
        invalid.push(`${name} → ${JSON.stringify(rawValue)}`);
        continue;
      }

      after.set(key, token);
      sourceKeys.add(key);
    }

    results.push({ group, before, after, sourceKeys });
  }

  // 值轉不出來就中止 —— 靜默跳過會讓 token 從下游悄悄消失
  if (invalid.length) {
    console.error(`\n✘ ${invalid.length} 個值無法轉換:`);
    invalid.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }

  const diffs = [];
  for (const { group, before, after, sourceKeys } of results) {
    await writeTokens(group, after);
    const diff = computeDiff(before, after, sourceKeys);
    console.log(`\n── ${group} ──`);
    reportDiff(diff, mode);
    diffs.push({ group, diff });
  }

  await writeStepSummary(
    summaryMarkdown({
      title: '從 Figma 同步 token',
      source: process.env.SOURCE_URL || null,
      mode,
      diffs,
      skipped: skipped.map((n) => `${n}（${whySkipped(n)}）`),
      notes: [
        `讀入 ${entries.length} 個項目，其中 ${accepted.length} 個進入 tokens/` +
          `（${diffs.map((d) => d.group).join(' / ')}）。`,
      ],
    })
  );

  if (skipped.length) {
    console.log(`\n略過 ${skipped.length} 個項目:`);
    skipped.slice(0, 10).forEach((n) => console.log(`    ${n}（${whySkipped(n)}）`));
    if (skipped.length > 10) console.log(`    ...還有 ${skipped.length - 10} 個`);
  }

  if (replace) {
    console.log('\n（--replace:tokens/ 已整份重建）');
  }
}

main();
