---
name: antigravity-cli-status-bar
description: 設定 Antigravity CLI 狀態列（Status Bar）的顯示項目與語系設定。當使用者要求「設定狀態列」、「調整 CLI 頁尾」或啟動此技能時使用。
---

# Antigravity 狀態列設定技能

本技能提供有關 Antigravity CLI 狀態列（Status Bar / Footer）的客製化與語系設定指引，適用於多平台與開源分享。

## 🎯 設定檔路徑規範（動態解析）

為確保取得最新資料與正確寫入，每次執行本技能時，AI 代理（Agent）**必須先動態解析以下路徑並進行讀取（View File）**，嚴禁使用寫死的絕對路徑：

1.  **全域設定檔（Global Settings）**：
    *   路徑語法：`~/.gemini/settings.json`
    *   *AI 執行規範*：請動態獲取當前作業系統的家目錄（環境變數 `$HOME` 或 `USERPROFILE`），並將其展開為當前使用者的絕對路徑後進行讀取。
2.  **CLI 專屬設定檔（CLI-Specific Settings，最高優先級）**：
    *   路徑語法：`~/.gemini/antigravity-cli/settings.json`
    *   *AI 執行規範*：此檔案由 Antigravity CLI（`agy`）自身維護，其優先級**高於**全域設定檔。AI 代理**必須**在 Pre-check 階段讀取此檔案，確認其中是否存在空的 `statusLine` 物件，若存在則需在步驟 5 中同步覆寫為正確的設定。
3.  **專案設定檔（Project Settings）**：
    *   路徑語法：當前工作區根目錄下的 `.gemini/settings.json`
    *   *AI 執行規範*：請動態獲取目前作用中工作區（Workspace）的根目錄絕對路徑，並讀取該目錄下相對路徑 of `.gemini/settings.json`（若專案設定檔存在）。

自訂語系偏好將記錄於設定檔的 `ui.language` 屬性中。

---

## 🛠️ 狀態列 Hook 技術實作規範（核心標準）

為確保狀態列在任何極端環境下都能維持極致效能與穩定美觀，AI 代理在建立或修改 `statusline-quota.mjs` 與背景快取更新程序 `fetch-local-quota.mjs` 時，**必須嚴格遵守以下開發標準**：

1.  **純 Node.js 跨平台實作**：
    *   全面廢棄依賴 Python (`ps`, `lsof`) 的作法。
    *   在 Windows 必須使用 `wmic` + `netstat -ano`，在 macOS/Linux 必須使用 `ps auxww` + `lsof`。
    *   所有 `fs.writeFileSync` 呼叫都必須明確帶上 `{ encoding: 'utf8' }`，防止在 Windows 環境下生成 UTF-16 導致 CLI 崩潰。
2.  **智慧型多行換行（Smart Line Wrapping by Feature）**：
    *   讀取 `meta.terminal_width` 或 `process.stdout.columns` 來得知終端機寬度。
    *   組合狀態列字串時，如果下一個加入的「指標」（例如：`API 額度: 94.9%`）會讓目前的整行長度（不含 ANSI 碼）超過終端機寬度，就必須將該指標與後續指標折疊到新的一行（即插入 `\n`）。
3.  **四階段精確色彩辨識（4-Tier ANSI Colors）**：
    *   針對百分比設計顏色：`100~75%` = 綠色、`74~50%` = 黃色、`49~25%` = 橘色、`24~0%` = 紅色。

---

## 🔄 執行步驟指南

### 步驟 1：取得最新資料（Pre-check）
在向使用者提問前，**必須動態展開並讀取上述三個設定檔**（全域、CLI 專屬、專案）。檢查目前 `ui.footer.items` 啟用了哪些項目、`ui.language` 設定，以及各設定檔中是否存在空的 `statusLine` 物件。

### 步驟 2：第一階段問卷（選擇語系）
呼叫 `ask_question` 工具並傳送以下問卷，收集使用者的語言偏好（由於 Antigravity CLI 原生支援以 `/statusline` 切換啟用或關閉狀態列，因此無需提供冗長的還原選單，最大化簡化問答流程）：

```json
{
  "questions": [
    {
      "question": "選擇顯示語系 / Select Display Language / 表示言語の選択",
      "is_multi_select": false,
      "options": [
        "繁體中文 (zh-tw)",
        "English (us)",
        "日本語 (jp)"
      ]
    }
  ]
}
```

