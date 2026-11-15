"""Add the OMEGA pyroxene map (Ody et al. 2012) to a region's grids, downloading only the rows that cover the box.

Usage: python scripts/fetch_omega.py [public/data]
Source: MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0 (ESA Mars Express OMEGA), NASA PDS Geosciences Node mirror.
Ody, A., et al. (2012), Global maps of anhydrous minerals at the surface of Mars from OMEGA/MEx, JGR 117, E00J14.
The value is the 2 µm pyroxene band depth (BD2000, maximum in each 0.025° pixel). Pixels below the detection
threshold (0.010) are missing in the source and stay "no data" (not detected) here. It is a spectral index, not an abundance.
Writes pyroxene.i16 (nearest OMEGA pixel for each grid cell) and adds it to dem.json.
"""
import json, sys, urllib.request
import numpy as np
from gridpack import save

URL = ('https://pds-geosciences.wustl.edu/mex/mex-m-omega-5-ddr-global-maps-v1/mexomg_2000/'
       'data/pyroxene/pyroxene_bd2000_equ_map.img')
PPD, W = 40, 14400                 # pixels per degree, samples per line (int16, little-endian; row 0 = 90N, col 0 = 180W)
SCALE, OFFSET, MISSING = 1.5256060329e-06, 5.9983480522e-02, -32768  # from pyroxene_bd2000_equ_map.lbl

d = sys.argv[1] if len(sys.argv) > 1 else 'public/data'
meta = json.load(open(f'{d}/dem.json'))
(lat0, lat1, lon0, lon1), rows, cols = meta['bounds'], meta['rows'], meta['cols']
lat = lat1 - (np.arange(rows) + 0.5) * (lat1 - lat0) / rows   # our cell centres
lon = lon0 + (np.arange(cols) + 0.5) * (lon1 - lon0) / cols
ri = np.floor((90 - lat) * PPD).astype(int)
ci = np.floor((lon + 180) * PPD).astype(int)
r_first, r_last = ri.min(), ri.max()
req = urllib.request.Request(URL, headers={'Range': f'bytes={r_first * W * 2}-{(r_last + 1) * W * 2 - 1}'})
raw = np.frombuffer(urllib.request.urlopen(req, timeout=300).read(), '<i2').reshape(-1, W)
assert raw.shape[0] == r_last - r_first + 1, 'server did not return the requested rows'
dn = raw[ri[:, None] - r_first, ci[None, :]]
grid = np.where(dn == MISSING, np.nan, dn * SCALE + OFFSET).astype(np.float32)
meta.setdefault('packed', {})['pyroxene'] = save(d, 'pyroxene', grid)
if 'pyroxene' not in meta['layers']:
    meta['layers'].append('pyroxene')
json.dump(meta, open(f'{d}/dem.json', 'w'))
ok = ~np.isnan(grid)
print(f'pyroxene detected in {ok.mean():.1%} of cells, BD2000 {np.nanmin(grid):.3f}..{np.nanmax(grid):.3f}' if ok.any() else 'no pyroxene detected')
