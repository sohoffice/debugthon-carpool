# Taipei bus stops

| File | What |
|------|------|
| `raw/GetStop.gz`, `raw/GetRoute.gz` | Snapshot of the official feed (updated 2026/10/18 14:03:04) |
| `busstops.csv` | One row per physical stop: `stop_id,name,lat,lng` (WGS84, Google Maps order) |
| `stop_routes.csv` | Routes serving each stop: `stop_id,route_id,route_name,go_back,seq_no` (`go_back` 0 = 去程, 1 = 返程) |
| `busstop.*` | Old 2020 shapefile. No longer used; 16% of names are truncated. |

Source: 臺北市公車動態資訊中心 (`https://tcgbusfs.blob.core.windows.net/blobbus/`), published on data.taipei under the 政府資料開放授權條款.

`stop_id` is the feed's `stopLocationId`. It matches `BSM_BUSSTO` in the old shapefile.

Refresh (the Python scripts were removed; to be rewritten in Go):

1. Download `GetStop.gz` and `GetRoute.gz` from `https://tcgbusfs.blob.core.windows.net/blobbus/`. Each is gzipped JSON: `{"EssentialInfo": {...}, "BusInfo": [...]}`. Check that `EssentialInfo.CoordinateSystem` is `WGS84` and `BusInfo` is a list before replacing the file in `raw/`.
2. `busstops.csv`: group `GetStop` rows by `stopLocationId`. Name = most common trimmed `nameZh`. Position = `latitude`/`longitude` of the row with the lowest `Id` (rows agree within ~7 m). Reject points outside Taiwan (lat 21.5–26.5, lng 119.0–122.5).
3. `stop_routes.csv`: one row per unique (`stopLocationId`, `routeId`, `goBack`, `seqNo`). `route_name` = trimmed `nameZh` from `GetRoute` by `Id`. An unknown `routeId` is an error.
4. Sort both files by their columns, in order. Write UTF-8 without BOM.
