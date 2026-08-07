/**
 * tokens/ 的讀寫與命名規則。
 *
 * tokens/*.json 是這個 repo 的 SSOT（DTCG 格式，進版控）。
 * 兩條 sync 路徑都寫這裡，build 只讀這裡。
 */

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
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

/** "Color/Primary/060" → "primary" */
export function familyOf(figmaName) {
  return norm(String(figmaName).split('/')[1] ?? '');
}

/**
 * 只認形狀:Color/<家族>/<階層>。
 *
 * 刻意「不」維護一份家族白名單 —— 那等於在 repo 裡再記一次
 * 「Figma 上有哪些家族」，而那份記錄一定會過期。
 * 新增家族是設計端的決定，這裡照單全收，命名治理留在 Figma。
 *
 * 代價:Figma 上有什麼，這裡就會有什麼。同色不同名的變數若同時存在，
 * 兩個都會進 tokens/。要避免的話得在 Figma 端把重複的刪掉。
 */
export function isAllowedToken(figmaName) {
  return (
    ALLOWED_GROUPS.includes(groupOf(figmaName)) &&
    toTokenPath(figmaName).length >= 3
  );
}

/** 說明為什麼被擋。只剩兩種原因。 */
export function whySkipped(figmaName) {
  const group = groupOf(figmaName);
  if (!ALLOWED_GROUPS.includes(group)) {
    return `不是 Color/ 開頭（讀到的分組是「${group}」）`;
  }
  return `層級不足，需要 Color/<家族>/<階層> 三層（讀到 ${toTokenPath(
    figmaName
  ).length} 層）`;
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
export function computeDiff(before, after, sourceKeys = null) {
  const added = [];
  const changed = [];
  const missing = [];

  for (const [key, token] of after) {
    const prev = before.get(key);
    if (!prev) added.push({ key, value: token.$value });
    else if (prev.$value !== token.$value)
      changed.push({ key, from: prev.$value, to: token.$value });
  }

  // 「來源裡沒有」要跟「輸出裡沒有」分開算 ——
  // merge 模式的 after 是 before 的複本，用 after 判斷永遠得到空集合，
  // 那則提醒就等於失效了。有給 sourceKeys 就以來源為準。
  const present = sourceKeys ?? new Set(after.keys());
  for (const key of before.keys()) {
    if (!present.has(key)) missing.push({ key, value: before.get(key).$value });
  }

  return { added, changed, missing };
}

export function reportDiff(diff, mode = 'merge') {
  const { added, changed, missing } = diff;

  if (added.length) {
    console.log(`\n+ 新增 ${added.length} 個:`);
    added.forEach((a) => console.log(`    ${a.key}  ${a.value}`));
  }
  if (changed.length) {
    console.log(`\n~ 色值變動 ${changed.length} 個:`);
    changed.forEach((c) => console.log(`    ${c.key}: ${c.from} → ${c.to}`));
  }
  if (missing.length) {
    const label =
      mode === 'replace'
        ? `已刪除 ${missing.length} 個（來源裡不再有）`
        : `${missing.length} 個既有 token 不在這次來源裡（保留未刪除）`;
    console.log(`\n${mode === 'replace' ? '-' : '!'} ${label}:`);
    missing.forEach((m) => console.log(`    ${m.key}  ${m.value}`));
  }
  if (!added.length && !changed.length && !missing.length) {
    console.log('\n沒有任何變動。');
  }
}

/**
 * 把結果寫進 GitHub Actions 的 Summary 頁面。
 *
 * 不寫的話那一頁是空的，要看發生什麼事得點進 step 展開 log ——
 * 對「只想知道這次改了什麼」的人來說門檻太高。
 *
 * 本機執行時 GITHUB_STEP_SUMMARY 不存在，直接跳過。
 */
export async function writeStepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  await appendFile(file, markdown.join('\n') + '\n');
}

/** 產生 sync 結果的 Summary markdown */
export function summaryMarkdown({ title, source, mode, diff, skipped, notes }) {
  const { added, changed, missing } = diff;
  const total = added.length + changed.length + missing.length;
  const md = [];

  md.push(`## ${total === 0 ? '✅' : '📝'} ${title}`, '');

  md.push('| | |', '| --- | --- |');
  if (source) md.push(`| 來源 | ${source} |`);
  md.push(
    `| 模式 | ${mode === 'replace' ? '整份重建（來源沒有的會刪除）' : '合併（只新增／更新，不刪除）'} |`
  );
  md.push(`| 新增 | ${added.length} |`);
  md.push(`| 色值變動 | ${changed.length} |`);
  md.push(
    `| ${mode === 'replace' ? '刪除' : '未涵蓋（保留）'} | ${missing.length} |`
  );
  if (skipped) md.push(`| 略過 | ${skipped.length} |`);
  md.push('');

  if (total === 0) {
    md.push(
      '> **沒有任何變動。** Figma 與 repo 的內容一致，因此不會開 PR —— ',
      '> 這是預期行為，不是失敗。',
      ''
    );
  }

  const table = (rows, head) => {
    md.push(head, '| --- | --- |');
    rows.forEach((r) => md.push(r));
    md.push('');
  };

  if (added.length) {
    md.push(`### ➕ 新增 ${added.length} 個`, '');
    table(
      added.map((a) => `| \`${a.key}\` | \`${a.value}\` |`),
      '| Token | 色值 |'
    );
  }
  if (changed.length) {
    md.push(`### 🔄 色值變動 ${changed.length} 個`, '');
    table(
      changed.map((c) => `| \`${c.key}\` | \`${c.from}\` → \`${c.to}\` |`),
      '| Token | 變動 |'
    );
  }
  if (missing.length) {
    md.push(
      mode === 'replace'
        ? `### ➖ 刪除 ${missing.length} 個`
        : `### ⚠️ ${missing.length} 個未涵蓋（已保留）`,
      ''
    );
    if (mode !== 'replace') {
      md.push(
        '這些 token 不在這次的來源裡。合併模式不會刪除它們 —— ',
        '請確認是**漏讀**還是設計師**真的刪掉了**。後者的話要勾「整份重建」重跑。',
        ''
      );
    }
    table(
      missing.map((m) => `| \`${m.key}\` | \`${m.value}\` |`),
      '| Token | 色值 |'
    );
  }

  if (skipped?.length) {
    md.push('<details>', `<summary>略過的 ${skipped.length} 個項目</summary>`, '');
    md.push('```');
    skipped.forEach((s) => md.push(s));
    md.push('```', '</details>', '');
  }

  if (notes?.length) md.push(...notes, '');

  return md;
}
