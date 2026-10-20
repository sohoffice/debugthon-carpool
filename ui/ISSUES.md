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

接 Go 後端的驗證（2026-10-20）：介面需要的 API 已在 Go 後端實作（T11～T13 的範圍，加上 `GET /api/driver/trip`、路線預覽、地點搜尋與 Demo 重設；Go 單元測試與 Karate 70 個情境都通過）。用 `just ui dev` 接 Go 後端完整走過：駕駛出發（預先帶入上次設定、路線預覽）→ 乘客查看供給（3 台車、時間軸）→ 送出請求 → 駕駛畫面變黃、確認 → 乘客看到已確認與地圖上的車 → 駕駛標記已上車 → 乘客結束共乘；另外驗證了自動接受、取消、目的地設定與強制標籤篩選。模擬器接 Go 後端時，Go 依回報正確判定經過上車點。後端缺 API 時畫面會顯示「後端還沒有提供…」，不會誤報成連不上。

合併 `main`（2026-10-20）之後：`main` 的 T11 供給查詢取代了 `feat/ui` 的版本，格式不同（見下方 #16 的待辦），**介面接 Go 後端時供給看板目前不能用**，接示範後端仍可用。

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
| 行程結束 | ✅ 已完成 | 抵達目的地自動結束（UD-16）；後端規則還沒經過需求與設計審查 |

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
| 供給看板改用 `main` 的 T11 格式 | ⬜ 待辦 | 查詢參數改成 `dest_lat`／`dest_lng`／`dest_name`、`stop_ids`、`required_tags`、`preferred_tags`；回傳改讀 `card`、`cars`、`timeline_range_s`。`types.ts`、`SupplyScreen.tsx`、`search.ts`、示範後端與它們的測試一起改 |
| 拿掉送出前的距離檢查 | ⬜ 待辦 | 供給查詢沒有送出請求距離；「今天我要搭」一律可按，太遠由後端拒絕（ui-design SC-P2、SC-P8） |
| 拿掉無車時的替代方案 | ⬜ 待辦 | REQ-051 不在 PoC 範圍：`NoMatchScreen.tsx` 只顯示「目前沒有可搭的車」；刪掉示範後端的 `alternatives.ts` 與 Go 臨時後端回傳的 `alternatives` |
| 取消請求 | ⚠️ 待審查 | 和 PR #26（PoC 不提供取消，只有示意按鈕）衝突，以合併後的 `main` 為準（ui-design UD-17） |

驗收條件：

- [x] 完整走一次：查看供給 → 送出請求 → 確認 → 已上車 → 結束共乘（示範後端）
- [x] 沒有車時立即看到「目前沒有可搭的車」（替代方案要拿掉，見上方待辦）
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
- [x] 頁面在背景執行 10 分鐘以上，模擬駕駛仍被正確判定經過上車點（示範後端：連續執行 10.5 分鐘；把分頁的 JavaScript 完全暫停 6 分鐘，恢復後補報的位置仍被判定經過。Go 後端：模擬器在背景分頁跑完整條路徑，期間把分頁的 JavaScript 完全暫停 6 分鐘，恢復後 Go 在 2 秒內判定經過上車點，車開到目的地時行程自動結束，駕駛 App 顯示「已到達目的地／今天載了 1 位乘客」）

### 展示頁（UD-18）

已完成：`ui/showcase`（`http://localhost:5170`），並排嵌入駕駛（`driver4`）與乘客（`passenger1`），「重設」按兩次才執行，執行後兩支手機一起重新載入。Go 後端還沒有 `POST /api/demo/reset`。

### 後端 #11～#13 的驗收條件對照

> **已過時。** #11 的部分已由 `main` 的 T11（`supply.go`、`supply_test.go`、`supply.feature`）取代，表中 #11 的測試名稱是 `feat/ui` 臨時版本的，已不適用。#12 以 PR #25 為準，#13 以後端的 T13 為準；臨時實作在後端完成後刪除。

