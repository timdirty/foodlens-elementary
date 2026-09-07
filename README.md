# FoodLens 食光偵探

> AI 校園剩食分析與智慧供餐系統
>
> 臺北市 115 學年度「智慧城市中的科技與人文：跨域創新素養競賽」— 科技助力社會創新

FoodLens 不是只辨識餐盤裡有什麼。它把一次午餐觀察串成完整循環：

**確認菜單 → 五源量測 → 影像初判 → 學生修正 → 找出規律 → 人類決策 → 驗證改善 → 核驗廚餘去向**

網站預設使用可重現的 Demo：48 筆班級餐期、96 份餐盤、8 週、4 個無個資班級代號。資料刻意包含可驗證的規則情境；所有數字、示範照片、改善案例與成本係數都醒目標示為模擬，不冒充實測成果。

## 直接執行

需求：Node.js 22.x（與 `package.json` 及離線啟動器一致）。

```bash
npm install
npm run dev
```

開啟 <http://localhost:3000>。不需要 `.env`、Supabase 或 AI Key，就能操作完整本機 Demo。

字型也完全離線：Noto Sans TC 可變字型已依專案文字製作 WOFF2 子集，透過 `next/font/local` 隨網站提供；未收錄字元會 fallback 至裝置的繁中字型。官方來源、授權、雜湊與子集範圍見 [app/fonts/README.md](app/fonts/README.md)。

## 十二個可操作頁面

| 路由            | 功能                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `/`             | 八週研究總覽、單筆閉環案例、七項 KPI、趨勢、食物排行、研究筆記、近期紀錄 |
| `/workflow`     | 一餐任務台：紙本菜單照片初判、逐欄人工確認、五源分流、匿名原因與人類決定 |
| `/scan`         | 餐期、相機／上傳／示範圖、可恢復草稿、人工修正、確認後保存               |
| `/records`      | 餐期與餐盤兩層紀錄、列表／卡片、搜尋篩選、分頁、AI／人工稽核軌跡         |
| `/lab`          | 日／週／星期／菜色／類別／班級比較、排行、Heatmap、規則洞察與資料表      |
| `/forecast`     | 可解釋供餐情境、依人數建立基準、安全上限、保存決策、逐筆建立驗證實驗     |
| `/impact`       | 累積影響、5/10/20/30% 全校情境滑桿、公開估算假設                         |
| `/trace`        | 逐源清運安排、校方交接、處理場收據指紋、人工核驗與最終去向稽核           |
| `/experiments`  | Before／After、固定範圍、供餐決策快照、人類採用量、樣本數與因果限制      |
| `/research`     | 評審研究檔案、田野紀錄格式、方法、人機分工、限制、倫理、AI 揭露與來源    |
| `/admin`        | 啟用評分、正式上線交接單、班級與治理、研究編輯、備份還原、校園登入       |
| `/presentation` | 8 分鐘簡報、5 分鐘提問與 7 分鐘答詢排練；含計時、題庫、證據與誠信邊界    |

## 從展示原型走向校園產品

教師管理的「啟用中心」會把準備狀態拆成兩條軌道：Demo 是否可完整展示，以及正式校園蒐集是否已備妥。系統不會因為示範資料齊全，就把產品誤標成可以直接蒐集真實資料。

正式啟用檢查涵蓋：

- 學校與團隊資料是否已完成。
- 至少一個可使用的班級；班級可新增、改名與停用，歷史資料不會因停用而消失。
- 資料負責人、保存天數與治理確認日期是否已設定。
- 雲端模式是否已連線至受 RLS 保護的 Supabase 校園工作區。
- 是否已有秤重的正式餐期資料，而非只依賴餐盤影像估算。

啟用分數只用來指出待辦，不是法遵認證。正式蒐集前，校方仍需自行確認同意流程、資料保存與刪除責任。

「校園雲端」頁另提供可複製／下載的正式啟用交接單，列出環境變數名稱、migration、精確 callback、教師 membership SQL placeholder、Private Storage 與登出驗收；交接單不讀取或匯出任何金鑰值。

## 資料模式

### `demo-local`（預設）

