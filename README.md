# design-system

Pinkoi design tokens。唯一真實來源是 Figma variables,經過三段互相獨立的流程產出各平台可直接使用的檔案。

**目前範圍:只處理 Color。** Spacing / Radius / Typography 之後再加。

## 架構:三段分離

```
① INGEST（可替換的來源）        ② NORMALIZE           ③ BUILD
┌────────────────────────┐
│ scripts/ingest-        │
│   figma-api.js         │ REST API（需 Enterprise）
│                        │
│ Figma MCP + AI 讀取     │ ──→ snapshots/*.json ──→ tokens/*.json ──→ dist/
│                        │      原始快照,進版控      DTCG,SSOT       平台產出
│ 手動編輯 snapshot        │
└────────────────────────┘
```

三段之間的介面是**磁碟上的檔案,不是函式呼叫**。所以每一段都能單獨跑、單獨測、單獨換掉 —— 之後接上 Figma API 時,只是多一支寫 `snapshots/` 的程式,②③ 一行都不用改。

各段的職責邊界:

| 階段 | 唯一知道的事 | 產出 |
| --- | --- | --- |
| ① Ingest | Figma 長什麼樣(API 格式、MCP 回傳格式) | `snapshots/*.json` |
| ② Normalize | 命名規則與 DTCG 語意(白名單、路徑正規化、撞名偵測) | `tokens/*.json` |
| ③ Build | 平台長什麼樣(Swift / CSS / XML) | `dist/**` |

**為什麼 `snapshots/` 要進版控:** 這樣 PR diff 分得出「設計師改了色值」和「我們改了轉換邏輯」。只存 `tokens/` 的話,看到色值變了無法判斷是哪一種 —— 而這兩種需要完全不同的 review。

## 工程師怎麼用

**iOS(Swift Package Manager)** — 在 Xcode 加入 package 依賴,指向這個 repo:

```swift
import DesignTokens

Text("售價")
    .foregroundColor(DesignTokens.colorPrimary060)
```

Figma 上的使用說明會帶進 Swift doc comment,Xcode 自動完成時看得到。

**Web(CSS 變數)**

```css
@import "@lianyehdesign/design-tokens/dist/web/tokens.css";

.price { color: var(--color-primary-060); }
```

**Web(JS / TS)**

```ts
import { ColorPrimary060 } from "@lianyehdesign/design-tokens";
```

**Android** — 把 `dist/android/colors.xml` 併入 `res/values/`。

## 規則

- **不要手動改 `tokens/` 與 `dist/`。** 每次跑都會整個重新產生,手改會被蓋掉。
- 要改色值請改 Figma,再重跑 ingest。
- `dist/` 有進版控(不在 .gitignore 裡)。SPM 是直接從 git 拉檔案、不會幫你 build,所以產出必須 commit。

## Snapshot 格式

```json
{
  "$meta": {
    "source": "figma-mcp",
    "library": "[Design System] Foundation",
    "fileKey": "...",
    "nodeId": "2615:3116",
    "capturedAt": "2026-08-06"
  },
  "variables": {
    "Color/Primary/060": {
      "value": "#003354",
      "description": "選填。會帶進 Swift doc comment 與 CSS 註解"
    },
    "Color/Neutral/080": { "value": null }
  }
}
```

`value` 為 `null` 代表**名稱已知但值還沒取得** —— 不會產出,但每次 normalize 都會列出來,不會被遺忘。

## 本機開發

```bash
npm install
npm run all        # normalize + build
```

拿到 Figma API 權限後:

```bash
FIGMA_TOKEN=xxx FIGMA_FILE_KEY=xxx npm run ingest:api && npm run all
```

## CI

| Workflow | 觸發 | 需要 secret |
| --- | --- | --- |
| `build.yml` | push / PR / **手動** | ✗ — 只跑 ②③,不碰網路 |
| `sync-tokens.yml` | 每週一 + 手動 | ✓ `FIGMA_TOKEN`、`FIGMA_FILE_KEY` |

手動觸發的「Run workflow」按鈕**只會出現在預設分支(main)的 Actions 頁面上** —— 這是 GitHub 的行為,不是設定問題。所以 workflow 必須先合進 main 才戳得到。

`sync-tokens.yml` 在沒設 secret 時會**在第一步就擋下來並給出說明**,不會壞在看不懂的地方。

`build.yml` 還會檢查 `tokens/` 與 `dist/` 有沒有跟 `snapshots/` 脫節。

`sync-tokens.yml` 需要的 secret:

| Secret | 說明 |
| --- | --- |
| `FIGMA_TOKEN` | Figma personal access token,需含 `file_variables:read` scope |
| `FIGMA_FILE_KEY` | `1TcgPhqHmLeZhPpv7LaCGO` |

## 已知待處理

- **`Color/Neutral/080` 有名稱、有 description(「用於元件的外框深色」),但色票 frame 上沒有它。** 值目前是 `null`。需要確認是被移除了還是漏放在色票上。

- **`Color/Gray/080` 和 `Color/Gray/090` 疑似舊命名殘留。** `Color/Gray/090` (`#66666a`) 與 `Color/Neutral/090` 值完全相同。而 `Color/Gray/080` (`#7c7c80`) 剛好落在 `Neutral/070` (`#929295`) 與 `Neutral/090` (`#66666a`) 之間 —— 有可能它就是缺席的 `Neutral/080`,但這是推測,要跟設計師確認。目前兩個都照樣產出。

- **Figma 端有兩套平行的 Foundation library。SSOT 取 `[Design System] Foundation`。**

  | Library | Collection | 命名風格 | 採用 |
  | --- | --- | --- | --- |
  | `[Design System] Foundation` | `Generic` | `Color/Primary/060`(有 description) | ✅ |
  | `[Pinzap Design System] Foundation` | `Generic Token` | `Color/primary/010`(無 description) | ✗ |

  兩邊有大量同名變數,**只差大小寫**。正規化後路徑會相同,所以 `scripts/lib/tokens.js` 的 `createCollector()` 會偵測撞名並讓 build 失敗,而不是靜默覆蓋。

- 舊的 `ColorSystem/` 命名(例如 `ColorSystem/Neutral 060`)不在 `Color/` 群組內,會被白名單擋掉。

- 別名變數(variable alias)目前不展開,ingest 時值會記為 `null` 並列在 log 裡。
