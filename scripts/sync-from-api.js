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
  isAllowedToken,
  toTokenPath,
  normalizeHex,
  readTokens,
  writeTokens,
  findCollisions,
  assertNoCollisions,
  computeDiff,
  reportDiff,
  summaryMarkdown,
  writeStepSummary,
} from './lib/tokens.js';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;

if (!FIGMA_TOKEN || !FILE_KEY) {
  console.error('缺少 FIGMA_TOKEN 或 FIGMA_FILE_KEY 環境變數');
  process.exit(1);
}

/**
 * 把 Figma 的錯誤翻譯成「該去哪裡改什麼」。
 *
 * 這幾種失敗長得很像「程式壞了」，但其實全都是設定問題，
 * 沒有這段說明的話很容易往錯的方向查。
 */
function explainFailure(status, body) {
  const hint = (lines) => console.error(`\n→ ${lines.join('\n  ')}`);

  if (status === 403 && body.includes('file_variables:read')) {
    hint([
      'token 缺少 file_variables:read scope（Variables API 只認這一個）。',
      '',
      '先確認一件事:到 Figma → Settings → Security → Personal access tokens →',
      'Generate new token，看 Scopes 清單裡「有沒有」file_variables:read 這個選項。',
      '',
      '  有 → 舊 token 沒辦法追加 scope，重建一個並勾選它，',
      '       然後更新 repo 的 FIGMA_TOKEN secret。',
      '',
      '  沒有 → 這條路現在走不通，不是你漏勾。這個 scope 只對 Enterprise',
      '       方案開放，選單裡看不到就代表組織方案還沒到那一層。',
      '       注意 Full seat 是「席次類型」，跟「方案層級」是兩回事，',
      '       升到 Full seat 不會讓這個 scope 出現。',
      '',
      '       替代方案（都不需要 Enterprise）:',
      '       1. npm run sync:link —— 手動讀取後貼上，現在就能用',
      '       2. 寫一個 Figma plugin —— Plugin API 的',
      '          figma.variables.getLocalVariablesAsync() 沒有方案限制',
    ]);
    return;
  }

  if (status === 403) {
    hint([
      'token 有效但沒有權限存取這個檔案。',
      '確認 FIGMA_TOKEN 所屬的帳號有這個檔案的存取權，',
      '而且 Variables REST API 需要 Figma Enterprise 方案。',
    ]);
    return;
  }

  if (status === 404) {
    hint([
      '找不到這個檔案。確認 FIGMA_FILE_KEY 是網址 /design/<這段>/ 的值，',
      '不是整條網址、也不是 node-id。',
    ]);
    return;
  }

  if (status === 401) {
    hint(['token 無效或已過期。重新產生一個並更新 FIGMA_TOKEN secret。']);
  }
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
    const body = await res.text();
    console.error(`Figma API 回傳 ${res.status}: ${body}`);
    explainFailure(res.status, body);
    process.exit(1);
  }

  const { meta } = await res.json();
  const { variables, variableCollections } = meta;

  const colorVars = Object.values(variables)
    .filter((v) => v.resolvedType === 'COLOR' && isAllowedToken(v.name))
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

  const diff = computeDiff(before, after);
  reportDiff(diff, 'replace');

  await writeStepSummary(
    summaryMarkdown({
      title: '從 Figma Variables API 同步色彩 token',
      source: `Figma file \`${FILE_KEY}\``,
      mode: 'replace',
      diff,
      notes: aliases.length
        ? [`> ⚠️ ${aliases.length} 個別名變數未展開，這次沒有寫入。`]
        : null,
    })
  );

  if (aliases.length) {
    console.log(`\n⚠ ${aliases.length} 個別名變數未展開，這次沒有寫入:`);
    aliases.forEach((a) => console.log(`    ${a}`));
  }
}

main();
