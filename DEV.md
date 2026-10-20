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
| `just ui mock-reset` | 重設示範後端（和 Go 後端相同的 `POST /api/demo/reset`） |
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
| GET | `/api/places?q=` | 任一 | 園區內的目的地搜尋（最多 8 筆）：用過的目的地與公車站名稱，供地址輸入使用；PoC 沒有地理編碼服務 |
| POST | `/api/driver/route-preview` | 駕駛 | 出發前的路線預覽：`pickup_point_id`、`destination`，回傳和出發時相同格式的 `route`，不建立行程；目的地不在園區內回 `400 destination_outside_park` |
| GET | `/api/driver/trip` | 駕駛 | 駕駛介面的輪詢（DD-04）：進行中的行程（沒有時為最近一趟，從未出發為 `null`），另含 `ended_at`、待回應的請求 `pending_request`、已確認乘客 `passengers[{request_id,dropoff,boarded}]` 與這趟完成的人數 `completed_count` |
| POST | `/api/driver/requests/:id/accept` | 駕駛 | 確認請求：暫留座位轉為正式佔用，乘客的參與主檔關聯到行程（DD-25）；不是等待中回 `409 request_not_pending` |
| POST | `/api/driver/requests/:id/decline` | 駕駛 | 婉拒：釋放座位並改配下一台（REQ-050） |
| POST | `/api/driver/requests/:id/board` | 駕駛 | 標記乘客已上車（DD-27）；已標記不報錯 |
| POST | `/api/driver/requests/:id/complete` | 駕駛 | 替乘客結束共乘（DD-23）；已結束不報錯 |
| GET | `/api/passenger/supply?…` | 乘客 | 供給查詢（T11）：`pickup_point_id`、`destination_name`、`destination_lat`、`destination_lng`、`accepted_stop_ids`、`required_tag_ids`、`preferred_tag_ids`（多個值以逗號分隔）；回傳該上車點的車數、最快到達、空位、各車 ETA、等待上限與送出請求距離。缺上車點、目的地或公車站回 `400 invalid_request` |
| POST | `/api/passenger/requests` | 乘客 | 送出請求（T12）：供給查詢的內容加上 `location`（目前位置，DD-25）。立即回傳結果：`rejected`（超過送出請求距離）、`no_match`（附步行替代方案）、`waiting_driver` 或 `confirmed`（自動接受）。已有進行中的請求回 `409 request_active` |
| GET | `/api/passenger/request` | 乘客 | 乘客介面的輪詢：最近一筆請求與狀態；已確認時含車輛、ETA、下車點、行程路線與車輛位置、行進方向；已上車時不含 ETA 與位置（REQ-068） |
| POST | `/api/passenger/requests/:id/cancel` | 乘客 | 上車前取消（UD-17），座位釋放；上車後或車已經過上車點回 `409 cannot_cancel` |
| POST | `/api/passenger/requests/:id/board` | 乘客 | 「我已上車」（DD-27）；已標記不報錯 |
| POST | `/api/passenger/requests/:id/complete` | 乘客 | 「我已下車，結束共乘」（DD-23）：建立服務紀錄並更新雙方的常用資料（DD-19）；已結束不報錯 |
| POST | `/api/demo/reset` | 免身分 | 重設 Demo（UD-18），回 `204`：只動 Demo 帳號（`users.simulated`），清除它們的請求與服務紀錄、結束它們的行程、以新的行程重新開始模擬行程，並重新寫入 Demo 種子（`demo_seed_extras()`） |

