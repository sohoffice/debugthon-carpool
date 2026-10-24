"""Homes and candidate road routes for the Neihu congestion simulation.

Each driver gets a few candidate routes (OSRM's fastest and alternatives, plus routes over the other bridges that
are at most DETOUR slower); the page shares people out over the bridges in the volumes the detectors measured. Every candidate
lists the TDX detectors it passes, so speeds come from the detectors' calibrated volume-speed curves. Routed with the public OSRM demo server; every
response is cached in route_cache.json.
"""
import collections
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path

OUT = Path(sys.argv[1])
PARK = json.loads(Path(sys.argv[2]).read_text())  # [[lat, lng], ...]
CACHE_FILE = OUT.with_name('route_cache.json')
CACHE = json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}

PICKUPS = [
    ('松山車站', 25.049806, 121.578206),
    ('台北世貿中心', 25.03315, 121.5619),
    ('台北大巨蛋', 25.044249, 121.557934),
    ('行天宮', 25.05941, 121.53316),
]
# Entries into Neihu: a point on the bridge carriageway towards Neihu, with that carriageway's bearing so OSRM
# does not snap to the opposite direction. 'direct' leaves the route to OSRM (自強隧道, 北安路 and the like).
ENTRIES = [
    ('大直橋', 25.0780, 121.5445, 0),
    ('民權大橋', 25.0638, 121.5690, 73),
    ('麥帥橋', 25.0527, 121.5718, 70),
    ('成美橋', 25.0538, 121.5826, 351),
    ('direct', None, None, None),
]
# (name, lat, lng, spread in degrees, count)
REGIONS = [
    ('三重', 25.063, 121.487, 0.008, 14),
    ('新莊', 25.040, 121.452, 0.008, 12),
    ('板橋', 25.013, 121.463, 0.008, 12),
    ('萬華', 25.033, 121.497, 0.006, 12),
    ('中正大同', 25.050, 121.513, 0.006, 12),
    ('中山', 25.062, 121.530, 0.006, 16),
    ('大安', 25.028, 121.540, 0.006, 18),
    ('信義', 25.032, 121.568, 0.004, 8),
    ('士林', 25.092, 121.522, 0.006, 12),
    ('北投', 25.122, 121.500, 0.007, 8),
    ('新店景美', 24.990, 121.540, 0.008, 12),
    ('永和中和', 25.005, 121.513, 0.006, 12),
    ('松山', 25.052, 121.556, 0.004, 6),
    ('大直', 25.081, 121.545, 0.004, 4),
]
N_DEST = 8
# Each driver already on an entry makes it this much slower for the next one (fraction of the trip per 10% share).
LOAD_PENALTY = 0.25
# An entry is only considered if it is at most this much slower than the driver's fastest one when empty.
MAX_DETOUR = 1.45
NORTH_REGIONS = {'士林', '北投', '大直'}


def inside(p, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (yi > p[0]) != (yj > p[0]) and p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def meters(a, b):
    return math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))


def simplify(points, tol_m=12):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    cos = math.cos(math.radians(a[0]))
    bx, by = (b[1] - a[1]) * 111320 * cos, (b[0] - a[0]) * 110540
    seg = bx * bx + by * by
    best, idx = -1, 0
    for i in range(1, len(points) - 1):
        px, py = (points[i][1] - a[1]) * 111320 * cos, (points[i][0] - a[0]) * 110540
        t = 0 if seg == 0 else max(0, min(1, (px * bx + py * by) / seg))
        d = math.hypot(px - t * bx, py - t * by)
        if d > best:
            best, idx = d, i
    if best <= tol_m:
        return [a, b]
    return simplify(points[: idx + 1], tol_m)[:-1] + simplify(points[idx:], tol_m)


