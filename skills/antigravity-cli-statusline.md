---
name: antigravity-cli-statusline
description: 本技能用於設定 Antigravity CLI（agy）的狀態列（Statusline / Footer）顯示指標、顯示順序與多語系介面（繁體中文 zh-tw / English us / 日本語 jp），並自動部署跨平台 Node.js Hook 腳本（statusline-quota.mjs、fetch-local-quota.mjs）至 ~/.gemini/antigravity-cli/hooks/，同步註冊三層 settings.json（全域、CLI 專屬、專案）與 trusted_hooks.json 信任機制。適用情境：使用者要求設定 / 客製化 / 啟用 CLI 狀態列、調整 CLI 頁尾顯示項目、顯示 API 額度 / Token 用量 / Context 消耗 / Git 分支 / 工作區是否乾淨（dirty）/ VCS 類型 / AI 模型名稱 / 代理狀態（agent state）/ 等你回應的工具確認對話框 / 輸入佇列 / 背景任務 / 子代理數 / 工件（artifacts）/ 沙盒模式 / CLI 版本 / 對話 ID / 使用中代理（agent profile）/ RAM 記憶體用量 / 訂閱方案等指標於 CLI 底部、切換狀態列語言、在新電腦上啟用此狀態列，或使用者主動以 /antigravity-cli-statusline 觸發本技能時。支援 macOS、Linux、Windows（含 Windows 10 / 11）跨平台環境，並於 Windows 上自動處理 sh.exe 缺失、UTF-8 BOM 污染、wmic 棄用等系統陷阱。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity CLI 狀態列（Statusline / Footer）的客製化、語系設定與跨平台 Hook 部署能力。

## ⚠️ References 載入規範（必讀）

本技能的細節分散於下列三份 references/：
- [`references/windows.md`](references/windows.md) — Windows 特定規範（BOM 鐵則、`sh.exe` 越獄、`csc.exe` 編譯等）
- [`references/config-files.md`](references/config-files.md) — 三層設定檔結構、`statusLine` 物件、`trusted_hooks.json` 信任機制
- [`references/pitfalls.md`](references/pitfalls.md) — 常見陷阱對照表

**載入規則（強制）**：
1. **禁止透過子代理（subagent / Explore Agent）摘要 references/ 內容**，主代理必須親自以 Read 工具讀取原文
2. **禁止改寫程式碼區塊與 JSON 結構**
3. 若內容與你熟悉的其他 CLI 規範不同，**一律以本技能檔案為準**

---

## 🎯 設定檔路徑（三層必同步）

| 層級 | 路徑語法 | 優先級 |
|---|---|---|
| **CLI 專屬（最高）** | `~/.gemini/antigravity-cli/settings.json` | 🔥 高於全域 |
| 全域 | `~/.gemini/settings.json` | 中 |
| 專案（條件性）| `<workspace>/.gemini/settings.json` | 若存在則覆寫 |

