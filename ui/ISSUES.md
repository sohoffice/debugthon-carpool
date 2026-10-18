# UI 相關 issue

整理自 [GitHub issues](https://github.com/sohoffice/debugthon-carpool/issues)（2026-10-18）。issue 內容以 GitHub 為準；這份文件只整理 UI 要做什麼、目前做到哪。

## 目錄

1. [直接屬於 UI](#1-直接屬於-ui)
   - [#14 T14 前端共用基礎](#14-t14-前端共用基礎)
   - [#15 T15 駕駛介面](#15-t15-駕駛介面)
   - [#16 T16 乘客介面](#16-t16-乘客介面)
2. [間接相關](#2-間接相關)
3. [風險與建議](#3-風險與建議)

## 1. 直接屬於 UI

### #14 T14 前端共用基礎

[#14](https://github.com/sohoffice/debugthon-carpool/issues/14) · 尺寸 M · 依賴 #1、#4

| 項目 | 狀態 | 說明 |
|---|---|---|
| API client | ✅ 已完成 | `shared/src/api/client.ts` |
| 可設定間隔的輪詢 hook | ✅ 已完成 | `shared/src/hooks/usePolling.ts` |
| 輪詢在畫面不在前景時暫停 | ⬜ 待做 | 目前 `usePolling` 不會暫停 |
| 帳號切換器（選帳號 → 產生 `role:account` token） | ⬜ 待做 | 目前只能用 `?account=` 網址參數切換 |
| 地圖元件：上車點、行程路線、沿途公車站 | 🟡 部分 | 元件已有（`shared/src/map/`）；資料要等 #3 種子資料、#5 行程路線 |
| 「模擬資料」標示元件 | ✅ 已完成 | `shared/src/ui/SimulatedBadge.tsx` |
| 標籤選擇元件（駕駛、乘客共用） | ⬜ 待做 | 需要後端的標籤 API |

驗收條件：

- [ ] 兩個入口都能用
- [ ] 地圖上看得到 3 個上車點與一條行程路線
- [ ] 標籤選擇後重新整理仍保留（需要後端儲存）

### #15 T15 駕駛介面

[#15](https://github.com/sohoffice/debugthon-carpool/issues/15) · 尺寸 M · 依賴 #5、#13、#14

範圍：

- 選擇適用於自己的標籤
- 出發確認畫面：預先帶入上次設定，不修改時一次操作出發；含自動接受選項；地圖顯示行程路線與沿途公車站
- 行程中只有一個極簡畫面（DD-04）：
  - 有沒有搭車請求、該請求的上車點與下車點
  - 已確認乘客的下車點
  - 確認／婉拒的大按鈕
  - 替車上乘客結束共乘
- 行程中**不顯示地圖**、統計、提示或動畫，也沒有任何設定入口

驗收條件：

- [ ] 手機寬度下可以一手操作
- [ ] 行程中找不到任何設定入口與地圖
- [ ] 收到請求後能在確認時限內完成確認

### #16 T16 乘客介面

[#16](https://github.com/sohoffice/debugthon-carpool/issues/16) · 尺寸 L · 依賴 #11、#13、#14

範圍：

- 選擇適用於自己的標籤
- 最終目的地與可接受公車站輸入：帶入從共乘累積的常用設定（不做公車站建議，Phase 2）
- 強制／建議標籤篩選
- 每個上車點的卡片與時間軸（範圍為等待上限），隨輪詢更新；不能點選車輛
- 「今天我要搭」：位置來自模擬器回報；送出後立即顯示分配結果或「目前沒有可搭的車」
- 請求狀態頁：等待中、已確認（上車地點、車輛資訊、ETA，地圖顯示行程路線）、已放寬標示、無車可配（替代方案）
- 下車後的「結束共乘」按鈕（結束共乘的主要方式）

驗收條件：

- [ ] 完整走一次：查看供給 → 送出請求 → 確認 → 結束共乘
- [ ] 沒有車時立即看到「目前沒有可搭的車」與替代方案

## 2. 間接相關

這些 issue 不屬於 UI，但驗收條件或 Demo 會用到 UI。

| Issue | 與 UI 的關係 |
|---|---|
| [#1](https://github.com/sohoffice/debugthon-carpool/issues/1) T01 專案骨架 | 驗收要求「一個指令啟動資料庫、後端與兩個前端」；目前 `just ui driver`／`just ui passenger` 要分開啟動 |
| [#3](https://github.com/sohoffice/debugthon-carpool/issues/3) T03 種子資料 | 保留 1 個駕駛給真人操作；帳號名稱決定 UI 的預設帳號（`driver/src/config.ts`、`passenger/src/config.ts`） |
| [#5](https://github.com/sohoffice/debugthon-carpool/issues/5) T05 行程管理 | 出發時回傳行程路線與沿途公車站，供地圖顯示（DD-21） |
| [#11](https://github.com/sohoffice/debugthon-carpool/issues/11) T11 供給查詢 API | 乘客卡片與時間軸的資料來源 |
| [#13](https://github.com/sohoffice/debugthon-carpool/issues/13) T13 請求流程 | 定義 UI 要輪詢的 API：駕駛「待回應的請求」、乘客「請求狀態」；輪詢間隔 carpool-oi-09 待決定 |
| [#17](https://github.com/sohoffice/debugthon-carpool/issues/17) T17 本機 Demo 環境 | 兩個 UI 與其他元件在同一台機器上執行（DD-24） |
| [#18](https://github.com/sohoffice/debugthon-carpool/issues/18) T18 Demo 劇本 | 「真人駕駛出發，地圖顯示行程路線」 |

## 3. 風險與建議

- **後端還沒開始**：#15、#16 依賴的 #5、#11、#13 都還沒做，API 格式也還沒定。等後端做完才開始，UI 會被卡住。
- **建議**：
  1. 先補完 #14 不需要後端的部分：輪詢在背景時暫停、帳號切換器。
  2. 和後端先約定 API 格式，UI 先用假資料做畫面。
  3. 輪詢間隔（carpool-oi-09）定案後，更新各 app `src/config.ts` 的 `POLL_INTERVAL_MS`。
