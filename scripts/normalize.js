/**
 * ② NORMALIZE:snapshots/*.json → tokens/*.json（DTCG）
 *
 *   npm run normalize
 *
 * 這一段完全不碰網路，也不知道 snapshot 是 API 抓的還是人／AI 貼的。
 * 只要 snapshot 符合格式，這裡就跑得起來 —— 所以它可以在 CI 上單獨驗證。
 *
 * Snapshot 格式:
 *   {
 *     "$meta": { "source": "...", "library": "...", ... },
 *     "variables": {
 *       "Color/Primary/060": { "value": "#003354", "description": "選填" }
 *     }
 *   }
 *
 * value 為 null 代表「名稱已知、值還沒取得」，不產出但會列出來。
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isAllowedGroup,
  groupOf,
  normalizeHex,
  createCollector,
} from './lib/tokens.js';

const SNAPSHOT_DIR = 'snapshots';
const TOKEN_DIR = 'tokens';

async function readSnapshots() {
  const files = (await readdir(SNAPSHOT_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (!files.length) {
    console.error(`${SNAPSHOT_DIR}/ 底下沒有任何 snapshot`);
    process.exit(1);
  }

  const snapshots = [];
  for (const file of files) {
    const path = join(SNAPSHOT_DIR, file);
    const json = JSON.parse(await readFile(path, 'utf8'));
    if (!json.variables) {
      console.error(`${path} 缺少 variables 欄位`);
      process.exit(1);
    }
    snapshots.push({ path, meta: json.$meta ?? {}, variables: json.variables });
  }
  return snapshots;
}

async function main() {
  const snapshots = await readSnapshots();
  const collector = createCollector();
  const skipped = [];
  const pending = [];
  const invalid = [];

  for (const snapshot of snapshots) {
    console.log(
      `讀取 ${snapshot.path}（source: ${snapshot.meta.source ?? '?'}, library: ${snapshot.meta.library ?? '?'}）`
    );

    for (const [name, entry] of Object.entries(snapshot.variables)) {
      if (!isAllowedGroup(name)) {
        skipped.push(`${name}（分組「${groupOf(name)}」不在白名單）`);
        continue;
      }

      const value = entry?.value ?? null;
      if (value === null) {
        pending.push(name);
        continue;
      }

      const hex = normalizeHex(value);
      if (!hex) {
        invalid.push(`${name} → ${JSON.stringify(value)}`);
        continue;
      }

      const token = { $type: 'color', $value: hex };
      if (entry.description) token.$description = entry.description;
      collector.add(name, token);
    }
  }

  // ---- 撞名直接中止:壞在這裡，不要壞在下游 app ----
  if (collector.collisions.length) {
    console.error(`\n✘ ${collector.collisions.length} 組變數名稱正規化後互相衝突:`);
    collector.collisions.forEach((c) => console.error(`  - ${c}`));
    console.error(
      '\n通常代表兩套 library 的變數被一起匯入。請確認 snapshot 只含一套來源。'
    );
    process.exit(1);
  }

  // ---- 值格式錯誤也中止:靜默跳過會讓 token 悄悄消失 ----
  if (invalid.length) {
    console.error(`\n✘ ${invalid.length} 個變數的值不是合法 hex:`);
    invalid.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }

  const groups = Object.entries(collector.output);
  if (!groups.length) {
    console.error('沒有任何變數通過轉換，請檢查 snapshot');
    process.exit(1);
  }

  await mkdir(TOKEN_DIR, { recursive: true });
  for (const [topKey, tree] of groups) {
    const path = join(TOKEN_DIR, `${topKey}.json`);
    await writeFile(path, JSON.stringify({ [topKey]: tree }, null, 2) + '\n');
    console.log(`✔ 寫入 ${path}`);
  }

  if (pending.length) {
    console.log(`\n⚠ ${pending.length} 個名稱已知但值還沒取得（未產出）:`);
    pending.forEach((p) => console.log(`  - ${p}`));
  }

  if (skipped.length) {
    console.log(`\n略過 ${skipped.length} 個非 Color 變數:`);
    skipped.slice(0, 10).forEach((s) => console.log(`  - ${s}`));
    if (skipped.length > 10) console.log(`  ...還有 ${skipped.length - 10} 個`);
  }
}

main();
