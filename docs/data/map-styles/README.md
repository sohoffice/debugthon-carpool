# 地圖樣式候選

三個候選的 Google 地圖樣式，選定一個後匯入 Google Cloud Console。設計依據見 [UI 設計](../../ui-design.md) 第 8.1 節與第 8.6 節。

> [!WARNING]
> **樣式還要再調整。** 2026-10-19 以路網樣式實測（Map ID 已建立，見專案根目錄 `.env`）：
>
> - 捷運線以各線原本的顏色顯示（綠、藍、棕），`infrastructure.railwayTrack` 設的灰色沒有生效。松山新店線的綠色和共乘路線色很接近，容易誤認。介面已替行程路線加上白色外框（`RoutePolyline`），兩者分得開；雲端樣式仍可再調整。
> - ~~地圖預設的中心與縮放沒有對準整段路線~~：已處理，`RouteMap` 會自動縮放到整段路線，並留出被面板蓋住的空間（2026-10-20）。

檔案使用 Google Cloud Console 的雲端地圖樣式格式（頂層 `variant`，`styles` 裡每條規則用 `id` 指定地圖元素），可以直接貼進樣式編輯器的 JSON 欄位。格式說明見 [JSON reference for cloud-based maps styling](https://developers.google.com/maps/documentation/javascript/cloud-customization/json-reference)。

## 目錄

1. [三個樣式](#1-三個樣式)
2. [匯入步驟](#2-匯入步驟)

## 1. 三個樣式

三個樣式都隱藏商家、地標與公車站圖示，只讓共乘的行程路線成為地圖上最顯眼的東西。

| 檔案 | 名稱 | 底色 | 特色 | 適合 |
|---|---|---|---|---|
| `mist.json` | 晨霧 | 冷灰綠 `#edf1ef`，和乘客畫面背景相同 | 白色道路、淡綠公園、淡藍綠水域；最安靜 | 地圖和畫面融為一體，路線最突出 |
| `network.json` | 路網 | 近白 `#f8f9f8` | 道路幾乎消失，保留鐵路線（灰色）和車站名稱 | 強調「共乘是交通網路裡的另一條線」，看得到和捷運的關係 |
| `asphalt.json` | 柏油 | 深色 `#1a242c`，和駕駛行程中的背景相同 | 深色道路與水域；地圖在淺色畫面上變成一塊深色區域 | 畫面對比最強；和駕駛的「開車模式」同一個顏色 |

**注意：**

- 柏油樣式是深色底，原本的路線色 `#0a7a68` 在上面不夠明顯，選這個樣式時要把地圖上的路線改成較亮的綠色。
- 柏油樣式的 `variant` 是 `dark`。如果 Map ID 的淺色模式（Light mode）選不到它，就把它設在深色模式（Dark mode），前端再讓地圖使用深色模式。
- 路網樣式的鐵路線在台北是否包含捷運，要在預覽中確認；看不到捷運線時，路網和晨霧的差別會變小。

## 2. 匯入步驟

匯入樣式和建立 Map ID 在 Google Cloud Console 的**兩個不同頁面**：「Map Styles」上傳樣式，「Map Management」建立 Map ID。只有「Map Styles」頁面能匯入 JSON。

**A. 在「Map Styles」匯入樣式**（[直接開啟](https://console.cloud.google.com/google/maps-apis/studio/styles)）

1. 左側選單選「Map Styles」（不是「Map Management」），按「Create style」。
2. 跳出的視窗上方有兩個分頁：「Google styles」和「JSON」。選「JSON」。
3. 輸入框裡預設是 `{ "variant": "light" }`。把它整個刪掉，換成選定檔案的全部內容（或按「Upload JSON File」上傳檔案）。
4. 右側預覽變成新樣式、沒有錯誤訊息後，按「Customize」，再按「Save」，輸入名稱（例如 `carpool-mist`）存檔。

**B. 在「Map Management」建立 Map ID 並套用樣式**（[直接開啟](https://console.cloud.google.com/google/maps-apis/studio/maps)）

1. 按「Create map ID」，類型選「JavaScript」、「Vector」，存檔。
2. 在新的 Map ID 頁面的「Map styles」區塊，按淺色模式（Light mode）旁的編輯，選 A 存好的樣式，按「Done」再按「Save」。
3. 把 Map ID 填入專案根目錄 `.env` 的 `VITE_GOOGLE_MAPS_MAP_ID`。