> [!CAUTION]
> CLI 專屬設定檔由 agy CLI 自身維護，優先級**高於**全域設定檔。若忽略此檔案，全域設定將被無聲覆蓋！這是本技能中**最致命且最隱蔽的 Bug**。完整路徑解析規則、JSON 結構、跨電腦移植雙保險設計詳見 [references/config-f### 步驟 2：第一階段問卷（語系確認與變更 — [問題 1/4]）

以步驟 1 取得的「目前語系」向使用者提問，詢問是否沿用或變更：

*   **若目前語系為 `zh-tw`**（繁體中文）：
    ```json
    {
      "questions": [
        {
          "question": "[步驟 1/4] 目前顯示語系設定為：繁體中文 (zh-tw)。是否需要變更？",
          "options": [
            "(Recommended) 保持目前語系（繁體中文）",
            "變更語系 (Change Language / 表示言語の変更)"
          ],
          "is_multi_select": false
        }
      ],
      "toolSummary": "語系確認",
      "toolAction": "確認顯示語系"
    }
    ```
*   **若目前語系為 `us`** (English)：採用英文詢問並加上 `[Step 1 of 4]` 前綴。
*   **若目前語系為 `jp`** (Japanese)：採用日文詢問並加上 `[ステップ 1/4]` 前綴。

- 若使用者選擇「變更語系」，則呼叫 `ask_question` 提供 `繁體中文 (zh-tw)`、`English (us)`、`日本語 (jp)` 進行選擇，並更新語系鎖定為新選定的語系；若選擇「保持目前語系」，則直接以目前語系鎖定進入下一步。後續所有對話輸出（包括問卷選項及回覆）皆依鎖定語系呈現。

---

### 步驟 3：第二階段問卷（勾選狀態列指標 — [問題 2/4]）

為提供最直觀的體驗，**不要拆分出額外的指標確認或重設步驟**。AI 代理應直接顯示所有 24 個指標的單一多選 checklist。
為實現「記得目前的設定」，AI 代理必須對照當前已啟用的指標，並將選項格式化為：
- 已啟用指標之選項：`[x] 說明文字 (識別碼)`
- 未啟用指標之選項：`[ ] 說明文字 (識別碼)`

**選項排序規範**：選項清單**必須且強制嚴格按照以下 predefined 順序排列**，不論是否啟用，這樣可以保證使用者每次打開都是一致的、可預期的排序：
1. 目前使用的 AI 模型名稱 (model-name)
2. 使用中代理 (agent-profile)
3. 代理當前狀態（idle / thinking / working / tool_use / initializing）(agent-state)
4. 沙盒模式狀態（off / on (net) / on (no-net)）(sandbox-status)
5. 目前對話已消耗的 Context 比例 (context-used)
6. 目前 Session 消耗的精確 Token 數量 (token-count)
7. 本次對話 AI 累計產出的成品 / 檔案數 (artifacts)
8. 帳號電子郵件 (account-email)
9. 目前訂閱方案等級 (plan-tier)
10. 帳號真實 API 可用額度 (quota)
11. API 重置時間倒數 (quota-reset-countdown)
12. AI 額度點數 (ai-credits)
13. 是否有等你回應的工具確認對話框 (tool-confirmation)
14. 佇列中待處理的使用者輸入數 (pending-input)
15. 進行中的背景任務數 (background-tasks)
16. 活躍子代理數 (subagents)
17. 目前工作區專案短路徑 (project-path)
18. 目前工作區專案完整路徑 (project-full-path)
19. 版本控制類型（git / jj / fig）(vcs-type)
20. 目前工作區專案的 Git 分支 (git-branch)
21. 工作區是否有未提交變更（dirty / clean）(vcs-dirty)
22. 系統時間 (system-time)
23. CLI 行程所消耗的 RAM 記憶體量 (memory-usage)
24. Antigravity CLI 版本號 (cli-version)
25. 目前對話 ID（前 8 碼，用於除錯）(conversation-id)

*   **若為 `zh-tw`**：
    ```json
    {
      "questions": [
        {
          "question": "[步驟 2/4] 請勾選要啟用的狀態列指標：",
          "options": [
            "目前使用的 AI 模型名稱 (model-name) [已啟用]",
            "使用中代理 (agent-profile)",
            ...
          ],
          "is_multi_select": true
        }
      ],
      "toolSummary": "指標勾選",
      "toolAction": "詢問顯示指標"
    }
    ```
*   **若為 `us` 或 `jp`**：依鎖定語系提供相同邏輯之翻譯問卷（並分別加上 `[Step 2 of 4]` / `[ステップ 2/4]` 前綴，已啟用的選項尾端加上 `(Active)` 或 `(有効)` 字樣）。

- **解析規則**：使用者送出勾選結果後，AI 代理直接在腦中提取所有被勾選之選項括號內的英文識別碼（如 `model-name`），作為最終指標陣列。若使用者直接提交（沒有任何變更），則指標完全不變。

---

### 步驟 4：第三階段問卷（手動排序與最終篩選 — [問題 3/4]）

將步驟 3 得到的最終指標清單標上數字編號，每項以 `\n` 分隔。詢問使用者是否排序：

*   **若為 `zh-tw`**：
    ```json
    {
      "questions": [
        {
          "question": "[步驟 3/4] 請設定狀態列顯示順序。\n\n目前已選取：\n1. 目前使用的 AI 模型名稱 (model-name)\n2. 帳號真實 API 可用額度 (quota)\n\n請在下方輸入框「Write-in...」中輸入以逗號分隔的數字序號或英文識別碼（如：2, 1）。可以使用 `n` 來強制換行。未填寫的指標將不予顯示。",
          "options": [
            "(Recommended) 略過，使用原勾選順序啟用全部指標",
            "手動排序（請在下方「Write-in...」欄位中填寫）"
          ],
          "is_multi_select": false
        }
      ],
      "toolSummary": "排序設定",
      "toolAction": "詢問顯示順序"
    }
    ```
*   **若為 `us` 或 `jp`**：依鎖定語系提供對應翻譯問卷（前綴 `[Step 3 of 4]` / `[ステップ 3/4]`）。

- **解析規則**：若使用者點選「略過」或 Write-in 為空，則按原勾選順序；若 Write-in 有輸入自訂排序字串（如 `2, 1` 或 `quota, model-name`），則解析並重新排序。

---

### 步驟 5：第四階段問卷（外觀樣式選擇 — 保留 classic 與 colorful — [問題 4/4]）

依鎖定語系詢問外觀樣式。將樣式簡化為 **classic（經典純文字）** 與 **colorful（彩色區塊）**：

*   **若為 `zh-tw`**：
    ```json
    {
      "questions": [
        {
          "question": "[步驟 4/4] 目前外觀樣式設定為：[目前樣式]。請選擇您要套用的狀態列外觀樣式：",
          "options": [
            "(Recommended) 保持目前樣式（[目前樣式]）",
            "經典純文字 (classic) - 以 │ 分割的極簡文字樣式",
            "彩色區塊 (colorful) - 彩色背景且平鋪連接的彩色區塊樣式"
          ],
          "is_multi_select": false
        }
      ],
      "toolSummary": "外觀樣式選擇",
      "toolAction": "詢問外觀樣式"
    }
    ```
*   **若為 `us`**：
    ```json
    {
      "questions": [
        {
          "question": "[Step 4 of 4] Current visual style is [Current Style]. Select statusline visual style to apply:",
          "options": [
            "(Recommended) Keep current style ([Current Style])",
            "Classic text (classic) - Minimalist style separated by │",
            "Colorful blocks (colorful) - Flat tiled blocks style with colored background"
          ],
          "is_multi_select": false
        }
      ],
      "toolSummary": "Visual Style Selection",
      "toolAction": "Ask visual style preference"
    }
    ```
*   **若為 `jp`**：
    ```json
    {
      "questions": [
        {
          "question": "[ステップ 4/4] 現在の表示スタイルは [Current Style] です。表示スタイルを選択してください：",
          "options": [
            "(Recommended) 現在のスタイルを維持する ([Current Style])",
            "クラシックテキスト (classic) - │ で区切られたシンプルなスタイル",
            "カラフルブロック (colorful) - カラフルな背景のフラットなブロックスタイル"
          ],
          "is_multi_select": false
        }
      ],
      "toolSummary": "表示スタイル選択",
      "toolAction": "表示スタイルを尋ねる"
    }
    ```

- **解析規則**：若選擇「保持目前樣式」，則沿用步驟 1 的目前樣式；若選擇 classic 或 colorful，則寫入對應的 style。若之前設定檔中為 `capsule` 或 `powerline` 且使用者選擇保持，寫入時可繼續寫入該值以保相容。




### 步驟 7：設定檔合併與寫入

**確定語言代碼**：採用第一階段問卷的選擇結果。
**確定外觀樣式**：採用第六階段問卷的選擇結果。

**【關鍵：多層設定檔同步寫入 — 三檔缺一不可】**：必須同時更新以下 3 個設定檔，否則狀態列將會失效：

1. **全域**：`~/.gemini/settings.json`
2. **CLI 專屬（最高優先級，極度重要）**：`~/.gemini/antigravity-cli/settings.json`
3. **專案**（若存在）：`<workspace>/.gemini/settings.json`

寫入內容：`ui.language` + 解析後的 `ui.footer.items` + `ui.footer.style` + 完整的 `statusLine` 物件（含 `enabled`、`type`、`command`）。

- macOS / Linux 與 Windows 的 `statusLine` JSON 範本、`command` 動態絕對路徑替換規則、`trusted_hooks.json` 信任機制細節（含當前工作區、家目錄、`"*"` 通配符三個鍵）→ 詳見 [references/config-files.md](references/config-files.md)
- **Windows 平台的 UTF-8 BOM 編碼鐵則（絕對禁止帶 BOM 寫檔的工具清單與保證不帶 BOM 的替代方案）** → 詳見 [references/windows.md](references/windows.md) §1

> [!CAUTION]
> 寫入 `command` 時**絕對禁止照抄範例中的 `<真實的使用者家目錄絕對路徑>` 佔位符**，必須動態解析並替換為當下系統環境真實的絕對路徑（例如 `/Users/andy/.gemini/antigravity-cli/hooks/statusline-quota.mjs`）。

**寫入後驗證（Windows 強制）**：每寫完一份設定檔，必須讀回前 3 個位元組驗證；若為 `EF BB BF` 必須就地剝除並重寫，直到通過為止。若步驟 2 預檢階段曾標記出已被 BOM 污染的設定檔，本步驟必須一併執行剝除流程。詳見 [references/windows.md §1](references/windows.md)。

### 步驟 8：自動部署 Hook 腳本

> [!CAUTION]
> **絕對禁令（最關鍵的安全規則）**：AI 代理**絕對禁止**自行發明、撰寫、或修改 `statusline-quota.mjs` 與 `fetch-local-quota.mjs` 的底層程式碼來部署！部署時，**必須 100% 準確地讀取本外掛 `scripts/` 資料夾（相對於本外掛根目錄為 `scripts/`）中的對應腳本檔案，原封不動地寫入**到使用者的 `hooks` 目錄中。若要更新狀態列邏輯，必須先更新對應的 `scripts/*.mjs` 內容再進行部署，**嚴禁憑空發明或竄改邏輯**！違反此規則將導致狀態列功能殘缺、指標抓取失敗、甚至 CLI 崩潰。

**讀取來源（Workspace-First 路由）**：
1. **優先**讀取當前工作區（Workspace）根目錄下的 `scripts/<filename>`
2. 若不存在或在其他工作區，**退回**從本外掛安裝目錄下的 `scripts/<filename>` 讀取。AI 代理應動態推導真實絕對路徑，例如：
   - macOS / Linux：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
   - Windows：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`

**部署目標**：
- `~/.gemini/antigravity-cli/hooks/statusline-quota.mjs`
- `~/.gemini/antigravity-cli/hooks/fetch-local-quota.mjs`

**寫入規範**：必須使用 `fs.writeFileSync(targetPath, content, { encoding: 'utf8' })`，防止 Windows 預設 UTF-16 編碼導致 CLI 崩潰。

**【僅 Windows】編譯靜默 sh.exe**：CLI 底層強制依賴 `sh -c` 執行指令，Windows 缺 `sh.exe`，必須利用內建 `csc.exe` 編譯一個無窗體（`/target:winexe`）的 `sh.exe` 橋接器，徹底消除黑框閃爍。完整步驟（從 `scripts/sh_hidden.cs` 編譯）詳見 [references/windows.md §6](references/windows.md)。

### 步驟 9：回報與重新載入提示

完成檔案編輯與 Hook 部署後，**根據使用者在第一階段所選擇的語系（zh-tw / us / jp）撰寫最終的回覆訊息**（例如選擇日本語 jp 請務必全程使用流利的日文回覆）。在回覆中告知使用者：「狀態列設定支援熱更新（Hot Reload），設定已自動在 CLI 底部即時生效，無需重新啟動。」

**舊版腳本檢查**：使用 Node 的 `fs.existsSync`，或跨平台終端機指令（macOS/Linux：`test -f`、Windows PowerShell：`Test-Path`）檢查 `~/.gemini/hooks/statusline-quota.mjs` 與 `~/.gemini/hooks/fetch-local-quota.mjs`。**只有當偵測到任一舊版腳本存在時**，才在回覆最後溫馨提醒：「若不再使用舊版的 Gemini CLI，可安全地手動刪除上述兩個舊版腳本檔，以節省空間並避免混淆。」若檔案皆不存在則完全略過此提醒，避免造成使用者困惑。

**故障診斷指引（依語系翻譯）**：在最終回覆末尾加入一句提示：「若日後狀態列突然完全消失（特別是在 agy CLI 內使用 `/statusline`、`/model` 等指令切換之後），請前往本外掛目錄執行 `node scripts/diagnose-statusline.mjs`，並把完整輸出貼給 AI 代理。該腳本為唯讀診斷工具，會檢查三層 `settings.json`、`trusted_hooks.json`、Hook 檔案存在性、以及最關鍵的 CLI 專屬層 `statusLine.command` 是否被清空（參見 [references/pitfalls.md](references/pitfalls.md) 陷阱 #9）。」

---

## 🚨 常見陷阱速查

完整對照表（8 條陷阱與修正做法）詳見 [references/pitfalls.md](references/pitfalls.md)。最關鍵的三條速記：

1. **必須同步寫入三層設定檔**（特別是 CLI 專屬的 `~/.gemini/antigravity-cli/settings.json`，是最致命的盲點）
2. **Windows 寫設定檔絕對禁止帶 BOM**，寫入後必須驗證前 3 個位元組
3. **絕對禁止憑空生成 Hook 腳本**，必須從本外掛的 `scripts/` 讀取原文部署
