# FoodLens 離線比賽備援包

這個目錄是已建置的 FoodLens Demo，不需要 `npm install`、Supabase、AI Key 或現場網路。請使用 Node.js 22，並在與製包相同的作業系統／CPU 架構執行，保留整個目錄結構；啟動器會先檢查相容性並提供可讀錯誤。

## 上場前先驗證

```bash
node verify-bundle.mjs
```

通過時會顯示 SHA-256 檔案數量。若顯示檔案損壞，請改用另一份備份，不要在這份包上繼續操作。

## 啟動

```bash
node start-foodlens.mjs
```

開啟 <http://127.0.0.1:3000>。若 3000 已被佔用，可使用備用連接埠：

```bash
node start-foodlens.mjs --port 3210
```

啟動後可在另一個終端檢查：

```bash
node healthcheck.mjs --port 3210
```

若需讓同一封閉局域網路內的 iPad 連線，可使用 `--host 0.0.0.0`，再開啟電腦的局域 IP。只在可信任的現場網路這樣做。

## 資料邊界

- 離線包強制不使用 Supabase 與真實 AI 憑證，固定使用本機 Demo／Mock 流程。
- Demo 資料保存在瀏覽器 IndexedDB，不是這個目錄內的檔案。
- `http://127.0.0.1:3000` 與 `http://127.0.0.1:3210` 是不同的瀏覽器來源，各自有獨立 Demo 資料。比賽全程應固定使用同一個連接埠。
- 現場前請另外從「教師管理 → 備份與重設」下載 JSON 完整備份。

`bundle-info.json` 記錄應用版本、Next.js 版本與 Build ID；`SHA256SUMS` 覆蓋包內所有出貨檔案。
