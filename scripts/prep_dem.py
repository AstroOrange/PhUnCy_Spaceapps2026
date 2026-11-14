"""Crop the MOLA 463 m DEM to a lat/lon box and write web-ready grids.

Usage: python scripts/prep_dem.py LAT_MIN LAT_MAX LON_MIN LON_MAX [--src data/raw/mola.tif] [--out public/data]
                                 [--layer NAME=PATH ...]
Longitudes are -180..180 east. Outputs:
  dem.bin    Float32 heights (m), row 0 = north, NaN = no data
  slope.bin  Float32 slope (degrees), NaN = no data
  NAME.bin   Float32, each --layer raster resampled onto the same grid, NaN = no data
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
json.dump({'bounds': [a.lat_min, a.lat_max, a.lon_min, a.lon_max], 'rows': rows, 'cols': cols, 'layers': names},
          open(f'{a.out}/dem.json', 'w'))
print(f'{rows}x{cols} cells, {np.isnan(dem).mean():.1%} no data, '
      f'height {np.nanmin(dem):.0f}..{np.nanmax(dem):.0f} m, max slope {np.nanmax(slope):.1f} deg')
