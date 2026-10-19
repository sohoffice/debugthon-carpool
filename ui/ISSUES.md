# UI 相關 issue

整理自 [GitHub issues](https://github.com/sohoffice/debugthon-carpool/issues)（2026-10-20）。issue 內容以 GitHub 為準；這份文件只整理 UI 要做什麼、目前做到哪。

## 目錄

1. [直接屬於 UI](#1-直接屬於-ui)
   - [#14 T14 前端共用基礎](#14-t14-前端共用基礎)
   - [#15 T15 駕駛介面](#15-t15-駕駛介面)
   - [#16 T16 乘客介面](#16-t16-乘客介面)
   - [#8 T08 模擬器（駕駛介面除錯模式）](#8-t08-模擬器駕駛介面除錯模式)
   - [展示頁（UD-18）](#展示頁ud-18)
2. [間接相關](#2-間接相關)
3. [風險與建議](#3-風險與建議)

## 1. 直接屬於 UI

進度（2026-10-20）：下列畫面都已完成，在示範後端上可以完整操作（`just ui dev-mock`），並以 390px 寬度與展示頁實際操作驗證過，包括設定地圖金鑰與 Map ID 後的地圖；`npm test` 53 個測試、型別檢查與建置都通過。Go 後端還沒有實際接上驗證（這台開發機沒有 Docker 與 PostgreSQL，後端也還缺請求流程的 API）。

### #14 T14 前端共用基礎

[#14](https://github.com/sohoffice/debugthon-carpool/issues/14) · 尺寸 M · 依賴 #1、#4

| 項目 | 狀態 | 說明 |
|---|---|---|
| API client | ✅ 已完成 | `shared/src/api/client.ts` |
| 可設定間隔的輪詢 hook | ✅ 已完成 | `shared/src/hooks/usePolling.ts` |
| 輪詢在畫面不在前景時暫停 | ✅ 已完成 | 分頁回到前景時立即輪詢一次 |
| 帳號切換器 | ✅ 已完成 | `?account=` 網址參數；除錯模式（`?debug=1`）裡也可以點選切換（ui-oi-08） |
| 地圖元件：上車點、行程路線、沿途公車站 | ✅ 已完成 | `RouteMap`、自訂標記（站名牌、小圓、方塊）、`VehicleMarker`（UD-15） |
| 「模擬資料」標示元件 | ✅ 已完成 | `shared/src/ui/SimulatedBadge.tsx` |
| 標籤選擇元件（駕駛、乘客共用） | ✅ 已完成 | `useMyTags`、`ChipSelect`、`TagFilterEditor` |

驗收條件：

- [x] 兩個入口都能用
- [x] 地圖上看得到 3 個上車點與一條行程路線（出發確認展開「上車點」時，地圖框住 3 個上車點與行程路線）
- [x] 標籤選擇後重新整理仍保留（以示範後端驗證；Go 後端的 `PUT／DELETE /api/me/tags/:id` 格式相同，未實際接上）

### #15 T15 駕駛介面

[#15](https://github.com/sohoffice/debugthon-carpool/issues/15) · 尺寸 M · 依賴 #5、#13、#14

| 項目 | 狀態 | 說明 |
|---|---|---|
| 出發確認（預先帶入、一次操作出發、自動接受、地圖與路線圖） | ✅ 已完成 | 預先帶入改用 Go 的 `GET /api/driver/trips/defaults`；出發用 Go 的 `POST /api/driver/trips` |
| 行程中：沒有請求／有請求（變黃） | ✅ 已完成 | |
| 標記乘客已上車（DD-27） | ✅ 已完成 | 每位乘客一次一個按鈕：「已上車」→「已下車」（UD-20） |
| 行程結束 | ✅ 已完成 | 抵達目的地自動結束（UD-16） |

驗收條件：

- [x] 手機寬度下可以一手操作
- [x] 行程中找不到任何設定入口與地圖（不含 `?debug=1` 的除錯模式）
- [x] 收到請求後能在確認時限內完成確認（以示範後端驗證：畫面變黃後按「確認」，乘客端下一次輪詢就看到已確認；Go 的請求流程 #12、#13 完成後再接上確認）

### #16 T16 乘客介面

[#16](https://github.com/sohoffice/debugthon-carpool/issues/16) · 尺寸 L · 依賴 #6、#11、#13、#14

| 項目 | 狀態 | 說明 |
|---|---|---|
| 目的地設定（地址、可接受公車站、篩選、我的標籤） | ✅ 已完成 | 有常用資料時直接進供給看板 |
| 供給看板：選定上車點的看板與時間軸，可改選上車點 | ✅ 已完成 | REQ-029：預設最近的上車點（UD-07） |
| 送出前確認（可調整篩選） | ✅ 已完成 | UD-08 |
| 「今天我要搭」：先建立參與主檔，再附上位置送出，並回報位置 | ✅ 已完成 | DD-25；之後每 10 秒回報一次 |
| 除錯模式：設定目前位置 | ✅ 已完成 | DD-26；同一帳號的其他分頁即時跟著改 |
| 請求狀態：等待中、已確認、已上車、已放寬、改配、無車可配、已拒絕、完成、取消 | ✅ 已完成 | 配到車時的模擬推播（UD-12）與轉場（UD-10）；地圖上平滑移動的車（UD-15） |

驗收條件：

- [x] 完整走一次：查看供給 → 送出請求 → 確認 → 已上車 → 結束共乘（示範後端）
- [x] 沒有車時立即看到「目前沒有可搭的車」與替代方案
- [x] 除錯模式設定的位置會附在請求上，且參與主檔建立後持續回報位置

### #8 T08 模擬器（駕駛介面除錯模式）

[#8](https://github.com/sohoffice/debugthon-carpool/issues/8) · 尺寸 M · 依賴 #5、#6、#14

已完成：`http://localhost:5173/?debug=1` 的除錯模式。可切換主畫面的駕駛，模擬器替勾選的駕駛沿 `driver/src/simulatorRoutes.ts` 的路徑與速度，透過 `POST /api/location` 回報位置；只在 `GET /api/driver/trips/current` 有行程時回報，到終點就停止。位置依經過時間計算，每兩筆回報相距不超過 20 公尺。

驗收條件：

- [x] 同時替 5 個駕駛帳號回報位置
- [x] 沒有進行中行程的駕駛不回報
- [x] 真人從駕駛介面出發後，模擬器開始替該行程回報位置
- [x] 速度設定符合預期（測試：30 km/h 一分鐘約 500 公尺）
- [x] 沒有 `?debug=1` 時看不到除錯模式
- [x] 頁面在背景執行 10 分鐘以上，模擬駕駛仍被正確判定經過上車點（以示範後端驗證，它依位置回報判斷經過上車點，規則和 Go 後端相同：連續執行 10.5 分鐘；另把分頁的 JavaScript 完全暫停 6 分鐘，期間車輛「開過」上車點，恢復後補報的位置仍被正確判定經過）

### 展示頁（UD-18）

已完成：`ui/showcase`（`http://localhost:5170`），並排嵌入駕駛（`driver4`）與乘客（`passenger1`），「重設」按兩次才執行，執行後兩支手機一起重新載入。Go 後端還沒有 `POST /api/demo/reset`。

## 2. 間接相關

這些 issue 不屬於 UI，但驗收條件或 Demo 會用到 UI。

| Issue | 與 UI 的關係 |
|---|---|
| [#1](https://github.com/sohoffice/debugthon-carpool/issues/1) T01 專案骨架 | 驗收要求「一個指令啟動資料庫、後端與兩個前端」；`just ui dev` 啟動兩個前端與展示頁，後端另外用 `just backend up` |
| [#3](https://github.com/sohoffice/debugthon-carpool/issues/3) T03 種子資料 | `passenger1` 的常用資料、`driver4` 的上一趟行程目前只有示範後端有（ui-design 10.2） |
| [#11](https://github.com/sohoffice/debugthon-carpool/issues/11) T11 供給查詢 API | 工作單已關閉，但 `main` 上還沒有 `GET /api/passenger/supply`；介面照工作單用 GET 與查詢參數，參數名稱是前端提案（ui-design 10.1） |
| [#12](https://github.com/sohoffice/debugthon-carpool/issues/12)、[#13](https://github.com/sohoffice/debugthon-carpool/issues/13) 請求流程 | 介面要輪詢的 `GET /api/driver/trip`、`GET /api/passenger/request` 與確認、婉拒、已上車、結束共乘、取消的 API，格式見 ui-design 10.1 |
| [#17](https://github.com/sohoffice/debugthon-carpool/issues/17) T17 本機 Demo 環境 | 兩個 UI、展示頁與其他元件在同一台機器上執行（DD-24） |
| [#18](https://github.com/sohoffice/debugthon-carpool/issues/18) T18 Demo 劇本 | 展示頁、駕駛除錯模式（模擬器）與乘客除錯模式（目前位置）的用法見 ui-design 8.8 |

## 3. 風險與建議

- **Go 後端還缺介面要用的 API**：`main` 上已有出發、行程、預設設定、參與主檔與位置回報，介面已改成照抄這些格式。還沒有的是供給查詢、送出請求與請求流程、`GET /api/driver/trip`、路線預覽、地點搜尋與 `POST /api/demo/reset`；在這些完成前，Demo 只能用示範後端（`just ui dev-mock`）。
- **建議**：
  1. 後端實作 #11～#13 時對照 `ui/shared/src/api/types.ts` 與 ui-design 10.1；格式要改時兩邊一起改，示範後端的測試（`mock-server/src/api.test.ts`）可以當作規格對照。
  2. 接上 Go 後端後，實際跑一次展示頁＋駕駛除錯分頁（模擬器），確認 ETA 與經過上車點的判斷。
  3. 地圖樣式（ui-oi-17）：捷運線仍以原本的顏色顯示。介面已替行程路線加上白色外框，和捷運線分得開；要再調整雲端樣式，見 `docs/data/map-styles/README.md`。