- Dexie + IndexedDB 儲存資料與圖片 Blob。
- 第一次開啟自動建立固定版 seed。
- 重新整理不消失；每個瀏覽器互相隔離。
- 寫入使用 IndexedDB transaction，跨分頁以 BroadcastChannel 同步。
- 掃描尚未送出時，表單、重編碼照片 Blob 與人工修正另存為本機草稿；午餐任務台也會保存尚未送出的案件進度。兩類草稿皆依工作區隔離、7 天到期，恢復後仍須重新人工確認才會寫入正式紀錄。
- 午餐任務台在切換案件或建立新案件前，會先取消自動保存倒數並等待最後一版草稿落盤；失敗時留在原案件並提示重試，不會用切頁掩蓋未存變更。評審簡報預檢以唯讀方式合計掃描與午餐任務草稿，並分別導回正確處理頁。
- seed 版本更新會保留手動／匯入資料與教師自訂內容，不會靜默清空；v12 以前無法判定五源去向的舊清運示範會以新版可稽核情境取代，不會猜測或偽造其來源。
- Reset 只影響目前瀏覽器，會清除未完成的示範掃描與午餐任務草稿；重設與整份還原前都會保留一份 recovery snapshot。
- 保存期限清理會先列出截止日、餐盤數與涉及餐期；確認後以單一 IndexedDB transaction 同步移除目前狀態與 recovery 中的到期照片／判讀，保留班級秤重，並留下不含照片內容的稽核摘要。
- IndexedDB 或 Web Storage 被校務裝置政策封鎖時，會自動降級為醒目標示的記憶體示範，不會永久卡在載入畫面；此模式重新整理後會重建 seed。
- 系統會以 best-effort 申請瀏覽器持久儲存；即使持久儲存或跨分頁通知 API 被封鎖，單頁操作仍可完成。
- deterministic Mock provider：同一張示範照片得到相同結果。
- 紙本菜單照片也可走 deterministic Mock OCR；辨識結果只形成可編輯草稿，未逐欄人工確認前不會成為餐期菜單。
- 固定 seed 另含 3 筆可追溯「一餐證據鏈」；新建任務、人工修正與最終決定都保存在目前瀏覽器，Reset 後回到相同的可重現案例。
- 新安裝／明確 Reset 的 v19 seed 另有 48 筆逐餐安全觀察情境，來源均標為模擬；既有瀏覽器升級只保留原安全紀錄，不自動回補示範值。未知、零事件與已邀請但零回覆分開保存。
- seed 另含三種去向狀態（待交接、收據待核驗、已核驗），且每批清運只連結明確勾選的廚餘來源，不把五源自動混成同一去向。
- JSON 完整備份會將本機圖片 Blob 轉成已驗證的 data URL，匯入時先辨識格式版本並安全升級可推導的舊欄位；CSV 支援引號、逗號與換行。
- JSON v4 備份包含安全觀察的完整追加修訂鏈。支援 v0–v3，缺少逐餐資料時保持空白，不從舊實驗均分反推票數。日期／班級已綁安全觀察的餐期不能被 CSV 改接；人數或菜單更正會讓舊觀察暫不進比較，須查核後追加新版。

### `school-cloud`

