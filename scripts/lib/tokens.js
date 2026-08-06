/**
 * tokens/ 的讀寫與命名規則。
 *
 * tokens/*.json 是這個 repo 的 SSOT（DTCG 格式，進版控）。
 * 兩條 sync 路徑都寫這裡，build 只讀這裡。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const TOKEN_DIR = 'tokens';

// ---- 目前只處理 Color ----
// 分組看「變數名稱的第一段」，不是 collection。
// Pinkoi 的 Foundation collection 叫 Generic，分類資訊在名稱裡:Color/Primary/060。
export const ALLOWED_GROUPS = ['color'];

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '-');

/** "Color/Primary/060" → "color" */
export function groupOf(figmaName) {
  return norm(String(figmaName).split('/')[0] ?? '');
}

export function isAllowedGroup(figmaName) {
  return ALLOWED_GROUPS.includes(groupOf(figmaName));
}

/** "Color/Primary/060" → ['color', 'primary', '060'] */
export function toTokenPath(figmaName) {
  return String(figmaName).split('/').map(norm).filter(Boolean);
}

/** #abc → #AABBCC；不是合法 hex 回傳 null */
export function normalizeHex(raw) {
  const h = String(raw).trim().replace(/^#/, '');
  const expanded =
    h.length === 3 || h.length === 4
      ? h.split('').map((c) => c + c).join('')
      : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) return null;
  return `#${expanded.toUpperCase()}`;
}

/** 巢狀 token 樹 → 扁平 Map：'color.primary.060' → token */
export function flatten(tree, prefix = [], out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    if (value && typeof value === 'object' && '$value' in value) {
      out.set([...prefix, key].join('.'), value);
    } else if (value && typeof value === 'object') {
      flatten(value, [...prefix, key], out);
    }
  }
  return out;
}

/** 扁平 Map → 巢狀 token 樹 */
export function unflatten(map) {
  const tree = {};
  for (const [key, token] of [...map.entries()].sort()) {
    const path = key.split('.');
    let cur = tree;
    for (let i = 0; i < path.length - 1; i++) {
      cur[path[i]] ??= {};
      cur = cur[path[i]];
    }
    cur[path.at(-1)] = token;
  }
  return tree;
}

/** 讀 tokens/<group>.json，回傳扁平 Map；檔案不存在回傳空 Map */
export async function readTokens(group) {
  try {
    const json = JSON.parse(
      await readFile(join(TOKEN_DIR, `${group}.json`), 'utf8')
    );
    return flatten(json[group] ?? {}, [group]);
  } catch (err) {
    if (err.code === 'ENOENT') return new Map();
    throw err;
  }
}

/** 扁平 Map → tokens/<group>.json */
export async function writeTokens(group, map) {
  const tree = unflatten(map);
  await mkdir(TOKEN_DIR, { recursive: true });
  const path = join(TOKEN_DIR, `${group}.json`);
  await writeFile(path, JSON.stringify(tree, null, 2) + '\n');
  console.log(`✔ 寫入 ${path}（${map.size} 個 token）`);
}

/**
 * 偵測「不同 Figma 名稱正規化後撞到同一個路徑」。
 *
 * 不是理論風險:Figma 上同時存在兩套 Foundation library，
 *   Color/Primary/010（[Design System] Foundation）
 *   Color/primary/010（[Pinzap Design System] Foundation）
 * 只差大小寫。沒有這個檢查，後寫入的會靜默蓋掉先寫入的，而且值可能不同。
 */
export function findCollisions(figmaNames) {
  const seen = new Map();
  const collisions = [];
  for (const name of figmaNames) {
    const key = toTokenPath(name).join('.');
    const prev = seen.get(key);
    if (prev !== undefined && prev !== name) {
      collisions.push(`${key} ← 「${prev}」與「${name}」`);
      continue;
    }
    seen.set(key, name);
  }
  return collisions;
}

export function assertNoCollisions(collisions) {
  if (!collisions.length) return;
  console.error(`\n✘ ${collisions.length} 組變數名稱正規化後互相衝突:`);
  collisions.forEach((c) => console.error(`  - ${c}`));
  console.error(
    '\n通常代表兩套 library 的變數被一起匯入。請確認來源只有一套。'
  );
  process.exit(1);
}

/**
 * 印出 sync 前後的差異，讓 PR / log 看得懂改了什麼。
 *
 * mode 決定「既有但這次來源沒有」的 token 怎麼描述:
 *   'merge'   — 合併模式（sync:link 預設），保留不刪
 *   'replace' — 整份重建（sync:api、sync:link --replace），已刪除
 */
export function reportDiff(before, after, mode = 'merge', sourceKeys = null) {
  const added = [];
  const changed = [];
  const missing = [];

  for (const [key, token] of after) {
    const prev = before.get(key);
    if (!prev) added.push(key);
    else if (prev.$value !== token.$value)
      changed.push(`${key}: ${prev.$value} → ${token.$value}`);
  }

  // 「來源裡沒有」要跟「輸出裡沒有」分開算 ——
  // merge 模式的 after 是 before 的複本，用 after 判斷永遠得到空集合，
  // 那則提醒就等於失效了。有給 sourceKeys 就以來源為準。
  const present = sourceKeys ?? new Set(after.keys());
  for (const key of before.keys()) {
    if (!present.has(key)) missing.push(key);
  }

  if (added.length) {
    console.log(`\n+ 新增 ${added.length} 個:`);
    added.forEach((k) => console.log(`    ${k}`));
  }
  if (changed.length) {
    console.log(`\n~ 色值變動 ${changed.length} 個:`);
    changed.forEach((c) => console.log(`    ${c}`));
  }
  if (missing.length) {
    const label =
      mode === 'replace'
        ? `已刪除 ${missing.length} 個（來源裡不再有）`
        : `${missing.length} 個既有 token 不在這次來源裡（保留未刪除）`;
    console.log(`\n${mode === 'replace' ? '-' : '!'} ${label}:`);
    missing.forEach((k) => console.log(`    ${k}`));
  }
  if (!added.length && !changed.length && !missing.length) {
    console.log('\n沒有任何變動。');
  }
}
