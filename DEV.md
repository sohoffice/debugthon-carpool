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
- [測試帳號](#測試帳號)

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

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/ping` | 健康檢查，回傳 `200 OK` 與 `{"status":"ok"}` |

啟動後可用 `curl -i localhost:8080/api/ping` 驗證。

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
