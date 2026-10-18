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

前端指令定義於 `ui/justfile`，並透過根目錄 `justfile` 的 `mod ui` 載入（`just ui <指令>`）。開發原則見 `ui/CLAUDE.md`。

| 指令 | 說明 |
| --- | --- |
| `just ui install` | 安裝所有前端 workspace 的 npm 套件（第一次使用前執行） |
| `just ui driver` | 啟動駕駛介面開發伺服器，網址 `http://localhost:5173` |
| `just ui passenger` | 啟動乘客介面開發伺服器，網址 `http://localhost:5174` |
| `just ui test` | 型別檢查並執行所有前端測試 |

- 開發時 `/api` 會轉送到後端，預設 `http://localhost:8080`，可用 `API_PROXY_TARGET` 覆寫。
- 以網址參數切換 Demo 帳號，例如 `http://localhost:5173/?account=driver2`。
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

- 除 `/api/ping` 外都需要 `Authorization: Bearer <角色>:<帳號>`：格式錯誤或帳號不存在回 `401`，帳號沒有該角色或角色不能使用該 API 回 `403`。
- 錯誤一律回 `{"error":{"code":"...","message":"..."}}`。
- 系統設定（`system_settings`）只供後端元件透過 `internal/settings` 讀取，每次都查資料庫，改 SQL 後不需重啟即可生效；沒有對外 API（DD-20）。
- 後端測試（`cd backend && go test ./...`）連線本機資料庫（需先 `just infra up`、`just backend db-apply`），每個測試在交易中執行並回滾；可用 `TEST_DATABASE_URL` 覆寫連線字串。

啟動後可用 `curl -i localhost:8080/api/ping` 驗證。

### API 整合測試（Karate）

測試位於 `backend/karate/`（Maven 專案，[Karate](https://github.com/karatelabs/karate) 2.1.3、Java 21 以上），以 `just backend karate` 執行。

- 針對**已啟動**的後端與資料庫；需先 `just infra up` 與 `just backend db-apply`。測試依賴種子資料：測試帳號（見下節）、標籤、上車點與公車站，不自行建立。
- 測試資料的原則：**有 REST API 可寫入就用 API**（例如以 `PUT`／`DELETE /api/me/tags/:id` 選擇與取消標籤，並在情境結束前還原）；**只有沒有 API 可用時才用 SQL**（目前是帳號與常用資料，見 DD-19），寫在 `profiles.feature`，由 `Db.java` 以 `carpool` 角色寫入。
- SQL 建立的帳號名稱帶 `karate-` 前綴與隨機後綴；每個情境結束時由 `cleanup.feature` 刪除（常用資料隨帳號連動刪除），因此情境可平行執行，也不會留下資料。新增這類情境時沿用同一做法。
- 以 `-DbaseUrl=...` 指定後端位址（預設 `http://localhost:8080`），以 `-DdbUrl=...`、`-DdbUser=...`、`-DdbPassword=...` 指定 JDBC 連線（預設 `jdbc:postgresql://localhost:5432/carpool`、`carpool`／`carpool`）；`just backend karate` 會依 `PORT`、`POSTGRES_PORT`、`POSTGRES_DB` 帶入。
- `.feature` 檔放在 `backend/karate/src/test/java/carpool/api/`；報表在 `backend/karate/target/karate-reports/`。

## 測試帳號

由遷移 `backend/migrations/20261018123407_seed_test_users.sql` 建立，皆為模擬帳號（`simulated = true`），每個帳號只有單一角色。

| 帳號 | 顯示名稱 | 角色 | Bearer token |
| --- | --- | --- | --- |
| `passenger1` | 乘客 小美 | 乘客 | `passenger:passenger1` |
| `passenger2` | 乘客 小華 | 乘客 | `passenger:passenger2` |
| `driver1` | 駕駛 阿明 | 駕駛 | `driver:driver1` |
| `driver2` | 駕駛 阿強 | 駕駛 | `driver:driver2` |
| `driver3` | 駕駛 阿珍 | 駕駛 | `driver:driver3` |
| `driver4` | 駕駛 阿德 | 駕駛 | `driver:driver4` |
| `driver5` | 駕駛 阿芬 | 駕駛 | `driver:driver5` |

呼叫 API 時以 `Authorization: Bearer <token>` 指定身分（DD-18），例如 `curl -H 'Authorization: Bearer driver:driver1' localhost:8080/api/ping`。

## 種子資料

由遷移 `backend/migrations/20261018140000_seed_reference_data.sql` 建立，所有語句皆可重複執行（`ON CONFLICT`／`NOT EXISTS`）。

- 上車點：松山車站、台北世貿中心、台北大巨蛋（範圍半徑 80 m）。世貿與大巨蛋在地面上、進入停車場前的專用車道：世貿在信義路五段旁通往世貿一館停車場的車道（25.03315, 121.5619，已在地圖上確認），大巨蛋在西側光復南路上（25.044249, 121.557934，使用者指定）。
- 內湖科學園區範圍：`park_boundary_points` 的 52 點多邊形，涵蓋北段與南段（西緣沿堤頂大道（北端到內湖路一段）與基隆河河濱公園的堤防側（河濱公園不含在內），南段北到民權東路六段、南到基隆河北岸、東到行愛路）；園區內公車站 97 個，由 `docs/data/busstop/busstops.csv` 以該多邊形篩選匯入。
- 標籤：6 個使用者自選標籤（`issuer = 'self'`）。
- 模擬行程：`driver1`～`driver3` 皆從松山車站出發、座位 3／4／2、自動接受，狀態為進行中（`active`、設定已鎖定、`started_at = now()`）；`driver4`、`driver5` 無行程，供真人從駕駛介面操作。`driver3` 帶有「不抽菸」「安靜通勤」標籤，`driver2` 帶有「可載行李」。
- Demo 乘客（尚未建立為資料，請求時輸入）：`passenger1` 在松山車站，最終目的地約 (25.0765, 121.5742)（瑞光路），可接受的公車站為「瑞光港墘路口」（`stop_id` 1013）與「港墘路」（`stop_id` 1106）。`driver1`、`driver3` 的目的地在其 200 m 內（完全相符），`driver2` 的目的地在基湖路，只能靠沿途公車站相符；取捨結果須待 T07／T08 提供路線與位置後才能驗證。
- 重建：遷移已套用的資料庫要改種子時，用 `just backend db-reset`。Down 只在剛種子的資料庫可用，跑過 Demo 後（位置紀錄、請求都會參照這些資料）請改用 `db-reset`。
- 系統設定預設值在建立結構的遷移中（`system_settings`）。
