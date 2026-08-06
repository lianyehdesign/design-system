/**
 * Style Dictionary 設定:tokens/*.json（DTCG 格式）→ 各平台檔案
 *
 * 唯一真實來源是 tokens/ 底下的 JSON,由 scripts/sync-figma.js 從 Figma 產生。
 * 這裡只負責「翻譯成各平台看得懂的形式」,不做任何值的決定。
 */

export default {
  source: ['tokens/**/*.json'],
  // tokens 用 DTCG 標準（$value / $type），必須明確開啟
  usesDtcg: true,

  platforms: {
    // ---- iOS：SwiftUI ----
    // 用自訂 format 而非內建的 ios-swift，因為內建產出的是 UIColor，
    // SwiftUI 端每次都要再包一層 Color(uiColor:)。
    ios: {
      transforms: ['attribute/cti', 'name/camel'],
      buildPath: 'dist/ios/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'DesignTokens.swift',
          format: 'swiftui/tokens',
        },
      ],
    },

    // ---- Web：CSS 變數 ----
    css: {
      transformGroup: 'css',
      buildPath: 'dist/web/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'tokens.css',
          format: 'css/variables',
          options: { selector: ':root' },
        },
      ],
    },

    // ---- Web：JS / TS ----
    ts: {
      transformGroup: 'js',
      buildPath: 'dist/web/',
      options: { usesDtcg: true },
      files: [
        { destination: 'tokens.js', format: 'javascript/es6' },
        { destination: 'tokens.d.ts', format: 'typescript/es6-declarations' },
      ],
    },

    // ---- Android ----
    android: {
      // 不用內建的 android transformGroup —— 它會把 px 當成 rem 換算（×16）。
      // 見 build.js 的 size/px-to-dp。
      transforms: [
        'attribute/cti',
        'name/snake',
        'color/hex8android',
        'size/px-to-dp',
      ],
      buildPath: 'dist/android/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'colors.xml',
          format: 'android/resources',
          filter: (token) => (token.$type ?? token.type) === 'color',
        },
        // Spacing / Radius 進來後再加 dimens.xml
      ],
    },
  },
};
