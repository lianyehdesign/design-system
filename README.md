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
├── figma-plugin/               ← 【Figma plugin】在 Figma 按一下就觸發同步
│   ├── manifest.json              plugin 設定
│   ├── code.js                    讀變數（主執行緒，無網路）
│   ├── ui.html                    設定畫面 + 呼叫 GitHub（iframe，有網路）
│   └── README.md                  安裝步驟與 token 權限設定
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

讀取 Figma 這一步沒辦法在 CI 裡做 —— runner 上沒有 Figma、也沒有選取狀態。所以讀取一定在本機,轉檔在 CI。有兩種讀法,**送出的東西完全一樣、走同一個 workflow**。

### 方式一:Figma plugin(推薦)

在 Foundation 檔案裡按一下 `figma-plugin/`,直接觸發同步。安裝見 [figma-plugin/README.md](figma-plugin/README.md)。

比手動路徑多兩個好處:**帶得回 description**(不用再人工維護),而且**會展開別名變數**。

### 方式二:手動貼 JSON(fallback)

1. 在 Figma 桌面版**選取色票 frame**
2. 用 Figma MCP(叫 AI 讀)或 Dev Mode,取得「變數名稱 → 色值」的 JSON:
   ```json
   {"Color/Primary/060":"#003354","Color/Neutral/000":"#ffffff"}
   ```
3. GitHub → Actions → **Sync tokens from Figma (link)** → Run workflow,把 JSON 貼進 `variables` 欄位
4. Workflow 轉檔、產出各平台檔案、**開一個 PR** 給你 review

`variables` 兩種格式都接受:

```json
"Color/Primary/060": "#003354"
"Color/Primary/060": { "value": "#003354", "description": "商品卡售價用色" }
```

**預設是合併,不刪除。** 因為這種讀取通常只涵蓋畫面上選到的部分,不是完整清單 —— 直接覆蓋會讓沒選到的 token 靜默消失,下游 app 就編不過了。確定是完整清單時再勾 `replace`。

**description 的優先順序:來源帶了就用來源的,沒帶才沿用既有的。** plugin 讀得到 description,以 Figma 為準;MCP / Dev Mode 讀不到,就保留人工整理過的內容不被清掉。

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
| **Sync tokens from Figma (API)** | 手動 | ✓ | ❌ 需 Enterprise |

手動觸發的「Run workflow」按鈕**只會出現在預設分支(main)的 Actions 頁面上** —— 這是 GitHub 的行為,不是設定問題。

`Build tokens` 會檢查 `platform/` 有沒有跟 `tokens/` 脫節。

API 那條**刻意沒有設排程** —— 在方案升級之前,排程只會每週一失敗一次、寄一封失敗通知,除了製造雜訊沒有作用。

需要的 secret:

| Secret | 說明 |
| --- | --- |
| `FIGMA_TOKEN` | Figma personal access token,**必須含 `file_variables:read` scope** |
| `FIGMA_FILE_KEY` | `1TcgPhqHmLeZhPpv7LaCGO`(網址 `/design/<這段>/` 的值) |

### ⚠️ 目前這條路走不通

**2026-08-06 確認:Pinkoi 的 Figma 方案是 Professional,Variables REST API 是 Enterprise 限定。**

建立 personal access token 時,Scopes 清單裡**沒有這個選項**。能勾的只有:

```
current_user:read
file_comments:read / file_comments:write / file_content:read
file_metadata:read / file_versions:read
library_assets:read / library_content:read / team_library_content:read
file_dev_resources:read / file_dev_resources:write
projects:read / webhooks:read / webhooks:write
```

全部勾滿再打 Variables API,回:

```
403 Invalid scope(s): file_content:read, file_metadata:read, ...
This endpoint requires the file_variables:read scope
```

**這不是漏勾。這個 scope 只對 Enterprise 開放,Professional 差了兩個層級。**

容易搞混的一點:**Full seat 是「席次類型」(你能不能編輯),跟「方案層級」
(組織買了哪一層)是兩回事。** 升到 Full seat 不會讓這個 scope 出現。

所以 `sync-from-api.yml` 目前是**備而不用**的狀態 —— 程式寫好了,方案到位就能跑。

### 不需要 Enterprise 的替代方案

1. **`sync:link`(目前採用)** — 手動讀取 Figma 後貼 JSON,見上面「設計師改了顏色,怎麼更新?」
2. **寫一個 Figma plugin** — Plugin API 的 `figma.variables.getLocalVariablesAsync()`
   **沒有方案限制**,讀得到本地變數的值與 description。做成按一下就推 GitHub PR,
   自動化程度接近 REST API 那條,但不用升級方案。Tokens Studio 走的就是這條路。

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