- Supabase Email Magic Link 登入後才可切換；登入表單設定 `shouldCreateUser: false`，不會把未授權 Email 自動註冊為 Auth user。AI 路由另只接受同校的 `teacher`／`admin`，`viewer` 不可呼叫真實模型。
- 新學校第一次登入可由教師管理頁建立班級、研究章節、專案資料與估算設定；不會把 48 筆 Demo 餐期寫入正式資料庫。
- 正式資料依 `school_id` 以 RLS 隔離，匿名使用者零權限。
- `meal_safety_observations` 與 `save_meal_safety_observation` 獨立保存逐餐觀察，不被五源量測或清運完成條件綁住。僅同校教師／管理員可追加、不可覆寫或刪除原版；資料庫留存登入者與收件時間。讀取工作區需同時通過回饋 v2／安全觀察 v1 版本檢查，缺少更新時明確停止，Demo 不受影響。
- 餐盤圖存於 private `plate-images` bucket，只允許同校 `teacher`／`admin` 以短效 signed URL 讀取；Storage 僅收最大 4,000,000 bytes 的 WebP。
- 單張 signed URL 失敗只顯示該張圖片的錯誤狀態，不會讓整份 Dashboard 無法讀取；重新整理會重新簽發網址。
- AI 原始偵測 append-only；學生修正另存，且雲端與本機都保留逐項修正註記。雲端註記依偵測順序對齊、每項最多 300 字，並納入重送指紋。
- `confirm_scan(jsonb)` 在單一 transaction 內寫入餐期、掃描、偵測與修正；送出 UUID 會保存於工作階段，完整內容與圖片指紋可阻止重複或錯誤重送。已被掃描引用的確認菜單版本與候選項目由資料庫凍結；更正必須建立後續版本，不能回頭改寫掃描當時看到的候選。
- `save_meal_evidence_chain(jsonb)` 以單一 transaction 保存菜單版本、菜色、餐期批次、五源量測、匿名回饋與人類決定；遇到既有同日菜單時會解析 canonical ID，再將子項引用安全重映射，避免重送或競態產生平行事實。
- 正式餐期沒有取得的通知人數、原計畫量、生產量與送達量保持 `null`；班級供應量不會被複製成供餐公司的上游事實。
- 清運事件逐批保存包含的五源類別；同餐期的同一來源不能重複分派。預定去向、交接證據與處理場實際收料分開，正式核驗需保留外部文件 SHA-256 指紋。
- 已完成清運與已核驗／退回收據由資料庫鎖定，不可經一般瀏覽器操作回退、改寫或刪除；核驗者由登入帳號綁定，核驗時間由資料庫產生。
- 保存期限只允許「唯一校園 membership 的 admin」執行；教師可先預覽，瀏覽器無法直接刪除餐期或任意同校圖片。
- 正式清理先由伺服器端 Storage API 分批移除 private 圖片，資料庫確認路徑不存在後才 cascade 清除餐盤、原始偵測與人工修正；班級餐期秤重與去識別稽核摘要保留。

設定：

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
# 只供伺服器端保存期限清理；不可加 NEXT_PUBLIC_
SUPABASE_SECRET_KEY=...
```

依序執行 `supabase/migrations/` 內的 migration（建議使用 `supabase db push`），再於 Supabase Auth 建立教師並加入 `memberships`。第二支 hardening migration 會先檢查既有資料，再補上跨校複合外鍵、學校範圍主鍵與可安全重送的掃描 RPC。新專案使用 publishable key；任何 secret/service key 都不得加上 `NEXT_PUBLIC_`。

### 遠端校園啟用與 Redirect allowlist

在 Supabase Auth 的 **URL Configuration**，將正式站點設為 Site URL，並只加入實際使用的 callback：

```text
http://localhost:3000/auth/callback
https://foodlens.example.edu.tw/auth/callback
```

不要使用可導向任意網域的 wildcard；部署到新的 preview 或正式網域前，先明確加入該網域的 `/auth/callback`。Magic Link 會從目前站點導向這個 callback，callback 完成 exchange 後只回到本站 `/admin`。

首次啟用遠端學校時，請由 Supabase 專案管理者在 SQL Editor（或受管 migration）建立學校與 membership；瀏覽器端沒有建立 membership 的權限。先在 Auth 建立教師帳號，再以其 Auth User UUID 執行：

```sql
insert into public.schools (name, timezone, currency)
values ('示範國小', 'Asia/Taipei', 'TWD')
returning id;

