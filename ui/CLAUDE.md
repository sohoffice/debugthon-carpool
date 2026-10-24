# UI — CLAUDE.md

內科上班順起來: 內科順路共乘的前端。這是黑客松 MVP：10/24 Demo 時必須能現場操作。先把流程做出來，不要做框架。

先讀：`../OVERVIEW.md` 第 9 節（範圍決定，與其他文件衝突時以此為準）、`../docs/design.md` 4.1～4.2、`../docs/requirement.md` US-06～US-16；UI 待辦與進度見 `ISSUES.md`。

**UI 設計見 `../docs/ui-design.md`**：畫面、視覺系統、動態與設計決定（UD-nn）都以它為準；它還是草案，標示「提案」的決定可能再改。

## 目錄結構

```
ui/
  shared/       @carpool/shared — 地圖、API 用戶端、輪詢、少量基本元件、主題
  driver/       駕駛介面   :5173
  passenger/    乘客介面   :5174
  showcase/     展示頁     :5170 — Demo 時並排嵌入兩個介面與「開始 Demo／重新開始」，並執行模擬器與台下操作（../docs/ui-design.md UD-18、UD-30）
  mock-server/  示範後端   :8081 — 只用 Node 內建模組，不是 workspace（../docs/ui-design.md 10.2）
  city/         市府管理介面 :5175 — 桌機版面的唯讀儀表板（../docs/design.md 4.20、DD-39）
```

使用 npm workspaces。`shared` 沒有建置步驟：各 app 直接 import 它的 TypeScript 原始碼。

## 指令（在 `ui/` 下執行）

在專案根目錄也可以用 `just ui <指令>`，見 `../DEV.md` 的「前端」小節。

- `npm install`
- `npm run dev:driver`／`npm run dev:passenger`／`npm run dev:showcase`／`npm run dev:city`
- `npm run mock` — 示範後端；要讓介面連到它，用 `just ui dev-mock`
- `npm test` — Vitest，跑所有 workspace
- `npm run typecheck`
- `npm run build`

環境變數放在專案根目錄的 `.env`，各變數說明見 `../DEV.md`。沒有設定 `VITE_GOOGLE_MAPS_API_KEY` 時，地圖會顯示提示文字，其他功能照常運作；例外是駕駛「有請求」畫面（SC-D3）的小地圖，整塊不出現、也不顯示提示（UD-29）。

## 原則

### 1. 不要過度設計（DO NOT OVER-ENGINEER）

- 只做需求或 Demo 現在需要的東西，不寫「以後可能用到」的程式。
- 沒有明確理由就不加新套件。MVP 不需要：狀態管理（Redux、Zustand）、資料請求套件（React Query、SWR）、router、表單套件、i18n、CSS-in-JS、元件庫、Storybook。
- 畫面切換用一般的 React state。真的需要網址時才加 router。
- 同樣的程式出現兩次再考慮抽出。只有第二個 app 真的用到時，才把程式搬進 `shared/`。
- 介面文字直接以繁體中文寫在程式中，不做翻譯層。
- 寧可寫一個清楚的元件，也不要寫一個有一堆 props 的萬用元件。

### 2. 邏輯在後端

- 媒合、ETA、座位、逾時、資格篩選都在後端（DD-08、DD-10、DD-13）。介面只顯示 API 回傳的內容，並送出使用者的操作。
- 以 `usePolling` 輪詢取得狀態（DD-03）。不用 WebSocket、SSE 或推播。
- 身分是 `Bearer <角色>:<帳號>`（DD-18），由 `createApiClient` 產生。Demo 時用 `?account=<帳號>` 切換帳號，沒有登入畫面。
- 只透過各 app `src/config.ts` 裡的 `api` 呼叫 API。呼叫路徑為 `/api/...`，開發時由 Vite 轉送到後端。
- API 的格式寫在 `shared/src/api/types.ts`，介面與示範後端共用。**一律以 `main` 的 Go 後端為準**（`../DEV.md`〈後端 API〉）：後端已有的 API 照抄後端格式，和型別檔、示範後端或 `../docs/ui-design.md` 不一致時，改前端，不改後端。後端還沒有的 API 才用前端提案的格式（`../docs/ui-design.md` 10.1），後端完成後改成後端的格式。
- 後端 API 完成前，前端連到一個共用的示範後端開發，連哪個後端由 `API_PROXY_TARGET` 決定，前端程式不切換（`../docs/ui-design.md` 10.2、UD-14）。