def osrm(url):
    if url in CACHE:
        return CACHE[url]
    for attempt in range(8):
        try:
            # curl, not urllib: the system Python here has no CA bundle for HTTPS.
            raw = subprocess.run(['curl', '-s', '--max-time', '40', '-A', 'carpool-congestion-sim/0.1', url], capture_output=True, text=True, check=True).stdout
            data = json.loads(raw)
            if data.get('code') == 'Ok':
                CACHE[url] = data
                if len(CACHE) % 25 == 0:
                    CACHE_FILE.write_text(json.dumps(CACHE))
                time.sleep(1.1)
                return data
            print('osrm', data.get('code'), data.get('message'), file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - retry any network hiccup
            print('retry', attempt, e, file=sys.stderr)
        time.sleep(3 + attempt * 3)
    raise RuntimeError(f'OSRM failed: {url[:120]}')


def coords(points):
    return ';'.join(f'{p[1]},{p[0]}' for p in points)


def route(points, bearings=None):
    url = f'https://router.project-osrm.org/route/v1/driving/{coords(points)}?overview=full&geometries=geojson'
    if bearings:
        url += '&bearings=' + ';'.join('' if b is None else f'{b},45' for b in bearings)
    r = osrm(url)['routes'][0]
    pts = [[round(lat, 5), round(lng, 5)] for lng, lat in r['geometry']['coordinates']]
    return {'points': simplify(pts), 'distance_m': round(r['distance']), 'duration_s': round(r['duration'])}


def table(sources, destinations, dest_bearings=None):
    pts = sources + destinations
    url = (f'https://router.project-osrm.org/table/v1/driving/{coords(pts)}?annotations=duration'
           f'&sources={";".join(map(str, range(len(sources))))}'
           f'&destinations={";".join(map(str, range(len(sources), len(pts))))}')
    if dest_bearings:
        url += '&bearings=' + ';'.join([''] * len(sources) + ['' if b is None else f'{b},45' for b in dest_bearings])
    return osrm(url)['durations']


def chunks(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]


# Large office buildings inside the park, weighted by how many people work there (head counts from public
# reports where known, the number of registered companies for multi-tenant buildings).
DESTS = [
    ('仁寶總部', 25.07976, 121.56798, 30),
    ('光寶總部', 25.0778, 121.57126, 15),
    ('APEC國家科技總部', 25.07391, 121.57865, 15),
    ('長虹旗艦科技大樓', 25.08367, 121.5623, 15),
    ('內科服務大樓', 25.07822, 121.57505, 15),
    ('遊戲橘子總部', 25.07184, 121.57645, 10),
]
DETECTORS = json.loads((OUT.parent / 'tdx' / 'detectors_2026-10-22.json').read_text())
BRIDGE_WAYS = collections.defaultdict(list)
for e in json.loads((OUT.parent / 'osm' / 'bridges.json').read_text())['elements']:
    BRIDGE_WAYS[e['tags']['name']] += [(p['lat'], p['lon']) for p in e['geometry']]
BRIDGE_GROUP = {'大直橋': '大直橋', '濱江跨越橋': '大直橋', '民權大橋': '民權大橋', '麥帥一橋': '麥帥橋', '麥帥二橋': '麥帥橋',
                '正氣橋': '麥帥橋', '成美橋': '成美橋', '自強橋': '自強橋', '成功橋': '成功橋', '大湖橋': '大湖橋'}
# A candidate may be at most this much slower than the fastest route on empty roads; wide enough that most
# people have a route over each of the busy bridges, which the page then fills in the measured shares.
DETOUR = 1.6


def seg_dist(p, a, b):
    k = 111320 * math.cos(math.radians(a[0]))
    bx, by = (b[1] - a[1]) * k, (b[0] - a[0]) * 110540
    px, py = (p[1] - a[1]) * k, (p[0] - a[0]) * 110540
    seg = bx * bx + by * by
    t = 0 if seg == 0 else max(0, min(1, (px * bx + py * by) / seg))
    return math.hypot(px - t * bx, py - t * by), t


def bearing(a, b):
    return (math.degrees(math.atan2((b[1] - a[1]) * math.cos(math.radians(a[0])), b[0] - a[0])) + 360) % 360


def annotate(r):
    """Which bridge the route crosses, and the detectors it passes heading their way, with metres along."""
    pts = r['points']
    hits, along, seen = [], 0.0, set()
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seg = meters(a, b)
        hdg = bearing(a, b)
        for di, d in enumerate(DETECTORS):
            if di in seen:
                continue
            dist, t = seg_dist(d['at'], a, b)
            diff = abs((hdg - d['bearing'] + 180) % 360 - 180)
            if dist < 40 and diff < 50 and seg > 5:
                hits.append([di, round(along + t * seg)])
                seen.add(di)
        along += seg
    crossed = {g for name, g in BRIDGE_GROUP.items()
               if sum(1 for q in BRIDGE_WAYS[name] if any(seg_dist(q, pts[i], pts[i + 1])[0] < 30 for i in range(len(pts) - 1))) >= 2}
    # 民權大橋 lands next to the 麥帥二橋 ramps, so it is checked first or its routes read as 麥帥橋.
    entry = next((g for g in ('成美橋', '民權大橋', '麥帥橋', '大直橋', '自強橋') if g in crossed), 'north')
    return {**r, 'entry': entry, 'hits': sorted(hits, key=lambda h: h[1])}


def routes_with_alternatives(points):
    url = f'https://router.project-osrm.org/route/v1/driving/{coords(points)}?overview=full&geometries=geojson&alternatives=2'
    out = []
    for r in osrm(url)['routes']:
        pts = [[round(lat, 5), round(lng, 5)] for lng, lat in r['geometry']['coordinates']]
        out.append({'points': simplify(pts), 'distance_m': round(r['distance']), 'duration_s': round(r['duration'])})
    return out


def candidates(start, dest, table_cost):
    """OSRM's fastest route and alternatives, plus routes over bridges they miss that are at most DETOUR slower."""
    cands = [annotate(r) for r in routes_with_alternatives([start, dest])]
    best = cands[0]['duration_s']
    for e in ENTRIES:
        if e[1] is None or any(c['entry'] == e[0] for c in cands):
            continue
        if table_cost.get(e[0], 1e9) > best * DETOUR:
            continue
        r = annotate(route([start, [e[1], e[2]], dest], [None, e[3], None]))
        if r['duration_s'] <= best * DETOUR and r['entry'] == e[0]:
            cands.append(r)
    # Drop near-duplicates (same bridge, within 3% length) and anything far slower than the best.
    kept = []
    for c in sorted(cands, key=lambda c: c['duration_s']):
        if c['duration_s'] > best * DETOUR:
            continue
        if any(k['entry'] == c['entry'] and abs(k['distance_m'] - c['distance_m']) < 0.03 * c['distance_m'] for k in kept):
            continue
        kept.append(c)
    return kept


def main():
    rnd = random.Random(20261024)
    homes = []
    for name, lat, lng, spread, n in REGIONS:
        for _ in range(n):
            homes.append({'region': name, 'at': [round(rnd.gauss(lat, spread), 5), round(rnd.gauss(lng, spread), 5)]})
    dests = [[d[1], d[2]] for d in DESTS]
    weights = [d[3] for d in DESTS]
    for h in homes:
        h['dest'] = rnd.choices(range(len(DESTS)), weights)[0]

    bridges = [e for e in ENTRIES if e[1] is not None]
    bridge_pts = [[e[1], e[2]] for e in bridges]
    to_bridge = []
    for part in chunks([h['at'] for h in homes], 60):
        to_bridge += table(part, bridge_pts, [e[3] for e in bridges])
    bridge_to_dest = table(bridge_pts, dests)
    pickup_to_bridge = table([p[1:] for p in PICKUPS], bridge_pts, [e[3] for e in bridges])

    for n, h in enumerate(homes):
        costs = {e[0]: to_bridge[n][b] + bridge_to_dest[b][h['dest']] for b, e in enumerate(bridges)}
        h['routes'] = candidates(h['at'], dests[h['dest']], costs)
        h['at'] = h['routes'][0]['points'][0]
        dist = [meters(h['at'], p[1:]) for p in PICKUPS]
        near = sorted(range(len(PICKUPS)), key=lambda k: dist[k])
        h['toPickups'] = {} if h['region'] in NORTH_REGIONS else \
            {str(k): route([h['at'], PICKUPS[k][1:]]) for k in near if k == near[0] or dist[k] < 4000}
        if n % 10 == 0:
            print(time.strftime('%H:%M:%S'), n, 'homes', file=sys.stderr, flush=True)
    onward = {}
    for pi, p in enumerate(PICKUPS):
        for di, d in enumerate(dests):
            costs = {e[0]: pickup_to_bridge[pi][b] + bridge_to_dest[b][di] for b, e in enumerate(bridges)}
            onward[f'{pi}|{di}'] = candidates(p[1:], d, costs)
    CACHE_FILE.write_text(json.dumps(CACHE))
    OUT.write_text(json.dumps({
        'homes': homes, 'dests': [{'name': d[0], 'at': [d[1], d[2]]} for d in DESTS], 'onward': onward,
        'detectors': DETECTORS,
    }, ensure_ascii=False, separators=(',', ':')))
    print('done', len(CACHE), 'cached responses', file=sys.stderr)


main()