### 步驟 3：流程控制
*   根據第一階段所選取的語言代碼（如 `zh-tw`, `us`, `jp`），動態決定第二階段問卷的顯示語系，並直接進入步驟 4。

### 步驟 4：第二階段問卷（動態語系細部設定）
請**根據階段一所選取的語言**，動態組合出以下對應語系的問卷內容，並呼叫 `ask_question` 發送。
由於 `ask_question` 的 `options` 僅支援字串陣列（不支援 `label` / `description` 物件），為同時提供直觀的語言翻譯與系統識別碼，我們統一採用 `「說明文字 (識別碼)」` 格式。

*   若為 `zh-tw`，請使用中文說明配上英文識別碼。
*   若為 `us`，請使用英文說明配上英文識別碼。
*   若為 `jp`，請使用日文說明配上英文識別碼。

由於 CLI 狀態列支援「多行智慧折行」且容納指標無上限，**嚴禁將指標拆分為多個問題發送**。必須將所有指標合併至單一多選問題中，以求極致直觀的 UX 體驗。

以下為 `zh-tw` 的問卷 JSON 結構範例：

```json
{
  "questions": [
    {
      "question": "選擇啟用的狀態列指標",
      "is_multi_select": true,
      "options": [
        "目前使用的 AI 模型名稱 (model-name)",
        "帳號真實剩餘額度 (quota)",
        "目前對話已消耗的 Context 比例 (context-used)",
        "CLI 行程所消耗的 RAM 記憶體量 (memory-usage)",
        "目前 Session 消耗的精確 Token 數量 (token-count)",
        "額度重製時間倒數 (quota-reset-countdown)",
        "目前工作區專案的 Git 分支 (git-branch)",
        "目前工作區專案短路徑 (project-path)",
        "目前工作區專案完整路徑 (project-full-path)"
      ]
    }
  ]
}
```

### 步驟 5：設定檔資料合併與寫入
*   確定「語言代碼」：採用第一階段問卷的選擇結果。
*   收集要啟用的項目列表：直接解析第二階段問題中所勾選的項目陣列。
*   在解析使用者的回答時，使用正則表達式 `/\(([^)]+)\)$/` 從選項字串（例如 `"目前使用的 AI 模型名稱 (model-name)"`）中提取出英文識別碼（例如 `"model-name"`）。
*   將 `ui.language` 與解析出的 `ui.footer.items` 寫入動態解析出的全域與專案設定檔中。
*   **【關鍵狀態列註冊（多層設定檔同步寫入）】**：Antigravity CLI 存在**多個層級的設定檔**，且高優先級的設定檔會覆蓋低優先級的設定。若只寫入其中一層，可能會被另一層的空設定靜默覆蓋而導致 Hook 完全失效。
    AI 代理**必須同時在以下所有設定檔中寫入**（或確保存在）正確的 `statusLine` 物件：
    1.  **全域設定檔**：`~/.gemini/settings.json`
    2.  **CLI 專屬設定檔（最高優先級）**：`~/.gemini/antigravity-cli/settings.json`
        > [!CAUTION]
        > 這是最容易被忽略的致命盲點！Antigravity CLI（`agy`）**優先讀取此檔案**。若此檔案中存在 `statusLine` 物件且 `command` 為空字串，將會完全覆蓋全域設定檔中的正確設定，導致狀態列無聲無息地失效。AI 代理**必須**在此檔案中也寫入完整的 `statusLine` 設定。
    3.  **專案設定檔**（若存在）：當前工作區根目錄下的 `.gemini/settings.json`

    AI 代理應在執行時動態獲取當前使用者的家目錄絕對路徑，並直接將**絕對路徑**寫入 `command` 中，避免 CLI 在背景執行 Hook 時因無法展開 Shell 環境變數（如 `$HOME`）而導致路徑解析失敗：
    *   在 **macOS / Linux** 系統下，寫入：
        ```json
        "statusLine": {
          "enabled": true,
          "type": "command",
          "command": "node /Users/[動態解析的使用者名稱]/.gemini/hooks/statusline-quota.mjs"
        }
        ```
    *   在 **Windows** 系統下，寫入（務必以 `{ encoding: 'utf8' }` 寫入設定檔）：
        ```json
        "statusLine": {
          "enabled": true,
          "type": "command",
          "command": "node C:\\Users\\[動態解析的使用者名稱]\\.gemini\\hooks\\statusline-quota.mjs"
        }
        ```

