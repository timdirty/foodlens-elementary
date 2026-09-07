# FoodLens Round 8：菜單與草稿保存可靠性

日期：2026-09-06（Asia/Taipei）。本輪集中改善日常輸入、菜單修正與案件切換，不增加未驗證的研究成果。

## 修正與證據

### 1. 菜單「修改成功」必須真的保存新內容

原本的菜單保護觸發器，對未被餐盤引用的 `UPDATE` 返回 `OLD`，導致介面或 RPC 回報成功、實際欄位仍是舊值。新增 5 項 pgTAP 先重現，其中直接更新回傳、重新讀取及整餐 RPC 內容共 3 項失敗。

新增 forward migration `20260905230110_preserve_uncited_menu_item_updates.sql`：只有 `DELETE` 返回 `OLD`，正常更新返回 `NEW`。已引用菜單不可變、跨班級僅可重用相同內容、原確認人與時間保護均維持。依據 [PostgreSQL 觸發器回傳語意](https://www.postgresql.org/docs/current/plpgsql-trigger.html)；未擴大函式或資料表權限。

本機 21 個 migrations 已套用且與 migration history 同步；3 個 pgTAP 檔案、276 項全部通過，advisors 無問題。私有函式仍採 `SECURITY INVOKER`、空 `search_path`，匿名及一般登入角色不能直接呼叫。這次是前向升級驗證，未重新執行 clean reset。

### 2. 自動保存只確認它真正寫入的編輯版本

保存 A 途中繼續輸入 B 時，A 不再把 B 誤標為已保存。`useWorkflowAutosave` 以編輯版本號及單一寫入佇列追上最新內容；案件切換與卸載共用相同佇列。正式保存成功後，先等候既有寫入結束，才刪除該草稿，避免晚到的寫入讓草稿重新出現。

失敗時保留輸入及離頁提醒，提供「重試保存草稿」。草稿仍只保存於目前瀏覽器；恢復時不代簽量測確認或人類決策。新增 8 項延遲 Promise 行為測試涵蓋連續編輯、同時 flush、失敗重試、卸載、正式提交清理、暫停及未修改狀態。

### 3. 正式保存與 OCR 期間固定目前編輯內容

正式保存、案件切換及 OCR 辨識期間，完整輸入區、四步驟導覽與上一／下一步會暫時停用，完成或失敗後恢復。輸入區使用有名稱的原生 `fieldset`，不是只有視覺灰化。這避免保存後畫面與資料庫內容不同，也避免 OCR 回應套用到另一個日期。

同一餐期重選不會啟動無法結束的切換；建立按鈕顯示「目前正在編輯此餐」，選其他班級或日期才可開啟另一餐。新增 6 項整頁整合測試，以真實四步元件驗證上述鎖定、成功／失敗恢復及同餐重選，持久化與影像辨識使用隔離的測試替身。

## 瀏覽器驗證

使用內建瀏覽器實際操作；發現 `localhost:3000` 已是其他專案後，改於 `localhost:3011` 啟動 FoodLens，未停止其他專案。

- 在獨立連接埠的 Demo 輸入「可靠性驗證：切換前最後輸入」，立即切換到另一餐。切換時可見輸入區與導覽停用。
- 回到原案件後保留最後輸入；重新整理後顯示「已恢復這台裝置的未完成草稿」，內容仍相同。
- `/workflow?case=workflow-live-demo` 在 390×844、768×1024、1440×900、1920×1080 實測 `scrollWidth === innerWidth`。
- 手機首屏與智慧菜單輸入區已目視檢查；臨時 viewport override 已還原。

此驗證只建立獨立 `3011` 網址的本機工作草稿，未新增餐盤掃描、重設 Demo、改寫原 `3000` 網址的草稿，或登入正式校園。不同連接埠的 IndexedDB 不共用；不能把它當成原網址資料遷移。

## 全專案驗收

- `npm run verify` 最終通過：Prettier、ESLint、Next route types、TypeScript strict、46 檔／373 項 Vitest、production build。
- 初次 verify 在新增測試仍編輯時碰到該檔格式檢查失敗；格式整理完成後重新執行完整 verify 通過，未調低測試或檢查標準。
- Next.js 16.3.3；Build ID：`QqM0sPgKBf5bo7LeAu_54`。
- `npm run package:offline:from-build` 通過；本輪 build 已更新 `dist/foodlens-offline`，1,558 個檔案通過 SHA-256，離線工具 3/3 測試通過。已複製到系統暫存目錄、以隨機 port 實際啟動，首頁、任務台、掃描、實驗室、簡報及代表 JavaScript 資產皆可載入。
- `npm audit --audit-level=high`：0 vulnerabilities。
- `git diff --check` exit 0；repository 全部檔案仍未追蹤且沒有 HEAD，因此不將此命令視為對未追蹤程式的完整驗證。

## 邊界

本輪未部署、發布或 Git commit。未進行真實校園量測、模型準確率研究、實體相機或螢幕閱讀器驗收。既有 Round 7 的完整頁面視覺紀錄保留於前一份稽核，不將它重標為本輪新測結果。
