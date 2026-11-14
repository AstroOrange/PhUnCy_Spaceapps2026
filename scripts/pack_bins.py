"""One-off: convert old Float32 grids (public/data/*.bin) to packed Int16 (*.i16) and record the scales in dem.json.
Usage: python scripts/pack_bins.py [public/data]"""
import json, os, sys
import numpy as np
from gridpack import save

d = sys.argv[1] if len(sys.argv) > 1 else 'public/data'
meta = json.load(open(f'{d}/dem.json'))
meta['packed'] = {}
for name in ['dem', 'slope', *meta.get('layers', [])]:
    g = np.fromfile(f'{d}/{name}.bin', np.float32)
    meta['packed'][name] = save(d, name, g)
    back = np.fromfile(f'{d}/{name}.i16', np.int16) * meta['packed'][name]['scale'] + meta['packed'][name]['offset']
    print(f"{name}: max error {np.nanmax(np.abs(back - g)):.5f}")
    os.remove(f'{d}/{name}.bin')
json.dump(meta, open(f'{d}/dem.json', 'w'))
