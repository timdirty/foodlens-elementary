# FoodLens 產品化驗收｜2026-08-31 Round 2

## 整體健康度

- **本機 Demo：可作為完整競賽展示產品。** 控制中心、掃描／人工判讀、餐期稽核、規則洞察、供餐建議、改善實驗、永續試算、研究與教師管理皆可操作並持久化。
- **正式校園模式：具備安全產品骨架。** Supabase RLS、private Storage、教師登入、正式資料空白起始、短效圖片授權、原始／修正分離與原子掃描保存均已落地；正式上線仍需校方 Supabase 工作區、membership 與真實量測資料。
- **部署：程式已通過 production build。** Vercel CLI 未登入；匿名 temporary deployment 完成本機 build 與上傳後由服務端回傳 `fetch failed`，本輪沒有建立公開 URL，也沒有建立 Production deployment。

## 本輪修正與驗證

1. **30 秒先懂完整循環**
   - 首頁新增一筆由 snapshot 真正推導的模擬閉環：拍餐盤 → 學生改正 → 跨日規律 → 供餐試算 → 再量測。
   - 30 秒摘要一次顯示五個節點，節點可切換細節，且提供在地問題來源。
   - Demo 團隊資料未設定時不再顯示像未完成模板的身分欄位。

2. **餐期與餐盤成為可追溯的日常工作流**
   - 每筆餐期可精確深連結追加第 N 份餐盤，並鎖定原日期、班級、菜單、人數與秤重。
   - 掃描第 2 步可主動選「直接建立人工判讀表」，不必先讓模型失敗。
   - 紀錄摘要依實際 corrections 顯示 0 項調整或已修正 N 項。
   - 跨路由導覽強制回到頁首，避免 sticky topbar 遮住頁面標題。

3. **供餐建議真正接到改善實驗**
   - 自動供應基準改為歷史每人供應中位數 × 預計人數；人工原計畫仍可覆寫。
   - 保存的決策可一鍵開啟改善實驗表單並預選最新情境。
   - 實驗固定使用自身期間與班級，不受全站瀏覽篩選改寫；結果保留原計畫、建議量與「待學校確認」。

4. **正式模式資料可信度與可靠性**
   - 校園模式不載入示範照片或示範菜單；未上傳真實照片不得分析或保存。
   - 正式近期待辦以 Asia/Taipei 今日計算，不會把過期研究資料顯示成今日。
   - 短暫雲端故障保留使用者原本的雲端意圖，提供明確重新連線入口。
   - Supabase snapshot 分頁讀取，私有圖片改用批次 signed URLs；JSON 匯出前重新取得圖片授權，缺圖即停止而不產生不完整備份。
   - 既有餐期量測方式與實驗期間 constraint 已由 migration 完整 validate。

5. **可及性、響應式與 release gate**
   - 圖表外層保留命名圖像語意，Recharts 內層 SVG 不再搶焦點；七張圖均有資料表替代。
   - Admin／Experiments tabs 支援方向鍵、Home、End 與 roving tabindex。
   - 390、640、768、1440、1920 實測均無頁面水平溢位；390px 簡報八個跳頁按鈕皆至少 44px。
   - `npm run verify` 通過：format、lint、typecheck、79 tests、Next.js production build。
   - Supabase local migration／seed／pgTAP 67 tests 通過；`npm audit --omit=dev` 為 0 vulnerabilities。
   - GitHub Actions 已納入 app gate、四種尺寸的 production browser journeys 與獨立 Supabase pgTAP job。

## 已接受畫面

- `04-home-product.jpg`：1440px 控制中心與單筆閉環。
- `05-tour-product.jpg`：30 秒五節點摘要。
- `06-records-evidence.jpg`：餐期兩層稽核證據與追加餐盤入口。
- `07-scan-linked-meal.jpg`：指定餐期欄位鎖定。
- `08-home-mobile-390.jpg`：390px 首頁。
- `09-home-tablet-768.jpg`：768px 首頁。
- `10-presentation-projector-1920.jpg`：1920×1080 評審簡報。
- `11-experiment-linked-decision.jpg`：供餐決策預選改善實驗。

## 已知正式營運邊界

- 首次學校與 membership 仍由受信任的 Supabase 管理者建立；沒有在公開瀏覽器暴露自助升權。
- 正式圖片刪除、保存到期與孤立 Storage 物件清理需由學校排程與治理程序執行。
- 本輪未取得正式 Supabase／AI 憑證，因此完成的是 schema、RLS 與本機 pgTAP 證據，不冒充遠端正式校園驗收。
