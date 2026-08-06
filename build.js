/**
 * 跑 Style Dictionary，把 tokens/ 轉成 dist/ 底下各平台的檔案。
 *
 *   npm run build
 */

import StyleDictionary from 'style-dictionary';
import config from './style-dictionary.config.js';

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

const sd = new StyleDictionary(config);
await sd.cleanAllPlatforms();
await sd.buildAllPlatforms();