*   **【安全性信任機制註冊（防呆機制）】**：為防止 CLI 的安全性（Security）機制因 Hook 未受信任而將其靜默阻擋，AI 代理**必須**動態讀取並更新全域的 `~/.gemini/trusted_hooks.json` 檔案。
    請在當前專案工作區目錄絕對路徑、使用者家目錄絕對路徑，以及萬用字元鍵 `"*"` 的陣列中，同步寫入或追加（Append）對應的信任規則。
    具體而言，對應路徑的陣列中必須確保包含以下信任標記：
    *   `"statusLine:node [當前使用者家目錄絕對路徑]/.gemini/hooks/statusline-quota.mjs"`

*   完成寫入後，繼續執行**步驟 6（自動部署跨平台 Hook）**。

### 步驟 6：自動部署 Hook 腳本原始碼（開源通用閉環）

> [!IMPORTANT]
> AI 代理必須動態展開家目錄絕對路徑（如 `join(os.homedir(), '.gemini', 'hooks', ...)`），將以下兩份程式碼寫入對應路徑，且寫入時**務必設定 `{ encoding: 'utf8' }`**。

#### 📂 建立/覆蓋背景快取更新腳本：`~/.gemini/hooks/fetch-local-quota.mjs`
請直接讀取本技能目錄（`__dirname`）下的 `scripts/fetch-local-quota.mjs`，並將其內容寫入。

#### 📂 建立/覆蓋 Hook 主腳本：`~/.gemini/hooks/statusline-quota.mjs`
請直接讀取本技能目錄（`__dirname`）下的 `scripts/statusline-quota.mjs`，並將其內容寫入。

### 步驟 7：回報與重新載入提示
完成檔案編輯與自動 Hook 腳本部署後，回報成功訊息。**AI 代理必須嚴格遵守：根據使用者在第一階段所選擇的語系（zh-tw / us / jp）來撰寫最終的回覆訊息**（例如，若使用者選擇日本語 jp，請務必全程使用流利的日文回覆）。請在回覆中告知使用者：「狀態列設定支援熱更新（Hot Reload），設定已自動在 CLI 底部即時生效，無需重新啟動。」

---

## 🔌 Dependencies (依賴環境)

