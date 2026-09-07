# FoodLens 逐餐安全觀察驗收

2026-09-06，Asia/Taipei。這輪完成「保存一餐 → 補記缺餐、添餐與滿意度 → 保留修訂 → 前後比較」的資料與操作鏈，不以剩食下降直接宣告供餐安全。正式校園試辦、校方核准、簽章與送件仍未完成。

修正後應用與測試來源：[33 份來源 SHA-256](2026-09-06-meal-safety-sources.json)。

## 本輪交付

- 午餐任務台保存後可以直接開啟該餐的安全觀察；每日紀錄的卡片與列表皆可操作。
- 缺餐與添餐各自記收集狀態、事件人次及觀察人數；未觀察不是 0，同一人重複事件也不是不同學生人數。
- 滿意度保存邀請人數與五級原始票數。未收集、已邀請零回覆、有效回覆分開；每餐均分不直接拿來平均。
- 保存後只能新增修訂，不覆寫前版。重送使用同一筆識別與內容；不同內容或過期修訂必須重新核對。
- 實驗按自己的日期、班級計算，顯示分母、涵蓋率、獨立日期、未知、排除原因、五級分布及菜單組成。人數或菜單被更正的舊觀察暫不進比較；同班同日同餐的重複紀錄不自動合併。
- 新安裝／明確重設的 Demo v19 才產生 48 筆可重現的模擬觀察；既有瀏覽器不回補。JSON v4 保存完整歷史；舊版升級不把摘要反推成票數。
- 研究回填操作見 [v0.3 補充](../competition/field-record-handoff-v0.3.md)。凍結紙本 v0.1、三案官方格式提案與中央版本登錄沒有重製或改版。

## 主代理驗收

第一輪完整 `npm run verify` 通過：Prettier、ESLint、TypeScript、57 files／513 tests 與 production build，單元測試於 14:54:20 開始。第一輪完整 E2E 於 14:54:47 開始：132 passed、72 個既有條件 skipped、0 unexpected、0 flaky、全部 retry 0；新增兩條安全觀察旅程 × 四尺寸的 8 項全部通過，任務台跨頁保存另涵蓋四尺寸。證據：[第一輪 JSON](../../output/playwright/meal-safety/e2e-final.json)。

獨立 Playwright CLI 視覺檢查發現比較表缺少樣式：雖無整頁溢出，手機仍逐字折行、桌機間距不足。此問題不能被自動無溢出測試取代。保留[修正前視覺證據](../../output/playwright/meal-safety/CLI-QA-2026-09-06.md)。已補 scoped CSS、820px 主表、各表獨立橫捲、鍵盤焦點及儲存格留白。

視覺修正後的第二輪 `npm run verify` 再次通過 513 項測試與 build；15:16:57 的完整 E2E 則為 129 passed、7 failed、72 skipped，沒有增加 retry。四項失敗來自新測試把「基準期」也匹配到「改善期減基準期」，需限定完整名稱；一項是手機保存後的焦點交接偶發遺失。另兩項回饋旅程出現瀏覽器等待逾時，保留 trace 診斷，不將它們藏在總通過數裡。結果：[視覺修正首跑 JSON](../../output/playwright/meal-safety/e2e-visual-final.json)、[當時來源](2026-09-06-meal-safety-visual-first-sources.json)；原始失敗資料保留於 `output/playwright/meal-safety/visual-first-test-results/`。焦點及定位修正後的最終結果待補。

測試一律使用隔離的 127.0.0.1:3311 與新瀏覽器 context，不重設使用者 localhost:3011 的資料。14:45:42 對使用者任務台唯讀確認 HTTP 200／noindex，這不代表逐項功能或正式雲端驗收。測試有既有 Next standalone、CSS preload 與 NO_COLOR／FORCE_COLOR 提示，不宣稱零警告或完整 WCAG 認證。

## 資料庫：通過不等於已上線

主代理重新執行 `node scripts/verify-meal-safety.mjs`，406 項 pgTAP 全過：172 evidence、110 RLS、31 retention、93 meal safety。四次交易各自套用待交付的第 22、23 支 migration，執行測試及 deferred constraints 後回滾；`databaseUnchanged: true`。

原本 21 支 migration 的本機 baseline 保持不變。三張既有相關表前後均為 0；安全觀察表、兩個新版 gate 與回饋 validator 前後都不存在。沒有 reset、已提交 DDL 或 migration-history 寫入；這不是全新資料庫完整 23 支 replay，也不是 Hosted 套用。

- 第 22 支：`20260906055734_feedback_collection_contract_v2.sql`，SHA-256 `991f744e9b097cfbbfa7b21beaa40f7ec2ca80597695b850ee786de9044036c1`。
- 第 23 支：`20260906063427_meal_safety_observations_v1.sql`，SHA-256 `80f095e8e97328c97911bbed3c858926d7fe366427e21c2062646fe74b1893da`。
- 新表僅同校教師／管理員可 SELECT、INSERT，沒有瀏覽器 UPDATE／DELETE。RPC 有原子修訂、同值重送、來源及父餐期檢查，原始修訂不可覆寫。
- 雲端 adapter 需要回饋 v2 及安全觀察 v1 gate；缺少 migration 時明確停止，不假裝雲端功能已啟用。本機 Demo 不受影響。

協作者使用 Supabase CLI 2.116.0 對現有 baseline 執行唯讀 advisors：39 INFO、0 WARN／ERROR；其中 37 個 unused_index、2 個刻意不開放瀏覽器的 private table RLS no-policy。這份結果只覆蓋既有 21 支 baseline，不涵蓋已回滾的新 schema。正式套用後仍需再驗 advisors、真實登入、多校隔離、私有圖片及模型服務。

## 離線與文件

第一輪離線包 build `u80p4I2Zy4msaopfFftQv` 已由主代理驗證：1,559 檔 SHA-256、3 項離線工具測試，以及從系統暫存目錄啟動 7 條代表路由與 JavaScript 資產皆通過。不是斷網瀏覽器完整演練。比較表視覺修正後須重新封裝，最終版本待補。

舊 Round 9 包保留於 `dist/foodlens-offline-round9-leJDGIvWz4itBAY_PUVAW`，可恢復；沒有刪除舊展示包。最終使用 `dist/foodlens-offline`，Node.js 22／darwin arm64，相同 host 與 port 才能使用相同 IndexedDB。Repo 尚無 HEAD，不把 generated bundle 當成已提交 release。

三案登錄的 6 份 DOCX／PDF，本輪重新核對檔案大小及 SHA-256 全部相符，沒有改動中央登錄；沿用的 205 項正式格式檢查屬先前執行，不列為本輪新驗收。網站更新不會自動改寫凍結文件或現有線上 Preview。

## 仍需完成

1. 正式實測、學校／營養師與學生具名覆核、公開資格確認、簽章及送件。
2. 製作量、送達量與操作計時的專用任務欄位；現在仍需紙本另記，不能用計畫或供應量代填。
3. 新 schema 正式套用與真實服務驗收；本輪沒有新部署。
4. 若要更新紙本或官方提案，另出版本、重新轉 PDF 與逐頁檢查，不沿用舊通過紀錄宣稱三案完全同步。
