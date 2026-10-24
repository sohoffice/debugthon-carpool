"""Fetch one weekday morning (07:00-09:30) of TDX historical VD data for the roads into Neihu, and sum it into
15-minute slots per detector and direction. Usage: fetch_peak.py <env file> <work dir> <date YYYY-MM-DD>"""
import collections
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENV, SCRATCH, DATE = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
TPE = timezone(timedelta(hours=8))
ROADS = {
    '堤頂大道', '環東大道', '內湖路一段', '民權東路六段', '北安路', '明水路', '樂群一路', '大直橋', '麥帥二橋',
    '新明路', '八德路四段', '舊宗路一段', '舊宗路二段', '南京東路五段', '南京東路六段', '塔悠路', '成功路二段',
    '成功路三段', '成功路四段',
}
static = json.loads((SCRATCH / 'tdx' / 'vd_static.json').read_text())['VDs']
vds = {v['VDID']: v for v in static if v['RoadName'] in ROADS and 25.040 <= v['PositionLat'] <= 25.092 and 121.535 <= v['PositionLon'] <= 121.610}
direction = {l['LinkID']: l.get('RoadDirection') for v in vds.values() for l in v.get('DetectionLinks', [])}

# TDX's historical API ignores $filter and returns the whole day for every Taipei detector (about 1 GB of
# JSON lines, timestamps in UTC), so the day is downloaded once and filtered here.
day_file = SCRATCH / 'tdx' / f'day_{DATE}.jsonl'
if not day_file.exists():
    path = f'/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei?Dates={DATE}&$format=JSON'
    subprocess.run([sys.executable, '-I', str(Path(__file__).with_name('tdx.py')), ENV, path, str(day_file)], check=True, env={'TDX_TIMEOUT': '600'})
lo = datetime.fromisoformat(f'{DATE}T07:00:00+08:00')
hi = datetime.fromisoformat(f'{DATE}T09:30:00+08:00')
records = []
with open(day_file, encoding='utf-8-sig') as fh:
    for line in fh:
        if not line.strip() or '"VDID":"' not in line:
            continue
        vid = line.split('"VDID":"', 1)[1].split('"', 1)[0]
        if vid not in vds:
            continue
        rec = json.loads(line)
        at = datetime.fromisoformat(rec['DataCollectTime']).astimezone(TPE)
        if lo <= at < hi:
            rec['local'] = at.strftime('%H:%M')
            records.append(rec)

# vd -> direction -> slot -> [volume, speed*volume, occupancy sum, minutes]
agg = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0, 0])))
for rec in records:
    t = rec['local']
    slot = f"{t[:2]}:{int(t[3:5]) // 15 * 15:02d}"
    for link in rec.get('LinkFlows', []):
        d = direction.get(link['LinkID'], '?')
        cell = agg[rec['VDID']][d][slot]
        for lane in link.get('Lanes', []):
            vol = sum(v.get('Volume', 0) for v in lane.get('Vehicles', []) if v.get('Volume', 0) > 0)
            cell[0] += vol
            cell[1] += vol * max(0, lane.get('Speed', 0))
            cell[2] += max(0, lane.get('Occupancy', 0))
            cell[3] += 1

summary = []
for vid, dirs in agg.items():
    v = vds[vid]
    for d, slots in dirs.items():
        rows = {s: {'volume': c[0], 'speed': round(c[1] / c[0], 1) if c[0] else None, 'occupancy': round(c[2] / c[3], 1) if c[3] else None} for s, c in sorted(slots.items())}
        summary.append({'vd': vid, 'road': v['RoadName'], 'dir': d, 'lat': v['PositionLat'], 'lng': v['PositionLon'], 'slots': rows})
(SCRATCH / 'tdx' / f'peak_{DATE}.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1))
print(len(vds), 'detectors asked,', len(records), 'records,', len(summary), 'detector-directions with data')
