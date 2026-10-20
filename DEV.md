# 開發指南

## 目錄

- [專案資源](#專案資源)
- [前置需求](#前置需求)
- [Just 指令](#just-指令)
  - [後端](#後端)
  - [基礎設施](#基礎設施)
  - [前端](#前端)
  - [通用](#通用)
- [後端 API](#後端-api)
- [API 整合測試（Karate）](#api-整合測試karate)
- [測試帳號](#測試帳號)
- [種子資料](#種子資料)

## 專案資源

- GitHub 儲存庫：[sohoffice/debugthon-carpool](https://github.com/sohoffice/debugthon-carpool)
- GitHub Project：[內科順路共乘 PoC](https://github.com/users/sohoffice/projects/5)

## 前置需求

- [Go](https://go.dev/) 1.27.2
- [just](https://github.com/casey/just) 1.31 以上（需支援 `mod`）
- Docker（用於 `docker-compose.yml` 中的 PostgreSQL）
- [Node.js](https://nodejs.org/) 20.19 或 22.12 以上（Vite 8 的需求）

## Just 指令

在專案根目錄執行 `just help`（或直接執行 `just`）可列出所有指令。

### 後端

後端指令定義於 `backend/justfile`，並透過根目錄 `justfile` 的 `mod backend` 載入，因此以 `backend` 為子指令前綴（`just backend <指令>`）。

| 指令 | 說明 |
| --- | --- |
| `just backend up` | 編譯後端並在背景啟動，預設監聽 `:8080`；若已在執行則不重複啟動 |
| `just backend down` | 停止由 `up` 啟動的後端 |
| `just backend test` | 執行後端 Go 測試（`go test ./...`），需先 `just infra up` 與 `just backend db-apply` |
| `just backend karate` | 啟動後端（若尚未執行）並以 Karate 執行 API 整合測試（見下方說明） |
| `just backend db-apply` | 套用尚未執行的資料庫遷移（需先 `just infra up`） |
| `just backend db-rollback` | 回滾最近一次已套用的遷移（執行該檔的 `-- +goose Down`） |
| `just backend migrate-status` | 顯示各遷移的套用狀態 |
| `just backend migrate-new <名稱>` | 在 `backend/migrations/` 建立新的 SQL 遷移檔 |
| `just backend db-reset` | 清空 `public` schema 並重新套用全部遷移（測試資料可隨時重建） |

- 以環境變數 `PORT` 變更連接埠，例如 `PORT=9000 just backend up`。
- 資料庫資料庫遷移使用 [goose](https://github.com/pressly/goose)，以 `go tool goose` 執行（版本鎖定於 `backend/go.mod`，無需另外安裝）。遷移檔為 `backend/migrations/` 下的 SQL，需同時寫 `-- +goose Up` 與 `-- +goose Down`，讓 `just backend db-rollback` 能回滾；測試資料不需保留，改動後也可用 `just backend db-reset` 整個重建。
- 連線字串預設由 `POSTGRES_*` 組成，也可直接設定 `DATABASE_URL` 覆寫。
- 執行檔、pid 檔與日誌位於 `backend/.run/`（`server`、`server.pid`、`server.log`），此目錄已列入 `.gitignore`。

### 基礎設施

基礎設施指令定義於 `infra.just`，以 `docker compose` 操作 `docker-compose.yml`（目前僅 PostgreSQL）。

| 指令 | 說明 |
| --- | --- |
| `just infra up` | 在背景啟動基礎設施並等待就緒 |
| `just infra down` | 停止並移除基礎設施容器（資料卷保留） |
| `just infra reset` | 移除容器與資料卷後重新啟動（資料全部清空，之後需再執行 `just backend db-apply`） |

- 資料庫名稱、帳號、密碼與連接埠可透過 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_PORT` 覆寫（資料庫預設 `carpool`，帳號與密碼預設 `postgres`，連接埠 `5432`）。這是超級使用者，供 goose 遷移使用；後端以第一個遷移建立的 `carpool` 使用者連線。

### 前端

前端指令定義於 `ui/justfile`，並透過根目錄 `justfile` 的 `mod ui` 載入（`just ui <指令>`）。開發原則見 `ui/CLAUDE.md`，UI 設計見 `docs/ui-design.md`。

| 指令 | 說明 |
| --- | --- |
| `just ui install` | 安裝所有前端 workspace 的 npm 套件（第一次使用前執行） |
| `just ui driver` | 啟動駕駛介面開發伺服器，網址 `http://localhost:5173` |
| `just ui passenger` | 啟動乘客介面開發伺服器，網址 `http://localhost:5174` |
| `just ui showcase` | 啟動展示頁（UD-18），網址 `http://localhost:5170`，並排嵌入駕駛與乘客介面 |
| `just ui dev-mock` | 啟動示範後端（`:8081`）、兩個介面與展示頁，全部連到示範後端（開發期間用） |
| `just ui dev` | 啟動兩個介面與展示頁，連到 Go 後端 `:8080`（後端先用 `just backend up` 啟動） |
| `just ui mock` | 只啟動示範後端 `:8081` |
| `just ui mock-scenario <情境>` | 切換示範情境並重設：`normal`、`reassign`、`no_cars` |
| `just ui mock-advance <秒數>` | 把示範後端的時鐘往前撥，例如讓車開到目的地 |
| `just ui mock-reset` | 重設示範後端（`POST /api/demo/reset`；Go 後端還沒有這個 API） |
| `just ui test` | 型別檢查並執行所有前端測試 |

- 開發時 `/api` 會轉送到後端，預設 `http://localhost:8080`，可用 `API_PROXY_TARGET` 覆寫；`just ui dev-mock`／`just ui dev` 會自動設定。
- 示範後端（`ui/mock-server/`）是只用 Node 內建模組的小程式，狀態放在記憶體裡，重啟就回到初始狀態。帳號、上車點、公車站、標籤與模擬行程直接讀 `backend/migrations/` 的種子 SQL，和 Go 後端一致。做法見 `docs/ui-design.md` 10.2。
- 以網址參數切換 Demo 帳號，例如 `http://localhost:5173/?account=driver2`。
- 除錯模式（Demo 工具）加上 `?debug=1`，畫面左緣會出現「除錯」標籤（`docs/ui-design.md` 8.8）：
  - 駕駛：`http://localhost:5173/?debug=1` 可切換帳號，並執行模擬器（DD-14）：按「開始模擬」後，有進行中行程的駕駛沿預先定義的路徑回報位置。接 Go 後端時，車輛位置全靠它，Demo 時另開一個分頁讓它一直開著。
  - 乘客：`http://localhost:5174/?debug=1` 可設定乘客的目前位置（DD-26），例如「離松山車站 420 公尺」來展示請求被拒絕。同一帳號的其他分頁會跟著改。
- 環境變數放在根目錄 `.env`：
  - `VITE_GOOGLE_MAPS_API_KEY`：瀏覽器用的 Google Maps 金鑰，會公開給使用者。請限制為 HTTP 參照網址，且只開 Maps JavaScript API；不要沿用伺服器端的 `MAP_API_KEY`。未設定時地圖顯示提示文字，其他功能照常運作。
  - `VITE_GOOGLE_MAPS_MAP_ID`：選填，留空則使用 Google 的 `DEMO_MAP_ID`。

### 通用

| 指令 | 說明 |
| --- | --- |
| `just help` | 列出所有可用指令（含子模組） |

## 後端 API

| 方法 | 路徑 | 角色 | 說明 |
| --- | --- | --- | --- |
| GET | `/api/ping` | 免身分 | 健康檢查，回傳 `200 OK` 與 `{"status":"ok"}` |
| GET | `/api/me` | 任一 | 目前帳號與角色 |
| GET | `/api/pickup-points` | 任一 | 上車點清單 |
| GET | `/api/bus-stops` | 任一 | 園區內公車站清單 |
| GET | `/api/tags` | 任一 | 標籤清單，`selected` 表示呼叫者是否已選擇 |
| PUT | `/api/me/tags/:id` | 任一 | 選擇清單中的標籤（重複選擇無影響；不在清單中回 404） |
| DELETE | `/api/me/tags/:id` | 任一 | 取消選擇標籤 |
| GET | `/api/driver/profile` | 駕駛 | 常用上車點、常用目的地、可載人數（尚無共乘紀錄時為 `null`） |
| GET | `/api/passenger/profile` | 乘客 | 平常抵達時間、常用目的地、可接受的下車公車站 |
| POST | `/api/activities` | 任一 | 表示今天要參與，建立位置回報的主檔（DD-25），回 `201`。駕駛的主檔關聯到進行中的行程（沒有則回 `409 no_active_trip`）；乘客的主檔在請求被確認時才關聯到行程（T12／T13），建立當下不關聯。再次呼叫會建立新的主檔 |
| POST | `/api/location` | 任一 | 回報位置 `{"lat","lng"}`，回 `201`，歸入呼叫者最新的主檔（從未建立過回 `409 no_activity`）。駕駛的回報若主檔有行程，會回傳 `passed_pickup`。座標缺漏或超出範圍回 `400 invalid_location` |
| GET | `/api/me/location-reports` | 任一 | 呼叫者所有回報過的位置，由舊到新（位置紀錄只新增、不修改） |
| POST | `/api/driver/trips` | 駕駛 | 出發（T05）：`pickup_point_id`、`destination{name,lat,lng}`、`capacity`、`auto_accept`、`tag_filters[{tag_id,intent}]`。回 `201` 與行程（含 `route`：`polyline`、`distance_m`、`duration_s`、`simulated`、沿途 `bus_stops`）。行程立即為 `active` 且 `settings_locked`，並同時建立駕駛的參與主檔，之後可直接 `POST /api/location`。上車點不在清單回 `400 invalid_pickup_point`、目的地不在園區內回 `400 destination_outside_park`、標籤不在清單回 `400 invalid_tag`、欄位錯誤回 `400 invalid_request`、已有進行中的行程回 `409 already_active` |
| GET | `/api/driver/trips/defaults` | 駕駛 | 上一次出發的設定，用來預先帶入下一次出發（REQ-016）；從未出發過則各欄位為 `null`、`tag_filters` 為空 |
| GET | `/api/driver/trips/current` | 駕駛 | 進行中的行程；沒有回 `404` |
| GET | `/api/trips/:id` | 任一 | 行程與其路線、沿途公車站；SQL 預先建立、尚無路線的行程在第一次讀取時補建並保存（DD-21） |
| GET | `/api/passenger/supply` | 乘客 | 供給查詢（T11）：指定上車點的相關車輛。查詢參數 `pickup_point_id`（必填）、`dest_lat`＋`dest_lng`（選填 `dest_name`）、`stop_ids`（`bus_stops.id`，逗號分隔）、`required_tags`／`preferred_tags`（標籤 id，逗號分隔）；目的地與公車站沒帶時用乘客的常用資料（REQ-025）。回 `200`：`card`（`count`、`fastest_eta_s`、`seats_remaining`）、`cars`（`trip_id`、`eta_s`、`seats_available`，ETA 由近到遠）、`timeline_range_s`（等待上限，秒）與實際採用的 `destination`、`accepted_stop_ids`。篩選沿用媒合引擎的資格篩選，不排序、不提供選車。上車點缺漏回 `400 invalid_request`、不存在回 `400 invalid_pickup_point`、沒有目的地回 `400 destination_required`、沒有公車站回 `400 stops_required`、公車站或標籤不在清單回 `400 invalid_stop`／`invalid_tag`、參數格式錯誤回 `400 invalid_request` |
| POST | `/api/passenger/requests` | 乘客 | 送出搭車請求（T12）：`pickup_point_id`、`location{lat,lng}`（乘客目前位置，必填）、選填 `destination{name,lat,lng}`、`stop_ids`、`tag_filters[{tag_id,intent}]`；目的地與公車站沒帶時用乘客的常用資料。一律回 `201` 與請求的當下結果：`status` 為 `rejected`（位置離上車點超過送出請求距離，`reason: too_far` 與 `message`）、`no_match`（`message` 為「目前沒有可搭的車」）、`waiting_driver`（已分配排序第一且還有座位的車並暫留座位，`trip_id`、`dropoff_bus_stop_id`、`response_deadline_at`），或 `confirmed`（該行程啟用自動接受，座位正式佔用，乘客最新的參與主檔關聯到該行程）。`relaxed` 表示分配的車未符合全部建議標籤。請求與位置（`submitted_lat`、`submitted_lng`）一律保存。位置缺漏回 `400 invalid_location`，其餘參數錯誤同供給查詢（`invalid_pickup_point`、`destination_required`、`stops_required`、`invalid_stop`、`invalid_tag`、`invalid_request`）。駕駛回應、逾時與改配、查詢請求狀態屬 T13 |
| GET | `/api/driver/requests` | 駕駛 | 駕駛進行中行程的請求（T13，REQ-049、REQ-066）：`trip_id`（沒有進行中的行程為 `null`，兩個清單為空）、`pending`（等待回應的請求：`id`、`passenger_name`、`pickup_point`、`dropoff{bus_stop_id,name,lat,lng}`——`bus_stop_id` 為 `null` 表示行程目的地、`relaxed`、`response_deadline_at`）與 `passengers`（已確認或已上車的乘客，同樣含 `dropoff`，`boarded` 標示是否已上車） |
| POST | `/api/driver/requests/:id/accept` | 駕駛 | 確認請求：暫留的座位轉為正式佔用，乘客最新的參與主檔關聯到該行程（DD-25）。回 `200` 與請求；請求不是這位駕駛行程的回 `404 not_found`，已不在等待回應（已回應、已逾時改配）回 `409 not_waiting` |
| POST | `/api/driver/requests/:id/decline` | 駕駛 | 婉拒請求：釋放座位並改配給排序中下一台還有座位的車（該車自動接受則直接確認），沒有車可配為 `no_match`。錯誤同 `accept` |
| POST | `/api/driver/requests/:id/board` | 駕駛 | 標記乘客已上車（DD-27）。回 `200` 與請求；乘客已先標記則直接回已上車的請求（`boarded_at` 為先到者的時間），座位計數不變。請求不是已確認或已上車回 `409 invalid_state`，不是這位駕駛行程的回 `404 not_found` |
| POST | `/api/driver/requests/:id/complete` | 駕駛 | 替乘客結束共乘（REQ-067、DD-23），已確認或已上車皆可：釋放座位、建立服務紀錄，並在同一個交易中依該駕駛與乘客累積的服務紀錄重新計算常用資料（DD-19：各欄位取最常出現的值，次數相同取最近一趟；乘客平常抵達時間取完成時間（台北時間）的中位數，可接受的下車公車站為實際用過的公車站）。已完成則直接回已完成的請求。錯誤同 `board` |
| GET | `/api/passenger/requests/current` | 乘客 | 乘客尚未結束（等待駕駛、已確認、已上車）的請求狀態，沒有則回 `{"request": null}`；乘客介面開啟時帶出（REQ-069） |
| GET | `/api/passenger/requests/:id` | 乘客 | 請求狀態（輪詢用，REQ-052、REQ-053）：送出請求的欄位加上 `boarded_at`、`completed_at`、`reassigned_count`（婉拒或逾時而改配的次數）。已確認時另含 `pickup_point`、`vehicle{plate,description}`、`eta_s`（尚無駕駛位置為 `null`）與 `trip`（含路線與沿途公車站）；等待、已上車與之後這四項皆為 `null`。`no_match` 帶 `reason`、`message`。不是自己的請求回 `404 not_found` |
| POST | `/api/passenger/requests/:id/board` | 乘客 | 乘客標記自己已上車，行為同駕駛的 `board` |
| POST | `/api/passenger/requests/:id/complete` | 乘客 | 乘客結束自己的共乘（主要方式），行為同駕駛的 `complete` |

- 除 `/api/ping` 外都需要 `Authorization: Bearer <角色>:<帳號>`：格式錯誤或帳號不存在回 `401`，帳號沒有該角色或角色不能使用該 API 回 `403`。
- 行程路線目前由模擬的直線備援產生（`route.simulated` 為 `true`，距離為直線 × 1.3、時速 20 公里，DD-09）；T07 的真實來源完成後換進 `RouteProvider` 即可。園區範圍由後端啟動時載入 `backend/config/park/boundary.geojson`，可用環境變數 `PARK_BOUNDARY` 指定其他路徑。
- 請求逾時（DD-13）：每筆等待中的請求以 `response_deadline_at` 為唯一的計時依據，時限來自 `system_settings.driver_confirm_timeout`（每次分配時讀取）。後端啟動時起一個背景掃描（每秒一次，`server.RunTimeoutSweeper`），把已逾時的請求改配；服務重啟後第一次掃描就會處理停機期間逾時的請求。確認、婉拒、逾時、上車與結束都先鎖定請求列再用條件式狀態轉換，同時發生時只有一方生效，後到的得到先到者的結果。
- 座位計算（暫留、正式佔用、釋放，`internal/server/seats.go`）是供請求流程使用的內部介面，沒有 HTTP API。
- 錯誤一律回 `{"error":{"code":"...","message":"..."}}`。
- 系統設定（`system_settings`）只供後端元件透過 `internal/settings` 讀取，每次都查資料庫，改 SQL 後不需重啟即可生效；沒有對外 API（DD-20）。
- 後端測試（`cd backend && go test ./...`）連線本機資料庫（需先 `just infra up`、`just backend db-apply`），每個測試在交易中執行並回滾；可用 `TEST_DATABASE_URL` 覆寫連線字串。

啟動後可用 `curl -i localhost:8080/api/ping` 驗證。

### API 整合測試（Karate）

測試位於 `backend/karate/`（Maven 專案，[Karate](https://github.com/karatelabs/karate) 2.1.3、Java 21 以上），以 `just backend karate` 執行。

- 針對**已啟動**的後端與資料庫；需先 `just infra up` 與 `just backend db-apply`。測試依賴種子資料：測試帳號（見下節）、標籤、上車點與公車站，不自行建立。
- 測試資料的原則：**有 REST API 可寫入就用 API**（例如以 `PUT`／`DELETE /api/me/tags/:id` 選擇與取消標籤，並在情境結束前還原）；**只有沒有 API 可用時才用 SQL**（目前是帳號與常用資料，見 DD-19），寫在 `profiles.feature`，由 `Db.java` 以 `carpool` 角色寫入。
- SQL 建立的帳號名稱帶 `karate-` 前綴與隨機後綴；每個情境結束時由 `cleanup.feature` 刪除（常用資料隨帳號連動刪除），因此情境可平行執行，也不會留下資料。新增這類情境時沿用同一做法。
- **新增或修改 API 的任務，一律要同時補上 Karate 情境**，覆蓋成功、被拒絕與未帶 token 的情況。
- 請求流程（`request-flow.feature`）同樣在最後一個上車點建立車輛，但標籤不夠每個情境各用一個，所以每個情境以 SQL 建立專屬標籤（標籤沒有 API）並在情境結束時刪除。逾時情境以 SQL 把期限改到過去（沒有 API 可以撥動時鐘），再等背景掃描改配。
- 請求（`requests.feature`）在最後一個上車點（大巨蛋）建立車輛，並讓每個情境各用一個專屬標籤隔離自己的車（乘客要求該標籤，只有該情境的車帶有），因此情境可平行執行；送出過請求的乘客帳號會留在資料庫（`ride_requests` 參照 `users`），行程由 `cleanup-tracking.feature` 結束。
- 位置回報（`location.feature`）是例外：`location_reports` 只新增（DD-06），觸發器擋下 `DELETE`，且回報掛在 `activities` 之下、`activities.user_id` 的外鍵不連動刪除，所以表示過參與的帳號無法被刪除。做法：每個情境各用一個全新的 `karate-track-` 帳號（可平行、斷言精確）；目前沒有行程 API，進行中的行程以 SQL 建立；情境結束時由 `cleanup-tracking.feature` 將該帳號的行程設為 `completed`，並刪除從未表示過參與的帳號。表示過參與的 `karate-track-` 帳號會留在資料庫，不影響其他測試與供給查詢。
- 行程（`trips.feature`）同理：出發會建立參與主檔，所以每個情境各用一個全新的 `karate-trip-` 駕駛帳號，結束時由 `cleanup-tracking.feature` 結束其行程；帳號本身會留在資料庫。
- 以 `-DbaseUrl=...` 指定後端位址（預設 `http://localhost:8080`），以 `-DdbUrl=...`、`-DdbUser=...`、`-DdbPassword=...` 指定 JDBC 連線（預設 `jdbc:postgresql://localhost:5432/carpool`、`carpool`／`carpool`）；`just backend karate` 會依 `PORT`、`POSTGRES_PORT`、`POSTGRES_DB` 帶入。
- `.feature` 檔放在 `backend/karate/src/test/java/carpool/api/`；報表在 `backend/karate/target/karate-reports/`。

## 測試帳號

由遷移 `backend/migrations/20261018123407_seed_test_users.sql` 建立，皆為模擬帳號（`simulated = true`），每個帳號只有單一角色。

| 帳號 | 顯示名稱 | 角色 | Bearer token |
| --- | --- | --- | --- |
| `passenger1` | 乘客 小美 | 乘客 | `passenger:passenger1` |
| `passenger2` | 乘客 小華 | 乘客 | `passenger:passenger2` |
| `driver1` | 駕駛 鐵雄 | 駕駛 | `driver:driver1` |
| `driver2` | 駕駛 大明 | 駕駛 | `driver:driver2` |
| `driver3` | 駕駛 珍珍 | 駕駛 | `driver:driver3` |
| `driver4` | 駕駛 阿丁 | 駕駛 | `driver:driver4` |
| `driver5` | 駕駛 阿龍 | 駕駛 | `driver:driver5` |

呼叫 API 時以 `Authorization: Bearer <token>` 指定身分（DD-18），例如 `curl -H 'Authorization: Bearer driver:driver1' localhost:8080/api/ping`。

## 種子資料

由遷移 `backend/migrations/20261018140000_seed_reference_data.sql` 建立，所有語句皆可重複執行（`ON CONFLICT`／`NOT EXISTS`）。

- 上車點：松山車站、台北世貿中心、台北大巨蛋（範圍半徑 80 m）。世貿與大巨蛋在地面上、進入停車場前的專用車道：世貿在信義路五段旁通往世貿一館停車場的車道（25.03315, 121.5619，已在地圖上確認），大巨蛋在西側光復南路上（25.044249, 121.557934，使用者指定）。
- 內湖科學園區範圍：不存資料庫，是 GeoJSON 檔 `backend/config/park/boundary.geojson` 的 52 點多邊形，涵蓋北段與南段（西緣沿堤頂大道（北端到內湖路一段）與基隆河河濱公園的堤防側（河濱公園不含在內），南段北到民權東路六段、南到基隆河北岸、東到行愛路）；園區內公車站 97 個，由 `docs/data/busstop/busstops.csv` 以該多邊形篩選匯入。
- 標籤：6 個使用者自選標籤（`issuer = 'self'`）。
- 模擬行程：`driver1`～`driver3` 皆從松山車站出發、座位 3／4／2、自動接受，狀態為進行中（`active`、設定已鎖定、`started_at = now()`）；`driver4`、`driver5` 無行程，供真人從駕駛介面操作。`driver3` 帶有「不抽菸」「安靜通勤」標籤，`driver2` 帶有「可載行李」。
- 車輛與位置回報主檔：由遷移 `backend/migrations/20261019130000_activities_and_vehicles.sql` 建立 `vehicles`、`activities` 兩張表。`driver1`～`driver5` 各有 1 輛車（車牌與描述為暫定的範例資料，可自行修改）；3 筆模擬行程的駕駛各有 1 筆關聯到該行程的主檔，讓模擬器可直接回報位置。乘客的主檔在乘客呼叫 `POST /api/activities` 時才建立。
- Demo 乘客（尚未建立為資料，請求時輸入）：`passenger1` 在松山車站，最終目的地約 (25.0765, 121.5742)（瑞光路），可接受的公車站為「瑞光港墘路口」（`stop_id` 1013）與「港墘路」（`stop_id` 1106）。`driver1`、`driver3` 的目的地在其 200 m 內（完全相符），`driver2` 的目的地在基湖路，只能靠沿途公車站相符；取捨結果須待 T07／T08 提供路線與位置後才能驗證。
- 重建：遷移已套用的資料庫要改種子時，用 `just backend db-reset`。Down 只在剛種子的資料庫可用，跑過 Demo 後（位置紀錄、請求都會參照這些資料）請改用 `db-reset`。
- 系統設定預設值在建立結構的遷移中（`system_settings`）。
- 離開緩衝 `pass_margin`（預設 25 m）由遷移 `backend/migrations/20261019150000_pass_margin_setting.sql` 加入：車輛進入上車點範圍（`radius_m`）後，要離上車點超過「`radius_m` ＋ `pass_margin`」才算已經過，避免定位誤差在範圍邊緣造成誤判（DD-06）。每次回報都會重新讀取，改 SQL 後立即生效；設為 0 即為單一門檻。
