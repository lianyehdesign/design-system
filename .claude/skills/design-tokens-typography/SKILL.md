---
name: design-tokens-typography
description: 處理 Pinkoi design system 的字體 token —— 從 Figma text style 讀出、轉成 DTCG、產出各平台檔案，以及把元件裡的字體對應到 token。當任務涉及 typography、font、字體、text style、字級、字重，或要把含文字的 Figma 元件轉成程式碼時使用。
---

# 字體 Token

字體跟 color / spacing / radius **不是同一種東西**，走不同的路。動手前先讀完這頁。

## 三個必須先知道的事實

### 1. Text style 不是 variable

```
figma.variables.getLocalVariablesAsync()   → 讀不到字體
figma.getLocalTextStylesAsync()            → 才讀得到
```

`figma-plugin/code.js` 的變數讀取邏輯**完全看不到字體**，是分開的一段。

### 2. Code syntax 對 text style 不適用

Code syntax 是 variable 專屬欄位。同一次 `get_variable_defs` 的回傳可以直接看出差別：

```
"var(--spacing-xs)": "4"      ← 變數，Code syntax 生效
"s-regular": "Font(...)"      ← 樣式，只有原始名稱
```

**所以「推送 Code syntax 到 Figma」那顆按鈕對字體沒有作用。** 生成程式碼時，要靠**樣式名稱**去對應 token，這一層對應是這份 skill 存在的主因。

### 3. 它是複合值

```
Font(family: "PingFang TC", style: Medium, size: 16,
     weight: 500, lineHeight: 100, letterSpacing: 0)
```

一個 token 六個屬性。各平台的表達方式差很多，不像顏色那樣一對一。

## 命名慣例

```
<尺寸>-<字重>

least-regular    12 / 400
xs-regular       13 / 400
s-regular        14 / 400
s-medium         14 / 500
m-medium         16 / 500
l-medium         18 / 500
xl-medium        22 / 500
3xl-medium       26 / 500
4xl-semibold     30 / 600
```

尺寸階層跟 `Spacing/` 共用同一套（`least` / `xs` / `s` / `m` / `l` / `xl` / `2xl` / `3xl` / `4xl`）。

**Figma 上的 text style 沒有 `Typography/` 前綴**（就叫 `s-medium`）。轉成 token 時要補上，才能跟其他分組一致：

```
Figma:  s-medium
Token:  typography.s-medium
iOS:    DesignTokens.typographySMedium
Web:    --typography-s-medium-*
```

## ⚠️ lineHeight 的單位

Figma 序列化成 `lineHeight: 100`，但 Figma 的 lineHeight 有三種單位：`AUTO` / `PIXELS` / `PERCENT`。

**`100` 幾乎確定是 100%（PERCENT），不是 100px** —— 12px 的字配 100px 行高不合理。但**動手前務必確認**，因為：

- CSS：`line-height: 1` （無單位倍數）
- SwiftUI：`Font` 沒有 lineHeight，要用 `.lineSpacing(行高 - 字級)`，**100% 代表 lineSpacing 為 0**
- Android：`lineHeight` 要換算成 sp

猜錯的話所有文字的行距都會壞掉，而且不會有任何錯誤訊息。

用 plugin 讀取時，`figma.getLocalTextStylesAsync()` 回傳的 `lineHeight` 是 `{ unit: 'PERCENT' | 'PIXELS' | 'AUTO', value: number }`，**以那個為準**，不要相信 `Font(...)` 字串裡的數字。

## 工作流程

字體要接上既有的 pipeline（見專案根目錄 README 的「流程」）：

```
Figma text styles
   ↓ figma-plugin（讀 getLocalTextStylesAsync）
   ↓ workflow_dispatch
tokens/typography.json      ← DTCG composite type
   ↓ npm run build
platform/
   ├── ios/DesignTokens.swift      Font + lineSpacing
   ├── web/tokens.css              每個 token 一組 custom property
   └── android/type.xml            TextAppearance style
```

### 加一個 token 分組

`scripts/lib/tokens.js` 的 `GROUPS` 是**型別對照表**，不是白名單。字體要加一筆：

```js
typography: { dtcgType: 'typography', figmaType: 'TEXT_STYLE' },
```

然後 `toToken()` 要能處理複合值 —— 現有的分支只認 hex 字串與數字。

### DTCG 的 typography 型別

```json
{
  "typography": {
    "s-medium": {
      "$type": "typography",
      "$value": {
        "fontFamily": "PingFang TC",
        "fontSize": "14px",
        "fontWeight": 500,
        "lineHeight": 1,
        "letterSpacing": "0px"
      }
    }
  }
}
```

`lineHeight` 用**無單位倍數**（1 = 100%），因為那是唯一三個平台都能無損換算的形式。

### 各平台的產出形式

**iOS** —— `Font` 不帶行高，所以要成對輸出：

```swift
public static let typographySMedium = Font.custom("PingFang TC", size: 14).weight(.medium)
/// 搭配 .lineSpacing() 使用；值為 字級 × (lineHeight - 1)
public static let typographySMediumLineSpacing: CGFloat = 0
```

**Web** —— 複合值攤平成多個 custom property：

```css
--typography-s-medium-font-family: "PingFang TC";
--typography-s-medium-font-size: 14px;
--typography-s-medium-font-weight: 500;
--typography-s-medium-line-height: 1;
```

**Android** —— `TextAppearance` style，不是 dimen：

```xml
<style name="TextAppearance.SMedium">
  <item name="android:textSize">14sp</item>
  <item name="android:fontFamily">@font/pingfang_tc</item>
</style>
```

## 把元件裡的字體對應到 token

因為 Code syntax 不適用，`get_design_context` 讀含文字的元件時，**回傳的是樣式名稱或原始數值**，不是 token 名稱。對應要在生成階段做：

1. 從回傳中找出字體資訊
   - 有樣式名（`s-medium`）→ 直接對應 `DesignTokens.typographySMedium`
   - 只有 `font-size: 14px; font-weight: 500` → 拿去比對 `tokens/typography.json`，找出符合的 token
2. **比對不到就是 magic number** —— 明確標示出來，不要自己編一個最接近的
3. 產出的程式碼引用 token，不要寫死數值

**比對不到時不要靜默處理。** 那代表設計師沒套樣式，是需要回報的發現，跟顏色沒綁變數是同一類問題。

## 動手前的檢查清單

- [ ] 確認 `lineHeight` 的單位（PERCENT / PIXELS / AUTO）
- [ ] 確認 `PingFang TC` 在 iOS / Android 的實際字體名稱 —— 三個平台的字體檔名常常不同
- [ ] 確認 Android 有沒有對應的 font resource（`@font/...`），沒有的話 `fontFamily` 要怎麼處理
- [ ] 問設計師：`s-regular` 和 `s-medium` 這種同尺寸不同字重，是否應該是同一個 token 的兩個變體

## 這份 skill 不涵蓋的

- **Figma 端的樣式治理**（誰能新增樣式、命名審核）—— 那是設計流程問題
- **多語言字體**（PingFang TC vs 日文 vs 英文）—— 目前只有一套，之後要支援需要重新設計 token 結構
