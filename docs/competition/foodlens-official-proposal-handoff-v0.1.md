# FoodLens 初選官方格式待填稿交接

版本：v0.1｜2026-09-06。這是可編輯、已通過檔案驗收的待填稿，不是已簽核、已送件或已完成實測的提案。

## 交付

- [可編輯 DOCX](../../output/competition/FoodLens_初選提案_官方格式待填稿_v0.1.docx)
- [閱讀 PDF](../../output/pdf/FoodLens_初選提案_官方格式待填稿_v0.1.pdf)
- [唯一內容來源](./foodlens-proposal-v0.1.json)：摘要、頁序、正文、表格、圖片與圖說；生成式編修先改此檔，不同時維護多份正文。
- [凍結證據清單](./foodlens-proposal-evidence-v0.1.json)：成品、原始程式、稽核及素材指紋；[三案共用規格](./shared/README.md)另列各案版本，不混用數字。

10 頁 A4；95 字報名理念、286 字摘要。封面題目 24 pt，小節 14 pt，摘要、正文、表格、圖說及頁碼 12 pt。依主辦附件第 3、7–9 頁配置初審 30%／35%／35% 順序。第 2 頁留白是 300 字內摘要的正常版式，不另外塞入研究附件。

PDF 1,076,148 bytes，小於三案內部保守目標 5,000,000 bytes。官方原文「50Mb」的容量解讀仍待確認，內部目標不是主辦規定。DOCX 550,286 bytes。

| 成品      | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| DOCX v0.1 | `53a344f67fee160845906512548b94aadfda7c36e1c5e168caaefb57f1467ba6` |
| PDF v0.1  | `ca65b394bd53ea08dadb9ba706e3705e13e0b18878330c8039ae10db7125104e` |

## 本輪實際改進

1. 以五種廚餘來源、八方協作、校方與營養師決策、去向收據核驗組織提案；不把治理規劃寫成八種已上線帳號。
2. 第 7 頁分開模型、規則、學生校正與專業決策，借鏡 ScamLens 的逐欄能力揭露。Mock 不讀懂照片，餐期日期由人填入；外部影像傳送風險有獨立說明。
3. 第 9 頁採 seed v18 的未四捨五入重量計算：27.1% → 19.0%、下降 8.0 個百分點、相對改善 29.7%。兩期各 8 筆／2 個獨立日；不把它說成第一週／第四週實測。
4. 借鏡 SoundScape 的事前研究條件與可追溯建置，寫入固定班級、菜單、期間、介入、排除理由與缺漏的待執行方法；沒有宣稱新增了資料庫預登錄功能。
5. 只引用實際已有的工程證據：Round 9 的 400 單元／元件、112 E2E、72 個既有條件跳過、0 retry；資料庫 276 項是 Round 8 基準，不是本輪重跑。兩張截圖是 09-05 的凍結原型，不冒充 09-06 新擷取。
6. 舊 09-05 Markdown 初稿保留歷史；同步計畫與 README 改指本稿，修正舊 332／243、照片留校、學生已完成覆核等容易誤解的表述。

## 檔案驗收

使用文件／PDF 技能的原生 DOCX → PDF 流程，不將提案做成整頁圖片。146 段／儲存格原生文字逐項比對，147 項頁面文字台帳核對頁次；兩張截圖都有替代文字及資料身分圖說。

最終 140 dpi PNG 第 1 至 10 頁均由主代理逐頁檢視：沒有缺字、表格溢出、文字重疊、多出空白頁；圖片為有說明的局部截圖。初次轉檔曾發生字型替代，已以專案專用 fontconfig 修正，再重新產出與檢查；另移除空白 Word 範本繼承的藍色標題線。

PDF 使用本機合法安裝的 BiauKaiTC-Regular「標楷體-繁」，所有子集已嵌入；有結構標記、可搜尋，無密碼、JavaScript 或自動開啟動作。**DOCX 未嵌入字型**，不散布 TTC 字型檔。這不是 Windows DFKai-SB 的相同檔案；換電腦編修須用該電腦合法安裝、符合要求的標楷體，重新轉 PDF 並檢查全部 10 頁。

驗證明細在 `output/competition/work/foodlens-v01/`：`artifact-check.json`、`source-ledger.json`、`render-provenance.json`、`visual-review.json`。這些是內部 QA，不併入 10 頁提案。不宣稱真人讀屏或完整 PDF/UA 認證。

文件專用回歸 4/4 通過：有效成品可讀、內容來源變動拒用舊稿、DOCX 編修後拒用舊台帳、11 頁 PDF 拒絕放行。全部使用暫存副本；12 個凍結來源／成品指紋及計畫內兩版摘要同步檢查通過，`npm run format:check` 與 `git diff --check` 通過。repository 仍未追蹤，不以 diff 檢查代替未追蹤內容驗收。本輪只有文件與文件工具變更，未重跑或改寫網站 400／112 與資料庫 276 的既有結果。

## 後續編修與重建

一般編修可直接用 Word 開啟 DOCX。若走自動建置，先修改 JSON 來源，再重建；直接改 Word 後不要執行舊來源重建覆蓋人工作品，應先對照並把修改回填來源，另出版本。

本機文件工具使用已配置的 bundled Python、python-docx 1.2.0、Pillow 12.3.0、pypdf 6.10.0、pdfplumber 0.11.9；不影響網站 `npm install`。範例在本 repo 根目錄執行：

```sh
FOODLENS_DOC_PY=/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
FOODLENS_DOC_RENDERER=/Users/apple/.codex/plugins/cache/openai-primary-runtime/documents/26.904.11930/skills/documents/render_docx.py
"$FOODLENS_DOC_PY" scripts/build-competition-proposal.py
"$FOODLENS_DOC_PY" scripts/render-competition-proposal.py --renderer "$FOODLENS_DOC_RENDERER"
"$FOODLENS_DOC_PY" scripts/check-competition-proposal.py
```

重新逐頁檢查後才更新 `visual-review.json` 的確切 PDF 指紋與頁面清單，再執行 `scripts/check-competition-proposal.py --finalize` 產生閱讀副本。舊目視紀錄不能替新 PDF 放行。凍結的 v0.1 不原地當成下一版，後續工具應先改版號／檔名並保留歷史。標楷體找不到時轉檔會停止，不接受靜默替代。

## 尚缺本人或校方完成

- 學校、學層、團隊、2–4 位學生、適用教師及本人真實動機與工作證據。
- 學生具名內容／AI／素材覆核；校方適用程序、參選人簽名與學校核章。
- 既有網站或 Preview 的公開事實盤點，以及承辦對「未經刊登」的書面解釋；noindex 不等於從未公開。本輪未部署或上傳。
- 校方核准後的真實操作計時、訪談、秤重、權限與裝置驗證；未完成就以研究設計呈現。
- 完成最後填寫後，重新轉檔、逐頁檢查及由指定人員送件，保存回執。

官方初選截止 2026-09-11，時刻未註明。初選前做不完四週研究時，不捏造結果，也不臨時收集未授權資料。可選影片尚未在本輪製作；網站簡報模式不等於已交付官方簡報檔。
