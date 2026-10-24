"""Per detector and direction, fit a BPR volume-delay curve to one weekday of TDX VD data.

speed(q) = vf / (1 + 0.15 * (q / C) ** 4), q in vehicles per 15 minutes.
vf is the volume-weighted speed between 01:00 and 05:00, when the roads are nearly empty (the 85th
percentile 10:00-16:00 speed where night traffic is too thin); C is solved so that the curve
passes through the busiest 15-minute slot of the 07:00-09:30 peak, whose occupancy is kept too (occupancy is
the share of time a car sits on the sensor: queues at signals raise it even where the average speed holds up),
with the exponent b of occupancy ~ volume^b fitted over the peak's 15-minute slots (how fast queues ease when
fewer cars come).
Usage: calibrate_vd.py <work dir> <date>
"""
import collections
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRATCH, DATE = Path(sys.argv[1]), sys.argv[2]
TPE = timezone(timedelta(hours=8))
ALPHA, BETA = 0.15, 4
BEARING = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}

peak = json.loads((SCRATCH / 'tdx' / f'peak_{DATE}.json').read_text())
static = {v['VDID']: v for v in json.loads((SCRATCH / 'tdx' / 'vd_static.json').read_text())['VDs']}
wanted = {r['vd'] for r in peak}
direction = {l['LinkID']: l.get('RoadDirection') for vid in wanted for l in static[vid].get('DetectionLinks', [])}

# Off-peak 15-minute speeds per (vd, dir), volume weighted within each slot.
slots = collections.defaultdict(lambda: [0, 0])
with open(SCRATCH / 'tdx' / f'day_{DATE}.jsonl', encoding='utf-8-sig') as fh:
    for line in fh:
        if '"VDID":"' not in line:
            continue
        vid = line.split('"VDID":"', 1)[1].split('"', 1)[0]
        if vid not in wanted:
            continue
        rec = json.loads(line)
        at = datetime.fromisoformat(rec['DataCollectTime']).astimezone(TPE)
        if 1 <= at.hour < 5:
            slot = 'night'
        elif 10 <= at.hour < 16:
            slot = at.strftime('%H') + f'{at.minute // 15 * 15:02d}'
        else:
            continue
        for link in rec.get('LinkFlows', []):
            d = direction.get(link['LinkID'], '?')
            for lane in link.get('Lanes', []):
                vol = sum(v.get('Volume', 0) for v in lane.get('Vehicles', []) if v.get('Volume', 0) > 0)
                if vol and lane.get('Speed', 0) > 0:
                    cell = slots[(vid, d, slot)]
                    cell[0] += vol
                    cell[1] += vol * lane['Speed']
offpeak = collections.defaultdict(list)
night = {}
for (vid, d, slot), (vol, sv) in slots.items():
    if slot == 'night':
        if vol >= 20:
            night[(vid, d)] = sv / vol
    elif vol >= 10:
        offpeak[(vid, d)].append(sv / vol)

out = []
for r in peak:
    s = offpeak.get((r['vd'], r['dir']), [])
    if len(s) < 8 or r['dir'] not in BEARING:
        continue
    s.sort()
    vf = night.get((r['vd'], r['dir'])) or s[int(len(s) * 0.85)]
    busy = max(r['slots'].items(), key=lambda kv: kv[1]['volume'])
    q, v, occ = busy[1]['volume'], busy[1]['speed'], busy[1]['occupancy'] or 0
    if not q or not v:
        continue
    vf = max(vf, v)
    # Below 90% of free speed the slot is congested and pins the curve; otherwise the road had spare room.
    if v < 0.9 * vf:
        cap = q / (((vf / v) - 1) / ALPHA) ** (1 / BETA)
    else:
        cap = q * 1.6
    speeds = [x['speed'] for x in r['slots'].values() if x['speed']]
    pts = [(math.log(x['volume']), math.log(x['occupancy'])) for x in r['slots'].values() if x['volume'] and x['occupancy']]
    exp = 1.0
    if len(pts) >= 5:
        mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - mx) ** 2 for p in pts)
        if sxx > 0:
            exp = min(3.0, max(0.5, sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx))
    out.append({
        'vd': r['vd'], 'road': r['road'], 'dir': r['dir'], 'bearing': BEARING[r['dir']], 'at': [r['lat'], r['lng']],
        'vf': round(vf, 1), 'qPeak': q, 'vPeak': round(v, 1), 'occPeak': round(occ, 1), 'occExp': round(exp, 2), 'cap': round(cap, 1), 'vMin': round(min(speeds), 1),
    })
(SCRATCH / 'tdx' / f'detectors_{DATE}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(len(out), 'detector-directions calibrated')
for d in sorted(out, key=lambda d: d['vPeak'] / d['vf'])[:14]:
    print(f"  {d['road']:<7}{d['dir']:<3}{d['vd']}  自由車速 {d['vf']:>5}  尖峰 {d['qPeak']:>4} 台/15分 @ {d['vPeak']:>5} km/h  容量 {d['cap']:>6}")
