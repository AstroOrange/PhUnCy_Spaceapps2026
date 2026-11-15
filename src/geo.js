export const R = 3389500; // Mars mean radius (m)
export const M_PER_DEG = R * Math.PI / 180; // ~59,157 m
const rad = d => d * Math.PI / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const slopeDeg = (dz, d) => Math.atan(Math.abs(dz) / d) * 180 / Math.PI;

// Grid <-> lat/lon. meta = {bounds: [latMin, latMax, lonMin, lonMax], rows, cols}, row 0 = north.
const step = ({ bounds: [a, b, c, d], rows, cols }) => [(b - a) / rows, (d - c) / cols];
export function cellLatLon(m, r, c) {
  const [dLat, dLon] = step(m);
  return [m.bounds[1] - (r + 0.5) * dLat, m.bounds[2] + (c + 0.5) * dLon];
}
export function latLonCell(m, lat, lon) {
  const [dLat, dLon] = step(m);
  return [Math.floor((m.bounds[1] - lat) / dLat), Math.floor((lon - m.bounds[2]) / dLon)];
}

// Cut out the part of a grid around some cells (a route, or pins) for the local 3D view.
// Pads by a quarter of the cells' extent and at least `minPad` cells, and makes the area at least `minSize` cells across.
// Returns the sub-grid, its meta and the cells shifted into it. No cells: the whole grid.
export function cropGrid(h, m, cells, { minPad = 20, minSize = 90 } = {}) {
  if (!cells.length) return { h, meta: m, cells };
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (const [r, c] of cells) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  const grow = (lo, hi, n) => {
    const pad = Math.max(minPad, Math.round((hi - lo) / 4), Math.ceil((minSize - (hi - lo + 1)) / 2));
    lo = Math.max(0, lo - pad); hi = Math.min(n - 1, hi + pad);
    return [lo, hi];
  };
  [r0, r1] = grow(r0, r1, m.rows); [c0, c1] = grow(c0, c1, m.cols);
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1, out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) out.set(h.subarray((r0 + r) * m.cols + c0, (r0 + r) * m.cols + c1 + 1), r * cols);
  const [dLat, dLon] = step(m), [, latMax, lonMin] = m.bounds;
  return {
    h: out, cells: cells.map(([r, c]) => [r - r0, c - c0]),
    meta: { rows, cols, bounds: [latMax - (r1 + 1) * dLat, latMax - r0 * dLat, lonMin + c0 * dLon, lonMin + (c1 + 1) * dLon] },
  };
}
