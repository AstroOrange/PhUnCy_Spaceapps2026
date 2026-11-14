"""Store a Float32 grid as Int16 (half the download): value = raw * scale + offset, raw -32768 = no data.
The scale is picked from the grid's own range, so precision is range / 65,000 (for example about 1 cm for heights here)."""
import numpy as np

NODATA = -32768

def save(out_dir, name, grid):
    g = np.asarray(grid, np.float64)
    ok = ~np.isnan(g)
    lo, hi = (float(g[ok].min()), float(g[ok].max())) if ok.any() else (0.0, 0.0)
    offset = (lo + hi) / 2
    scale = max((hi - lo) / 65000, 1e-9)
    raw = np.full(g.shape, NODATA, np.int16)
    raw[ok] = np.clip(np.round((g[ok] - offset) / scale), -32767, 32767)
    raw.tofile(f'{out_dir}/{name}.i16')
    return {'scale': scale, 'offset': offset}