insert into public.memberships (school_id, user_id, role)
values ('<上一步 school UUID>', '<教師 Auth User UUID>', 'teacher');
```

只有受信任的校方管理者才應授予 `admin`。資料庫 RLS 保留 `viewer` 同校唯讀能力；首版 FoodLens 正式工作區只開放 `teacher`／`admin` 進入，`viewer` 不可寫入或呼叫真實 AI。完成登入後可從教師管理頁建立空白工作區範本，不會匯入 Demo 餐期。

### 本機 Supabase

Docker 與 Supabase CLI 可用時：

```bash
supabase start
supabase db reset
supabase test db
```

`supabase/seed.sql` 只建立本機學校、四班與 Impact 假設；Auth 會員需在本機 Dashboard 建立後加入 membership。

Storage 與 PostgreSQL 無法共享單一交易，因此 FoodLens 採可重試的兩階段流程：先固定最多 500 份到期餐盤清單，再由 Storage API 刪圖，最後確認 `storage.objects` 已無目標路徑才完成資料庫清理。任一步驟失敗都保守保留資料庫判讀並回傳追蹤碼；不會把部分成功冒充成完成。

本機資料庫驗收使用專案專屬連接埠（API 55321、Postgres 55322），可與其他 Supabase stack 並存。除了 `supabase test db --local`，亦應執行 `supabase db advisors --local --type all`。

回饋 v2 新增 `20260906055734_feedback_collection_contract_v2.sql`。正式工作區先確認資料庫支援 v2，缺少更新時停止讀寫正式案件；Demo 不受影響。在原 21 支 migration baseline 可執行 `node scripts/verify-feedback-contract-v2.mjs`，逐檔載入新 migration、跑 pgTAP 並回滾，核對 baseline 未變。此驗收不會替你將新版持久套用到本機或 Hosted。

## AI abstraction

```ts
interface FoodAnalysisProvider {
  readonly id: string;
  analyze(input: { fingerprint: string; image?: Blob }): Promise<AiAnalysisV1>;
}
```

- `MockFoodAnalysisProvider`：純本機、固定規則、免 Key。
- `createManualFoodAnalysis`：模型不可用時建立明確標示的人工起始表，不冒充 AI 輸出。
- `POST /api/ai/analyze`：僅同校 `teacher`／`admin` 可呼叫伺服器端 OpenAI-compatible adapter；供應商請求 30 秒逾時即中止，回傳可操作的重試／人工輸入選項。
- `POST /api/ai/menu-analyze`：只接受瀏覽器去除 EXIF 後的 WebP 菜單影像，先驗證同源請求、登入權限、檔案 magic bytes、配額與 Zod 輸出；不把錯誤內容或 OCR 原文寫入 server log。
- 真實模型採資料庫原子配額：每位教師每個 60 秒固定視窗最多 10 次；多個 Vercel instance 同時收到請求也不會各自重算額度。
- 伺服器端輸出必須通過 Zod schema；比例限制 0–1、信心 0–1、重量為正整數。
- 真實服務失敗時明確顯示「重試／人工輸入／切換示範辨識」，不會無聲假裝成功。

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=...
AI_MODEL=...
AI_BASE_URL=https://provider.example/v1
```

## 計算原則

- 加權剩食率：`sum(剩食重量) / sum(供應重量)`。
- 班級剩食率只使用餐期層的整班秤重；餐盤影像只回答「剩下哪些食物」，不冒充整班剩食量。
- 圖片重量：`標準原始份量 × 影像估計剩餘比例`；絕不宣稱單張 2D 照片能精確秤重。
- 洞察同時呈現獨立供餐日與班級餐期；類別至少 5 項、差異至少 5 個百分點。
- 預測：最近 180 天、主食＋主菜或主菜名稱完全相同且至少 3 個獨立供餐日優先，再降級到相似食材與全校基準；同一天四個班級只算一個獨立供餐日。
- 原計畫供餐量可留白；此時以相似餐期的每人供應量中位數 × 預計人數建立基準。使用者輸入原計畫量時則保留人工計畫。
- 減量：歷史剩食率 × 75%；精確／相似／基準上限分別為 15%／8%／5%。
- 已保存的供餐情境可逐筆連結至改善實驗；建立時會保存原計畫、FoodLens 建議量、人類採用方式與實際量的決策快照。實驗計算固定使用自身日期與班級，不會被 Dashboard 全站篩選改寫。
- 供餐試算可直接選擇已確認菜單，並產生可列印／下載的「供餐協作單」；計畫、生產、送達、班級供應與剩食仍是不同階段，未知值不可互相代填。
- Impact：成本預設 NT$80/kg，5 天／週、20 週／學期、2 學期／年；全部可由教師修改。
- Impact 提供不含照片、班級排行或學生資訊的家長／社群公開摘要；系統只負責產生草稿，不會自動發布。
- 沒有可追溯來源前，不顯示虛構 kgCO₂e。
- 原因未收集、已收集零回覆、舊資料待複核分開保存；配送與溫度各自確認。決策頁揭露收集餐數，信心值依該類線索的獨立供餐日限制，不用其他秤重紀錄補大回饋樣本。
- 逐餐安全觀察：缺餐與添餐以 `總事件人次 ÷ 該項已觀察用餐人次 × 100` 比較，並非不同學生百分比；滿意度以五級票數加權。兩期的涵蓋餐數、獨立日期、未知、零回覆與菜單混雜分開揭露。舊版單一摘要不參與新計算，系統不據此宣布供餐安全或因果成立。

