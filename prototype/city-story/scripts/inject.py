"""Write prototype/city-story/data.js from the data files in the work directory."""
import json
import sys
from pathlib import Path

scratch, out = Path(sys.argv[1]), Path(sys.argv[2])
routes_file = sys.argv[3] if len(sys.argv) > 3 else 'routes.json'

stations = json.loads((scratch / 'stations.json').read_text())
# OSM's 淡水信義線 relation stops at 大安; the last two stations of the Xinyi section are added by hand.
xinyi_tail = [
    {'name': '信義安和', 'lat': 25.03313, 'lng': 121.55273},
    {'name': '台北101/世貿', 'lat': 25.03298, 'lng': 121.56245},
]
if stations['淡水信義'][-1]['name'] == '大安':
    stations['淡水信義'] += xinyi_tail

tracks = json.loads((scratch / 'mrt_lines.json').read_text())
daan = stations['淡水信義'][-3]
tracks['淡水信義'].append([[daan['lat'], daan['lng']]] + [[s['lat'], s['lng']] for s in xinyi_tail])

data = {
    'routes': json.loads((scratch / routes_file).read_text()),
    'stations': stations,
    'tracks': tracks,
    'park': json.loads((scratch / 'park.json').read_text()),
}
out.write_text('window.STORY_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
print('wrote', out, out.stat().st_size, 'bytes')
