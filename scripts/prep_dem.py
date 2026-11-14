"""Crop the MOLA 463 m DEM to a lat/lon box and write web-ready grids.

Usage: python scripts/prep_dem.py LAT_MIN LAT_MAX LON_MIN LON_MAX [--src data/raw/mola.tif] [--out public/data]
Longitudes are -180..180 east. Outputs:
  dem.bin   Float32 heights (m), row 0 = north, NaN = no data
  slope.bin Float32 slope (degrees), NaN = no data
  dem.json  {bounds: [latMin, latMax, lonMin, lonMax], rows, cols}
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
a = p.parse_args()

with rasterio.open(a.src) as src:
    res = src.res[0] / (R_MOLA * np.pi / 180)  # keep native resolution, in degrees
    cols = round((a.lon_max - a.lon_min) / res)
    rows = round((a.lat_max - a.lat_min) / res)
    dem = np.full((rows, cols), np.nan, np.float32)
    reproject(rasterio.band(src, 1), dem,
              dst_transform=from_bounds(a.lon_min, a.lat_min, a.lon_max, a.lat_max, cols, rows),
              dst_crs=f'+proj=longlat +R={R_MOLA} +no_defs', dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    dem = dem * src.scales[0] + src.offsets[0]

lat = np.linspace(a.lat_max, a.lat_min, rows)[:, None]
dy = (a.lat_max - a.lat_min) / rows * M_PER_DEG
dx = (a.lon_max - a.lon_min) / cols * M_PER_DEG * np.cos(np.radians(lat))
gy, gx = np.gradient(dem, axis=(0, 1))
slope = np.degrees(np.arctan(np.hypot(gx / dx, gy / dy))).astype(np.float32)

os.makedirs(a.out, exist_ok=True)
dem.astype(np.float32).tofile(f'{a.out}/dem.bin')
slope.tofile(f'{a.out}/slope.bin')
json.dump({'bounds': [a.lat_min, a.lat_max, a.lon_min, a.lon_max], 'rows': rows, 'cols': cols},
          open(f'{a.out}/dem.json', 'w'))
print(f'{rows}x{cols} cells, {np.isnan(dem).mean():.1%} no data, '
      f'height {np.nanmin(dem):.0f}..{np.nanmax(dem):.0f} m, max slope {np.nanmax(slope):.1f} deg')