## 圖片與隱私

- 接受 JPEG／PNG／WebP，原檔 5MB 以下。
- 瀏覽器重編碼成 WebP、最長邊 1600px，移除 EXIF；必要時逐級縮小，保證送往 Vercel Function 的處理後圖片不超過 4MB。
- 伺服器不只信任副檔名或用戶端 MIME：會再驗證 WebP RIFF 長度、安全 chunk allowlist、實際畫布尺寸與 1600px／4,000,000 bytes 上限，並拒絕 EXIF、XMP、ICC、動畫或來源不明的 chunk。
- 拍攝提示禁止人臉、姓名、學號與座號。
- 學校是正式資料的控制與管理責任單位：必須在收集前確認校內同意、設定餐盤原始證據保存期限、受理更正／刪除請求，並保留處理紀錄；FoodLens 不會自行替學校決定期限或排程無人確認的刪除。
- 保存期限到達時，管理員先預覽並輸入學校名稱確認。系統移除到期 `plate-images`、餐盤判讀、AI 原始值與人工修正，但保留班級餐期的去識別秤重，讓研究仍可做前後比較。
- UI 的「已清理」只代表 FoodLens 應用層完成；雲端供應商備份仍依學校方案與供應商政策保留，不宣稱立即從所有備份永久消失。
- 三張示範餐盤、一張紙本菜單與品牌主視覺的生成與使用揭露見 [docs/GENERATED_ASSETS.md](docs/GENERATED_ASSETS.md)。
- 視覺、評審旅程與可信度稽核見 [docs/PRODUCT_AUDIT_2026-08-30.md](docs/PRODUCT_AUDIT_2026-08-30.md)。

## 競賽與校園試辦文件

- [115 學年度參賽同步初版](docs/competition/115-entry-initial-plan.md)：官方格式、評分證據、95 字理念、286 字簡介、10 頁配置與送件風險。
- [官方格式待填稿交接](docs/competition/foodlens-official-proposal-handoff-v0.1.md)：可編輯 10 頁 DOCX、同源 PDF、標楷體與逐頁內容驗收；仍待真實身分、學生覆核及校方簽章。
- [三案共用標準](docs/competition/shared/README.md)：FoodLens、ScamLens、SoundScape 共用證據／版本登錄、學生貢獻、AI 素材與送件清單，不混用三案研究數據。
- [三案送件文件總入口](output/shared-competition/README.md)：當前閱讀 PDF／可編輯母稿、官方原樣空白報名表、三案貼用文字；學生與校方具名覆核仍待完成。
- [歷史提案第 3–10 頁初稿](docs/competition/115-proposal-pages-3-10-v1.md)：保留 09-05 原稿；最新主張與數字以新官方格式母稿為準。
- [八角色產品路線圖](docs/competition/foodlens-product-roadmap-v2.md)：校方、家長、教室、營養師、團膳、清運與城市端的權責及資料邊界。
- [單班四週試辦執行包 v1.1](docs/competition/field-pilot-kit-v1.1.md)：角色分工、五源秤重、匿名原因、訪談及安全護欄；時間、完整率與人工修正率依目前資料結構定義。
- [單餐量測紀錄表與最新回填補充](docs/competition/field-record-handoff-v0.3.md)：保留 v0.1 的 3 頁 PDF／Word；前 2 頁雙面填寫，第 3 頁為舊版說明，請搭配逐餐安全觀察補充使用。非官方初選必繳附件。

