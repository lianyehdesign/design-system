/**
 * NORMALIZE 階段的共用邏輯 —— 唯一知道「命名規則與 DTCG 語意」的地方。
 *
 * 這一層刻意不知道資料從哪來（API / MCP / 手貼），也不知道要產出什麼平台。
 * 它只認得一種輸入:snapshot 的 variables 區塊。
 */

// ---- 目前只處理 Color ----
// 分組是看「變數名稱的第一段」，不是 collection。
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

/**
 * Figma 變數路徑 → DTCG 路徑
 *   Color/Primary/060   → ['color', 'primary', '060']
 *   Color/Func-Two/040  → ['color', 'func-two', '040']
 */
export function toTokenPath(figmaName) {
  return String(figmaName).split('/').map(norm).filter(Boolean);
}

/** #abc → #AABBCC，並驗證是合法 hex；不合法回傳 null */
export function normalizeHex(raw) {
  const h = String(raw).trim().replace(/^#/, '');
  const expanded =
    h.length === 3 || h.length === 4
      ? h.split('').map((c) => c + c).join('')
      : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) return null;
  return `#${expanded.toUpperCase()}`;
}

function setDeep(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    cur[path[i]] ??= {};
    cur = cur[path[i]];
  }
  cur[path.at(-1)] = value;
}

/**
 * 收集 token，並偵測「不同 Figma 名稱正規化後撞到同一個路徑」。
 *
 * 這不是理論風險:Figma 上同時存在兩套 Foundation library，
 *   Color/Primary/010（[Design System] Foundation）
 *   Color/primary/010（[Pinzap Design System] Foundation）
 * 只差大小寫。沒有這個檢查的話後寫入的會靜默蓋掉先寫入的，而且值可能不同。
 */
export function createCollector() {
  const output = {};
  const seen = new Map(); // 'color.primary.010' → 原始 Figma 名稱
  const collisions = [];

  return {
    output,
    collisions,
    add(figmaName, token) {
      const path = toTokenPath(figmaName);
      const key = path.join('.');
      const prev = seen.get(key);

      if (prev !== undefined && prev !== figmaName) {
        collisions.push(`${key} ← 「${prev}」與「${figmaName}」`);
        return;
      }

      seen.set(key, figmaName);
      setDeep(output, path, token);
    },
  };
}
