# FoodLens 離線字型

`noto-sans-tc-foodlens-vf.woff2` 是從 Google Fonts 官方的 Noto Sans TC 可變字型製作的專案子集，保留 `wght` 100–900 軸。Next.js 透過 `next/font/local` 在同網域提供字型，因此開發、建置與瀏覽都不需要連線至 Google Fonts。

## 來源與授權

- 原始字型：[`NotoSansTC[wght].ttf`](https://github.com/google/fonts/blob/b950a7257470b900078f2bf3223823a8602de7e1/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf)
- 原始字型 SHA-256：`864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`
- 固定來源 commit：`b950a7257470b900078f2bf3223823a8602de7e1`
- 授權：SIL Open Font License 1.1，完整內容見 [`OFL.txt`](./OFL.txt)

## 子集範圍

字型包含產生當下專案文字中，原始 Noto Sans TC 支援的全部字元，另固定保留基本 ASCII（`U+0020–U+007E`）、全形 ASCII、常用中英文標點、箭頭、數學與幾何符號。未收錄或原始字型不支援的字元會依序交給 PingFang TC、Microsoft JhengHei、裝置上的 Noto Sans TC 與系統 sans-serif，不會顯示成缺字方框。

產物由 fontTools 4.51.0 的 `pyftsubset` 產生：

- WOFF2 大小：344,232 bytes
- WOFF2 SHA-256：`47acc6fa1e44fdbbb8a32809af372c7e91e8778128ca4371ac9d61dee43216a8`
- 字型 glyph：1,626
- cmap code point：1,307
- 專案文字中原始字型可支援的 1,081 個 code point：全部收錄

若新增目前子集未包含的常用文字，畫面仍會安全 fallback；若希望新字也使用 Noto Sans TC，請從同一官方來源重新建立子集並同步更新以上雜湊與數量。
