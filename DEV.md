# 開發指南

## 目錄

- [專案資源](#專案資源)
- [前置需求](#前置需求)
- [Just 指令](#just-指令)
  - [後端](#後端)
  - [基礎設施](#基礎設施)
  - [前端](#前端)
  - [Demo](#demo)
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
- Java 21 以上與 [Maven](https://maven.apache.org/) 3.8 以上：執行 Karate API 測試（`just backend karate`）用；版本不符時 Maven 在編譯前就以訊息指出需要的版本
- [Node.js](https://nodejs.org/) 22（22.18 以上）、24 或 26 以上：`just demo-offstage` 與示範後端直接執行 `.ts` 檔，需要 Node 原生支援 TypeScript（22.18、23.6 起）；Vitest 只支援 22.12 以上的 22、24 與 26 以上，不含 23、25

## Just 指令

在專案根目錄執行 `just help`（或直接執行 `just`）可列出所有指令。

### 後端

後端指令定義於 `backend/justfile`，並透過根目錄 `justfile` 的 `mod backend` 載入，因此以 `backend` 為子指令前綴（`just backend <指令>`）。

| 指令 | 說明 |
| --- | --- |
| `just backend up` | 編譯後端並在背景啟動，預設監聽 `:8080`；若已在執行則不重複啟動。連接埠被其他程式占用時直接報錯；啟動後等 `/api/ping` 回應（最多 15 秒），沒回應就印出 log 最後幾行並以失敗結束 |
| `just backend down` | 停止由 `up` 啟動的後端，並等它真的結束（最多 15 秒）才返回，接著 `up` 不會撞到還沒放開的連接埠 |
| `just backend test` | 執行後端 Go 測試（`go test ./...`），需先 `just infra up` 與 `just backend db-apply` |
| `just backend karate` | 另外啟動一個 Karate 專用的後端（`:18080`，空的 `MAP_API_KEY`，測試不呼叫真實 Google），以 Karate 執行 API 整合測試，結束後關掉；不會動到執行中的 `just backend up`／`just demo` 後端（見下方說明） |
| `just backend db-apply` | 套用尚未執行的資料庫遷移（需先 `just infra up`） |
| `just backend db-rollback` | 回滾最近一次已套用的遷移（執行該檔的 `-- +goose Down`） |
| `just backend migrate-status` | 顯示各遷移的套用狀態 |
| `just backend migrate-new <名稱>` | 在 `backend/migrations/` 建立新的 SQL 遷移檔 |
| `just backend db-reset` | 清空 `public` schema 並重新套用全部遷移（測試資料可隨時重建） |

- 以環境變數 `PORT` 變更連接埠，例如 `PORT=9000 just backend up`。
- Demo 重設 API（`POST /api/demo/reset`，DD-29）只在環境變數 `DEMO_RESET` 為真（`1`、`true`）時註冊；後端程式本身預設不開。本機開發就是 Demo 環境（DD-24），所以 `just backend up` 預設帶 `DEMO_RESET=1`，展示頁的重設按鈕與 Karate 不必另外設定；要關掉用 `DEMO_RESET=0 just backend up`（已在執行時先 `just backend down`）。
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
- `docker-compose.yml` 固定專案名稱 `debugthon-carpool`，所以共用 checkout 和每個 git worktree 用的都是同一個 Postgres（容器 `debugthon-carpool-postgres-1`、資料卷 `debugthon-carpool_pgdata`）。從任何 worktree 執行 `just infra down`／`just infra reset` 都會作用在這個共用的 Postgres 上，`reset` 會清掉 Demo 的資料；Demo 或演練前後不要從 worktree 執行。需要另一套獨立的資料庫時，用 `COMPOSE_PROJECT_NAME=<名稱> POSTGRES_PORT=55432 just infra up`（`COMPOSE_PROJECT_NAME` 會蓋過固定的名稱）。

### 前端

前端指令定義於 `ui/justfile`，並透過根目錄 `justfile` 的 `mod ui` 載入（`just ui <指令>`）。開發原則見 `ui/CLAUDE.md`，UI 設計見 `docs/ui-design.md`。

| 指令 | 說明 |
| --- | --- |
| `just ui install` | 安裝所有前端 workspace 的 npm 套件（第一次使用前執行） |
| `just ui driver` | 啟動駕駛介面開發伺服器，網址 `http://localhost:5173` |
| `just ui passenger` | 啟動乘客介面開發伺服器，網址 `http://localhost:5174` |
| `just ui showcase` | 啟動展示頁（UD-18），網址 `http://localhost:5170`，並排嵌入駕駛與乘客介面 |
| `just ui city` | 啟動市府管理介面（DD-39，桌機版面），網址 `http://localhost:5175/?account=city1` |
| `just ui dev-mock` | 啟動示範後端（`:8081`）、兩個介面、展示頁與市府管理介面，全部連到示範後端（開發期間用） |
| `just ui dev` | 啟動兩個介面、展示頁與市府管理介面，連到 Go 後端 `:8080`（後端先用 `just backend up` 啟動） |
| `just ui mock` | 只啟動示範後端 `:8081` |
| `just ui mock-scenario <情境>` | 切換示範情境並重設：`normal`、`reassign`、`no_cars` |
| `just ui mock-advance <秒數>` | 把示範後端的時鐘往前撥，例如讓車開到目的地 |
| `just ui mock-reset` | 重設示範後端（`POST /api/demo/reset`；Go 後端用 `just demo-reset`） |
| `just ui test` | 型別檢查並執行所有前端測試 |
| `just ui e2e` | 執行前端端對端測試（Playwright，T18B）：自己啟動示範後端與兩個介面，透過瀏覽器走完快樂路徑 |
| `just ui e2e-go` | 同樣的流程接 Go 後端（T18B）：自己建置並啟動 Go 後端，用獨立的資料庫 `carpool_e2e`；需要先 `just infra up` |

- 端對端測試（`ui/e2e/`，示範後端的設定在 `ui/playwright.config.ts`，Go 後端的在 `ui/playwright.go.config.ts`）：
  - `just ui e2e` 第一次執行時會下載 Playwright 的 Chromium。
  - 測試自己啟動示範後端 `:8091`、駕駛介面 `:5183`、乘客介面 `:5184`，以及帶假金鑰的駕駛介面 `:5185`、乘客介面 `:5186`，不會用到開發中的伺服器。
  - 每個測試前後都重設示範後端，不留下資料。
  - 不帶地圖金鑰，地圖只顯示提示文字。園區範圍檢查的測試（`park-check.spec.ts`）要搜尋目的地，改連 `:5185`、`:5186`，並由 Playwright 攔截 Maps 的腳本、換成 `ui/e2e/fakeGoogleMaps.ts` 的假 API（只認得固定的兩個地點），其他 Google 請求一律擋下，不會呼叫真的 Google。
  - 失敗時的紀錄（trace）在 `ui/test-results/`，可用 `npx playwright show-trace <檔案>` 查看。
  - 接 Go 後端（`just ui e2e-go`，測試在 `ui/e2e/go/`）：
    - `ui/e2e/go/backend.sh` 建立並遷移資料庫 `carpool_e2e`、建置 Go 後端，以 `DEMO_RESET=1` 與空的 `MAP_API_KEY` 在 `:8092` 啟動：Go e2e 一律用模擬路線，不呼叫 Google（空值優先於根目錄 `.env` 的金鑰）；介面在 `:5187`、`:5188`，另有帶假金鑰的駕駛介面 `:5189`、乘客介面 `:5190`。開發用的資料庫 `carpool`、Demo 與 Karate 都不受影響，可以同時執行。
    - 每個測試前後都呼叫 `POST /api/demo/reset`（DD-29），並取消 `driver4` 自選的標籤（重設不還原自選標籤），不留下資料。
    - 測試替模擬器回報 `driver4` 的位置；快樂路徑讓乘客把台上標籤「不抽菸」「可載行李」都設成「強制」，只有台上駕駛兩個都帶（模擬駕駛 `driver2` 只帶「可載行李」、`driver3` 只帶「不抽菸」），請求才會配給 `driver4`（同 Demo 劇本）。
    - 情境：快樂路徑與無車（`happy-path.spec.ts`，含剩餘座位、模擬資料標示、下車點與車輛資訊）、園區範圍檢查（`park-check.spec.ts`）、駕駛婉拒（沒有其他車、改配下一台車）與自動接受（`driver-response.spec.ts`）；共用的重設與開啟介面的函式在 `support.ts`。
    - 一般介面不帶地圖金鑰，只用預先帶入的目的地；園區範圍檢查改連 `:5189`、`:5190`，和示範後端一樣由 Playwright 換成 `ui/e2e/fakeGoogleMaps.ts` 的假 API。
    - 婉拒改配的情境讓 `driver5` 當第二台車：用 API 出發（帶兩個台上標籤「不抽菸」「可載行李」、自動接受關閉、位置比 `driver4` 遠，所以 `driver4` 排第一），在介面上確認。重設不會讓出發過的駕駛回到「第一次出發」（Demo 重設不刪除行程，駕駛的預先帶入取自最近一趟行程，DD-19、DD-29），所以駕駛的園區檢查從 `driver4` 預先帶入的設定開始：園區外的地點被提示、不會取代原目的地；「沒有目的地時『我出發了』無法按」只在示範後端的 e2e 驗證。`carpool_e2e` 若已被舊版測試弄髒，可 `DROP DATABASE carpool_e2e` 後重跑。
- 開發時 `/api` 會轉送到後端，預設 `http://localhost:8080`，可用 `API_PROXY_TARGET` 覆寫；`just ui dev-mock`／`just ui dev` 會自動設定。
- 示範後端（`ui/mock-server/`）是只用 Node 內建模組的小程式，狀態放在記憶體裡，重啟就回到初始狀態。帳號、上車點、公車站、標籤與模擬行程直接讀 `backend/migrations/` 的種子 SQL，和 Go 後端一致。做法見 `docs/ui-design.md` 10.2。
- 以網址參數切換 Demo 帳號，例如 `http://localhost:5173/?account=driver2`。
- 市府管理介面（`ui/city`）以 `?account=city1` 開啟（token `city:city1`），只呼叫 `/api/city/*`；以駕駛或乘客帳號開啟時只顯示無權限的訊息。以 1440 × 900 的桌機畫面設計，不支援手機寬度。示範後端的市府 API 一律以「今天 08:15」為現在（如同設定了 `demo_clock`），數字是另外產生的假資料，和 Go 後端不同。
- 除錯模式（Demo 工具）加上 `?debug=1`，畫面左緣會出現「除錯」標籤（`docs/ui-design.md` 8.8）：
  - 駕駛：`http://localhost:5173/?debug=1` 可切換帳號，並執行模擬器（DD-14）：按「開始模擬」後，有進行中行程的駕駛沿預先定義的路徑回報位置。接 Go 後端時，車輛位置全靠它。Demo 時由 `just demo-offstage` 在背景開一個這樣的頁面，不要再自己另開（見〈Demo〉）。
  - 乘客：`http://localhost:5174/?debug=1` 可設定乘客的目前位置（DD-26），例如「離松山車站 420 公尺」來展示請求被拒絕。同一帳號的其他分頁會跟著改。
- 環境變數放在根目錄 `.env`：
  - `VITE_GOOGLE_MAPS_API_KEY`：瀏覽器用的 Google Maps 金鑰，會公開給使用者。請限制為 HTTP 參照網址，且只開 Maps JavaScript API；不要沿用伺服器端的 `MAP_API_KEY`。未設定時地圖顯示提示文字，其他功能照常運作。
  - `VITE_GOOGLE_MAPS_MAP_ID`：選填，留空則使用 Google 的 `DEMO_MAP_ID`。
  - `MAP_API_KEY`：後端用的 Google Routes 金鑰，只放在伺服器端，且只開 Routes API。有設定時行程路線、行車時間與步行時間來自 Google；留空則用模擬。
  - Go 後端啟動時只載入找到的第一個 `.env`：先找目前目錄，沒有再找上一層（從 `backend/` 執行時就是根目錄的 `.env`），不再往上找，也不會合併兩個檔案；都沒有只記一行 log，不算錯誤。環境中已設定的變數優先，包含設為空值的（例如 `MAP_API_KEY= just backend up` 強制用模擬）。Go 測試不讀 `.env`；`just backend karate` 的專用後端一律以空的 `MAP_API_KEY` 啟動。

### Demo

Demo 時所有元件都在同一台機器上執行（DD-24）。指令定義在根目錄 `justfile`。

| 指令 | 說明 |
| --- | --- |
| `just demo-check` | 檢查 `just demo` 需要、但不會替你準備的東西：Docker 有在執行、Node 能直接執行 TypeScript、根目錄有 `.env`、`:5170`／`:5173`／`:5174`／`:5175` 沒被占用；`MAP_API_KEY` 或 `VITE_GOOGLE_MAPS_API_KEY` 是空的只警告（Demo 會改用模擬路線或不顯示地圖） |
| `just demo` | 一個指令啟動全部元件：先執行 `just demo-check`，再啟動 PostgreSQL（`just infra up`）、套用遷移、重新啟動後端（開啟 Demo 重設）、兩個介面與展示頁（`just ui dev`）。`ui/package-lock.json` 比上次安裝新（例如 pull 之後）或從沒安裝過時，先執行 `just ui install`。按 Ctrl-C 停止介面，後端繼續在背景執行（`just backend down` 停止） |
| `just demo-reset` | 一個指令把 Demo 重設回初始狀態（呼叫 `POST /api/demo/reset`）；展示頁的「重設」按鈕呼叫同一個 API |

- 開啟的網址：展示頁 `http://localhost:5170`（並排嵌入兩支手機）。模擬器（DD-14）由 `just demo-offstage` 在背景開啟，照 `docs/demo-script.md` 演出時不要再另開 `http://localhost:5173/?debug=1` 按「開始模擬」，否則兩個模擬器會同時回報同一批車的位置。不跑台下腳本、只想讓 `driver1`～`driver3` 動起來時，才自己開這個分頁。
- 重設之後，重新執行 `just demo-offstage`（或重新整理自己開的除錯模式駕駛頁面），模擬器就從起點重新開始；展示頁按「重設」會自己重新載入兩支手機。
- 重設的內容（DD-29）只動 Demo 帳號（`users.simulated`），在同一個交易內完成：
  - 刪除 Demo 乘客的請求與這些請求的服務紀錄；這些請求暫留或佔用的座位還給原本的行程。
  - 駕駛點數還原為種子（DD-34）：在刪除服務紀錄之前，刪除 Demo 駕駛的 `ride` 點數紀錄，以及因載 Demo 乘客而產生的 `ride` 點數紀錄（非 Demo 駕駛的累積點數隨之重算為點數紀錄的加總）；再呼叫 `seed_demo_driver_points()`（遷移 `20261022100000_driver_points.sql`），把 Demo 駕駛的累積點數設為 `seed` 紀錄的加總。`seed` 紀錄不刪除。
  - 常用資料還原為種子（DD-19）：刪除 Demo 乘客的常用資料；Demo 駕駛的常用資料列不刪除（累積點數在這一列，DD-34），只清空常用資料欄位。再呼叫資料庫函式 `seed_demo_habitual_data()`（遷移 `20261021120000_demo_seed_function.sql`，值和種子遷移相同，由 `TestDemoSeedFunctionMatchesMigration` 驗證）。這個函式每次都替 `driver4` 新增一趟和種子相同、已結束的行程，所以重設後駕駛介面帶入的是種子的設定，而不是 Demo 中最後一趟的設定。
  - Demo 駕駛尚未結束的行程改為 `cancelled`（不是 `completed`：行程沒有抵達目的地，駕駛介面不會顯示「行程結束」）。
  - `driver1`～`driver3` 最近一趟模擬行程以新的行程重新開始：設定相同，並建立關聯到新行程的參與主檔，模擬器可以直接回報位置。保存的路線只在是真實路線時複製；模擬的直線不複製，新行程第一次讀取時用目前的來源重建，所以斷網時開始的 Demo 在有金鑰時重設，地圖會回到真實路線（DD-09、DD-21）。
  - 不刪除位置紀錄（DD-06），舊的行程與參與主檔都保留。
  - Phase 2 的模擬車流、天氣與上車點統計（T36、T37，DD-40）：呼叫 `generate_commute_simulation`，以重設當下的現在（DD-41）重新產生，見〈後端 API〉的車流與天氣說明。
  - 不動的資料：非 Demo 帳號的請求一律不動（即使在 Demo 駕駛的車上）；使用者自選的標籤（`user_tags`）不還原。
  - 限制：非 Demo 乘客如果正搭 Demo 駕駛的車，重設後他的請求仍是已確認，卻指向一趟已取消的行程；乘客介面不讓有未結束請求的人再送出（REQ-069），他會卡住。Demo 只用 Demo 帳號，Karate 也用自己建立的駕駛，所以實際上不會發生。
- 外部資料來源斷線：有 `MAP_API_KEY` 時，路線與時間來自 Google Routes；斷網或沒有金鑰時，後端改用模擬備援（DD-09），照常運作，估算值都標示為模擬（`simulated: true`，介面顯示「估算」，REQ-063）。模擬的直線不經過 passenger1 可接受的公車站，所以這時 `driver2` 不參與取捨（見〈種子資料〉的取捨 Demo 腳本）。地圖與目的地搜尋（Google Maps、Places）在瀏覽器端，斷網時無法載入。

### 通用

| 指令 | 說明 |
| --- | --- |
| `just help` | 列出所有可用指令（含子模組） |

## 後端 API

| 方法 | 路徑 | 角色 | 說明 |
| --- | --- | --- | --- |
| GET | `/api/ping` | 免身分 | 健康檢查，回傳 `200 OK` 與 `{"status":"ok"}` |
| POST | `/api/demo/reset` | 免身分 | Demo 重設（T17，DD-29）：只在 `DEMO_RESET` 開啟時存在（否則 `404 not_found`），回 `204`。把 Demo 帳號重設回初始狀態，細節見〈[Demo](#demo)〉；Demo 駕駛被結束的行程狀態為 `cancelled` |
| GET | `/api/me` | 駕駛／乘客 | 目前帳號與角色 |
| GET | `/api/pickup-points` | 駕駛／乘客 | 上車點清單 |
| GET | `/api/bus-stops` | 駕駛／乘客 | 園區內公車站清單 |
| GET | `/api/park/check` | 駕駛／乘客 | 園區範圍檢查（T20，DD-32）：查詢參數 `lat`、`lng`，回 `200` 與 `{"inside":true|false}`，判斷和出發、送出搭車請求相同；不在園區內回 `false` 而不是錯誤。座標缺漏、不是數字或超出範圍回 `400 invalid_location` |
| GET | `/api/tags` | 駕駛／乘客 | 標籤清單（T43，REQ-086、DD-42）：每個標籤有 `id`、`name`（只供系統辨識，不呈現給使用者）、`issuer`、`applies_to`（`driver`、`passenger` 或 `both`）、`self_label`（呼叫者角色描述自己的用語）、`filter_label`（呼叫者角色篩選對方的用語）與 `selected`（呼叫者是否已選擇）。用語依 token 的角色回傳，不適用時為 `null`：例如「可載行李」對駕駛是 `self_label`「車上能放大件行李」、`filter_label` 為 `null`，對乘客是 `self_label` 為 `null`、`filter_label`「能放大件行李」。介面只列出有用語的標籤 |
| PUT | `/api/me/tags/:id` | 駕駛／乘客 | 選擇清單中的標籤（重複選擇無影響；不在清單中回 `404 not_found`；不適用於呼叫者角色回 `400 tag_not_applicable`，REQ-008） |
| DELETE | `/api/me/tags/:id` | 駕駛／乘客 | 取消選擇標籤 |
| GET | `/api/driver/profile` | 駕駛 | 名稱 `display_name`（與 `GET /api/me` 相同，T45，DD-35）、常用上車點、常用目的地、可載人數（尚無共乘紀錄時為 `null`），以及車輛 `vehicle{plate,description}`（沒有車輛為 `null`）與累積點數 `point_balance`（T35，REQ-074、DD-34、DD-35；從未記點為 `0`） |
| GET | `/api/driver/points` | 駕駛 | 最近的點數紀錄（T35，REQ-074、DD-35）：回 `200` 與 `{"points":[{delta,reason,service_record_id,created_at}]}`，由新到舊；`reason` 為 `ride`（共乘完成，`service_record_id` 指向該次服務紀錄）或 `seed`（Demo 初始點數，`service_record_id` 為 `null`）。選填 `limit`（1～50，預設 5），超出範圍或不是整數回 `400 invalid_request`；乘客回 `403`。乘客可取得的 API 都不含駕駛點數（REQ-075） |
| GET | `/api/passenger/profile` | 乘客 | 平常抵達時間、常用目的地、可接受的下車公車站 |
| POST | `/api/activities` | 駕駛／乘客 | 表示今天要參與，建立位置回報的主檔（DD-25），回 `201`。駕駛的主檔關聯到進行中的行程（沒有則回 `409 no_active_trip`）；乘客的主檔在請求被確認時才關聯到行程（T12／T13），建立當下不關聯。再次呼叫會建立新的主檔 |
| POST | `/api/location` | 駕駛／乘客 | 回報位置 `{"lat","lng"}`，回 `201`，歸入呼叫者最新的主檔（從未建立過回 `409 no_activity`）。駕駛的回報若主檔有行程，會回傳 `passed_pickup` 與 `trip_ended`：經過上車點之後，回報進入目的地「抵達距離」（`arrival_radius`）之內，行程即自動結束（T21，REQ-070、DD-30），`trip_ended` 為 `true`，詳見下方〈行程自動結束〉。座標缺漏或超出範圍回 `400 invalid_location` |
| GET | `/api/me/location-reports` | 駕駛／乘客 | 呼叫者所有回報過的位置，由舊到新（位置紀錄只新增、不修改） |
| POST | `/api/driver/trips` | 駕駛 | 出發（T05）：`pickup_point_id`、`destination{name,lat,lng}`、`capacity`、`auto_accept`、`tag_filters[{tag_id,intent}]`。回 `201` 與行程（含 `route`：`polyline`、`distance_m`、`duration_s`、`simulated`、沿途 `bus_stops`）。行程立即為 `active` 且 `settings_locked`，並同時建立駕駛的參與主檔，之後可直接 `POST /api/location`。上車點不在清單回 `400 invalid_pickup_point`、目的地不在園區內回 `400 destination_outside_park`、標籤不在清單回 `400 invalid_tag`、欄位錯誤回 `400 invalid_request`、已有進行中的行程回 `409 already_active`。駕駛的標籤篩選只能是強制：`intent` 為 `preferred` 回 `400 intent_not_allowed`（REQ-013）；篩選的標籤不適用於乘客（例如「可載行李」）回 `400 tag_not_applicable`（REQ-085）。選填 `preview_id`（T26，DD-21）：有帶就把該預覽的路線與沿途公車站複製到行程，不呼叫路線規劃，並在同一個交易內把預覽標記為已使用；出發失敗時預覽仍可使用。預覽不存在、不屬於呼叫者、已使用，或上車點、目的地經緯度與出發設定不同（目的地名稱不比對）回 `400 invalid_route_preview`，不改為重新規劃；沒帶 `preview_id` 則在出發時規劃 |
| POST | `/api/driver/route-preview` | 駕駛 | 路線預覽（T20、T26，DD-21）：`pickup_point_id`、`destination{lat,lng}`，回 `200` 與 `{preview_id, route}`，`route` 的格式和出發回傳的行程 `route` 相同（`polyline`、`distance_m`、`duration_s`、`simulated`、沿途 `bus_stops`）。不建立行程；路線與沿途公車站存成一筆預覽（`route_previews`、`route_preview_stops`），`preview_id` 供出發引用；每次預覽都是新的一筆，預覽不清除。上車點不在清單回 `400 invalid_pickup_point`、目的地不在園區內回 `400 destination_outside_park`、欄位錯誤回 `400 invalid_request`，錯誤碼和出發相同；乘客回 `403` |
| GET | `/api/driver/trips/defaults` | 駕駛 | 上一次出發的設定，用來預先帶入下一次出發（REQ-016）；從未出發過則各欄位為 `null`、`tag_filters` 為空 |
| GET | `/api/driver/trips/current` | 駕駛 | 進行中的行程；沒有回 `404` |
| GET | `/api/trips/:id` | 駕駛／乘客 | 行程與其路線、沿途公車站；SQL 預先建立、尚無路線的行程在第一次讀取時補建並保存（DD-21）。`status` 為 `completed` 表示行程已結束（抵達目的地），`ended_at` 為結束時間（未結束為 `null`）；`completed_rides` 為這趟已完成的共乘人數（服務紀錄筆數），給駕駛介面的「行程結束」畫面 |
| GET | `/api/passenger/supply` | 乘客 | 供給查詢（T11）：指定上車點的相關車輛。查詢參數 `pickup_point_id`（必填）、`dest_lat`＋`dest_lng`（選填 `dest_name`）、`stop_ids`（`bus_stops.id`，逗號分隔）、`required_tags`／`preferred_tags`（標籤 id，逗號分隔）；目的地與公車站沒帶時用乘客的常用資料（REQ-025）。回 `200`：`card`（`count`、`fastest_eta_s`、`fastest_eta_simulated`、`seats_remaining`）、`cars`（`trip_id`、`eta_s`、`eta_simulated`、`seats_available`，ETA 由近到遠）、`timeline_range_s`（等待上限，秒）與實際採用的 `destination`、`accepted_stop_ids`。`*_simulated` 為 `true` 表示 ETA 來自模擬的路線備援（REQ-063、DD-09）；沒有車時 `fastest_eta_simulated` 為 `null`。篩選沿用媒合引擎的資格篩選，不排序、不提供選車。上車點缺漏回 `400 invalid_request`、不存在回 `400 invalid_pickup_point`、沒有目的地回 `400 destination_required`、沒有公車站回 `400 stops_required`、公車站或標籤不在清單回 `400 invalid_stop`／`invalid_tag`、篩選的標籤不適用於駕駛回 `400 tag_not_applicable`（REQ-085）、參數格式錯誤回 `400 invalid_request` |
| POST | `/api/passenger/requests` | 乘客 | 送出搭車請求（T12）：`pickup_point_id`、`location{lat,lng}`（乘客目前位置，必填）、選填 `destination{name,lat,lng}`、`stop_ids`、`tag_filters[{tag_id,intent}]`；目的地與公車站沒帶時用乘客的常用資料。一律回 `201` 與請求的當下結果：`status` 為 `rejected`（位置離上車點超過送出請求距離，`reason: too_far` 與 `message`）、`no_match`（`message` 為「目前沒有可搭的車」），或 `waiting_driver`（已分配排序第一且還有座位的車並暫留座位，`trip_id`、`dropoff_bus_stop_id`、`response_deadline_at`）。行程啟用自動接受時也是 `waiting_driver`：由駕駛介面替駕駛呼叫 `accept`，後端不直接確認（DD-33）。`relaxed` 表示分配的車未符合全部建議標籤。請求與位置（`submitted_lat`、`submitted_lng`）一律保存。位置缺漏回 `400 invalid_location`，最終目的地（含預先帶入的常用目的地）不在園區內回 `400 destination_outside_park`、不建立請求（REQ-001、DD-32），其餘參數錯誤同供給查詢（`invalid_pickup_point`、`destination_required`、`stops_required`、`invalid_stop`、`invalid_tag`、`tag_not_applicable`、`invalid_request`）。駕駛回應、逾時與改配、查詢請求狀態屬 T13 |
| GET | `/api/driver/requests` | 駕駛 | 駕駛進行中行程的請求（T13，REQ-049、REQ-066）：`trip_id`（沒有進行中的行程為 `null`，兩個清單為空）、`pending`（等待回應的請求：`id`、`passenger_name`、`pickup_point`、`dropoff{bus_stop_id,name,lat,lng}`——`bus_stop_id` 為 `null` 表示行程目的地、`relaxed`、`response_deadline_at`）與 `passengers`（已確認或已上車的乘客，同樣含 `dropoff`，`boarded` 標示是否已上車） |
| POST | `/api/driver/requests/:id/accept` | 駕駛 | 確認請求：暫留的座位轉為正式佔用，乘客最新的參與主檔關聯到該行程（DD-25）。回 `200` 與請求；請求不是這位駕駛行程的回 `404 not_found`，已不在等待回應（已回應、已逾時改配）回 `409 not_waiting` |
| POST | `/api/driver/requests/:id/decline` | 駕駛 | 婉拒請求：釋放座位並改配給排序中下一台還有座位的車（一樣等待該車駕駛確認，DD-33），沒有車可配為 `no_match`。錯誤同 `accept` |
| POST | `/api/driver/requests/:id/board` | 駕駛 | 標記乘客已上車（DD-27）。回 `200` 與請求；乘客已先標記則直接回已上車的請求（`boarded_at` 為先到者的時間），座位計數不變。請求不是已確認或已上車回 `409 invalid_state`，不是這位駕駛行程的回 `404 not_found` |
| POST | `/api/driver/requests/:id/complete` | 駕駛 | 替乘客結束共乘（REQ-067、DD-23），已確認或已上車皆可：釋放座位、建立服務紀錄，並在同一個交易中依該駕駛與乘客累積的服務紀錄重新計算常用資料（DD-19：各欄位取最常出現的值，次數相同取最近一趟；乘客平常抵達時間取完成時間（台北時間）的中位數，可接受的下車公車站為實際用過的公車站，沒有用過任何公車站時保留原本的值、不清空）；同一個交易中也為駕駛記點（T35，REQ-072、DD-34）：新增一筆指向該服務紀錄的 `ride` 點數紀錄，累積點數加上系統設定 `points_per_ride`（預設 10）。同一次共乘只記一次點。已完成則直接回已完成的請求。錯誤同 `board` |
| GET | `/api/passenger/requests/current` | 乘客 | 乘客尚未結束（等待駕駛、已確認、已上車）的請求狀態，沒有則回 `{"request": null}`；乘客介面開啟時帶出（REQ-069） |
| GET | `/api/passenger/requests/:id` | 乘客 | 請求狀態（輪詢用，REQ-052、REQ-053）：送出請求的欄位加上 `boarded_at`、`completed_at`、`reassigned_count`（婉拒、逾時或行程結束而改配的次數）。已確認時另含 `pickup_point`、`vehicle{plate,description}`、`eta_s`（尚無駕駛位置，或車輛已經過上車點，為 `null`）、`eta_simulated`（ETA 是否來自模擬路線，REQ-063；沒有 `eta_s` 時為 `null`）與 `trip`（含路線與沿途公車站）；另有 `vehicle_position{lat,lng,heading_deg,reported_at}`（DD-31：駕駛最新的回報；`heading_deg` 由最近兩筆位置不同的回報計算，正北為 0 度、順時針，只有一個位置時為 `null`；車輛尚無回報時整個物件為 `null`）與 `passed_pickup`（車輛是否已經過上車點，DD-06）。等待、已上車與之後這些欄位皆為 `null`。`no_match` 帶 `reason`、`message`。不是自己的請求回 `404 not_found` |
| POST | `/api/passenger/requests/:id/board` | 乘客 | 乘客標記自己已上車，行為同駕駛的 `board` |
| POST | `/api/passenger/requests/:id/complete` | 乘客 | 乘客結束自己的共乘（主要方式），行為同駕駛的 `complete` |
| GET | `/api/commute/traffic` | 駕駛／乘客 | 通勤資訊的車流（T36、T54，Phase 2，REQ-077、DD-36、DD-41）：回 `200` 與 `{now, today, days, simulated, weather_simulated}`。`days` 為今天之前的 10 個上班日（週一到週五，不扣國定假日），由新到舊，每天 `{date, weekday, slots}`，`weekday` 為 ISO 星期（1 星期一～5 星期五）；`slots` 為上班時段 07:00–09:45 開始的 15 分鐘時段（每天 12 格），每格 `{slot_start, volume, avg_speed_kmh, weather, simulated, weather_simulated}`：`volume` 為 16 個入口的總車流量，`avg_speed_kmh` 以車流量加權平均，`weather` 為該時段的天氣（同時段的每個入口相同，欄位見〈車流與天氣〉）。`simulated` 為車流是否模擬：TDX 實測的日子（目前 2026-10-12～10-22）為 `false`，沒有實測的上班日為 `true`；`weather_simulated` 為天氣是否模擬，目前一律 `true`。最外層的 `simulated`、`weather_simulated` 為任一格是否模擬。`now`、`today` 為 Demo 模擬時間下的現在與今天。不接受查詢參數 |
| GET | `/api/commute/weather` | 駕駛／乘客 | 今天的天氣（T36、T54，Phase 2，REQ-077、DD-41）：回 `200` 與 `{now, today, weather, simulated, weather_simulated}`（兩個旗標相同，都是天氣是否模擬），`weather` 為今天觀測時間不晚於現在的最新一筆（`station_id`、`station_name`、`obs_time`、`weather`、`air_temperature`、`precipitation`），今天還沒有任何觀測（例如沒有設定 `demo_clock` 的週末）時為 `null`。前端以這裡的 `now` 決定通勤資訊的預設時段，不用裝置時鐘。不接受查詢參數 |
| GET | `/api/commute/pickup-rides` | 駕駛／乘客 | 上車點的載客次數（T37，Phase 2，REQ-056、DD-37、DD-40、DD-41）：查詢參數 `pickup_point_id`、`from`、`to`（皆必填；`from`、`to` 為台北時間 `HH:MM`，落在 15 分鐘的整點上，07:00 ≤ `from` < `to` ≤ 10:00）。回 `200` 與 `{now, pickup_point_id, days, today, summary, simulated}`。`days` 為今天之前的 10 個上班日，由新到舊，每天 `{date, weekday, slots}`，`slots` 為 07:00–09:45 開始的 12 格，每格 `{slot_start, ride_count, weather, simulated}`：`ride_count` 為該格的載客次數（歸入請求送出時所在的時段），`weather` 取自車流表同一時段的天氣（與 `/api/commute/traffic` 相同）。`today` 格式相同，只有 07:00 到現在所在的時段（Demo 時為 07:00–08:15 的 6 格；現在早於 07:00 時為空），每格是今天的模擬統計加上今天實際完成的共乘；現在所在的時段還沒有觀測，`weather` 為 `null`、`simulated` 為 `false`。`summary` 為 `{from, to, daily_avg, weekday, same_weekday_avg}`：`daily_avg` 為 `days` 在 `from`～`to`（含 `from`、不含 `to`）的載客次數加總除以 10，`same_weekday_avg` 為 `days` 中與今天同一個星期幾（`weekday`）的那幾天的平均（沒有這樣的一天時為 `null`），都不含今天。不回傳駕駛人數與乘客人數。`pickup_point_id` 缺漏或不是整數、`from`／`to` 不合法回 `400 invalid_request`，上車點不存在回 `404 not_found` |
| GET | `/api/city/live` | 市府 | 儀表板的即時區（T38，Phase 2，REQ-078、DD-39、DD-40 第 5 步）：回 `200` 與 `{now, today, demo_clock, vehicles, counts, simulated_counts, pickup_points, simulated}`。`now`、`today` 為 Phase 2 的現在與今天（DD-41），`demo_clock` 為是否設定了 Demo 模擬時間，給儀表板頂部顯示時間與「模擬時間」標示（四個 `/api/city/*` 都附這三個欄位）。`vehicles` 為行程中車輛的不具名位置 `{lat, lng, heading_deg, on_board, simulated}`：真實的行程取駕駛最新的回報（還沒回報的行程只計入數量），`heading_deg` 同乘客的請求狀態（DD-31），`on_board` 為車上的乘客人數。`counts` 為 `{vehicles, on_board, waiting, matched}`：行程中的車輛數、車上的乘客人數、等待配對（已送出、還沒有駕駛確認）的乘客人數與已配對但尚未上車的乘客人數，真實與模擬合計；`simulated_counts` 為其中模擬的部分（REQ-063）。真實的請求只計今天（實際日期）送出、行程尚未結束的。`pickup_points` 為三個上車點 `{id, name, lat, lng, waiting, simulated_waiting}`：該上車點等待配對的人數（合計）與其中模擬的人數。**即時模擬**：後端依經過的時間計算約 30～40 台模擬車輛，沿 `internal/server/city_sim_routes.go` 的靜態路徑（每個上車點 2 條，2026-10-23 以 Google Routes 產生）從三個上車點駛向園區，不寫入資料庫，不出現在乘客的供給查詢；以固定的一輪呈現，從 Demo 重設後（或當天）第一次查詢這個 API 時開始，時間軸往前推，第一次查詢時大部分的車已在路上、幾分鐘內開始有車抵達，約半小時跑完，之後不再有新的車；路徑、出發順序、速度與乘客數以今天（DD-41）的日期為亂數種子。每台車載 1～3 位模擬乘客，到上車點前計為等待配對或已配對。模擬的一輪存在後端記憶體，重啟後端或 Demo 重設後重新開始 |
| GET | `/api/city/traffic` | 市府 | 儀表板的車流（T38、T54，Phase 2，REQ-079、DD-36、DD-39、DD-41、DD-44）：選填查詢參數 `slot`（時段開始時間，RFC 3339，例如 `2026-10-23T08:00:00+08:00`）或 `date`（`YYYY-MM-DD`），兩者擇一。**不帶參數或帶 `slot`**：回 `200` 與 `{now, today, demo_clock, slot_start, detectors, weather, simulated, weather_simulated}`，未指定時為最新時段，即現在之前最後一個完整的 15 分鐘時段（Demo 時為今天 08:00–08:15）。**帶 `date`**：回 `200` 與 `{now, today, demo_clock, date, slots, simulated, weather_simulated}`，`slots` 為該日 07:00–09:45 的 12 格；今天在最新時段之後的格子還沒有車流與天氣：各入口的 `volume`、`avg_speed_kmh`、`occupancy_pct`、`coverage_pct` 與 `weather` 為 `null`，`simulated`、`weather_simulated` 為 `false`，只有 `past_avg_speed_kmh`、`past_min_speed_kmh`、`past_max_speed_kmh` 照常有值（畫面以此畫「還沒到」），每格 `{slot_start, detectors, weather, simulated, weather_simulated}`，與單一時段的格式相同。`detectors` 為 16 個入口，每個 `{vd_id, source, gateway, road_name, road_direction, bearing, sort_order, location_note, lat, lng, shape, proxy, proxy_note, reference_speed_kmh, volume, avg_speed_kmh, occupancy_pct, coverage_pct, past_avg_speed_kmh, past_min_speed_kmh, past_max_speed_kmh, simulated}`，依 `sort_order` 排列：`source` 為 `city` 或 `freeway`；`gateway` 為入口名稱；`bearing` 為進內湖的方位（例如 `NE`）；`sort_order` 為入口在畫面上的順序與編號（1～16，依 UD-28 的格子列：市區道路由大直起順時針，再來是國道匝道由西到東）；`location_note` 為位置說明（例如「區界外 10 公尺，東向」）；`shape` 為路段線形 `[{lat, lng}, …]`（點序即車流方向，16 個中 6 個有，其餘 `null`）；`proxy` 為是否以附近路段的偵測器代替（成美橋、成功橋），`proxy_note` 為偵測器的實際位置；`reference_speed_kmh` 為全天 p85 參考速度（DD-44）；`coverage_pct` 為資料完整度（0～100，模擬為 100）；`past_avg_speed_kmh`、`past_min_speed_kmh`、`past_max_speed_kmh` 為過去 10 個上班日（今天之前，DD-41）同一時刻車速的平均、最低與最高，不含所選的那一天；`simulated` 為車流是否模擬。某個入口在該時段沒有資料時，`volume`、`avg_speed_kmh`、`occupancy_pct`、`coverage_pct` 為 `null`、`simulated` 為 `false`。`weather` 為該時段的天氣，`weather_simulated` 為天氣是否模擬（目前一律 `true`）；最外層的 `simulated` 為任一入口（或任一格）的車流是否模擬。`slot` 不是 RFC 3339 或不在 15 分鐘的整點上、`date` 不是合法日期、同時帶 `slot` 與 `date` 回 `400 invalid_request`；`slot` 還沒結束、不在上班時段內或沒有資料，日期不是今天或過去 10 個上班日之一回 `404 not_found` |
| GET | `/api/city/today` | 市府 | 儀表板的今日成效（T38，Phase 2，REQ-080、REQ-083、DD-40）：回 `200` 與 `{now, today, demo_clock, completed, requests, matched, match_rate, no_match, trips_saved, trips_saved_estimate, pickup_points, simulated}`。`completed` 為今日完成的共乘數、`requests` 為送出的請求數、`matched` 為其中成功配對的數目、`match_rate` 為 `matched / requests`（沒有請求時為 `null`）、`no_match` 為無車可配的次數、`trips_saved` 為估計減少的車次（每次共乘少一台車，`trips_saved_estimate` 恆為 `true`，畫面標示為估算，REQ-063）；`pickup_points` 為三個上車點 `{id, name, lat, lng, completed}`，加總等於 `completed`。數字是三個部分的合計：(1) 今天在現在之前的模擬統計，配對視同完成（請求 = 乘客人數、成功配對 = 完成 = 載客次數、無車可配 = 乘客人數 − 載客次數）；(2) 今天（實際日期）實際的請求與共乘：完成數用 `commute_real_rides`（與 `/api/commute/pickup-rides` 同一個規則，上班時段以外的也計入），成功配對為 `confirmed`、`boarded`、`completed`，無車可配為 `no_match`，尚未結束的請求不算無車可配，送出時離上車點太遠被拒絕（`rejected`，REQ-034）的不算送出的請求；(3) 即時模擬已抵達的車上的每位乘客，計為一筆送出且配對成功的請求與一次完成的共乘（只計入儀表板，不計入 `pickup-rides`）。這個 API 不會開始即時模擬的一輪 |
| GET | `/api/city/history` | 市府 | 儀表板的歷史區（T38，Phase 2，REQ-080、REQ-082、REQ-083、DD-41）：回 `200` 與 `{now, today, demo_clock, days, pickup_points, simulated}`。`days` 為今天之前的 10 個上班日（與 `/api/commute/traffic` 相同），由新到舊，每天 `{date, weekday, rides, weather, simulated, traffic_simulated}`：`rides` 為各上車點當天載客次數的加總，`weather` 為當天雨量最大的時段的天氣（與通勤資訊的熱力圖相同，DD-38），沒有觀測時為 `null`；`simulated` 指載客統計是否模擬，`traffic_simulated` 指當天上班時段的車流是否模擬（與 `/api/city/traffic?date=` 的 `simulated` 相同：有 TDX 實測的上班日為 `false`，沒有實測的上班日為 `true`，T56、REQ-063、DD-36），供戰情室日期選單標「實測」或「模擬」。`pickup_points` 為三個上車點 `{id, name, lat, lng, drivers_per_day, passengers_per_day, rides_per_day}`：過去 10 個上班日平均每天的駕駛人數、乘客人數與載客次數（10 天的加總除以 10，四捨五入到小數一位）。不含今天 |

- 除 `/api/ping` 與 `/api/demo/reset` 外都需要 `Authorization: Bearer <角色>:<帳號>`（角色為 `driver`、`passenger` 或 `city`）：格式錯誤或帳號不存在回 `401`，帳號沒有該角色或角色不能使用該 API 回 `403`。市府管理者（`city`，T38，DD-39）只能呼叫 `/api/city/*`，呼叫其他 API（包括表中「駕駛／乘客」共用的 API）都回 `403`；駕駛與乘客呼叫 `/api/city/*` 也回 `403`。
- 路線、行車時間與步行時間的來源（DD-09）：設定了 `MAP_API_KEY`，後端用 Google Routes（記憶體快取 → 逾時與斷路器 → Google，失敗時改用模擬）；沒有設定則全部用模擬的直線備援（`route.simulated` 為 `true`，距離為直線 × 1.3、時速 20 公里、步行每分鐘 80 公尺）。啟動時 log 會寫明使用哪一種，不會印出金鑰。媒合排序有約 2 秒的總時間預算，用完後剩下的估算改用模擬並標記為模擬。園區範圍由後端啟動時載入 `backend/config/park/boundary.geojson`，可用環境變數 `PARK_BOUNDARY` 指定其他路徑。
- 請求逾時（DD-13）：每筆等待中的請求以 `response_deadline_at` 為唯一的計時依據，時限來自 `system_settings.driver_confirm_timeout`（每次分配時讀取）。後端啟動時起一個背景掃描（每秒一次，`server.RunTimeoutSweeper`），把已逾時的請求改配；服務重啟後第一次掃描就會處理停機期間逾時的請求。改配（婉拒、逾時、行程結束）時當下就選好下一台車並保留座位，但記下 `offered_at` 為現在加 `system_settings.reassign_delay`（預設 2 秒），`GET /api/driver/requests` 到那之後才列出這筆待回應的請求，`response_deadline_at` 也從 `offered_at` 起算；乘客的 `reassigned_count` 當下就增加。第一次分配的 `offered_at` 是送出的當下。確認、婉拒、逾時、上車與結束都先鎖定請求列再用條件式狀態轉換，同時發生時只有一方生效，後到的得到先到者的結果。
- 行程自動結束（T21，REQ-070、DD-30）：駕駛的回報在行程已經過上車點之後，距目的地不超過 `system_settings.arrival_radius`（預設 50 m，每次回報都重新讀取）時，在同一個交易內：行程改為 `completed` 並記下 `ended_at`；車上已確認或已上車的共乘一併完成（建立服務紀錄、更新常用資料，同 `complete`）；仍在等待該駕駛回應的請求釋放座位，改配給排序中的下一台車，沒有車可配為 `no_match`，該候選的結果記為 `trip_ended`。經過上車點之前進入目的地範圍不會結束。行程結束後，`GET /api/driver/requests` 的 `trip_id` 為 `null`，之後的回報照常保存（DD-06），`trip_ended` 維持 `true`。
- 座位計算（暫留、正式佔用、釋放，`internal/server/seats.go`）是供請求流程使用的內部介面，沒有 HTTP API。
- 錯誤一律回 `{"error":{"code":"...","message":"..."}}`。
- 車流與天氣（T36、T54，Phase 2，DD-36、DD-40、DD-41）：資料表 `traffic_detectors`（入口）與 `traffic_observations`（每個入口每 15 分鐘一筆，天氣存在同一列），由遷移 `backend/migrations/20261022120000_commute_traffic_weather.sql` 建立，`backend/migrations/20261023180000_tdx_gateway_traffic.sql`（T54）改成 16 個入口並載入 TDX 實測。
  - 入口：進內湖的 16 個入口（市區 10 個、國道 1 號出口匝道 6 個），每個入口一支代表的偵測器，資料取自 [`docs/data/tdx-vd/detectors.csv`](docs/data/tdx-vd/README.md)。
  - 實測資料：`docs/data/tdx-vd/observations-15min.csv` 的 2026-10-12～10-22 上班日 07:00–10:00，由遷移載入，`simulated = false`。Demo 重設不會刪除或改動實測的車流，只更新它們的天氣。之後補上的日子以新的遷移檔載入（做法見 `docs/data/tdx-vd/README.md`）。
  - 模擬資料：資料庫函式 `generate_commute_simulation(now)` 刪除所有 `simulated` 的觀測後，以 `now` 的日期為今天，先產生過去 10 個上班日與今天在現在之前的完整時段的天氣（只含 07:00–10:00；10 天中 2～3 天下雨，從前幾個時段一直下到 10:00），寫入每一列（實測的列也一樣，`weather_simulated = true`；不在這 10 天內的實測列沒有天氣）。再只為沒有任何實測的日子（今天，以及沒有下載的上班日，Demo 時為 10/23）產生車流：每個入口取實測資料同時段的平均車流量、車速與佔有率，加上隨機變化（車流量 ±8%、車速 ±5%、佔有率 ±10%），不隨天氣變化，`simulated = true`、`coverage_pct = 100`。天氣欄位依中央氣象署自動氣象站 O-A0001-001，測站為內湖（`C0A9F0`），雨量為該時段的毫米數。亂數以今天的日期為種子，同一個今天產生的資料相同。
  - 何時產生：遷移執行時產生一次，之後只在 Demo 重設（`POST /api/demo/reset`、`just demo-reset`）時重新產生，查詢 API 不會重新產生。所以換了一天，要先重設一次，資料才會換成新的過去 10 個上班日。已知限制：沒有設定 `demo_clock` 時，今天的時段停在上次重設時的現在，不會隨實際時間增加；Demo 固定 08:15，不受影響。
  - Demo 模擬時間 `demo_clock`（REQ-084、DD-41）：系統設定，以當天 0 點起的分鐘數保存，預設 495（08:15）。有這一列時，Phase 2 的現在是今天的這個時間，今天遇到星期六、日時改為下一個星期一；例如 10/24（星期六）重設時，今天是 10/26，過去 10 個上班日為 10/12～10/23，10/24 與 10/25 重設產生的資料相同。後端一律經 `commuteNow`（資料庫函式 `commute_now`）取得現在，不直接讀系統時鐘；媒合、行程、請求與逾時仍用實際時鐘。值必須是 0～1439 的整數，否則 API 回 500。
    - 改時間：`UPDATE system_settings SET value = 540 WHERE key = 'demo_clock';`（09:00），再 `just demo-reset` 重新產生。
    - 移除（改用實際的日期與時間）：`DELETE FROM system_settings WHERE key = 'demo_clock';`，再 `just demo-reset`。
    - 加回：`INSERT INTO system_settings (key, value, unit, description) VALUES ('demo_clock', 495, 'min', 'Demo 模擬時間');`
- 上車點統計（T37，Phase 2，DD-37、DD-40）：資料表 `supply_demand_stats`（每個上車點每 15 分鐘一筆：駕駛人數、乘客人數、載客次數），由遷移 `backend/migrations/20261022180000_pickup_ride_stats.sql` 建立；資料表限制載客次數不超過乘客人數。不存天氣，API 依時段從 `traffic_observations` 取得。
  - 模擬資料：`generate_commute_simulation(now)` 先產生車流與天氣（`generate_commute_traffic`），再依同一份天氣產生上車點統計（`generate_pickup_stats`），涵蓋所有有天氣的時段（過去 10 個上班日與今天在現在之前的時段，不論車流是實測或模擬）。乘客與駕駛人數在 08:15 前後最多、星期五最多，下雨時乘客人數增加；載客次數不超過乘客人數，也不超過駕駛人數 × 2（模擬的平均可載人數）。何時產生與車流相同（遷移與 Demo 重設）。
  - 今天實際的共乘：資料庫函式 `commute_real_rides(real_now)` 依上車點與時段計算今天（實際日期，依請求的送出時間）完成的共乘，每個請求只計一次。有 `demo_clock` 時全部計入現在所在的時段（Demo 時為 08:15–08:30）；沒有時計入請求送出時所在的時段，上班時段以外送出的 `slot_start` 為 `null`，不計入任何時段。`/api/commute/pickup-rides` 以這個函式加上今天的數字，市府儀表板的今日成效也要用同一個函式。
- 系統設定（`system_settings`）只供後端元件透過 `internal/settings` 讀取，每次都查資料庫，改 SQL 後不需重啟即可生效；沒有對外 API（DD-20）。
- 後端測試（`cd backend && go test ./...`）連線本機資料庫（需先 `just infra up`、`just backend db-apply`），每個測試在交易中執行並回滾；可用 `TEST_DATABASE_URL` 覆寫連線字串。
- 自動測試一律不呼叫真實的 Google Routes：轉接器只對 `httptest` 假伺服器或假來源測試，不讀 `MAP_API_KEY`。開發時要用真實 API 手動確認轉接器，執行預設不跑的 `googlelive` 測試（每種估算各呼叫一次）：`MAP_API_KEY=<金鑰> go test -tags googlelive -run TestGoogleLive -v ./internal/server/`（在 `backend/` 下）。

啟動後可用 `curl -i localhost:8080/api/ping` 驗證。

### API 整合測試（Karate）

測試位於 `backend/karate/`（Maven 專案，[Karate](https://github.com/karatelabs/karate) 2.1.3；Java 與 Maven 版本見〈[前置需求](#前置需求)〉），以 `just backend karate` 執行。

- `just backend karate` 另外編譯並啟動一個 Karate 專用的後端（`KARATE_PORT`，預設 `:18080`；`MAP_API_KEY` 一律為空，蓋過 `.env` 的金鑰，所以只用模擬路線；`DEMO_RESET` 開啟），跑完就關掉，不會停掉或重開 `:8080` 上的 Demo 後端。資料庫則是共用的：`demo-reset.feature` 會重設 Demo 帳號，所以 Demo 演練時不要跑 Karate。需先 `just infra up` 與 `just backend db-apply`。測試依賴種子資料：測試帳號（見下節）、標籤、上車點與公車站，不自行建立。
- 測試資料的原則：**有 REST API 可寫入就用 API**（例如以 `PUT`／`DELETE /api/me/tags/:id` 選擇與取消標籤，並在情境結束前還原）；**只有沒有 API 可用時才用 SQL**（目前是帳號與常用資料，見 DD-19），寫在 `profiles.feature`，由 `Db.java` 以 `carpool` 角色寫入。
- SQL 建立的帳號名稱帶 `karate-` 前綴與隨機後綴；每個情境結束時由 `cleanup.feature` 刪除（常用資料隨帳號連動刪除），因此情境可平行執行，也不會留下資料。新增這類情境時沿用同一做法。
- **新增或修改 API 的任務，一律要同時補上 Karate 情境**，覆蓋成功、被拒絕與未帶 token 的情況。
- 請求流程（`request-flow.feature`）同樣在最後一個上車點建立車輛，但標籤不夠每個情境各用一個，所以每個情境以 SQL 建立專屬標籤（標籤沒有 API）並在情境結束時刪除。逾時情境以 SQL 把期限改到過去（沒有 API 可以撥動時鐘），再等背景掃描改配。
- 請求（`requests.feature`）在最後一個上車點（大巨蛋）建立車輛，並讓每個情境各用一個專屬標籤隔離自己的車（乘客要求該標籤，只有該情境的車帶有），因此情境可平行執行；送出過請求的乘客帳號會留在資料庫（`ride_requests` 參照 `users`），行程由 `cleanup-tracking.feature` 結束。
- 位置回報（`location.feature`）是例外：`location_reports` 只新增（DD-06），觸發器擋下 `DELETE`，且回報掛在 `activities` 之下、`activities.user_id` 的外鍵不連動刪除，所以表示過參與的帳號無法被刪除。做法：每個情境各用一個全新的 `karate-track-` 帳號（可平行、斷言精確）；目前沒有行程 API，進行中的行程以 SQL 建立；情境結束時由 `cleanup-tracking.feature` 將該帳號的行程設為 `completed`，並刪除從未表示過參與的帳號。表示過參與的 `karate-track-` 帳號會留在資料庫，不影響其他測試與供給查詢。
- 行程（`trips.feature`）同理：出發會建立參與主檔，所以每個情境各用一個全新的 `karate-trip-` 駕駛帳號，結束時由 `cleanup-tracking.feature` 結束其行程；帳號本身會留在資料庫。
- Demo 重設（`demo-reset.feature`）需要後端開啟 `DEMO_RESET`（`just backend karate` 的專用後端已開啟）。重設只動 Demo 帳號，在一個交易內換掉資料，平行讀取種子資料的情境看到的前後都是種子；情境送出的請求都要求一個只屬於它、沒有車帶有的標籤，結果是 `no_match`，不佔其他情境的車。
- 直接執行 mvn 時，以 `-DbaseUrl=...` 指定後端位址（預設 `http://localhost:8080`），以 `-DdbUrl=...`、`-DdbUser=...`、`-DdbPassword=...` 指定 JDBC 連線（預設 `jdbc:postgresql://localhost:5432/carpool`、`carpool`／`carpool`）；`just backend karate` 會依 `KARATE_PORT`、`POSTGRES_PORT`、`POSTGRES_DB` 帶入。
- `.feature` 檔放在 `backend/karate/src/test/java/carpool/api/`；報表在 `backend/karate/target/karate-reports/`。

## 測試帳號

由遷移 `backend/migrations/20261018123407_seed_test_users.sql` 建立，皆為模擬帳號（`simulated = true`），每個帳號只有單一角色。`city1` 由遷移 `backend/migrations/20261023120000_city_admin_role.sql`（T38，DD-39）建立，只有市府管理者角色（`users.is_city_admin`），不是 Demo 帳號，Demo 重設不會動它；同一個遷移把帳號的角色限制放寬為駕駛、乘客、市府管理者至少其一。

| 帳號 | 顯示名稱 | 角色 | Bearer token |
| --- | --- | --- | --- |
| `passenger1` | 乘客 小美 | 乘客 | `passenger:passenger1` |
| `passenger2` | 乘客 小華 | 乘客 | `passenger:passenger2` |
| `driver1` | 駕駛 鐵雄 | 駕駛 | `driver:driver1` |
| `driver2` | 駕駛 大明 | 駕駛 | `driver:driver2` |
| `driver3` | 駕駛 珍珍 | 駕駛 | `driver:driver3` |
| `driver4` | 駕駛 阿丁 | 駕駛 | `driver:driver4` |
| `driver5` | 駕駛 阿龍 | 駕駛 | `driver:driver5` |
| `city1` | 市府 管理者 | 市府管理者 | `city:city1` |

呼叫 API 時以 `Authorization: Bearer <token>` 指定身分（DD-18），例如 `curl -H 'Authorization: Bearer driver:driver1' localhost:8080/api/ping`。

## 種子資料

由遷移 `backend/migrations/20261018140000_seed_reference_data.sql` 建立，所有語句皆可重複執行（`ON CONFLICT`／`NOT EXISTS`）。

- 上車點：松山車站、台北世貿中心、台北大巨蛋（範圍半徑 80 m）。世貿與大巨蛋在地面上、進入停車場前的專用車道：世貿在信義路五段旁通往世貿一館停車場的車道（25.03315, 121.5619，已在地圖上確認），大巨蛋在西側光復南路上（25.044249, 121.557934，使用者指定）。
- 內湖科學園區範圍：不存資料庫，是 GeoJSON 檔 `backend/config/park/boundary.geojson` 的 52 點多邊形，涵蓋北段與南段（西緣沿堤頂大道（北端到內湖路一段）與基隆河河濱公園的堤防側（河濱公園不含在內），南段北到民權東路六段、南到基隆河北岸、東到行愛路）；園區內公車站 97 個，由 `docs/data/busstop/busstops.csv` 以該多邊形篩選匯入。
- 標籤：使用者自選標籤（`issuer = 'self'`）。遷移 `backend/migrations/20261023100000_tag_roles.sql`（T43，DD-42）為每個標籤加上適用的一方與四種用語，並刪除「可帶寵物」「女性友善」，現在共 4 個：「不抽菸」「安靜通勤」「可聊天」適用於雙方，「可載行李」只適用於駕駛。同一個遷移刪除不適用於使用者角色的已選標籤，以及駕駛所有的建議篩選（`trip_tag_filters.intent` 之後只能是 `required`）。
- 模擬行程：`driver1`～`driver3` 皆從松山車站出發、座位 3／4／2、自動接受，狀態為進行中（`active`、設定已鎖定、`started_at = now()`）；`driver4`、`driver5` 無行程，供真人從駕駛介面操作。`driver3` 帶有「不抽菸」「安靜通勤」標籤，`driver2` 帶有「可載行李」。
- 車輛與位置回報主檔：由遷移 `backend/migrations/20261019130000_activities_and_vehicles.sql` 建立 `vehicles`、`activities` 兩張表。`driver1`～`driver5` 各有 1 輛車（車牌與描述為暫定的範例資料，可自行修改）；3 筆模擬行程的駕駛各有 1 筆關聯到該行程的主檔，讓模擬器可直接回報位置。乘客的主檔在乘客呼叫 `POST /api/activities` 時才建立。
- Demo 預先帶入的資料（DD-19）由遷移 `backend/migrations/20261020120000_seed_demo_habitual_data.sql` 建立：`passenger1` 的常用目的地瑞光路 513 巷（25.0765, 121.5742）與可接受的公車站「瑞光港墘路口」（`stop_id` 1013）、「港墘路」（`stop_id` 1106），平常抵達時間不寫入；`driver4` 一趟已結束的行程（松山車站 → 瑞光路 513 巷，可載 3 人、不自動接受、沒有標籤篩選，非模擬行程，沒有服務紀錄與常用資料；原本的「不抽菸」建議篩選由 T43 的遷移刪除，Demo 重設呼叫的 `seed_demo_habitual_data()` 也不再建立）。`passenger2`、`driver5` 不寫入，用來展示第一次使用。這些值在帳號第一次完成共乘時被重新計算的結果取代（可接受的公車站算不出任何一站時保留種子的值，DD-19）；手動跑過 Demo 後想還原請用 `just demo-reset`（見〈[Demo](#demo)〉）。
- 取捨 Demo 腳本：乘客用 `passenger1`（松山車站出發，目的地瑞光路 513 巷，可接受瑞光港墘路口與港墘路），建議標籤選「不抽菸」。`driver1`、`driver3` 的目的地在 200 m 內，不必步行；`driver3` 帶有「不抽菸」但只有 2 個座位；`driver2` 的路線經過瑞光港墘路口（遷移 `20261021150000_seed_driver2_real_route.sql` 將其目的地移到 25.0790, 121.5690，Google Routes 的真實路線依序經過堤頂大道一段、瑞光港墘路口、仁寶大樓），要下車走路。這個取捨以真實路線為準：斷網只靠模擬的直線時，`driver2` 的路線不經過可接受的公車站，不參與取捨（已知的取捨，T23）。預設參數下（等待 ×2、步行 ×1.5、標籤加分上限 4 分鐘、等待上限 10 分鐘），結果取決於各車的等待時間，由 `internal/server/seed_demo_test.go` 的 `TestSeedShowsWaitWalkTagTradeoff` 驗證（沿途公車站用 2026-10-21 記錄的真實路線，`realRouteStops`）：
  - 三車等待相同：選了建議標籤 → `driver3` 第一；沒選 → `driver1` 第一；`driver2` 都排最後。
  - `driver3` 多等 3 分鐘：標籤加分（4 分鐘）抵不過多出的等待（6 分鐘），`driver1` 勝出。
  - `driver2` 只等 1 分鐘、其他車等 8 分鐘：短等待勝過步行，`driver2` 勝出；把步行加重 `walk_weight` 調高（例如 6，以 SQL 修改系統設定，DD-20）則回到 `driver3`。
  - `driver3` 等待超過 10 分鐘：直接排除，不論標籤。
  模擬行程沒有種子位置，等待時間要由駕駛介面的模擬器（`?debug=1`）回報位置來調整。
- 重建：遷移已套用的資料庫要改種子時，用 `just backend db-reset`。Down 只在剛種子的資料庫可用，跑過 Demo 後（位置紀錄、請求都會參照這些資料）請改用 `db-reset`。
- 駕駛點數（T35，DD-34）由遷移 `backend/migrations/20261022100000_driver_points.sql` 建立：`driver_profiles.point_balance` 與點數紀錄 `driver_point_ledger`，以及系統設定 `points_per_ride`（每次共乘點數，預設 10，每次完成共乘時重新讀取）。種子替每位 Demo 駕駛建立一列 `driver_profiles`（常用資料欄位為空，`GET /api/driver/profile` 的常用資料仍回傳 `null`）與每筆 10 點的 `seed` 紀錄：`driver1` 3 筆、`driver2` 2 筆、`driver3` 4 筆、`driver4` 8 筆（展示駕駛資訊用，DD-35）、`driver5` 1 筆，累積點數等於紀錄的加總（REQ-073）。
- 系統設定預設值在建立結構的遷移中（`system_settings`）。
- 離開緩衝 `pass_margin`（預設 25 m）由遷移 `backend/migrations/20261019150000_pass_margin_setting.sql` 加入：車輛進入上車點範圍（`radius_m`）後，要離上車點超過「`radius_m` ＋ `pass_margin`」才算已經過，避免定位誤差在範圍邊緣造成誤判（DD-06）。每次回報都會重新讀取，改 SQL 後立即生效；設為 0 即為單一門檻。
- 抵達距離 `arrival_radius`（預設 50 m）由遷移 `backend/migrations/20261021130000_arrival_ends_trip.sql` 加入（DD-30）：經過上車點之後，車輛回報的位置離駕駛目的地在這個距離內，行程即結束。每次回報都會重新讀取，改 SQL 後立即生效。
