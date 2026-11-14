"""Crop the MOLA 463 m DEM to a lat/lon box and write web-ready grids.

Usage: python scripts/prep_dem.py LAT_MIN LAT_MAX LON_MIN LON_MAX [--src data/raw/mola.tif] [--out public/data]
                                 [--layer NAME=PATH ...] [--craters CATALOG.csv(.zip)]
Longitudes are -180..180 east. Outputs:
  dem.bin    Float32 heights (m), row 0 = north, NaN = no data
  slope.bin  Float32 slope (degrees), NaN = no data
  NAME.bin   Float32, each --layer raster resampled onto the same grid, NaN = no data
  crater.bin Float32 crater rim proximity 0..1 from the Robbins crater catalog (1 on the rim crest)
  dem.json   {bounds: [latMin, latMax, lonMin, lonMax], rows, cols, layers: [NAME, ...]}
"""
import argparse, json, os
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds

R_MOLA = 3396190.0          # sphere radius of the DEM's projection (m)
M_PER_DEG = 3389500.0 * np.pi / 180  # ~59,157 m per degree (Mars mean radius 3389.5 km)

p = argparse.ArgumentParser()
for a in ('lat_min', 'lat_max', 'lon_min', 'lon_max'):
    p.add_argument(a, type=float)
p.add_argument('--src', default='data/raw/mola.tif')
p.add_argument('--out', default='public/data')
p.add_argument('--layer', action='append', default=[], metavar='NAME=PATH', help='extra raster to put on the same grid')
p.add_argument('--craters', help='Robbins & Hynek crater catalog (.csv or .csv.zip)')
a = p.parse_args()

with rasterio.open(a.src) as src:
    res = src.res[0] / (R_MOLA * np.pi / 180)  # keep native resolution, in degrees
cols = round((a.lon_max - a.lon_min) / res)
rows = round((a.lat_max - a.lat_min) / res)

def warp(path):
    """Resample band 1 of any raster onto our lat/lon grid (bilinear), NaN where it has no data."""
    with rasterio.open(path) as src:
        out = np.full((rows, cols), np.nan, np.float32)
        reproject(rasterio.band(src, 1), out,
                  dst_transform=from_bounds(a.lon_min, a.lat_min, a.lon_max, a.lat_max, cols, rows),
                  dst_crs=f'+proj=longlat +R={R_MOLA} +no_defs', dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        return out * src.scales[0] + src.offsets[0]

dem = warp(a.src)

lat = np.linspace(a.lat_max, a.lat_min, rows)[:, None]
dy = (a.lat_max - a.lat_min) / rows * M_PER_DEG
dx = (a.lon_max - a.lon_min) / cols * M_PER_DEG * np.cos(np.radians(lat))
gy, gx = np.gradient(dem, axis=(0, 1))
slope = np.degrees(np.arctan(np.hypot(gx / dx, gy / dy))).astype(np.float32)

os.makedirs(a.out, exist_ok=True)
dem.astype(np.float32).tofile(f'{a.out}/dem.bin')
slope.tofile(f'{a.out}/slope.bin')
names = []
for spec in a.layer:
    name, path = spec.split('=', 1)
    grid = warp(path).astype(np.float32)
    grid.tofile(f'{a.out}/{name}.bin')
    names.append(name)
    print(f'{name}: {np.isnan(grid).mean():.1%} no data, range {np.nanmin(grid):.2f}..{np.nanmax(grid):.2f}')
if a.craters:
    import csv, io, zipfile
    f = zipfile.ZipFile(a.craters).open(zipfile.ZipFile(a.craters).namelist()[0]) if a.craters.endswith('.zip') else open(a.craters, 'rb')
    km = M_PER_DEG / 1000
    clat = a.lat_max - (np.arange(rows) + 0.5) * (a.lat_max - a.lat_min) / rows
    clon = a.lon_min + (np.arange(cols) + 0.5) * (a.lon_max - a.lon_min) / cols
    rim, used = np.zeros((rows, cols), np.float32), 0
    for row in csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig')):
        la, lo, R = float(row['LAT_CIRC_IMG']), float(row['LON_CIRC_IMG']), float(row['DIAM_CIRC_IMG']) / 2
        lo = lo - 360 if lo > 180 else lo
        if R > 50:                                     # ancient basins: worn down, their relief is already in the slope grid
            continue
        band = min(max(0.25 * R, 0.5), 2.0)            # rim zone half-width, km
        reach_lat = (R + band) / km
        reach_lon = reach_lat / max(np.cos(np.radians(la)), 0.01)
        r0, r1 = np.searchsorted(-clat, -(la + reach_lat)), np.searchsorted(-clat, -(la - reach_lat))
        c0, c1 = np.searchsorted(clon, lo - reach_lon), np.searchsorted(clon, lo + reach_lon)
        if r0 >= r1 or c0 >= c1:
            continue
        dy = (clat[r0:r1, None] - la) * km
        dx = (clon[None, c0:c1] - lo) * km * np.cos(np.radians(la))
        score = np.clip(1 - np.abs(np.hypot(dx, dy) - R) / band, 0, 1)
        np.maximum(rim[r0:r1, c0:c1], score, out=rim[r0:r1, c0:c1])
        used += 1
    rim.tofile(f'{a.out}/crater.bin')
    names.append('crater')
    print(f'crater: {used} craters in the box, {(rim > 0.5).mean():.1%} of cells near a rim')
json.dump({'bounds': [a.lat_min, a.lat_max, a.lon_min, a.lon_max], 'rows': rows, 'cols': cols, 'layers': names},
          open(f'{a.out}/dem.json', 'w'))
print(f'{rows}x{cols} cells, {np.isnan(dem).mean():.1%} no data, '
      f'height {np.nanmin(dem):.0f}..{np.nanmax(dem):.0f} m, max slope {np.nanmax(slope):.1f} deg')
