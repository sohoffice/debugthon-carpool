# 市府儀表板故事模式 prototype

開場動畫的獨立 prototype：同一個早上演兩次，第一幕大家各自開車進內科，第二幕部分的人改搭捷運、在上車點和同棟大樓的司機共乘。不動 `ui/` 的程式。

## 執行

```sh
python3 prototype/city-story/serve.py
```

打開 `http://localhost:5180`。`serve.py` 每次從根目錄 `.env` 讀 `VITE_GOOGLE_MAPS_API_KEY`，以 `config.js` 交給頁面，金鑰不會寫進檔案。沒有金鑰或金鑰被拒時改用 OpenStreetMap 底圖；網址加 `?base=osm` 可以直接指定。

## 資料與模型

| 項目 | 來源 |
|---|---|
| 各偵測器的車流量與車速 | TDX 車輛偵測器歷史資料，2026-10-22 07:00–09:30；自由車速取同一天 01:00–05:00 |
| 車流量 → 車速 | 每個偵測器、每個方向一條 BPR 曲線 `v = vf / (1 + 0.15 (q / cap)^4)`，通過晨峰最忙的 15 分鐘 |
| 道路路線 | OSRM 公開路網服務（OpenStreetMap） |
| 捷運線與車站 | OpenStreetMap（© OpenStreetMap contributors, ODbL） |
| 內科範圍 | `backend/config/park/boundary.geojson` |
| 下車大樓 | 臺北市內湖科技園區廠商名錄（data.taipei）、公開報導的員工人數 |

- 模擬的通勤者是樣本。第一幕各偵測器的車流量等於實測值，模擬車輛以外的部分視為背景車流（汐止、南港、內湖本地、路過的車）。
- 第二幕依採用比例減少車流，背景車流假設同比例減少，再由同一條曲線算出車速。
- 塞車程度：車速掉幅與佔有率（occupancy）取較嚴重者；偵測器不在橋上，民權大橋、麥帥橋、成美橋各取最近的進內湖方向偵測器。
- 選路：第一幕各橋的車數按入口偵測器的實測流量分配；每座橋另加一個校準秒數（代表號誌、匝道、習慣等路網沒有的因素），讓這個分配本身就是均衡，也就是每個人照 BPR 車速算出的延誤自由選路，結果仍是同樣的比例。第二幕保留這些秒數，從原本的橋出發重新均衡，所以改走別座橋的人只因為塞車程度改變。
- 偵測器量的是路段中間的點車速，量不到路口與匝道排隊，所以延誤可能被低估。

## 重新產生 `data.js`

`scripts/` 裡的腳本在一個工作目錄（以下稱 `$W`）讀寫中間資料。TDX 金鑰放在根目錄 `.env` 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。

1. `tdx.py`：呼叫 TDX API。另外用它下載臺北市 VD 靜態資料到 `$W/tdx/vd_static.json`。
2. `fetch_peak.py .env $W 2026-10-22`：下載整天的 VD 歷史資料（約 1 GB），彙整內湖各路段晨峰每 15 分鐘的資料。
3. `calibrate_vd.py $W 2026-10-22`：產生 `$W/tdx/detectors_2026-10-22.json`，即各偵測器的自由車速與容量。
4. `build_routes.py $W/routes_v5.json $W/park.json`：產生住家、候選路線與經過的偵測器。需要 `$W/osm/bridges.json`（Overpass 抓的內湖周邊橋梁），請求結果快取在 `$W/route_cache.json`。
5. `inject.py $W prototype/city-story/data.js routes_v5.json`：合併 `$W/stations.json`、`$W/mrt_lines.json`（Overpass 抓的捷運車站順序與軌道）與 `$W/park.json`，寫出 `data.js`。
