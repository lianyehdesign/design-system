/**
 * 跑 Style Dictionary，把 tokens/ 轉成 platform/ 底下各平台的檔案。
 *
 *   npm run build
 */

import StyleDictionary from 'style-dictionary';
import config from './style-dictionary.config.js';
import { writeFile } from 'node:fs/promises';
import {
  GROUP_NAMES,
  GROUPS,
  readTokens,
  normalizeHex,
  symbolNames,
  writeStepSummary,
} from './lib/tokens.js';

// ---- SwiftUI 用的自訂 format ----
// 產出一個 DesignTokens enum，裡面是扁平的 static 常數:
//   DesignTokens.colorPrimary060
//   DesignTokens.spacingM
// 扁平而非巢狀是刻意的:巢狀的話 Color/Spacing 這種命名會跟
// SwiftUI 自己的型別撞名，處理起來反而麻煩。
StyleDictionary.registerFormat({
  name: 'swiftui/tokens',
  format: ({ dictionary }) => {
    const lines = [];

    for (const token of dictionary.allTokens) {
      const type = token.$type ?? token.type;
      const value = token.$value ?? token.value;
      const description = token.$description ?? token.description;
      // Figma 上的使用說明帶進 Swift doc comment，Xcode 會顯示在自動完成裡
      const comment = description
        ? `  /// ${description}\n  /// (${token.path.join('/')})`
        : `  /// ${token.path.join('/')}`;

      if (type === 'color') {
        const { r, g, b, a } = hexToRgba(value);
        lines.push(comment);
        lines.push(
          `  public static let ${token.name} = Color(` +
            `.sRGB, red: ${fmt(r)}, green: ${fmt(g)}, blue: ${fmt(b)}, opacity: ${fmt(a)})`
        );
      } else if (type === 'dimension') {
        const num = parseFloat(String(value));
        if (Number.isNaN(num)) continue;
        lines.push(comment);
        lines.push(`  public static let ${token.name}: CGFloat = ${num}`);
      }
    }

    return [
      '// 這個檔案是自動產生的，請不要手動修改。',
      '// 來源:Figma variables → tokens/*.json → Style Dictionary',
      '',
      'import SwiftUI',
      '',
      'public enum DesignTokens {',
      lines.join('\n'),
      '}',
      '',
    ].join('\n');
  },
});

// ---- Android 用的 dimension transform ----
// 內建的 android transformGroup 假設數值單位是 rem，會自動 ×16，
// 但我們的 token 是 px（Figma 出來就是 px），直接 1:1 對到 dp 才對。
StyleDictionary.registerTransform({
  name: 'size/px-to-dp',
  type: 'value',
  transitive: true,
  filter: (token) => (token.$type ?? token.type) === 'dimension',
  transform: (token) => {
    const num = parseFloat(String(token.$value ?? token.value));
    return Number.isNaN(num) ? token.$value ?? token.value : `${num}dp`;
  },
});

function hexToRgba(hex) {
  const h = String(hex).replace('#', '');
  const part = (i) => parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
  return {
    r: part(0),
    g: part(1),
    b: part(2),
    a: h.length >= 8 ? part(3) : 1,
  };
}

const fmt = (n) => Number(n.toFixed(4));

// ---- build 前先驗證 tokens/ ----
// tokens/ 是可以手改的 SSOT，所以錯字要壞在這裡，
// 不能讓 NaN 之類的東西流進 platform/ 再流到 app。
const tokensByGroup = new Map();
for (const group of GROUP_NAMES) {
  const map = await readTokens(group);
  if (map.size) tokensByGroup.set(group, map);
}

const bad = [];
for (const [group, map] of tokensByGroup) {
  for (const [key, token] of map) {
    const type = token.$type ?? token.type;
    const value = token.$value ?? token.value;

    if (type === 'color') {
      if (normalizeHex(value) === null) bad.push(`${key} → ${JSON.stringify(value)}`);
    } else if (type === 'dimension') {
      if (!Number.isFinite(parseFloat(String(value))))
        bad.push(`${key} → ${JSON.stringify(value)}`);
    } else {
      bad.push(`${key} → 未知型別 ${JSON.stringify(type)}`);
    }
  }
}
if (bad.length) {
  console.error(`✘ ${bad.length} 個 token 的值不合法:`);
  bad.forEach((b) => console.error(`  - ${b}`));
  process.exit(1);
}

const sd = new StyleDictionary(config);
await sd.cleanAllPlatforms();
await sd.buildAllPlatforms();

// ---- 產出 Code syntax 對照表 ----
// 這份表是「repo 這邊的名字」的權威記錄，給 figma-plugin 寫回 Figma 用。
// 它進版控，所以 plugin 那份實作若跟這裡漂移，diff 看得出來。
const codeSyntax = {};
for (const [group, map] of tokensByGroup) {
  for (const key of map.keys()) {
    codeSyntax[key] = symbolNames(key, GROUPS[group].dtcgType);
  }
}
await writeFile(
  'platform/code-syntax.json',
  JSON.stringify(
    {
      $comment:
        'Figma 變數的 Code syntax 對照表。key 是正規化後的 token 路徑（Color/Primary/060 → color.primary.060）。由 figma-plugin 寫回 Figma，讓 Dev Mode 顯示 token 名稱而不是色值。',
      tokens: codeSyntax,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `✔ platform/code-syntax.json（${Object.keys(codeSyntax).length} 筆）`
);

// ---- 把結果寫進 Actions 的 Summary 頁面 ----
// 不寫的話那一頁是空的，得點進 step 展開 log 才知道發生什麼事。
const totalTokens = [...tokensByGroup.values()].reduce((n, m) => n + m.size, 0);

await writeStepSummary([
  '## 🎨 產出各平台檔案',
  '',
  `\`tokens/\` 的 **${totalTokens} 個 token** 已轉成下列檔案:`,
  '',
  '| 平台 | 檔案 |',
  '| --- | --- |',
  '| iOS | `platform/ios/DesignTokens.swift` |',
  '| Web | `platform/web/tokens.css` · `tokens.js` · `tokens.d.ts` |',
  '| Android | `platform/android/colors.xml` · `dimens.xml` |',
  '',
  '| 分組 | 型別 | 數量 |',
  '| --- | --- | --- |',
  ...[...tokensByGroup.entries()]
    .sort()
    .map(([g, m]) => `| \`${g}\` | ${GROUPS[g].dtcgType} | ${m.size} |`),
]);