## 驗收

目前逐餐安全觀察已具備本機／雲端介面、修訂歷史、JSON v4 與兩期比較；最新結果、來源指紋、離線包及尚未完成事項集中在[逐餐安全觀察驗收](docs/audits/2026-09-06-meal-safety.md)。下列 Round 9 與回饋 v2 數字保留作歷史，不能代替最新版本狀態。

```bash
npm run verify        # format、lint、typecheck、unit、production build
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
git diff --check
```

瀏覽器驗收預設使用獨立網址 `http://127.0.0.1:3311`，不重用正在執行的開發伺服器；連接埠已被佔用就停止。可用 `FOODLENS_E2E_PORT=3312 npm run test:e2e` 指定另一個測試埠。建置及測試伺服器會清空 Supabase／AI 環境設定，並在操作前核對 FoodLens 頁面身分與禁止索引標頭；每項測試使用新的暫存瀏覽器 context，不會重設你平常使用的 Demo 草稿。請勿把測試網址當成日常工作網址。

50 個 Vitest 檔案、400 項單元與可靠性測試涵蓋 seed 決定性與誠實升級、菜單照片 OCR 安全邊界、伺服器 WebP 容器與尺寸驗證、已確認菜單候選與餐盤分析連動及來源持久化、菜單正規化、五源廚餘分流、一餐證據鏈、加權比例、洞察門檻、27% → 19% 情境、實驗安全護欄、供餐預測 fallback 與上限、Impact 零基準、AI schema 與路由邊界、Mock／真實 AI／人工判讀／來源不明四種來源身分、未確認不寫入、掃描與午餐任務台草稿恢復、快速案件切換前草稿落盤、簡報預檢草稿數、多日期／多班級案件深連結、紀錄篩選與深連結語意、人工修正註記、確認焦點進出、清運取消、收據退回與核驗、決選排練、班級生命週期、正式啟用、重複送出、IndexedDB 關閉後重開不遺失資料、損壞快照隔離、版本化 JSON 備份、CSV 證據防覆寫及保存期限語意。Supabase pgTAP 現有 3 個檔案、276 項測試，額外覆蓋 correction notes 對齊與長度、Storage WebP／4MB／teacher-admin 邊界、已被掃描引用的菜單版本與候選不可改寫，以及同日其他班級仍可安全重用內容完全相同的 canonical 菜單。 未引用菜單的直接修正與整餐保存，亦會驗證實際保存值；新增測試涵蓋慢速草稿保存、失敗重試、OCR／正式保存操作鎖定與同餐重選。

2026-09-06 Round 9 完整 `npm run verify` 通過：Prettier、ESLint、Next route types、TypeScript strict、400/400 Vitest 與 Next.js production build。本輪新增真實草稿預檢、唯讀餐期瀏覽、導覽焦點與驗收環境隔離的回歸；21 個 Supabase migrations、276/276 pgTAP 與 advisors 的資料庫基準沿用同日 Round 8，本輪未修改資料庫或重跑 clean reset。

Round 9 離線包對應 build `leJDGIvWz4itBAY_PUVAW`：1,558 個檔案通過 SHA-256，離線工具 3/3 測試通過；已從獨立暫存目錄啟動並驗證 5 條代表路由與 JavaScript 資產。後續一般 build 不會自動更新這個離線包。

Playwright Round 9 歷史執行：112 通過、72 個既有條件跳過、0 失敗，`retries: 0`；涵蓋 390px WebKit 手機、768px 平板、1440px 桌機與 1920×1080 投影，12 路由的自動無障礙／無溢位檢查與核心操作流程。已修正字色對比、WebKit 導覽焦點，以及只查看已保存餐期卻變成草稿的問題；詳見 [Round 9 完整驗收](docs/audits/2026-09-06-product-round9-readiness/AUDIT.md)。測試使用專用 3311 與暫存瀏覽器，沒有改動日常 Demo 資料；內建瀏覽器另在 3011 唯讀確認管理預檢及首頁，未重新部署。此前視覺與保存可靠性證據保留於 [Round 7](docs/audits/2026-09-05-product-round7-browser/AUDIT.md)／[Round 8](docs/audits/2026-09-06-product-round8/AUDIT.md)。

