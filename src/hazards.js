// Extra hazards from orbiter data. All values are Estimated (inferred surface properties), 0 = fine, 1 = worst.
const c01 = x => (x > 0 ? Math.min(1, x) : 0); // also turns NaN (no data) into 0

// Loose ground: fine dust from TES thermal inertia (150+ firm, 60 or lower powder, Putzig & Mellon 2007)
// or heavy dust cover from the TES Dust Cover Index (0.95+ low dust, 0.92 or lower dusty, Ruff & Christensen 2002).
export const loose = (ti, dci) => Math.max(c01((150 - ti) / 90), c01((0.95 - dci) / 0.03));

// Per-cell hazard grids that exist for this region.
export function hazardGrids(layers) {
  const out = {};
  if (layers.ti && layers.dci) out.loose = layers.ti.map((t, i) => loose(t, layers.dci[i]));
  return out;
}

// Extra cost term for A*: sum of weight × hazard per cell.
export function extraCost(grids, weights) {
  const names = Object.keys(weights).filter(k => grids[k] && weights[k] > 0);
  if (!names.length) return null;
  const n = grids[names[0]].length, extra = new Float32Array(n);
  for (const k of names) for (let i = 0; i < n; i++) extra[i] += weights[k] * grids[k][i];
  return extra;
}
