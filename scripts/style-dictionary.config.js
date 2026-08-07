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
      buildPath: 'platform/ios/',
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
      preprocessors: ['drop-typography'],
      transformGroup: 'css',
      buildPath: 'platform/web/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'tokens.css',
          format: 'css/variables',
          options: { selector: ':root' },
          // 字體是複合值，css/variables 會把整個物件塞進一個變數。
          // 攤平成多個 property 由 typography/css 處理。
          filter: (token) => (token.$type ?? token.type) !== 'typography',
        },
      ],
    },

    // ---- Web：字體 ----
    // 獨立一個 platform，不用 css transformGroup —— 它有一個 font shorthand
    // transform 會把複合物件壓成 "500 26px/1 'PingFang TC'" 這種字串，
    // 攤平成個別 property 就取不到值了。
    cssTypography: {
      transforms: ['attribute/cti', 'name/kebab'],
      buildPath: 'platform/web/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'typography.css',
          format: 'typography/css',
          filter: (token) => (token.$type ?? token.type) === 'typography',
        },
      ],
    },

    // ---- Web：JS / TS ----
    ts: {
      preprocessors: ['drop-typography'],
      transformGroup: 'js',
      buildPath: 'platform/web/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'tokens.js',
          format: 'javascript/es6',
          filter: (token) => (token.$type ?? token.type) !== 'typography',
        },
        {
          destination: 'tokens.d.ts',
          format: 'typescript/es6-declarations',
          filter: (token) => (token.$type ?? token.type) !== 'typography',
        },
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
      buildPath: 'platform/android/',
      options: { usesDtcg: true },
      files: [
        {
          destination: 'colors.xml',
          format: 'android/resources',
          filter: (token) => (token.$type ?? token.type) === 'color',
        },
        {
          destination: 'dimens.xml',
          format: 'android/resources',
          filter: (token) => (token.$type ?? token.type) === 'dimension',
        },
        // 字體在 Android 是 TextAppearance style，不是 resource 值
        {
          destination: 'type.xml',
          format: 'typography/android',
          // 沒有 filter 的話，即使一個字體 token 都沒有也會產生空檔案
          filter: (token) => (token.$type ?? token.type) === 'typography',
        },
      ],
    },
  },
};
