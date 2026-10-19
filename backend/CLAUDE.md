# Backend — CLAUDE.md

## 目錄

- [概覽](#概覽)
- [測試策略](#測試策略)
  - [單元測試（Go）](#單元測試go)
  - [API 測試（Karate）](#api-測試karate)

## 概覽

內科順路共乘的後端：Go（Gin）HTTP API，資料存於 PostgreSQL（pgx），結構以 goose SQL 遷移管理（`migrations/`）。進入點為 `cmd/server`，路由與處理函式在 `internal/server`，設定在 `internal/settings`。指令（`just backend …`）與環境設定見 `../DEV.md`。

## 測試策略

每個功能都要同時有 Go 單元測試與 Karate API 測試：單元測試驗證邏輯與 SQL，Karate 從外部驗證 HTTP 契約。

### 單元測試（Go）

- 測試檔與被測程式放在同一 package（`*_test.go`），以 `go test ./...` 執行。
- 需要資料庫的測試以 `testTx(t)`（`internal/server/testdb_test.go`）取得交易，測試結束時自動回滾，不留資料；連線預設本機 `carpool` 使用者，可用 `TEST_DATABASE_URL` 覆寫。
- 執行前需 `just infra up` 與 `just backend db-apply`。

### API 測試（Karate）

- 位於 `karate/`，`.feature` 檔放在 `karate/src/test/java/carpool/api/`，以 `just backend karate` 執行（會自動啟動後端）。
- 針對已啟動的後端與種子資料；測試資料優先透過 REST API 建立並在情境結束前還原，只有沒有 API 時才用 SQL（`profiles.feature`／`Db.java`），並由 `cleanup.feature` 清除。
- 完整規則見 `../DEV.md` 的〈API 整合測試（Karate）〉。
