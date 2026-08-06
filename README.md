# design-system

Pinkoi design tokens。Figma 是真實來源,這個 repo 存放轉譯後的 token,並自動產出各平台可直接使用的檔案。

**目前範圍:只處理 Color(46 個)。** Spacing / Radius / Typography 之後再加。

## 流程

```
Figma variables
   │
   ├── sync:api    Variables REST API（需 Enterprise 權限,目前不通）
   └── sync:link   從 Figma 讀出的「名稱 → 色值」對照表
   │
tokens/color.json      ← SSOT（DTCG 格式,進版控,可手改）
   │  build
platform/
   ├── ios/DesignTokens.swift
   ├── web/tokens.css · tokens.js · tokens.d.ts
   └── android/colors.xml
```

## 目錄結構

```
design-system/
├── tokens/                     ← 【真實來源】改這裡
│   └── color.json                 DTCG 格式的色彩 token，進版控，可手改
│
├── platform/                   ← 【自動產出】不要手改
│   ├── ios/DesignTokens.swift     SwiftUI 常數
│   ├── web/tokens.css             CSS 變數
│   ├── web/tokens.js              JS 常數
│   ├── web/tokens.d.ts            TypeScript 型別宣告
│   └── android/colors.xml         Android 資源檔
│
├── scripts/                    ← 【程式】跑流程的東西
│   ├── build.js                   tokens/ → platform/，跑 Style Dictionary
│   ├── sync-from-link.js          貼上的 JSON → tokens/（合併，不需權限）
│   ├── sync-from-api.js           Figma API → tokens/（需 Enterprise 權限）
│   ├── style-dictionary.config.js 定義每個平台輸出什麼格式、到哪個資料夾
│   └── lib/tokens.js              共用邏輯：命名規則、hex 驗證、撞名偵測、讀寫 tokens/
│
├── .github/workflows/          ← 【CI】GitHub Actions
│   ├── build.yml                  每次 push/PR 驗證 platform/ 沒脫節
│   ├── sync-from-link.yml         手動貼 JSON 更新 token，開 PR
│   └── sync-from-api.yml          每週自動從 Figma API 同步（等權限）
│
├── package.json                ← npm 設定：相依套件、npm run 的指令清單
├── package-lock.json              鎖定套件版本，確保 CI 跟本機裝到一模一樣的東西
├── Package.swift               ← Swift Package Manager 設定，讓 iOS 能直接依賴這個 repo
├── .gitignore                     告訴 git 哪些檔案不要進版控
└── node_modules/                  npm 裝下來的套件（不進版控，跑 npm install 會重建）
```

**三個為什麼:**

- **`node_modules/` 為什麼不進版控** — 它是 `package.json` 的產物,幾萬個檔案、幾十 MB,而且跟作業系統有關。`package-lock.json` 已經精確記錄了每個套件的版本與雜湊值,任何人跑 `npm install` 都會得到一模一樣的結果。存原始碼、不存產物。
- **`platform/` 為什麼**要**進版控** — 它也是產物,照理該忽略。但 iOS 端是用 SPM 直接從 git 拉檔案,SPM **不會幫你跑 build**。產出不 commit,iOS 就拿不到東西。這是刻意的例外,所以才需要 CI 檢查它有沒有跟 `tokens/` 脫節。
- **`Package.swift` 和 `package.json` 為什麼在根目錄** — 不是我沒收好。SPM 和 npm 都規定設定檔必須在專案根目錄,移走就找不到了。

## 工程師怎麼用

**iOS(Swift Package Manager)** — 在 Xcode 加入 package 依賴,指向這個 repo:

```swift
import DesignTokens

Text("售價").foregroundColor(DesignTokens.colorPrimary060)
```

Figma 上的使用說明會帶進 Swift doc comment,Xcode 自動完成時看得到。

**Web(CSS 變數)**

```css
@import "@lianyehdesign/design-tokens/platform/web/tokens.css";

.price { color: var(--color-primary-060); }
```

**Web(JS / TS)**

```ts
import { ColorPrimary060 } from "@lianyehdesign/design-tokens";
```

**Android** — 把 `platform/android/colors.xml` 併入 `res/values/`。

## 規則

- **不要手動改 `platform/`。** 每次 build 會整個重新產生,手改會被蓋掉。
- `tokens/` **可以**手改 —— 它就是 SSOT。改完務必跑 `npm run build`,否則 CI 會擋。
- `platform/` 有進版控(不在 .gitignore 裡)。SPM 直接從 git 拉檔案、不會幫你 build,所以產出必須 commit。

