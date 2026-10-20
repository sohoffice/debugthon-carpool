# UI 相關 issue

整理自 [GitHub issues](https://github.com/sohoffice/debugthon-carpool/issues)（2026-10-20）。issue 內容以 GitHub 為準；這份文件只整理 UI 要做什麼、目前做到哪。API 一律以 `main` 的後端為準（`../DEV.md`〈後端 API〉）。

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

進度（2026-10-20）：下列畫面都已完成，在示範後端上可以完整操作（`just ui dev-mock`），並以 390px 寬度與展示頁實際操作驗證過，包括設定地圖金鑰與 Map ID 後的地圖；`npm test` 54 個測試、型別檢查與建置都通過。

接 Go 後端（2026-10-20 合併 `main` 之後）：`feat/ui` 原本自己寫的臨時後端已全部刪除，後端一律以 `main` 為準。`main` 目前有 T11 供給查詢與 T12 送出請求，**還沒有** T13（駕駛輪詢與確認、婉拒、上車、結束共乘、乘客查詢請求狀態）、地點搜尋、路線預覽與 Demo 重設。所以接 Go 後端（`just ui dev`）時，供給看板以後的流程都還不能用；完整流程目前只能接示範後端（`just ui dev-mock`）。

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
- [x] 標籤選擇後重新整理仍保留（示範後端與 Go 後端都驗證過）

### #15 T15 駕駛介面

[#15](https://github.com/sohoffice/debugthon-carpool/issues/15) · 尺寸 M · 依賴 #5、#13、#14

| 項目 | 狀態 | 說明 |
|---|---|---|
| 出發確認（預先帶入、一次操作出發、自動接受、地圖與路線圖） | ✅ 已完成 | 預先帶入改用 Go 的 `GET /api/driver/trips/defaults`；出發用 Go 的 `POST /api/driver/trips` |
| 行程中：沒有請求／有請求（變黃） | ✅ 已完成 | |
| 標記乘客已上車（DD-27） | ✅ 已完成 | 每位乘客一次一個按鈕：「已上車」→「已下車」（UD-20） |
| 行程結束 | ⚠️ 只有示範後端 | 抵達目的地自動結束（UD-16）；後端規則提案為 REQ-070、DD-30（PR #29），實作在 [#31 T21](https://github.com/sohoffice/debugthon-carpool/issues/31) |

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
| 請求狀態：等待中、已確認、已上車、已放寬、改配、無車可配、已拒絕、完成 | ✅ 已完成（示範後端） | 配到車時的模擬推播（UD-12）與轉場（UD-10）；地圖上平滑移動的車（UD-15） |
| 供給看板改用 `main` 的 T11 格式 | ⬜ 待辦 | 查詢參數改成 `dest_lat`／`dest_lng`／`dest_name`、`stop_ids`、`required_tags`、`preferred_tags`；回傳改讀 `card`、`cars`、`timeline_range_s`。`types.ts`、`SupplyScreen.tsx`、`search.ts`、示範後端與它們的測試一起改 |
| 拿掉送出前的距離檢查 | ⬜ 待辦 | 供給查詢沒有送出請求距離；「今天我要搭」一律可按，太遠由後端拒絕（ui-design SC-P2、SC-P8） |
| 拿掉無車時的替代方案 | ⬜ 待辦 | REQ-051 不在 PoC 範圍：`NoMatchScreen.tsx` 只顯示「目前沒有可搭的車」；刪掉示範後端的 `alternatives.ts` 與 `PassengerRequest.alternatives` |
| 取消請求改成示意按鈕 | ⬜ 待辦 | PoC 不提供取消（design.md 1.1、carpool-oi-13）：「取消請求」按下不做任何事，等駕駛確認、已確認、已上車都顯示；刪掉取消的 API 呼叫、`can_cancel`、`cancelled` 狀態與示範後端的取消（ui-design UD-17） |
| 送出請求改用 `main` 的 T12 格式 | ⬜ 待辦 | `POST /api/passenger/requests` 的本文用 `stop_ids`，回傳是 `RequestView`（`status`、`reason`、`message`、`trip_id`…），不是 `{ request }`；格式見 `../DEV.md` |
| 已有尚未結束的請求時不能再送出（REQ-069） | ⬜ 待確認 | 後端不檢查，只由介面防止；確認介面打開時直接顯示該請求、沒有送出入口。需要 T13 的「查詢尚未結束的請求」 |

驗收條件：

- [x] 完整走一次：查看供給 → 送出請求 → 確認 → 已上車 → 結束共乘（示範後端）
- [x] 沒有車時立即看到「目前沒有可搭的車」（替代方案要拿掉，見上方待辦）
- [ ] 已有尚未結束的請求時，開啟乘客介面直接顯示該請求，無法再送出
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
- [x] 頁面在背景執行 10 分鐘以上，模擬駕駛仍被正確判定經過上車點（示範後端：連續執行 10.5 分鐘；把分頁的 JavaScript 完全暫停 6 分鐘，恢復後補報的位置仍被判定經過。Go 後端的驗證是對已刪除的臨時後端做的，要在 `main` 的後端上重新驗證）

### 展示頁（UD-18）

已完成：`ui/showcase`（`http://localhost:5170`），並排嵌入駕駛（`driver4`）與乘客（`passenger1`），「重設」按兩次才執行，執行後兩支手機一起重新載入。Go 後端沒有 `POST /api/demo/reset`，`design.md` 也沒有，要交給架構師或後端決定。

## 2. 間接相關

這些 issue 不屬於 UI，但驗收條件或 Demo 會用到 UI。

| Issue | 與 UI 的關係 |
|---|---|
| [#1](https://github.com/sohoffice/debugthon-carpool/issues/1) T01 專案骨架 | 驗收要求「一個指令啟動資料庫、後端與兩個前端」；`just ui dev` 啟動兩個前端與展示頁，後端另外用 `just backend up` |
| [#3](https://github.com/sohoffice/debugthon-carpool/issues/3) T03 種子資料 | `passenger1` 的常用資料、`driver4` 的上一趟行程只有示範後端有（ui-design 10.2）；Go 後端要不要補，交給這張工作單決定 |
| [#11](https://github.com/sohoffice/debugthon-carpool/issues/11) T11 供給查詢 API | 已合併進 `main`；格式和介面原本的提案不同，介面要改成 `main` 的格式（見 #16 的待辦） |
| [#12](https://github.com/sohoffice/debugthon-carpool/issues/12) T12 送出請求 | 已合併進 `main`（PR #25）；介面要改成它的格式（見 #16 的待辦） |
| [#13](https://github.com/sohoffice/debugthon-carpool/issues/13) T13 請求流程 | 介面要輪詢的駕駛行程、乘客請求狀態，以及確認、婉拒、上車、結束共乘都在這張工作單；完成前接 Go 後端時這些畫面不能用 |
| [#17](https://github.com/sohoffice/debugthon-carpool/issues/17) T17 本機 Demo 環境 | 兩個 UI、展示頁與其他元件在同一台機器上執行（DD-24） |
| [#18](https://github.com/sohoffice/debugthon-carpool/issues/18) T18 Demo 劇本 | 展示頁、駕駛除錯模式（模擬器）與乘客除錯模式（目前位置）的用法見 ui-design 8.8 |

## 3. 風險與建議

- **後端以 `main` 為準**：`feat/ui` 原本自己寫的臨時後端（請求流程、地點搜尋、路線預覽、Demo 重設、行程自動結束）已在合併 `main` 時全部刪除，舊程式在 commit `8e27438` 可以找到。介面用到、但 `main` 還沒有的 API：
  - T13 的範圍：`GET /api/driver/trip`、`GET /api/passenger/request` 與確認、婉拒、上車、結束共乘。
  - 已提案寫進需求與設計（[PR #29](https://github.com/sohoffice/debugthon-carpool/pull/29)），並開了工作單：地點搜尋與路線預覽（DD-28、DD-21，[#30 T20](https://github.com/sohoffice/debugthon-carpool/issues/30)）、Demo 重設（DD-29，[#17 T17](https://github.com/sohoffice/debugthon-carpool/issues/17)）、行程抵達目的地自動結束（REQ-070、DD-30，[#31 T21](https://github.com/sohoffice/debugthon-carpool/issues/31)）。
- **介面程式要跟上 `main`**：見 #16 的待辦（供給查詢、送出請求、拿掉距離檢查、替代方案與取消）。改完前，接 Go 後端時乘客介面不能用。
- **接 Go 後端時的分配順序**：Go 依感受成本排序，通常是最近的模擬車先拿到請求；要讓台上的駕駛收到請求，見 ui-design 8.8。
- **建議**：
  1. API 格式以 `main` 的後端為準：後端格式變了，`ui/shared/src/api/types.ts` 與示範後端跟著改，不回頭改後端。
  2. PR #29 合併後，T20、T21、T17 依新的設計實作；介面的格式到時以後端為準。
  3. Demo 劇本（#18）決定接 Go 後端時怎麼讓台上的駕駛收到請求。
  4. 地圖樣式（ui-oi-17）已決定：採用路網樣式，雲端樣式不再調整；捷運線與路線色接近的問題由介面替行程路線加白色外框處理。