9 月 6 日文書交接輪另由主代理重跑 lint、typecheck、400 項測試與 build，全數通過；三案正式格式待填稿檢查 205 項通過。這輪未重跑整套 E2E、DB 或重製離線包；仍需修正正式資料的未知狀態與逐餐安全護欄，詳見[本輪驗收與未完成事項](docs/audits/2026-09-06-document-handoff.md)。

GitHub Actions 會執行完整 `npm run verify`、四種顯示尺寸的 production browser journeys，以及隔離 Supabase stack 的 migration、seed 與 pgTAP。任一層失敗都不會通過 release gate。

9 月 6 日回饋 v2 歷史驗收：439 項單元／元件、124 項瀏覽器通過，72 項既有條件跳過、0 flaky／retry；新回饋 12 項四尺寸旅程全過。313 項 pgTAP 在原 baseline 以新 migration 交易回滾驗證，未持久套用到正式 DB。未知、0、false 與待複核已分開。Build ID `KR2Kc85SaMYZKF3ksBHBN`，當時未重製離線包或部署，詳見[回饋 v2 驗收](docs/audits/2026-09-06-feedback-v2.md)。逐餐安全觀察的後續實作、驗收與最新離線包另見[逐餐安全觀察驗收](docs/audits/2026-09-06-meal-safety.md)，不沿用舊稿的待辦或測試數冒充最新狀態。

## 部署

專案已具備 Vercel Preview 所需設定，完全不設定環境變數時仍是完整 Demo。Metadata 與 `X-Robots-Tag` 皆設定 `noindex, nofollow`，但這不能保證公開 URL 不構成「刊登」。目前交付只保留受 Vercel SSO 保護的舊 Preview，沒有 Production deployment；對外分享前仍應先向主辦單位書面確認「作品未經刊登」的認定方式，且不得因受保護就省略校方核准。

先前驗證用 Preview（不含本輪尚未重新部署的最新變更）：<https://foodlens-school-doqvsowid-timdirtys-projects.vercel.app>

```bash
npx vercel deploy --yes --target=preview
```

請保留 `--target=preview`；Vercel CLI 可能把新專案的第一次未指定 target 部署自動指向 Production。

比賽現場備援：

```bash
npm run package:offline
```

這個指令會使用無 Supabase／AI 憑證的環境重新建置，再將 Next.js
standalone server、`.next/static`、`public`、啟動器、健康檢查與 SHA-256
清單封裝至 `dist/foodlens-offline/`。`bundle-info.json` 會記錄 Build ID、Git revision 與 clean／dirty／no-head 狀態，不把沒有版本的包冒充成可追溯封版。指令會自動把封裝結果複製到系統暫存目錄，以隨機備用連接埠啟動，並實際驗證首頁、任務台、掃描、每日紀錄、改善實驗、數據實驗室、簡報及代表 JavaScript 資產。

上場前將整個 `dist/foodlens-offline/` 複製到兩個不同儲存位置。目標電腦需使用 Node.js 22，且作業系統與 CPU 架構須和製包電腦相同；啟動器會先檢查相容性。它不需要 `npm install` 或專案原始碼：

```bash
cd dist/foodlens-offline
node verify-bundle.mjs
node start-foodlens.mjs
# 3000 被佔用時：node start-foodlens.mjs --port 3210
```

另一個終端可執行 `node healthcheck.mjs --port 3000`。備用連接埠會建立獨立的瀏覽器 IndexedDB，因此展示全程應固定使用同一個 host 與 port；若需保留已操作的證據，上場前還應從教師管理下載 JSON 完整備份。

`dist/` 是可重建產物，已加入 `.gitignore`，不應 commit。若已有通過驗收的 `.next/standalone`，CI 可用 `npm run package:offline:from-build`避免重複建置；只要重驗現有離線包則使用 `npm run verify:offline`。`npm run test:offline-tools` 可獨立驗證首頁健康檢查與檔案損壞偵測。

本機 Demo 不依賴現場網路、Supabase 或外部 AI。
