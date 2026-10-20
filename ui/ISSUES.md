# UI 相關 issue

整理自 [GitHub issues](https://github.com/sohoffice/debugthon-carpool/issues)（2026-10-20）。issue 內容以 GitHub 為準；這份文件只整理 UI 要做什麼、目前做到哪。API 一律以 `main` 的後端為準（`../DEV.md`〈後端 API〉）。

## 目錄

1. [直接屬於 UI](#1-直接屬於-ui)
   - [#14 T14 前端共用基礎](#14-t14-前端共用基礎)
   - [#15 T15 駕駛介面](#15-t15-駕駛介面)
   - [#16 T16 乘客介面](#16-t16-乘客介面)
   - [#57 T24 介面改用 T20、T22 的後端格式](#57-t24-介面改用-t20t22-的後端格式)
   - [#8 T08 模擬器（駕駛介面除錯模式）](#8-t08-模擬器駕駛介面除錯模式)
   - [#35 T18B UI 端對端測試](#35-t18b-ui-端對端測試)
   - [展示頁（UD-18）](#展示頁ud-18)
   - [UI 優化待修清單](#ui-優化待修清單)
2. [間接相關](#2-間接相關)
3. [風險與建議](#3-風險與建議)

## 1. 直接屬於 UI

進度（2026-10-20）：下列畫面都已完成，在示範後端上可以完整操作（`just ui dev-mock`），並以 390px 寬度與展示頁實際操作驗證過，包括設定地圖金鑰與 Map ID 後的地圖；`npm test` 61 個測試、型別檢查與建置都通過。

接 Go 後端：介面與示範後端已改用 `main` 的 T11 供給查詢、T12 送出請求與 T13 請求流程的格式，接 Go 後端（`just ui dev`）實際走完「出發 → 送出 → 確認 → 已上車 → 結束共乘」。接 Go 後端時還不能用的部分：

- 後端已合併、介面還沒改成它的格式，由 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) 處理：
  - 地點搜尋（T20，DD-32）：目的地改由介面以 Google Places 搜尋，後端只有園區範圍檢查 `GET /api/park/check`；介面還在呼叫示範後端才有的 `GET /api/places`，接 Go 後端時駕駛與乘客都無法選新的目的地。駕駛要有上一趟行程、乘客要有常用資料才能直接操作，兩者的 Demo 種子由 T03 補上。
  - 路線預覽（T20，DD-21）：路徑相同，但 Go 回傳 `{route}`，介面讀的是 `Route` 本身。
  - 車輛位置與行進方向（T22，DD-31）：Go 的欄位是 `vehicle_position.heading_deg`，介面讀 `heading`，地圖上的車不會轉向；ETA 的模擬標示（`eta_simulated`、`fastest_eta_simulated`）介面還沒顯示。
- 後端還沒有：
  - 行程自動結束（T21）：接 Go 後端時行程不會結束；「行程結束」畫面的載客人數也等 T21。
  - Demo 重設（T17）。

### #14 T14 前端共用基礎

[#14](https://github.com/sohoffice/debugthon-carpool/issues/14) · 尺寸 M · 依賴 #1、#4 · 已關閉

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
- [x] 地圖上看得到 3 個上車點與一條行程路線（出發確認展開「上車點」時，地圖框住 3 個上車點與行程路線；測試：`driver/src/App.test.tsx`「shows the 3 pickup points and the trip route on the map…」）
- [x] 標籤選擇後重新整理仍保留（示範後端與 Go 後端都驗證過；測試：`driver/src/App.test.tsx`「keeps a chosen tag after a reload」）

### #15 T15 駕駛介面

[#15](https://github.com/sohoffice/debugthon-carpool/issues/15) · 尺寸 M · 依賴 #5、#13、#14、#30、#31、#57

| 項目 | 狀態 | 說明 |
|---|---|---|
| 出發確認（預先帶入、一次操作出發、自動接受、地圖與路線圖） | ✅ 已完成 | 預先帶入改用 Go 的 `GET /api/driver/trips/defaults`；出發用 Go 的 `POST /api/driver/trips` |
| 行程中：沒有請求／有請求（變黃） | ✅ 已完成 | |
| 標記乘客已上車（DD-27） | ✅ 已完成 | 每位乘客一次一個按鈕：「已上車」→「已下車」（UD-20） |
| 改用 `main` 的 T13 格式 | ✅ 已完成 | 行程中輪詢 `GET /api/driver/requests`（`pending`、`passengers`）；確認、婉拒、上車、結束共乘後重新輪詢，`409 not_waiting`／`invalid_state` 時顯示目前的狀態 |
| 目的地以 Google Places 搜尋，選定後提示不在園區內的地點 | ⬜ 待辦 | DD-32；目前用示範後端的 `GET /api/places`，改用 Google Places 與 `GET /api/park/check`，在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) |
| 出發前的路線預覽 | ⚠️ 只有示範後端 | DD-21；介面已呼叫 `POST /api/driver/route-preview`，但讀的格式和 Go 不同（Go 回傳 `{route}`），在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) 修正 |
| 行程結束 | ⚠️ 只有示範後端 | 抵達目的地自動結束（UD-16）：輪詢的 `trip_id` 變成 `null` 時，以 `GET /api/trips/:id` 確認行程已結束並顯示目的地；載客人數等 T21 提供。後端規則見 REQ-070、DD-30，實作在 [#31 T21](https://github.com/sohoffice/debugthon-carpool/issues/31) |

驗收條件：

- [x] 手機寬度下可以一手操作
- [x] 行程中找不到任何設定入口與地圖（不含 `?debug=1` 的除錯模式）
- [x] 收到請求後能在確認時限內完成確認（示範後端與 Go 後端都驗證過：畫面變黃後按「確認」，乘客端下一次輪詢就看到已確認）
- [ ] 出發前在地圖上看得到預覽的行程路線（示範後端可以；Go 後端等 #57 T24）
- [ ] 抵達目的地後畫面換到行程結束（等 T21）

前兩條在 `main` 5b16bd2 以 Playwright（390×664）在示範後端與 Go 後端實測：行程中的按鈕都在螢幕下半部（「確認」342×112、「婉拒」342×72、「已上車／已下車」108×64），沒有橫向捲動；行程中四個畫面（沒有請求、搭車請求、乘客等上車、乘客在車上）都沒有地圖元素與設定入口，加上 `?debug=1` 才出現「除錯」。量測是手動腳本；「行程中沒有地圖與設定入口」的自動測試在下一個 T15 PR 補上。

### #16 T16 乘客介面

[#16](https://github.com/sohoffice/debugthon-carpool/issues/16) · 尺寸 L · 依賴 #6、#11、#13、#14、#30、#33、#57

| 項目 | 狀態 | 說明 |
|---|---|---|
| 目的地設定（地址、可接受公車站、篩選、我的標籤） | ✅ 已完成 | 有常用資料時直接進供給看板 |
| 目的地以 Google Places 搜尋，選定後提示不在園區內的地點 | ⬜ 待辦 | DD-32；目前用示範後端的 `GET /api/places`，在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) |
| 供給看板：選定上車點的看板與時間軸，可改選上車點 | ✅ 已完成 | REQ-029：預設最近的上車點（UD-07） |
| 送出前確認（可調整篩選） | ✅ 已完成 | UD-08 |
| 「今天我要搭」：先建立參與主檔，再附上位置送出，並回報位置 | ✅ 已完成 | DD-25；之後每 10 秒回報一次 |
| 除錯模式：設定目前位置 | ✅ 已完成 | DD-26；同一帳號的其他分頁即時跟著改 |
| 請求狀態：等待中、已確認、已上車、已放寬、改配、無車可配、已拒絕、完成 | ✅ 已完成 | 配到車時的模擬推播（UD-12）與轉場（UD-10）；地圖上平滑移動的車（UD-15）只有示範後端：T22 已合併，欄位名稱的修改在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) |
| 供給看板改用 `main` 的 T11 格式 | ✅ 已完成 | 查詢參數 `dest_lat`／`dest_lng`／`dest_name`、`stop_ids`、`required_tags`、`preferred_tags`；讀 `card`、`cars`、`timeline_range_s` |
| 拿掉送出前的距離檢查 | ✅ 已完成 | 站名牌只顯示距離作為提示；「今天我要搭」一律可按，太遠時顯示後端的 `message`（SC-P2、SC-P8） |
| 拿掉無車時的替代方案 | ✅ 已完成 | 只顯示「目前沒有可搭的車」（REQ-051 不在 PoC 範圍）；示範後端的 `alternatives.ts` 已刪除 |
| 取消請求改成示意按鈕 | ✅ 已完成 | `CancelButton`：等駕駛確認、已確認、已上車都顯示，按下不呼叫 API（UD-17）；示範後端的取消已刪除 |
| 請求狀態改用 `main` 的 T13 格式 | ✅ 已完成 | 打開 App 用 `GET /api/passenger/requests/current`，輪詢 `GET /api/passenger/requests/:id`；改配看 `reassigned_count`。上車點、公車站名稱由清單對照；已上車後狀態不再帶車輛與行程，介面保留確認時的車輛，行程以 `GET /api/trips/:id` 補上。車輛位置與 `passed_pickup` 仍是前端提案的欄位（`heading`），T22 已合併，照 `DEV.md` 改成 `heading_deg` 在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57)；「車已到上車點」依是否已經過上車點判斷，不用 `eta_s` 為 `null` 判斷 |
| 送出請求改用 `main` 的 T12 格式 | ✅ 已完成 | 本文 `pickup_point_id`、`location`、`destination`、`stop_ids`、`tag_filters`；回傳的 `RequestView` 已是結果，再讀一次請求狀態取得車輛與行程 |
| 地圖上的車改用後端的方向 | ✅ 已完成 | DD-31：行進方向由後端計算，介面不自己算；`nextHeading` 只用 API 的方向，沒有方向時保持原來的方向（UD-15）。[#33 T22](https://github.com/sohoffice/debugthon-carpool/issues/33) 已合併，欄位名稱不同，在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) 修正 |
| 已有尚未結束的請求時不能再送出（REQ-069） | ✅ 已完成 | 後端不檢查，只由介面防止：打開 App 時以 `GET /api/passenger/requests/current` 帶出該請求、沒有送出入口；送出前也再查一次，有就直接顯示該請求 |

驗收條件：

- [x] 完整走一次：查看供給 → 送出請求 → 確認 → 已上車 → 結束共乘（示範後端與 Go 後端；Go 後端上 `passenger1` 的常用資料是手動寫入的，等 T03）
- [x] 沒有車時立即看到「目前沒有可搭的車」
- [x] 已有尚未結束的請求時，開啟乘客介面直接顯示該請求，無法再送出
- [x] 除錯模式設定的位置會附在請求上，且參與主檔建立後持續回報位置（測試：`passenger/src/useLocationReporting.test.ts`）

### #57 T24 介面改用 T20、T22 的後端格式

[#57](https://github.com/sohoffice/debugthon-carpool/issues/57) · 尺寸 M · 依賴 #30、#33（都已合併）

T20、T22 的後端已在 `main`，介面還在用前端提案的格式。完成後 #15、#16 才能在 Go 後端上驗收。

| 項目 | 狀態 | 說明 |
|---|---|---|
| 目的地改用 Google Places（駕駛、乘客） | ⬜ 待辦 | DD-32；取代 `GET /api/places`，Google 不可用時預先帶入的目的地仍可用 |
| 選定地點後提示不在園區內 | ⬜ 待辦 | `GET /api/park/check` |
| `destination_outside_park` 顯示中文訊息 | ⬜ 待辦 | 出發與送出請求（REQ-001） |
| 路線預覽讀 `{route}` | ⬜ 待辦 | DD-21 |
| 車輛方向改用 `vehicle_position.heading_deg` | ⬜ 待辦 | DD-31 |
| ETA 的模擬標示 | ⬜ 待辦 | `eta_simulated`、`fastest_eta_simulated`（REQ-063） |
| 型別與示範後端照 `main` 修改，刪除 `GET /api/places` | ⬜ 待辦 | |

### #8 T08 模擬器（駕駛介面除錯模式）

[#8](https://github.com/sohoffice/debugthon-carpool/issues/8) · 尺寸 M · 依賴 #5、#6、#14 · 已關閉

已完成：`http://localhost:5173/?debug=1` 的除錯模式。可切換主畫面的駕駛，模擬器替勾選的駕駛沿 `driver/src/simulatorRoutes.ts` 的路徑與速度，透過 `POST /api/location` 回報位置；只在 `GET /api/driver/trips/current` 有行程時回報，到終點就停止。位置依經過時間計算，每兩筆回報相距不超過 20 公尺。

驗收條件：

- [x] 同時替 5 個駕駛帳號回報位置（測試：`driver/src/useSimulator.test.ts`）
- [x] 沒有進行中行程的駕駛不回報（測試：`driver/src/useSimulator.test.ts`）
- [x] 真人從駕駛介面出發後，模擬器開始替該行程回報位置（測試：`driver/src/useSimulator.test.ts`）
- [x] 速度設定符合預期（測試：30 km/h 一分鐘約 500 公尺）
- [x] 沒有 `?debug=1` 時看不到除錯模式
- [x] 頁面在背景執行 10 分鐘以上，模擬駕駛仍被正確判定經過上車點（示範後端：連續執行 10.5 分鐘；把分頁的 JavaScript 完全暫停 6 分鐘，恢復後補報的位置仍被判定經過。`main` 的 Go 後端：把模擬器的計時器壓到每 60 秒才執行一次（Chrome 背景分頁最嚴格的降頻）執行 10 分鐘，driver1～driver4 每次喚醒補報約 21 筆、相鄰兩筆不超過 20 公尺、每位都有 8 筆落在上車點範圍內，四段行程的 `passed_pickup` 都由 `false` 變成 `true`）

### #35 T18B UI 端對端測試

[#35](https://github.com/sohoffice/debugthon-carpool/issues/35) · 尺寸 M · 依賴 #15、#16、#17

| 項目 | 狀態 | 說明 |
|---|---|---|
| 選定並建立 e2e 工具 | ✅ 已完成 | Playwright（`@playwright/test` 1.63.0），設定在 `playwright.config.ts`，以 `just ui e2e` 執行（`../DEV.md`） |
| 快樂路徑：出發 → 查看供給 → 送出並分配 → 確認 → 上車 → 結束共乘 | ✅ 已完成（示範後端） | `e2e/happy-path.spec.ts`；另測無車可配時立即告知 |
| 測試後不留資料 | ✅ 已完成（示範後端） | 每個測試前後重設示範後端 |
| 接 Go 後端 | ⬜ 待辦 | 等 T20（駕駛在介面上選目的地）與 T17（重設、不留資料） |

### 展示頁（UD-18）

已完成：`ui/showcase`（`http://localhost:5170`），並排嵌入駕駛（`driver4`）與乘客（`passenger1`），「重設」按兩次才執行，執行後兩支手機一起重新載入。Go 後端的 `POST /api/demo/reset` 在 [#17 T17](https://github.com/sohoffice/debugthon-carpool/issues/17)（DD-29），還沒完成。

### UI 優化待修清單

不影響 Demo、先不開工作單的小問題；有空時修，或併進相關的 PR。

- 駕駛出發確認的「自動接受」開關只有 52×32，高度低於觸控建議的 44（T15 驗證時發現）。

## 2. 間接相關

這些 issue 不屬於 UI，但驗收條件或 Demo 會用到 UI。

| Issue | 與 UI 的關係 |
|---|---|
| [#1](https://github.com/sohoffice/debugthon-carpool/issues/1) T01 專案骨架 | 驗收要求「一個指令啟動資料庫、後端與兩個前端」；`just ui dev` 啟動兩個前端與展示頁，後端另外用 `just backend up` |
| [#3](https://github.com/sohoffice/debugthon-carpool/issues/3) T03 種子資料 | `passenger1` 的常用資料、`driver4` 的上一趟行程目前只有示範後端有（ui-design 10.2）；已決定作為 DD-19 的 Demo 例外，由這張工作單在 Go 種子實作，內容同示範後端 |
| [#11](https://github.com/sohoffice/debugthon-carpool/issues/11) T11 供給查詢 API | 已合併；介面已改用它的格式 |
| [#12](https://github.com/sohoffice/debugthon-carpool/issues/12) T12 送出請求 | 已合併（PR #25）；介面已改用它的格式 |
| [#13](https://github.com/sohoffice/debugthon-carpool/issues/13) T13 請求流程 | 已合併（PR #28）；介面已改用它的格式 |
| [#30](https://github.com/sohoffice/debugthon-carpool/issues/30) T20 路線預覽與園區範圍檢查 | 已合併（PR #53）。DD-28 已撤回，改為 DD-32：目的地由介面以 Google Places 搜尋，後端提供 `GET /api/park/check` 與 `POST /api/driver/route-preview`；介面照它改在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) |
| [#31](https://github.com/sohoffice/debugthon-carpool/issues/31) T21 行程抵達目的地自動結束 | 未完成；駕駛介面的「行程結束」畫面與載客人數要用到 |
| [#33](https://github.com/sohoffice/debugthon-carpool/issues/33) T22 請求狀態：車輛位置、行進方向與模擬標示 | 已合併（PR #48）；乘客已確認畫面的地圖上的車（UD-15）與「車已到上車點」（UD-09）要用到，介面照 `DEV.md` 的欄位改在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57) |
| [#49](https://github.com/sohoffice/debugthon-carpool/issues/49) T23 串接路線與旅行時間來源 | 完成後行程路線改沿真實道路；沒有金鑰或外部來源失敗時仍是模擬，介面依 `simulated` 標示 |
| [#17](https://github.com/sohoffice/debugthon-carpool/issues/17) T17 本機 Demo 環境 | 兩個 UI、展示頁與其他元件在同一台機器上執行（DD-24） |
| [#18](https://github.com/sohoffice/debugthon-carpool/issues/18) T18 端對端 Demo 劇本與預演 | 容器，拆成 #34（已關閉）、#35、#36、#37 |
| [#36](https://github.com/sohoffice/debugthon-carpool/issues/36) T18C Demo 劇本 | 劇本全程在兩個介面上操作；展示頁、駕駛除錯模式（模擬器）與乘客除錯模式（目前位置）的用法見 ui-design 8.8 |
| [#37](https://github.com/sohoffice/debugthon-carpool/issues/37) T18D Demo 預演 | 在 Demo 用的機器上依劇本預演兩次；發現的介面問題回報到對應的工作單 |

## 3. 風險與建議

- **後端以 `main` 為準**：`feat/ui` 原本自己寫的臨時後端（請求流程、地點搜尋、路線預覽、Demo 重設、行程自動結束）已在合併 `main` 時全部刪除，舊程式在 commit `8e27438` 可以找到。介面用到、但 `main` 還沒有的 API：Demo 重設（DD-29，[#17 T17](https://github.com/sohoffice/debugthon-carpool/issues/17)）、行程抵達目的地自動結束（REQ-070、DD-30，[#31 T21](https://github.com/sohoffice/debugthon-carpool/issues/31)）。
- **介面程式要跟上 `main`**：T20、T22 已合併，介面照它們的格式改在 [#57 T24](https://github.com/sohoffice/debugthon-carpool/issues/57)。改完前，接 Go 後端時無法搜尋新的目的地、路線預覽讀不到、地圖上的車不會轉向。
- **接 Go 後端時的分配順序**：Go 依感受成本排序，通常是最近的模擬車先拿到請求；要讓台上的駕駛收到請求，見 ui-design 8.8。
- **建議**：
  1. API 格式以 `main` 的後端為準：後端格式變了，`ui/shared/src/api/types.ts` 與示範後端跟著改，不回頭改後端。
  2. T21、T17 依 `design.md` 實作；介面的格式到時以後端為準。
  3. Demo 劇本（#18）決定接 Go 後端時怎麼讓台上的駕駛收到請求。
  4. 地圖樣式（ui-oi-17）已決定：採用路網樣式，雲端樣式不再調整；捷運線與路線色接近的問題由介面替行程路線加白色外框處理。
