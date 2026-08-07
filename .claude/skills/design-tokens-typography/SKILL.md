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

各平台的表達方式差很多，不像顏色那樣一對一。

（注意上面那個 `lineHeight: 100` —— 那串字裡**沒有單位**。實際上 Figma 端是 `AUTO`，
不要相信這個數字，見下一節。）

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

## ⚠️ token 不帶行高

**這是刻意的決定，不是遺漏。**

Figma 上 29 個 text style 的 `lineHeight` 全部是 `AUTO` —— 也就是「跟著字體本身的行高走」。而那正是三個平台的預設行為：

| 平台 | AUTO 對應到 |
| --- | --- |
| CSS | 不設 `line-height` |
| SwiftUI | 不加 `.lineSpacing()` |
| Android | 不設 `android:lineHeight` |

所以帶著一個永遠等於「什麼都不做」的欄位，只是讓每一層都多一段沒有作用的程式碼。

### 但不會靜默忽略

plugin 讀到**不是 AUTO** 的行高時會回報：

```
s-medium（行高不是 AUTO，是 150 PERCENT
         —— 目前的 token 不帶行高，這個設定會被忽略）
```

設計師設固定行高是有意圖的，pipeline 不該當作沒看到。看到這個訊息就是「該把欄位加回來」的信號。

### 加回來的時候要注意 SwiftUI

`.lineSpacing(x)` 是在**字體自然行高之上再加 x**，不是設定行高。自然行高由字體 metrics 決定，**靜態算不出來** —— 所以不能輸出 pt 值，只能輸出倍數讓呼叫端拿實際 metrics 換算。

（這裡原本寫錯過:用 `字級 × (倍數 - 1)` 算 lineSpacing，那假設自然行高等於字級，不成立。）

## 工作流程

字體要接上既有的 pipeline（見專案根目錄 README 的「流程」）：

```
Figma text styles
   ↓ figma-plugin（讀 getLocalTextStylesAsync）
   ↓ workflow_dispatch
tokens/typography.json      ← DTCG composite type
   ↓ npm run build
platform/
   ├── ios/DesignTokens.swift      Font.system
   ├── web/tokens.css              每個 token 一組 custom property
   └── android/type.xml            TextAppearance style
```

### token 分組（已實作）

`scripts/lib/tokens.js` 的 `GROUPS` 有這一筆:

```js
typography: { dtcgType: 'typography', figmaType: 'TEXT_STYLE' },
```

`figmaType` 特別標成 `TEXT_STYLE` —— 提醒它走的是另一條 API。

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
        "letterSpacing": "0px"
      }
    }
  }
}
```

### 各平台的產出形式

**三個平台都用系統字體（已確認）**，所以 `fontFamily` 不影響任何產出。它仍留在 `tokens/` 裡 —— 記錄設計端的現況，日後要載入品牌字體時才不用重查。

**iOS** —— `fontFamily` 不進 Swift。

```swift
public static let typographySMedium = Font.system(size: 14, weight: .medium)
```

**Web** —— 跟 iOS 一樣用**系統字體堆疊**（已確認）。複合值攤平成多個 custom property：

```css
/* Figma: PingFang TC — 刻意改用系統字體堆疊 */
--typography-s-medium-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", …, "PingFang TC", …;
--typography-s-medium-font-size: 14px;
--typography-s-medium-font-weight: 500;
--typography-s-medium-letter-spacing: 0px;
```

堆疊定義在 `scripts/build.js` 的 `WEB_FONT_STACK`。CJK fallback 排在西文之後 —— 拉丁字母用各平台系統字體，中文才落到 PingFang / Noto / 微軟正黑。

**Android** —— `TextAppearance` style，不是 dimen：

```xml
<style name="TextAppearance.SMedium">
  <item name="android:textSize">14sp</item>
  <item name="android:textFontWeight">500</item>
</style>
```

**刻意不輸出 `android:fontFamily`** —— 三個平台都用系統字體（已確認）。不寫這個 item 就會 fallback 到系統字體，正是要的結果。

## 把元件裡的字體對應到 token

因為 Code syntax 不適用，`get_design_context` 讀含文字的元件時，**回傳的是樣式名稱或原始數值**，不是 token 名稱。對應要在生成階段做：

1. 從回傳中找出字體資訊
   - 有樣式名（`s-medium`）→ 直接對應 `DesignTokens.typographySMedium`
   - 只有 `font-size: 14px; font-weight: 500` → 拿去比對 `tokens/typography.json`，找出符合的 token
2. **比對不到就是 magic number** —— 明確標示出來，不要自己編一個最接近的
3. 產出的程式碼引用 token，不要寫死數值

**比對不到時不要靜默處理。** 那代表設計師沒套樣式，是需要回報的發現，跟顏色沒綁變數是同一類問題。

## 已確認的決策

| 問題 | 答案 |
| --- | --- |
| 行高 | **不納入 token**（Figma 上全部是 AUTO，等同各平台預設） |
| iOS 用什麼字體 | **系統字體**（不載入 PingFang TC） |
| Web 用什麼字體 | **系統字體堆疊**（跟 iOS 一致） |
| Android 用什麼字體 | **系統字體**（`type.xml` 不輸出 `fontFamily`） |
| `s-regular` / `s-medium` | **兩個獨立的 token**，不是一個 token 的兩個變體 |

## 還沒確認的

- [ ] **品牌字體在三平台的實際名稱** —— iOS / Web 已改用系統字體所以不受影響，但要載入品牌字體時這件事會回來
- [ ] **多語言字體結構** —— 目前只有繁中一套，要支援日文 / 英文得重新設計 token 結構

## 一個實作上的坑

Style Dictionary 的 `css` transformGroup 有一個 **font shorthand transform**，會把複合物件壓成 `"500 26px/1 'PingFang TC'"` 這種字串。要攤平成個別 property 就取不到值了（全部變 `undefined`）。

所以字體在 Web 端**用獨立的 platform**（`cssTypography`），只跑 `attribute/cti` 與 `name/kebab`，不用 `css` transformGroup。

同理，`css` 與 `ts` 兩個 platform 掛了 `drop-typography` preprocessor —— `files[].filter` 只在輸出階段生效，transform 還是會跑到所有 token，那個 shorthand transform 會噴一個誤導的警告。

## 這份 skill 不涵蓋的

- **Figma 端的樣式治理**（誰能新增樣式、命名審核）—— 那是設計流程問題
- **多語言字體**（PingFang TC vs 日文 vs 英文）—— 目前只有一套，之後要支援需要重新設計 token 結構