- 除 `/api/ping` 外都需要 `Authorization: Bearer <角色>:<帳號>`：格式錯誤或帳號不存在回 `401`，帳號沒有該角色或角色不能使用該 API 回 `403`。
- 行程路線目前由模擬的直線備援產生（`route.simulated` 為 `true`，距離為直線 × 1.3、時速 20 公里，DD-09）；T07 的真實來源完成後換進 `RouteProvider` 即可。園區範圍由後端啟動時載入 `backend/config/park/boundary.geojson`，可用環境變數 `PARK_BOUNDARY` 指定其他路徑。
- 座位計算（暫留、正式佔用、釋放，`internal/server/seats.go`）是供請求流程使用的內部介面，沒有 HTTP API。
- 請求流程（`internal/server/requestflow.go`）：分配、確認、婉拒、逾時、上車、結束共乘與取消都在同一把 advisory lock 下的交易中進行，所以座位依送出順序分配（REQ-048、DD-12）。駕駛確認時限由後端計時（DD-13）：伺服器每秒檢查一次到期的請求，兩個輪詢 API 也會先檢查；期限存在資料庫，重啟後照常生效。
- 駕駛的回報經過上車點之後，回報位置離目的地 50 公尺內時，行程自動結束，車上的共乘一併完成（UD-16）。
- 錯誤一律回 `{"error":{"code":"...","message":"..."}}`。
- 系統設定（`system_settings`）只供後端元件透過 `internal/settings` 讀取，每次都查資料庫，改 SQL 後不需重啟即可生效；沒有對外 API（DD-20）。
- 後端測試（`cd backend && go test ./...`）連線本機資料庫（需先 `just infra up`、`just backend db-apply`），每個測試在交易中執行並回滾；可用 `TEST_DATABASE_URL` 覆寫連線字串。

啟動後可用 `curl -i localhost:8080/api/ping` 驗證。

### API 整合測試（Karate）

測試位於 `backend/karate/`（Maven 專案，[Karate](https://github.com/karatelabs/karate) 2.1.3、Java 21 以上），以 `just backend karate` 執行。

- 針對**已啟動**的後端與資料庫；需先 `just infra up` 與 `just backend db-apply`。測試依賴種子資料：測試帳號（見下節）、標籤、上車點與公車站，不自行建立。
- 在同一個資料庫跑過 Demo 後（真的完成過共乘，種子帳號就會累積常用資料，DD-19），先 `curl -X POST localhost:8080/api/demo/reset` 回到種子狀態再跑，否則假設種子帳號沒有常用資料的情境會失敗。
- 測試資料的原則：**有 REST API 可寫入就用 API**（例如以 `PUT`／`DELETE /api/me/tags/:id` 選擇與取消標籤，並在情境結束前還原）；**只有沒有 API 可用時才用 SQL**（目前是帳號與常用資料，見 DD-19），寫在 `profiles.feature`，由 `Db.java` 以 `carpool` 角色寫入。
- SQL 建立的帳號名稱帶 `karate-` 前綴與隨機後綴；每個情境結束時由 `cleanup.feature` 刪除（常用資料隨帳號連動刪除），因此情境可平行執行，也不會留下資料。新增這類情境時沿用同一做法。
- **新增或修改 API 的任務，一律要同時補上 Karate 情境**，覆蓋成功、被拒絕與未帶 token 的情況。
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
- Demo 種子補充（遷移 `backend/migrations/20261020090100_demo_seed_extras.sql`，函式 `demo_seed_extras()`，Demo 重設時也會再執行）：`passenger1` 的常用資料（目的地瑞光路 513 巷、可接受公車站同下），讓乘客介面直接進供給看板；`driver4` 一趟已結束的行程（松山車站 → 瑞光路 513 巷、可載 3 人、不自動接受、「不抽菸」建議），讓出發確認畫面預先帶入。`passenger2`、`driver5` 都沒有，用來展示第一次使用的畫面。
- Demo 乘客：`passenger1` 在松山車站，最終目的地約 (25.0765, 121.5742)（瑞光路），可接受的公車站為「瑞光港墘路口」（`stop_id` 1013）與「港墘路」（`stop_id` 1106）。`driver1`、`driver3` 的目的地在其 200 m 內（完全相符），`driver2` 的目的地在基湖路，只能靠沿途公車站相符；取捨結果須待 T07／T08 提供路線與位置後才能驗證。
- 重建：遷移已套用的資料庫要改種子時，用 `just backend db-reset`。Down 只在剛種子的資料庫可用，跑過 Demo 後（位置紀錄、請求都會參照這些資料）請改用 `db-reset`。
- 系統設定預設值在建立結構的遷移中（`system_settings`）。
- 離開緩衝 `pass_margin`（預設 25 m）由遷移 `backend/migrations/20261019150000_pass_margin_setting.sql` 加入：車輛進入上車點範圍（`radius_m`）後，要離上車點超過「`radius_m` ＋ `pass_margin`」才算已經過，避免定位誤差在範圍邊緣造成誤判（DD-06）。每次回報都會重新讀取，改 SQL 後立即生效；設為 0 即為單一門檻。