本技能在運作與執行時，依賴以下本機系統環境：
*   **Node.js**: Hook 腳本採用純 Node.js (`.mjs` 模組）實作。執行環境中必須能使用 `node` 指令。
*   **作業系統**: 支援 macOS / Linux / Windows 雙平台與跨平台環境。

---

## 🚀 Quick Start (快速啟用)

要在新裝置或當前工作區中啟用此技能並設定彩色狀態列，AI 代理只需引導使用者執行：
1. 在聊天框中輸入：`/antigravity-status-bar`
2. 在彈出的問卷第一階段選取顯示語系（例如 `zh-tw`）。
3. 在第二階段勾選要啟用的狀態列指標。
4. 代理會全自動註冊與部署 Hook，部署完成後狀態列會即時熱更新見效，無需重開 CLI！
5. 在 CLI 執行期間，使用者可隨時執行 `/statusline` 來即時切換開啟或關閉自訂狀態列。

---

## ⚠️ Common Mistakes (常見錯誤與避坑指南)

當 AI 代理執行此技能時，必須時刻檢視並防範以下 4 個極具破壞性的常見錯誤，以保證極致的健壯性：

### 1. 遺漏全域設定檔中的 `statusLine` Hook 註冊
*   ❌ **錯誤行為**：僅在 `settings.json` 中配置 `ui.footer` 設定，卻忘了在根節點下寫入 `"statusLine"` 物件。這會導致在全新/乾淨的電腦上，CLI 根本不會去載入 Hook，自訂狀態列也完全不會顯現。
*   👉 **修正做法**：必須確保在寫入 `settings.json` 時，同步寫入包含 `"enabled": true`、`"type": "command"` 的 `"statusLine"` 物件，並指向正確的 Hook 腳本路徑。

### 2. 環境變數展開失敗與安全匹配失效（跨電腦移植與執行衝突）
*   ❌ **錯誤行為**：
    *   在 `settings.json` 的 `command` 中僅寫入動態環境變數（例如 `node $HOME/.gemini/...`），但 CLI 在背景以直接呼叫方式執行 Hook 時，**無法透過 Shell 展開環境變數**，導致 Node.js 因找不到路徑而執行失敗。
    *   或者，`settings.json` 中使用了動態環境變數，但 `trusted_hooks.json` 僅信任了絕對路徑，導致安全比對字串不匹配而被系統靜默阻擋。
*   👉 **修正做法（雙保險設計）**：
    *   **寫入 `settings.json` 時**：AI 代理應在執行時動態獲取當前使用者的家目錄絕對路徑，並直接將**絕對路徑**寫入 `command` 中（例如 `node /Users/username/.gemini/...`），這能 100% 確保在本機上執行成功，免去 Shell 展開的依賴。
    *   **寫入 `trusted_hooks.json` 時**：為了同時相容於絕對路徑與未來的動態移植，AI 代理**必須同時追加註冊**絕對路徑指令與環境變數指令（如 `$HOME` 或 `%USERPROFILE%`）的信任規則，以完美通過 CLI 的安全性（Security）檢驗。
    *   **跨電腦移植時**：由於開源分享或複製設定檔到新電腦時絕對路徑會改變，新電腦的 AI 代理在首次執行本技能時，會全自動動態重新解析新電腦的絕對路徑並覆寫更新設定，因此直接寫入絕對路徑是最健壯且無副作用的方案。

### 3. 在 Windows 平台上寫入腳本時遺漏 UTF-8 強制編碼
*   ❌ **錯誤行為**：在 Windows 平台上呼叫 `writeFileSync` 覆寫 Hook 主腳本或快取程式時，沒有指定 `{ encoding: 'utf8' }`。這會使 Windows 預設使用 UTF-16 編碼寫入檔案，導致 agy CLI 啟動時發生解析錯誤並直接崩潰。
*   👉 **修正做法**：每一次進行 `fs.writeFileSync` 或 `fs.writeFile` 寫入時，**必須且強制指定 `{ encoding: 'utf8' }`** 以達成跨平台最高規格防呆。

### 4. 遺漏 CLI 專屬設定檔（`~/.gemini/antigravity-cli/settings.json`）的同步寫入
*   ❌ **錯誤行為**：僅將 `statusLine` 寫入全域設定檔 `~/.gemini/settings.json`，卻忽略了 Antigravity CLI 自身維護的另一份 **CLI 專屬設定檔** `~/.gemini/antigravity-cli/settings.json`。該檔案的優先級**高於**全域設定檔，若其中已存在一個 `statusLine` 物件且 `command` 為空字串（例如 `{ "type": "", "command": "", "enabled": true }`），全域設定檔中正確的 Hook 設定會被完全覆蓋，導致狀態列**無聲無息地徹底失效**，且沒有任何錯誤訊息或日誌輸出，極難排查。
*   👉 **修正做法**：AI 代理在執行步驟 5 時，**必須同時讀取並更新** `~/.gemini/antigravity-cli/settings.json`。若該檔案存在，將正確的 `statusLine` 物件合併寫入；若不存在則跳過。這是本技能中**最致命且最隱蔽的 Bug**，務必嚴格執行。

### 5. AI Agent 憑空捏造或竄改 Hook 原始碼（Hallucination）
*   ❌ **錯誤行為**：AI Agent 接收到部署狀態列的指令時，沒有讀取 `scripts/` 目錄下的標準程式碼檔案，而是直接呼叫 `write_to_file` 或其他工具，將自己「想像」或「重寫」的錯誤程式碼直接寫入 `~/.gemini/hooks/statusline-quota.mjs`。這會導致狀態列功能殘缺、指標抓取失敗（例如抓不到 Token 變成 `--`）、甚至導致 CLI 崩潰！
*   👉 **修正做法（絕對禁令）**：AI 代理**絕對禁止**自行發明、撰寫、或修改 `statusline-quota.mjs` 與 `fetch-local-quota.mjs` 的底層程式碼結構來部署！部署時，**必須 100% 準確地讀取本技能目錄下 `scripts/` 資料夾中的對應腳本檔案**，並原封不動地寫入到使用者的 `hooks` 目錄中。若要更新狀態列邏輯，必須先更新對應的 `scripts/*.mjs` 腳本檔案內容，再進行部署，嚴禁憑空發明或竄改邏輯！
