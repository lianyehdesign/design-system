/**
 * 從 Figma Variables REST API 更新 tokens/ —— 需要 Enterprise 權限。
 *
 *   FIGMA_TOKEN=xxx FIGMA_FILE_KEY=xxx npm run sync:api
 *
 * 需要環境變數:
 *   FIGMA_TOKEN     — personal access token，需含 file_variables:read scope
 *   FIGMA_FILE_KEY  — Foundation 檔案的 key（網址 /design/<這段>/...）
 *
 * 注意:variables/local 這個 endpoint 只開放 Enterprise 方案。
 *
 * 與 sync-from-link.js 的差別:
 *   API 回傳的是完整清單，所以這裡預設就是整份重建（含刪除）。
 *   而且 API 有帶 description，會直接寫進 $description，不需要保留舊的。
 */

import {
  isAllowedGroup,
  toTokenPath,
  normalizeHex,
  readTokens,
  writeTokens,
  findCollisions,
  assertNoCollisions,
  reportDiff,
} from './lib/tokens.js';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;

if (!FIGMA_TOKEN || !FILE_KEY) {
  console.error('缺少 FIGMA_TOKEN 或 FIGMA_FILE_KEY 環境變數');
  process.exit(1);
}

function rgbaToHex({ r, g, b, a = 1 }) {
  const ch = (v) =>
    Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  const hex = `#${ch(r)}${ch(g)}${ch(b)}`;
  return a < 1 ? `${hex}${ch(a)}` : hex;
}

async function main() {
  const res = await fetch(
    `https://api.figma.com/v1/files/${FILE_KEY}/variables/local`,
    { headers: { 'X-Figma-Token': FIGMA_TOKEN } }
  );

  if (!res.ok) {
    console.error(`Figma API 回傳 ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const { meta } = await res.json();
  const { variables, variableCollections } = meta;

  const colorVars = Object.values(variables)
    .filter((v) => v.resolvedType === 'COLOR' && isAllowedGroup(v.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  assertNoCollisions(findCollisions(colorVars.map((v) => v.name)));

  const before = await readTokens('color');
  const after = new Map();
  const aliases = [];
  const invalid = [];

  for (const variable of colorVars) {
    const collection = variableCollections[variable.variableCollectionId];
    // 只取預設 mode（目前沒有 light/dark 多主題，要支援再擴充）
    const rawValue = variable.valuesByMode?.[collection?.defaultModeId];

    // 別名變數（指向另一個變數）目前不展開
    if (rawValue?.type === 'VARIABLE_ALIAS') {
      aliases.push(variable.name);
      continue;
    }

    const hex = rawValue ? normalizeHex(rgbaToHex(rawValue)) : null;
    if (!hex) {
      invalid.push(`${variable.name} → ${JSON.stringify(rawValue)}`);
      continue;
    }

    const token = { $type: 'color', $value: hex };
    if (variable.description) token.$description = variable.description;
    after.set(toTokenPath(variable.name).join('.'), token);
  }

  if (invalid.length) {
    console.error(`\n✘ ${invalid.length} 個變數的值無法轉成 hex:`);
    invalid.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }

  await writeTokens('color', after);
  reportDiff(before, after, 'replace');

  if (aliases.length) {
    console.log(`\n⚠ ${aliases.length} 個別名變數未展開，這次沒有寫入:`);
    aliases.forEach((a) => console.log(`    ${a}`));
  }
}

main();
