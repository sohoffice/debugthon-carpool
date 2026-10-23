# 進內湖 16 個入口的 TDX 車流

市府管理介面與通勤資訊的實測車流（DD-36、DD-44），由遷移檔 `backend/migrations/20261023180000_tdx_gateway_traffic.sql` 載入資料庫。

| 檔案 | 內容 |
|------|------|
| `detectors.csv` | 16 個入口，每個入口一支代表的偵測器（`traffic_detectors`） |
| `observations-15min.csv` | 每個入口每 15 分鐘一筆的彙總（`traffic_observations`） |
| `reference-speeds.csv` | 每個入口的 p85 速度：尖峰、夜間與全天；載入的是全天（`p85_all_day`） |

## 來源

交通部運輸資料流通服務平臺（TDX）：

- 偵測器靜態資料：臺北市 `/v2/Road/Traffic/VD/City/Taipei`、國道 `/v2/Road/Traffic/VD/Freeway`（2026-10-22 更新）。
- 路段線形：`/v2/Road/Traffic/SectionShape/City/Taipei`、`/v2/Road/Traffic/SectionShape/Freeway`，以 `SectionID` = `L_` + 偵測器的 `link_id` 對應。16 個入口只有 6 個對得到。
- 車流：臺北市與國道的 VD 歷史資料 `/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei`、`.../VD/Freeway`，每個車道每分鐘一筆。

## 期間

2026-10-12～10-22 的上班日（10/12–16、10/19–22，共 9 天），07:00–10:00，只取進內湖方向的車道。共 9 天 × 12 個時段 × 16 個入口 = 1728 筆。

## 欄位

`detectors.csv`：

- `source`：`city`（臺北市）或 `freeway`（國道）。
- `vd_id`、`link_id`、`road_name`、`lat`、`lng`：TDX 的 `VDID`、進內湖方向的 `LinkID`、`RoadName`、`PositionLat`、`PositionLon`。
- `gateway`：畫面上的入口名稱。`from`、`note`：入口從哪裡進來、偵測器的位置說明。
- `road_direction`、`bearing`：進內湖方向那一筆 `DetectionLinks` 的 `RoadDirection` 與 `Bearing`。兩者可能不同，例如堤頂大道（大直端）是 `S` 與 `E`。
- `lanes`：進內湖方向的車道數。
- `proxy`、`proxy_note`：以附近路段的偵測器代替入口時為 `true`，並寫偵測器的實際位置。成美橋（VMSV820）在橋北端的新明路；成功橋（VQ6WK40）在橋北約 900 公尺的成功路二段。
- `reference_speed_kmh`：全天 p85，同 `reference-speeds.csv` 的 `p85_all_day`。
- `shape`：路段線形，JSON 陣列 `[{"lat":…,"lng":…}, …]`，點序就是車流方向；沒有線形時為空。

`observations-15min.csv`：

- `slot_start`：時段開始，台北時間的 :00、:15、:30、:45。
- `volume`：補足缺漏後的車流量（所有車道、所有車型）。`volume_raw`：補足前的加總。
- `avg_speed_kmh`：以車流量加權的平均車速。`occupancy_pct`：佔有率，各車道分鐘的平均。
- `coverage_pct`：保留的車道分鐘占應有的比例；1728 筆中有 110 筆未滿 100%，最低 66.7%。
- `simulated`：全部為 `false`。

## 彙總方式

1. 只取進內湖方向的車道。
2. 捨棄狀態不為 0 或數值為 −99 的車道分鐘。
3. 車流量 = 保留的加總 ×（車道數 × 15）÷ 保留的車道分鐘數。
4. 速度以車流量加權平均；佔有率為保留的車道分鐘的平均。
5. p85：該入口所有 15 分鐘時段的車速中，最快 15% 的門檻。全天是 24 小時，每個入口 824～866 個時段。

## 授權

[交通部運輸資料流通服務平臺資料授權利用條款](https://tdx.transportdata.tw/term)（112 年 10 月 26 日訂頒），依據政府資料開放授權條款，必須標示資料來源為「交通部運輸資料流通服務平臺」。條款另規定：「依本條款授權利用平臺運輸資料所為之相關研究或統計成果，使用者同意無償提供平臺管理機關及資料來源單位參考使用。」本目錄的 15 分鐘彙總屬於這類統計成果。

這裡的檔案不含 TDX 的金鑰；金鑰只放在 `.env`。

## 補上新的一天

TDX 的歷史資料在隔天 00:05 之後才能取得，只能整天下載。補上新的一天（例如 10/23）時：

1. 依上面的方式彙總，把新的列加進 `observations-15min.csv`。
2. 新增一個遷移檔：先刪除那一天模擬的列（`DELETE FROM traffic_observations WHERE simulated AND` 落在那一天），再插入實測的列（`simulated = false`、`weather_simulated = true`），最後呼叫 `generate_commute_simulation(commute_now(now()))`，讓天氣與上車點統計跟著更新。
3. 參考速度不更新（DD-44）。
