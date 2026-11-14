import { M_PER_DEG, slopeDeg } from './geo.js';

// Hazard-aware A* on an 8-neighbour grid.
// h = heights (m), s = terrain slope (deg); NaN = no data ("unknown").
// Step cost = distance × (1 + k × slope), slope = max(terrain slope, step grade).
// Slope over maxSlope is blocked; unknown cells cost as if at maxSlope, × `unknown`.
// Optional: `extra` adds a per-cell cost multiplier term (other hazards); `goal` (0/1 per cell) means
// "stop at the nearest goal cell" instead of a fixed end (then the search is plain Dijkstra).
// Returns [[row, col], ...] from start to end, or null.
export function astar(h, s, meta, [sr, sc], end, { k = 0.1, maxSlope = 15, unknown = 5, extra = null, goal = null } = {}) {
  const [er, ec] = end ?? [sr, sc];
  const { rows, cols, bounds: [latMin, latMax, lonMin, lonMax] } = meta, N = rows * cols;
  const dLat = (latMax - latMin) / rows, dy = dLat * M_PER_DEG;
  const dxRow = r => (lonMax - lonMin) / cols * M_PER_DEG * Math.cos((latMax - (r + 0.5) * dLat) * Math.PI / 180);
  const hd = goal ? () => 0 : (r, c) => Math.hypot((r - er) * dy, (c - ec) * Math.min(dxRow(r), dxRow(er))); // never overestimates
  const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);

  const heap = [];
  const push = (f, i) => {
    heap.push([f, i]);
    for (let j = heap.length - 1, p; j && heap[p = (j - 1) >> 1][0] > heap[j][0]; j = p) [heap[p], heap[j]] = [heap[j], heap[p]];
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let j = 0; ;) {
        const l = 2 * j + 1, r = l + 1;
        let m = j;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j], heap[m]];
        j = m;
      }
    }
    return top[1];
  };

  const S = sr * cols + sc, E = er * cols + ec, isGoal = goal ? i => goal[i] : i => i === E;
  let reached = -1;
  g[S] = 0;
  push(hd(sr, sc), S);
  while (heap.length) {
    const i = pop();
    if (isGoal(i)) { reached = i; break; }
    if (done[i]) continue;
    done[i] = 1;
    const r = (i / cols) | 0, c = i % cols, dx = dxRow(r);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const nr = r + a, nc = c + b, n = nr * cols + nc;
      if ((!a && !b) || nr < 0 || nc < 0 || nr >= rows || nc >= cols || done[n]) continue;
      const d = Math.hypot(a * dy, b * dx), sl = Math.max(s[n], slopeDeg(h[n] - h[i], d));
      if (sl > maxSlope) continue;
      const ng = g[i] + d * (1 + k * (Number.isNaN(sl) ? maxSlope * unknown : sl) + (extra ? extra[n] : 0));
      if (ng < g[n]) { g[n] = ng; from[n] = i; push(ng + hd(nr, nc), n); }
    }
  }
  if (reached < 0) return null;
  const path = [];
  for (let i = reached; i >= 0; i = from[i]) path.unshift([(i / cols) | 0, i % cols]);
  return path;
}