## 設計師改了顏色,怎麼更新?

**現在(沒有 API 權限):用 Sync tokens from Figma (link)**

讀取 Figma 這一步沒辦法在 CI 裡做 —— runner 上沒有 Figma、也沒有選取狀態。所以拆成:讀取在本機、轉檔在 CI。

1. 在 Figma 桌面版**選取色票 frame**
2. 用 Figma MCP(叫 AI 讀)或 Dev Mode,取得「變數名稱 → 色值」的 JSON:
   ```json
   {"Color/Primary/060":"#003354","Color/Neutral/000":"#ffffff"}
   ```
3. GitHub → Actions → **Sync tokens from Figma (link)** → Run workflow,把 JSON 貼進 `variables` 欄位
4. Workflow 轉檔、產出各平台檔案、**開一個 PR** 給你 review

**預設是合併,不刪除。** 因為這種讀取通常只涵蓋畫面上選到的部分,不是完整清單 —— 直接覆蓋會讓沒選到的 token 靜默消失,下游 app 就編不過了。確定是完整清單時再勾 `replace`。

既有的 `$description` 會保留。`get_variable_defs` 不回傳 description,但那些使用說明是人工整理過的資產,不該被一次讀取蓋掉。

**未來(拿到 API 權限後):用 Sync tokens from Figma (API)**

設好 secret 後就會每週一自動跑,也可以手動觸發。API 回傳的是完整清單,所以那條路徑預設就是整份重建(含刪除),而且 description 直接從 API 帶。

## 本機開發

```bash
npm install
npm run build                              # tokens/ → platform/
npm run sync:link -- payload.json          # 合併更新（預設）
npm run sync:link -- payload.json --replace  # 整份重建
```

拿到 API 權限後:

```bash
FIGMA_TOKEN=xxx FIGMA_FILE_KEY=xxx npm run sync:api
```

## CI

| Workflow | 觸發 | 需要 secret | 現在能跑 |
| --- | --- | --- | --- |
| **Build tokens** | push / PR / 手動 | ✗ | ✅ |
| **Sync tokens from Figma (link)** | 手動(貼 JSON) | ✗ | ✅ |
| **Sync tokens from Figma (API)** | 每週一 + 手動 | ✓ | ❌ 等權限 |

手動觸發的「Run workflow」按鈕**只會出現在預設分支(main)的 Actions 頁面上** —— 這是 GitHub 的行為,不是設定問題。

`Build tokens` 會檢查 `platform/` 有沒有跟 `tokens/` 脫節。`Sync tokens from Figma (API)` 在沒設 secret 時會在第一步就擋下來並說明原因。

需要的 secret:

| Secret | 說明 |
| --- | --- |
| `FIGMA_TOKEN` | Figma personal access token,需含 `file_variables:read` scope |
| `FIGMA_FILE_KEY` | `1TcgPhqHmLeZhPpv7LaCGO` |

## 保護機制

三個都是直接讓流程失敗,而不是靜默降級:

- **撞名偵測** — Figma 上有兩套平行的 Foundation library,`Color/Primary/010` 與 `Color/primary/010` 只差大小寫,正規化後路徑相同。沒有這個檢查,後寫入的會靜默蓋掉先寫入的。
- **hex 驗證** — sync 與 build 都會驗。`tokens/` 可以手改,錯字必須壞在 CI,不能流進 `platform/` 再流到 app。
- **`platform/` 同步檢查** — iOS 是用 SPM 直接拉 `platform/` 裡的檔案,那些檔案跟 `tokens/` 脫節就是線上錯了。

## 已知待處理

- **`Color/Gray/090` 疑似舊命名殘留。** 值 (`#66666a`) 與 `Color/Neutral/090` 完全相同。同系列的 `Color/Gray/080` 已由設計師改為 `Color/Neutral/080`,`Gray/090` 可能是同一批遺留,值得一併確認。

- **Figma 端有兩套平行的 Foundation library。SSOT 取 `[Design System] Foundation`。**

  | Library | Collection | 命名風格 | 採用 |
  | --- | --- | --- | --- |
  | `[Design System] Foundation` | `Generic` | `Color/Primary/060`(有 description) | ✅ |
  | `[Pinzap Design System] Foundation` | `Generic Token` | `Color/primary/010`(無 description) | ✗ |

- 色票 frame 上混著非 token 的項目(字型樣式、別的 UI kit 的灰階、`White` 等),白名單只放行 `Color/` 開頭的,會列在 log 裡。

- 別名變數(variable alias)目前不展開,API 路徑會列在 log 裡並略過。