### 3. 設計文件中的角色規則

- **駕駛：** 行程中只有一個畫面：有沒有搭車請求、該請求的上車點與下車點、已確認乘客的下車點與是否已上車，以及確認／婉拒、標記已上車、替乘客結束共乘（DD-04、DD-27、REQ-066）。**行程中除了回應請求時標出下車點的小地圖（DD-04 例外、UD-29），不顯示地圖**，也不放設定、統計、提示或動畫。完整的路線地圖與所有設定只在出發確認畫面。按鈕要大、好按。
- **乘客：** 不能讓乘客選特定車輛（REQ-031）。顯示選定上車點的供給（預設最近，可改選，REQ-029）、送出「今天我要搭」（先建立參與主檔，再附上目前位置送出，DD-25）、顯示請求狀態；確認後在地圖上顯示行程路線，乘客按「我已上車」（DD-27）；下車後由乘客按「結束共乘」（DD-23）。乘客的目前位置只從 `passenger/src/position.ts` 取得（DD-26）。
- **兩者：** 模擬資料一律用 `<SimulatedBadge />` 標示（REQ-063）。
- **除錯模式：** 只有網址帶 `?debug=1` 才出現（`DebugSheet`）。駕駛端只放帳號切換（SC-X2；模擬器在展示頁，DD-14），乘客端放目前位置（DD-26）。它是 Demo 工具，不受 DD-04 限制，但不要把產品功能放進去。

### 4. 地圖

- 使用 Google Maps（`@vis.gl/react-google-maps`），**一律包在 `shared/src/map/` 裡**。各 app 從 `@carpool/shared` import `RouteMap`、`VehicleMarker`、`MapView`、`PlaceMarker`、`RoutePolyline`、`CarDot`（市府管理介面的車點）、`RoadSegment`（市府管理介面入口的路段線，UD-28；畫線的範圍由 `pathAround`、`pathAlongBearing` 算出），不直接 import `@vis.gl/*`。日後換地圖服務只需改一個地方。
- `RoutePolyline` 接受 `path`（座標陣列）或 Google 的 `encodedPath`（Routes API 回傳的 polyline 可直接傳入）。
- 需要新的地圖功能時：通用的才加到 `shared/src/map/`；否則在 app 內以 shared 的元件組合出來。

### 5. 版面與樣式

- 行動裝置優先（Demo 時用手機）。以 390px 寬度測試。市府管理介面（`city/`）是桌機版面，在 768px 以下重排成單欄（T71），以 1440px 與 390px 兩種寬度測試（`e2e/city-narrow.spec.ts`）；`shared` 不放只適用手機的版面。
- 只用 Tailwind。顏色用 `shared/src/theme.css` 的 token（色彩定義與用途見 `../docs/ui-design.md` 8.1），不要在 app 裡直接寫新的色碼。
- 全螢幕版面用 `h-dvh`。

### 6. 程式碼

- TypeScript strict。型別保持簡單，不寫花俏的泛型。
- 不直接修改 state 或 props，一律建立新物件。
- API 錯誤要讓使用者看得到：顯示簡短的中文訊息，並保留上一次正確的資料。
- 檔案要小，一個檔案一個元件。各 app 的 `src/` 先保持扁平，真的太亂再分資料夾。

## 測試 — 只測重要的

- 使用 Vitest + Testing Library。測試檔放在程式旁邊，命名為 `*.test.ts(x)`。
- 要測：shared 的邏輯（API 用戶端、輪詢、帳號），以及各流程的關鍵畫面狀態（例如：請求等待中 → 已確認；無車可配 → 顯示「目前沒有可搭的車」）。
- 不測：樣式、Tailwind class、地圖繪製、snapshot、簡單的元件。
- mock `fetch` 或 `api` 物件，不要 mock React 內部。測試環境沒有 Maps 金鑰，所以地圖會顯示提示文字；駕駛 SC-D3 的小地圖則整塊不出現（`useMapAvailable`）。
- 每個 app 保留一個 smoke test（`App.test.tsx`），確認整體接線正常。
- 端對端測試用 Playwright，放在 `e2e/*.spec.ts`，以 `just ui e2e` 執行。只測跨駕駛與乘客兩個介面的完整流程（快樂路徑、無車可配），以及工作單明文要求的 e2e 情境（例如 #55 的園區外目的地、#208 市府管理介面在 390px 與 1440px 的版面）；其他畫面細節留給 Vitest 測。