這次為了讓介面能接 Go 後端，在 `feat/ui` 分支上實作了 #11～#13 的範圍。下表把每張工作單的驗收條件對到驗證它的測試（Go 測試在 `backend/internal/server/requests_test.go`，Karate 在 `backend/karate/src/test/java/carpool/api/requests.feature`）。GitHub 上的工作單內容與狀態沒有改，交給工作單流程（審查）處理。

| 工作單 | 驗收條件 | 驗證 |
|---|---|---|
| #11 | 同一情境下，供給清單與 T09 篩選結果一致 | 供給直接呼叫 T09 的 `eligible`（`supply.go`）；`TestSupplyOfThePickupPoint` |
| #11 | 不符合雙方強制標籤的車不出現 | `TestSupplyFollowsWaitLimitAndRequiredTags`；Karate 供給情境 |
| #11 | 修改等待上限後，時間軸範圍跟著改變 | `TestSupplyFollowsWaitLimitAndRequiredTags`（改設定後 `wait_limit_min` 與車輛都跟著變） |
| #11 | Karate：時間軸範圍、缺上車點／目的地／公車站回 400、強制標籤排除 | Karate 供給情境（等待上限的改變只在 Go 測試：Karate 平行執行，改全域設定會影響其他情境） |
| #12 | 兩位乘客同時搶最後一個座位，先送出者得到座位 | `TestLastSeatGoesToTheFirstSubmitted`（真的平行連線，重跑 10 次都通過） |
| #12 | 沒有可分配的車時，送出後立即得到「目前沒有可搭的車」 | `TestNoCarAnswersAtOnceWithWalking` |
| #12 | 狀態轉移測試涵蓋每一條轉移 | 送出→已拒絕 `TestTooFarIsRejectedWithTheDistance`；送出→等待駕駛→已確認 `TestRequestIsHeldThenConfirmedByTheDriver`；送出→已確認（自動接受）`TestAutoAcceptConfirmsAtOnce`；送出→無車可配 `TestNoCarAnswersAtOnceWithWalking`；等待駕駛→改配→無車可配 `TestDeclinesMoveOnUntilNoCarIsLeft`、`TestTimeoutMovesToTheNextCar`；已確認→已上車→已完成 `TestBoardingAndCompletingHappenOnce`；已確認→已完成 `TestCompleteWithoutBoarding`；等待駕駛／已確認→已取消 `TestCancelBeforeBoardingOnly` |
| #12 | 請求附上的位置超過送出請求距離時被拒絕並說明原因 | `TestTooFarIsRejectedWithTheDistance`；Karate |
| #12 | 自動接受確認後，乘客的參與主檔關聯到該行程 | `TestAutoAcceptConfirmsAtOnce` |
| #13 | 逾時改配、連續婉拒直到無車可配 | `TestTimeoutMovesToTheNextCar`、`TestDeclinesMoveOnUntilNoCarIsLeft` |
| #13 | 乘客與駕駛同時結束共乘時只完成一次 | `TestSimultaneousBoardAndCompleteTakeEffectOnce` |
| #13 | 乘客與駕駛同時標記上車時只標記一次 | `TestSimultaneousBoardAndCompleteTakeEffectOnce` |
| #13 | 從已上車與直接從已確認都能結束共乘 | `TestBoardingAndCompletingHappenOnce`、`TestCompleteWithoutBoarding` |
| #13 | Karate：乘客先標記上車、駕駛先標記上車、雙方都標記 | Karate「a full ride」的四列 Examples |
| #13 | 完成後常用資料更新，下次出發或查詢時帶入 | `TestBoardingAndCompletingHappenOnce`（駕駛與乘客的常用資料）；Karate 完成後讀乘客常用資料；接 Go 後端時，完成過共乘的帳號下次出發確認與乘客介面都帶入了這些資料 |
| #13 | 服務紀錄欄位完整 | `TestBoardingAndCompletingHappenOnce`（含上車時間） |
| #13 | 駕駛確認後，乘客的參與主檔關聯到該行程 | `TestRequestIsHeldThenConfirmedByTheDriver` |

