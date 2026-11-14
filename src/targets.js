import { haversine, cellLatLon } from './geo.js';

// Pick the strongest spots of a grid as named targets: cells at or above `min`, best first,
// each at least `sepKm` from every target already picked (so one big patch gives one target).
// Cells within `margin` cells of the box edge are skipped: a target on the edge can't be checked around.
export function peaks(grid, meta, { min, sepKm, max = 8, margin = 0 }) {
  const cand = [], { rows, cols } = meta;
  for (let i = 0; i < grid.length; i++) {
    const r = (i / cols) | 0, c = i % cols;
    if (grid[i] >= min && r >= margin && c >= margin && r < rows - margin && c < cols - margin) cand.push(i);
  }
  cand.sort((a, b) => grid[b] - grid[a]);
  const out = [];
  for (const i of cand) {
    const r = (i / meta.cols) | 0, c = i % meta.cols, ll = cellLatLon(meta, r, c);
    if (out.some(t => haversine(...t.ll, ...ll) < sepKm * 1000)) continue;
    out.push({ i, cell: [r, c], ll, value: grid[i] });
    if (out.length === max) break;
  }
  return out;
}
