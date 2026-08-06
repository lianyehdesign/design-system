# Design Tokens → GitHub(Figma plugin)

在 Figma 裡按一下,把色彩變數送去觸發 repo 的同步 workflow。

```
在 Figma 按一下
   ↓ Plugin API 讀本地變數（含 description，無方案限制）
   ↓ POST GitHub workflow_dispatch
sync-from-link.yml  ← 跟手動貼 JSON 走的是同一個 workflow
   ↓ 轉檔 → build → 開 PR
```

## 為什麼只觸發 workflow,不自己 commit

plugin 可以自己做完整套 git 操作(建 blob → tree → commit → ref → PR),但那樣有三個壞處:

1. **轉換邏輯會跑進 plugin 裡** —— 改一次規則就要重新發佈 plugin,而且那段程式碼不在版控裡、沒人 review。
2. **token 權限要大很多** —— 需要 `contents:write` + `pull_requests:write`。現在只要 `actions:write`,**即使 token 外洩也只能觸發 workflow,不能推程式碼進 repo**。
3. **會變成兩套邏輯** —— 手動貼 JSON 那條路徑得自己維護一份。

現在 plugin 只是個薄薄的觸發器,送出的 payload 跟你手動貼的完全一樣。

## 安裝

### 1. 建立 GitHub token

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token

| 設定 | 值 |
| --- | --- |
| Repository access | Only select repositories → **`design-system`** |
| Permissions → Actions | **Read and write** |

其他權限一個都不要給。這個 token 唯一能做的事就是觸發這個 repo 的 workflow。

> 設定過期時間。到期後 plugin 會回 401,重新產生一個貼進去即可。

### 2. 載入 plugin

Figma 桌面版 → 選單 → Plugins → Development → **Import plugin from manifest…** → 選這個資料夾裡的 `manifest.json`。

不用上架 Figma 社群。

### 3. 第一次執行

**必須在 Foundation 檔案裡執行**(`[Design System] Foundation`)。

把 token 貼進第一個欄位,其餘欄位已經預設好了:

| 欄位 | 預設 |
| --- | --- |
| Owner | `lianyehdesign` |
| Repo | `design-system` |
| Workflow | `sync-from-link.yml` |
| Branch | `main` |

按「讀取變數並觸發同步」。成功後設定會存在 Figma 本機(`figma.clientStorage`),下次不用再填。

## 整份重建的勾選框

plugin 讀的是**這個檔案所有的本地變數**,所以它拿到的是完整清單 —— 這跟手動讀取(只涵蓋選到的 frame)不一樣。

因此勾「整份重建」在這裡是合理的:Figma 上刪掉的變數,`tokens/` 也該跟著刪。**預設仍然不勾**,因為刪除是不可逆的,值得每次明確決定一次。

## 兩個按鈕

**讀取變數並觸發同步** — 完整流程,直接開 PR。

**只讀取,複製 JSON** — 只把 JSON 複製到剪貼簿,不碰 GitHub。用途:

- 還沒設定 token 時先試一下讀得對不對
- plugin 觸發失敗時的 fallback(貼進 workflow 的 `variables` 欄位)

## 限制

- **只讀當前檔案的本地變數。** 在引用 library 的檔案裡跑會讀不到東西 —— 那些是 remote 變數。plugin 會直接告訴你這件事,不會靜默回傳空的。
- **只取預設 mode。** 目前沒有 light/dark 多主題,要支援得改 `code.js` 的 `resolveColor`。
- **只送 `Color/` 開頭的變數。** 跟 repo 端的白名單一致,`ColorSystem/` 這種舊命名會被擋掉。
- **payload 上限約 64KB。** 這是 `workflow_dispatch` 的輸入限制。目前 46 個 color token 約 2KB,離上限很遠,但加了 typography 之後要留意。plugin 會先擋下來並給明確訊息,不會變成 GitHub 那邊語意不明的 422。

## 這個 plugin 比其他讀取方式多做的一件事

**它會展開別名變數(variable alias)。** REST API 那條和 MCP 讀取都只能把別名記下來然後略過,plugin 可以一路追到真正的色值。

也因此 description 不用再人工維護 —— Plugin API 讀得到,`sync-from-link.js` 會以來源帶回的為準。