## 2. 間接相關

這些 issue 不屬於 UI，但驗收條件或 Demo 會用到 UI。

| Issue | 與 UI 的關係 |
|---|---|
| [#1](https://github.com/sohoffice/debugthon-carpool/issues/1) T01 專案骨架 | 驗收要求「一個指令啟動資料庫、後端與兩個前端」；`just ui dev` 啟動兩個前端與展示頁，後端另外用 `just backend up` |
| [#3](https://github.com/sohoffice/debugthon-carpool/issues/3) T03 種子資料 | `passenger1` 的常用資料、`driver4` 的上一趟行程目前只有示範後端有（ui-design 10.2） |
| [#11](https://github.com/sohoffice/debugthon-carpool/issues/11) T11 供給查詢 API | 已合併進 `main`；格式和介面原本的提案不同，介面要改成 `main` 的格式（見 #16 的待辦） |
| [#12](https://github.com/sohoffice/debugthon-carpool/issues/12)、[#13](https://github.com/sohoffice/debugthon-carpool/issues/13) 請求流程 | #12 的送出請求在 [PR #25](https://github.com/sohoffice/debugthon-carpool/pull/25)，格式和介面目前用的不同，合併後介面照它改；#13 的輪詢、確認、婉拒、已上車、結束共乘還沒有後端版本，暫用 `feat/ui` 的臨時實作（`../DEV.md`〈臨時 API〉） |
| [#17](https://github.com/sohoffice/debugthon-carpool/issues/17) T17 本機 Demo 環境 | 兩個 UI、展示頁與其他元件在同一台機器上執行（DD-24） |
| [#18](https://github.com/sohoffice/debugthon-carpool/issues/18) T18 Demo 劇本 | 展示頁、駕駛除錯模式（模擬器）與乘客除錯模式（目前位置）的用法見 ui-design 8.8 |

## 3. 風險與建議

- **臨時後端要清掉**：`feat/ui` 為了讓 Demo 能接 Go 後端，先寫了 #12、#13 範圍的臨時實作（`backend/internal/server/requestflow.go`、`requests.go`、`candidates.go`、`places.go`、`demo.go` 與兩個遷移）。這些不是工作單的交付內容：後端已有的功能一律改用後端的版本並刪掉臨時實作（`supply.go` 已改用 `main` 的 T11），其餘等後端工作單完成後再刪。`candidates.go` 和 `main` 的 `loadMatchTrips`（`supply.go`）做同一件事，改用後者。
- **合併後的已知問題**：`backend/internal/server/requests_test.go` 的供給測試還是舊格式，會失敗；介面接 Go 後端時供給看板不能用。下一次改程式時修。
- **需求與設計待審查**：行程抵達目的地自動結束（UD-16）與乘客取消請求（UD-17）原本寫進了 `requirement.md`、`design.md`（DD-28、DD-29、REQ-069），合併時已拿掉，交給架構師或後端確認。REQ-069 的編號已被 PR #26 用在「不能重複送出請求」。
- **接 Go 後端時的分配順序**：Go 依感受成本排序，通常是最近的模擬車先拿到請求；要讓台上的駕駛收到請求，見 ui-design 8.8。
- **建議**：
  1. API 格式以 `main` 的後端為準：後端格式變了，`ui/shared/src/api/types.ts` 與示範後端跟著改，不回頭改後端。
  2. Demo 劇本（#18）決定接 Go 後端時怎麼讓台上的駕駛收到請求。
  3. 地圖樣式（ui-oi-17）已決定：採用路網樣式，雲端樣式不再調整；捷運線與路線色接近的問題由介面替行程路線加白色外框處理。
