/**
 * tokens/ 的讀寫與命名規則。
 *
 * tokens/*.json 是這個 repo 的 SSOT（DTCG 格式，進版控）。
 * 兩條 sync 路徑都寫這裡，build 只讀這裡。
 */

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TOKEN_DIR = 'tokens';

/**
 * ---- Token 分組登記表 ----
 *
 * 分組是「變數名稱的第一段」，不是 collection ——
 * Pinkoi 的 Foundation collection 叫 Generic，分類資訊在名稱裡:Color/Primary/060。
 *
 * 這不是「允許誰進來」的白名單，是「這種東西怎麼轉換」的對照表。
 * 兩者的差別很重要:
 *
 *   家族（Primary / Blue / Test）  只是名字 → 不該在 repo 裡記，已經不記了
 *   分組（Color / Spacing / …）    決定型別 → 非記不可
 *
 * 因為分組決定了值怎麼解讀、各平台輸出成什麼:
 *
 *   color      hex     → Color(.sRGB, …)   #003354   #ff003354
 *   dimension  數字    → CGFloat            10px      10dp
 *
 * 遇到沒登記過的分組，pipeline 不知道值是 hex 還是數字、單位是什麼、
 * iOS 上該是什麼型別。那不是能照單全收的東西 —— 新增一種 token 類型
 * 本來就該有人做決定。
 *
 * 深度刻意不限制:Color/Primary/060 是三層、Spacing/m 是兩層，
 * 未來也可能出現 Color/Brand/Primary/060。層數是設計端的事。
 */
export const GROUPS = {
  color: { dtcgType: 'color', figmaType: 'COLOR' },
  spacing: { dtcgType: 'dimension', figmaType: 'FLOAT' },
  radius: { dtcgType: 'dimension', figmaType: 'FLOAT' },
};

export const GROUP_NAMES = Object.keys(GROUPS);

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '-');

/** "Color/Primary/060" → "color" */
export function groupOf(figmaName) {
  return norm(String(figmaName).split('/')[0] ?? '');
}

/** 取這個變數所屬分組的設定；沒登記過回傳 null */
export function groupConfig(figmaName) {
  return GROUPS[groupOf(figmaName)] ?? null;
}

export function isAllowedToken(figmaName) {
  return groupConfig(figmaName) !== null;
}

export function whySkipped(figmaName) {
  return (
    `分組「${groupOf(figmaName)}」沒有登記轉換方式` +
    `（目前支援:${GROUP_NAMES.join(' / ')}）。` +
    `要新增請在 scripts/lib/tokens.js 的 GROUPS 加一筆`
  );
}

/**
 * 把一個原始值轉成 DTCG token。
 *
 * 值的形狀由分組決定:color 收 hex 字串，dimension 收數字或 "10px"。
 * 轉不出來回傳 null，由呼叫端決定要不要中止 —— 靜默跳過會讓 token 悄悄消失。
 */
export function toToken(figmaName, rawValue, description) {
  const cfg = groupConfig(figmaName);
  if (!cfg) return null;

  let $value;
  if (cfg.dtcgType === 'color') {
    $value = normalizeHex(rawValue);
  } else {
    const num =
      typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue));
    $value = Number.isFinite(num) ? `${num}px` : null;
  }
  if ($value === null) return null;

  const token = { $type: cfg.dtcgType, $value };
  if (description) token.$description = description;
  return token;
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

/**
 * ---- 各平台的符號名稱 ----
 *
 * 這三個函式決定了 platform/ 底下產出什麼名字，也決定了要寫回 Figma
 * 的 Code syntax 是什麼。兩者**必須一致** —— Code syntax 只是一個標籤，
 * 它不會建立任何東西。名字對不上的話，Dev Mode 會叫工程師寫一個
 * 不存在的符號，然後編譯失敗。
 *
 * 注意:figma-plugin/code.js 有一份相同的實作（plugin 沙箱讀不到這個檔案）。
 * 改這裡的話那邊也要改。platform/code-syntax.json 是兩邊的對照憑據 ——
 * 它進版控，所以任何漂移都會出現在 diff 裡。
 */
export function symbolNames(tokenPath, dtcgType) {
  const path = Array.isArray(tokenPath) ? tokenPath : tokenPath.split('.');

  // 先拆成「字」再組合。段落本身可能含連字號（func-two、on-surface），
  // 直接對段落做大寫轉換會留下連字號 —— colorFunc-two030 不是合法的
  // Swift 識別字，Android 資源名也不接受。Style Dictionary 是先拆字再組，
  // 這裡必須跟它一致，否則 Code syntax 會指向一個編不過的符號。
  const words = path.flatMap((seg) => seg.split(/[^a-zA-Z0-9]+/).filter(Boolean));

  const camel = words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  const kebab = words.join('-');
  const snake = words.join('_');

  return {
    // Xcode 自動完成看得到的形式
    iOS: `DesignTokens.${camel}`,
    // CSS 直接可用
    WEB: `var(--${kebab})`,
    // Android 的資源型別跟著 token 型別走
    ANDROID: `R.${dtcgType === 'color' ? 'color' : 'dimen'}.${snake}`,
  };
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

/**
 * 產生 sync 結果的 Summary markdown。
 *
 * diffs 是一個分組一筆:[{ group: 'color', diff }, { group: 'spacing', diff }]
 * 分組列出而不是全部混在一起 —— 「顏色動了」跟「間距動了」的影響範圍差很多。
 */
export function summaryMarkdown({ title, source, mode, diffs, skipped, notes }) {
  const md = [];
  const sum = (f) => diffs.reduce((n, d) => n + d.diff[f].length, 0);
  const total = sum('added') + sum('changed') + sum('missing');

  md.push(`## ${total === 0 ? '✅' : '📝'} ${title}`, '');

  md.push('| | |', '| --- | --- |');
  if (source) md.push(`| 來源 | ${source} |`);
  md.push(
    `| 模式 | ${mode === 'replace' ? '整份重建（來源沒有的會刪除）' : '合併（只新增／更新，不刪除）'} |`
  );
  md.push(`| 分組 | ${diffs.map((d) => d.group).join(' / ') || '（無）'} |`);
  md.push(`| 新增 | ${sum('added')} |`);
  md.push(`| 值變動 | ${sum('changed')} |`);
  md.push(`| ${mode === 'replace' ? '刪除' : '未涵蓋（保留）'} | ${sum('missing')} |`);
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

  for (const { group, diff } of diffs) {
    const { added, changed, missing } = diff;
    if (!added.length && !changed.length && !missing.length) continue;

    md.push(`### \`${group}\``, '');

    if (added.length) {
      md.push(`**➕ 新增 ${added.length} 個**`, '');
      table(
        added.map((a) => `| \`${a.key}\` | \`${a.value}\` |`),
        '| Token | 值 |'
      );
    }
    if (changed.length) {
      md.push(`**🔄 值變動 ${changed.length} 個**`, '');
      table(
        changed.map((c) => `| \`${c.key}\` | \`${c.from}\` → \`${c.to}\` |`),
        '| Token | 變動 |'
      );
    }
    if (missing.length) {
      md.push(
        mode === 'replace'
          ? `**➖ 刪除 ${missing.length} 個**`
          : `**⚠️ ${missing.length} 個未涵蓋（已保留）**`,
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
        '| Token | 值 |'
      );
    }
  }

  if (skipped?.length) {
    md.push('<details>', `<summary>略過的 ${skipped.length} 個項目</summary>`, '');
    md.push('```');
    skipped.forEach((x) => md.push(x));
    md.push('```', '</details>', '');
  }

  if (notes?.length) md.push(...notes, '');

  return md;
}
