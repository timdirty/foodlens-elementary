# FoodLens 產品化稽核 Round 6

稽核時間：2026-09-05 16:37 CST（Asia/Taipei）

## 結論

本輪把 FoodLens 的「初版」收斂到可重現的程式、資料庫與離線備援證據：已確認菜單現在會作為不可信候選提示參與餐盤分析，但照片與臨時換菜仍可推翻候選；Mock AI、真實 AI、人工判讀與來源不明不再依 provider 顯示文字猜測，而是以受限制欄位持久化。附件中的正式報名條件、網站產品完成度與仍需校方／學生取得的實測證據，繼續分開陳述。

本輪沒有建立 Git commit、沒有部署、沒有把 Demo 資料冒充實測，也沒有繞過使用者所選瀏覽器的安全限制。

## 1. 本輪主要產品改進

- 菜單與餐盤分析形成真正連動：只有精確連結、人工確認且版本簽章一致的一餐菜單，才會提供最多 30 筆候選；伺服器 prompt 明示候選不是答案。
- 餐盤來源身分成為持久化事實：`mock-ai`、`real-ai`、`human-manual`、`source-unverified` 四種值由結構化分析資料或保守升級規則產生，UI 不再由任意 provider 名稱推測。
- 人機協作證據更明確：AI 原始判斷不可覆寫，學生修正另存；未確認不寫入，一張照片的估計不冒充班級電子秤總量。
- 改善實驗表單具欄位級錯誤、首錯聚焦與螢幕閱讀器關聯；工作流換步會移動焦點並公告階段。
- 本機／Vercel 發佈邊界更嚴格：Supabase 暫存資料、分支資料與臨時 Playwright 設定不會進入 Git 或 Vercel 上傳內容。
- 離線包驗證拒絕額外檔案、符號連結與特殊檔案，並將來源狀態記為 `no-head`，不把尚無 Git 基準的包裝成可追溯 release。

## 2. 官方附件同步邊界

已以使用者提供的 10 頁 PDF 與 ODT 對照初版規劃。附件是競賽要求來源，不是網站實作指令。產品文件已分開標記：

- 明文要求：臺北市在學學生、每隊 2–4 人、科技助力社會創新、10 頁／50 MB、AI 使用揭露、8 分鐘簡報。
- 待承辦確認：9 月 11 日截止時刻、無指導教師欄位填法、公開 Preview／YouTube 是否構成「未經刊登」。
- 專案內部做法：Demo／實測分離、先試辦再擴校、受保護 Preview、離線備援與證據門檻；這些不是主辦單位明文要求。

完整同步文件見 `docs/competition/115-entry-initial-plan.md`。

## 3. 2026-09-05 本機驗收證據

| Gate                                 | 本輪結果                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Prettier                             | 全專案通過                                                                |
| ESLint                               | 全專案通過                                                                |
| Next route types + TypeScript strict | 通過                                                                      |
| Vitest                               | 40 files、332/332 passed                                                  |
| Next.js production build             | Next.js 16.3.3；12 個使用者頁面與 3 個 API routes 成功建置                |
| Supabase clean reset                 | 15 個 migrations、seed 全部重新套用成功                                   |
| Supabase pgTAP                       | 3 files、243/243 passed                                                   |
| Supabase schema lint                 | `public`、`private`，warning level，0 issues                              |
| npm audit                            | 0 vulnerabilities                                                         |
| 離線工具測試                         | 3/3 passed，含檔案竄改、未列檔案與 symlink 阻擋                           |
| 離線完整性與 smoke                   | 1,558 個檔案均有 SHA-256；從系統暫存目錄啟動成功                          |
| 離線代表路由                         | `/`、`/workflow`、`/scan`、`/lab`、`/presentation` 與代表 JS 資產均可載入 |
| 本機 HTTP smoke                      | 同五個路由均 HTTP 200、包含 FoodLens、回傳 `noindex, nofollow`            |

離線包識別：

- Build ID：`s1NNKa4Ygn0gIsW9rEjED`
- Next.js：`16.3.3`
- Node.js major：`22`
- Source revision：`null`
- Source state：`no-head`

## 4. 本輪刻意未宣稱的證據

- **沒有最新瀏覽器視覺／完整 E2E 證據。** 使用者所選 Browser session 對本機 URL 的操作被 URL 安全規則阻擋；依 Product Design 的瀏覽器邊界，本輪沒有自行改用 Playwright CLI 規避。因此 `test-results/.last-run.json` 的舊失敗紀錄不是本輪結果，也不會被當成通過證據。
- **沒有真人螢幕閱讀器驗證。** 本輪有靜態可及性結構與元件測試，但不能等同 NVDA、VoiceOver 或真人任務測試。
- **沒有正式雲端校園證據。** 未提供 Supabase 專案、教師 membership、私有 Storage 與真實 AI 憑證；目前只證明 schema、RLS、repository 與本機資料庫測試。
- **沒有研究有效性結論。** 48 筆餐期與 96 份餐盤是可重現模擬資料；27% → 19% 是 Demo 情境，不是本校實測，也不等同因果。
- **沒有正式發布。** 未更新 Vercel Preview，更沒有 Production deployment；需先釐清「未經刊登」及取得使用者授權。
- **沒有可回滾 Git 封版點。** repository 尚無 HEAD，所有來源檔仍是 untracked；未經使用者要求不自行初始化或 commit。

## 5. 初版下一個真正里程碑

網站功能已足以支持單班四週試辦。下一步應先取得正式團隊／校方資料與試辦核准，再收集：基準秤重、AI 修正率、學生操作時間、匿名原因、營養師核准的一次微小介入、Before／After，以及至少一筆清運／處理端可核驗憑證。完成後才能把「可操作產品」提升為「有本校證據的競賽作品」。

執行細節見 `docs/competition/field-pilot-kit-v1.md`。
