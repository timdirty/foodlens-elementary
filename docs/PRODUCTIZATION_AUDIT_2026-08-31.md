# FoodLens 產品化稽核（2026-08-31）

## 目標

本輪不以增加頁面數量為目標，而是檢查 FoodLens 是否已具備「可展示、可操作、可治理、可逐步啟用」的產品骨架。評審應能分辨示範沙盒與正式校園資料；教師也應能知道下一步要完成什麼，而不是只得到一組漂亮 Dashboard。

## 1. 首屏與 30 秒理解

- 首屏把研究問題、48 筆餐期、96 份餐盤、學生修正、資料規律、供餐試算與再次量測放進同一條閉環。
- 所有示範成果固定標示為模擬情境，不冒充本校實測。
- KPI 數字與單位已分離，動態數字在桌機與手機均保持可讀。
- 移除永遠隱藏但仍在背景運算的圖表，改用 Recharts 3 原生 responsive 模式；頁面載入後無 console error 或 warning。

證據：

- `audits/2026-08-31-productization/19-home-desktop-final.png`
- `audits/2026-08-31-productization/18-home-mobile-final.png`
- `audits/2026-08-31-productization/20-home-trend-chart-final.png`

## 2. 掃描與人機協作

- 正常流程即可選擇「直接建立人工判讀表」，不需先讓 AI 失敗。
- 人工判讀明確標為不呼叫模型，不會冒充 AI 輸出。
- 平板版把照片來源與預覽整理成雙欄；手機仍保留 44px 觸控目標。
- 每日紀錄依實際修正數顯示「0 項調整」或「修正 N 項」，不再把單純確認說成修改。

證據：`audits/2026-08-31-productization/14-scan-tablet-compact.png`

## 3. 供餐決策

- 預設原計畫量由歷史每人供應中位數乘以預計人數，自動隨人數與菜色更新。
- 教師可人工覆寫原計畫，再一鍵恢復自動基準。
- 保存時一併保存計算理由；建議仍受 15%／8%／5% 安全上限約束。
- 介面固定提醒：這是決策建議，營養師與學校保有最後決定權。

證據：`audits/2026-08-31-productization/17-forecast-mobile-people-aware.png`

## 4. 正式啟用中心

- 新增 Demo 就緒與正式校園啟用兩條獨立狀態，避免示範資料完整就被誤認為可立即蒐集真實資料。
- 六個條件逐一檢查專案識別、班級、實測秤重、估算來源、資料治理與校園私有工作區。
- 每個未完成條件都有可操作入口；啟用分數是待辦指引，不宣稱法遵認證。

證據：

- `audits/2026-08-31-productization/16-admin-launch-desktop-final.png`
- `audits/2026-08-31-productization/15-admin-launch-mobile-final.png`

## 5. 班級與資料治理

- 教師可新增、改名與停用班級；停用不刪除歷史餐期、餐盤或修正軌跡。
- 掃描頁只讓使用者新增到使用中的班級；歷史頁仍可查詢停用班級。
- 資料負責人、保存天數與治理確認日期可持久化；研究頁同步顯示治理狀態。
- Demo、記憶體備援與 Supabase repository 共用同一個班級 upsert 契約。
- Supabase migration 增加治理欄位與同校班級更新函式；RLS、Storage 與 append-only 稽核維持通過。

## 6. 驗收結果

- `npm install`：依賴已是最新狀態，0 個已知漏洞。
- `npm run lint`：通過，0 error、0 warning。
- `npm run typecheck`：通過。
- `npm run test`：8 個檔案、56 項測試通過。
- `npm run build`：Next.js 16.3.3 production build 通過，13 個頁面／端點均完成建置。
- `npx supabase test db`：65 項 pgTAP 測試通過。
- `git diff --check`：通過。
- 內建瀏覽器：首頁、趨勢圖、AI 掃描第二步、班級保存、Demo Reset、供餐人數基準、人工覆寫／恢復、數據實驗室均已實際操作；最後一輪 console 無 error 或 warning。

## 尚待外部條件

- 正式校園雲端仍需 Supabase 專案、教師帳號與 membership。
- 真實 AI 仍需伺服器端供應商設定；沒有 Key 時完整 Mock／人工流程可用。
- 公開 Vercel Preview 應在主辦單位確認「作品未經刊登」規定後再建立。
- 真實研究結論仍需校園秤重、同意流程與跨週資料；目前 27% → 19% 只是一組可重現的計算測試。
