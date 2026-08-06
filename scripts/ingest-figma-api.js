/**
 * ① INGEST（正式路徑）:Figma Variables REST API → snapshots/figma.color.json
 *
 *   FIGMA_TOKEN=xxx FIGMA_FILE_KEY=xxx npm run ingest:api
 *
 * 需要環境變數:
 *   FIGMA_TOKEN     — personal access token，需含 file_variables:read scope
 *   FIGMA_FILE_KEY  — Foundation 檔案的 key（網址 /design/<這段>/...）
 *
 * 注意:variables/local 這個 endpoint 只開放 Enterprise 方案。
 *
 * 這支程式的職責只有一個:把 Figma 的回傳整理成 snapshot 格式寫到磁碟。
 * 它不做白名單過濾、不做命名正規化、不產生 DTCG —— 那些是 normalize 的事。
 * 唯一的例外是「只保留 Color 群組」，因為抓回來的東西太雜，
 * snapshot 全存反而讓 diff 難讀。
 */

import { writeFile, mkdir } from 'node:fs/promises';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;
const OUTPUT = 'snapshots/figma.color.json';

if (!FIGMA_TOKEN || !FILE_KEY) {
  console.error('缺少 FIGMA_TOKEN 或 FIGMA_FILE_KEY 環境變數');
  process.exit(1);
}

function rgbaToHex({ r, g, b, a = 1 }) {
  const ch = (v) =>
    Math.round(v * 255).toString(16).padStart(2, '0').toLowerCase();
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

  const out = {};
  const aliases = [];

  // 名稱排序，讓 snapshot 的 diff 穩定、可讀
  const sorted = Object.values(variables).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const variable of sorted) {
    if (variable.resolvedType !== 'COLOR') continue;
    if (!variable.name.toLowerCase().startsWith('color/')) continue;

    const collection = variableCollections[variable.variableCollectionId];
    const rawValue = variable.valuesByMode?.[collection?.defaultModeId];

    // 別名變數（指向另一個變數）目前不展開
    if (rawValue?.type === 'VARIABLE_ALIAS') {
      aliases.push(variable.name);
      out[variable.name] = { value: null, description: variable.description };
      continue;
    }

    const entry = { value: rawValue ? rgbaToHex(rawValue) : null };
    if (variable.description) entry.description = variable.description;
    out[variable.name] = entry;
  }

  const snapshot = {
    $meta: {
      source: 'figma-api',
      fileKey: FILE_KEY,
      capturedAt: new Date().toISOString().slice(0, 10),
      endpoint: 'GET /v1/files/:key/variables/local',
    },
    variables: out,
  };

  await mkdir('snapshots', { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`✔ 寫入 ${OUTPUT}（${Object.keys(out).length} 個 Color 變數）`);

  if (aliases.length) {
    console.log(`\n⚠ ${aliases.length} 個別名變數未展開，值記為 null:`);
    aliases.forEach((a) => console.log(`  - ${a}`));
  }
}

main();
