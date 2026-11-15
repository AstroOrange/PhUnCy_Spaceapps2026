"""Global MOLA elevation for the world-map readout, and the colour bar that matches the Mars Trek MOLA colour map.

Usage: cd scripts && python fetch_mola_global.py [../public/data]   (needs pillow for the colour bar: pip install pillow)
1. Downloads the MGS MOLA MEGDR at 4 pixels per degree (megt90n000cb.img, 2 MB; Smith et al. 2003, PDS Geosciences Node),
   heights in metres above the areoid like the 463 m DEM, and writes mola_global.i16 + mola_global.json
   (row 0 = 90N, column 0 = 180W, so it lines up with the map).
2. Measures the colour scale of the Mars Trek "MGS MOLA colour shaded relief" tiles by sampling every pixel of the
   zoom-2 tiles against the MOLA height at the same place, and records the median colour for each 250 m band.
   Hill shading changes brightness, so the median is used; the bar is the map's own colours, not a guess.
"""
import io, json, sys, urllib.request
import numpy as np
from gridpack import save

MEGDR = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img'
TILE = 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/2/{y}/{x}.jpg'
PPD = 4
d = sys.argv[1] if len(sys.argv) > 1 else '../public/data'

# 1. Elevation: big-endian int16 metres, 1440 x 720, column 0 = 0E (label: SAMPLE_PROJECTION_OFFSET 720.5, CENTER_LONGITUDE 180)
raw = np.frombuffer(urllib.request.urlopen(MEGDR, timeout=300).read(), '>i2').reshape(720, 1440)
elev = np.roll(raw.astype(np.float32), 720, axis=1)      # column 0 = 180W
packed = save(d, 'mola_global', elev)

# 2. Colour scale from the zoom-2 tiles (8 x 4 tiles of 256 px, 45 degrees each)
from PIL import Image
rgb, z = [], []
for ty in range(4):
    for tx in range(8):
        img = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(TILE.format(x=tx, y=ty), timeout=60).read())).convert('RGB'))
        n = img.shape[0]
        lat = 90 - ty * 45 - (np.arange(n) + 0.5) * 45 / n
        lon = -180 + tx * 45 + (np.arange(n) + 0.5) * 45 / n
        r = np.clip(((90 - lat) * PPD).astype(int), 0, 719)
        c = np.clip(((lon + 180) * PPD).astype(int), 0, 1439)
        z.append(elev[r[:, None], c[None, :]].ravel()); rgb.append(img.reshape(-1, 3))
z, rgb = np.concatenate(z), np.concatenate(rgb)
stops = []
for lo in np.arange(-8500, 22000, 250):
    m = (z >= lo) & (z < lo + 250)
    if m.sum() >= 200:
        stops.append([int(lo + 125), *[int(v) for v in np.median(rgb[m], axis=0)]])
json.dump({'ppd': PPD, 'rows': 720, 'cols': 1440, 'packed': packed, 'colorbar': stops,
           'source': 'MGS MOLA MEGDR 4 px/deg (Smith et al. 2003, PDS); colour bar measured from NASA Mars Trek MOLA colour shaded relief tiles'},
          open(f'{d}/mola_global.json', 'w'))
print(f'height {np.nanmin(elev):.0f}..{np.nanmax(elev):.0f} m; colour bar {stops[0][0]}..{stops[-1][0]} m, {len(stops)} stops')
for s in stops[::8]: print(s)
