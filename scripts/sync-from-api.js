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
      '既有 token 沒辦法追加 scope，必須重新建立:',
      'Figma → Settings → Security → Personal access tokens → Generate new token，',
      '建立時把 Variables → Read 勾起來，然後更新 repo 的 FIGMA_TOKEN secret。',
      '',
      '注意:這個選項只有 Enterprise 組織的帳號看得到。',
      '用個人帳號建的 token 不會有這個 scope。',
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
