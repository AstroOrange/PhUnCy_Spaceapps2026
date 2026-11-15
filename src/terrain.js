import { M_PER_DEG } from './geo.js';

// Terrain map drawn in the browser from measured MOLA heights: shaded relief (light from the north-west) with contour lines.
// Picture tiles from a map server stop at a fixed resolution and can go missing; this is computed for any zoom level from
// the height grid itself, so it has no gaps, stays sharp, and works offline. Inside the sector it uses the 463 m grid,
// elsewhere the 15 km world grid. A grid is { h: Float32Array, rows, cols, bounds: [latMin, latMax, lonMin, lonMax] }, row 0 = north.

// Colours: the middle tone is the region's average colour measured from the Viking colour mosaic (#755a57); dark and light keep its hue.
const DARK = [58, 44, 46], MID = [117, 90, 87], LIGHT = [196, 166, 156], NODATA = [150, 150, 150];
const GAIN = 10; // relief contrast: a 5.7° slope facing the light is about 75% of the way to full brightness

// Contour interval in metres for a zoom level (`fine` = inside the 463 m sector grid)
export const contourStep = (z, fine) => (fine ? (z <= 6 ? 200 : z <= 8 ? 100 : z <= 10 ? 50 : 25) : z <= 3 ? 2000 : z <= 5 ? 1000 : 500);

const inside = (g, lat, lon) => g && lat > g.bounds[0] && lat < g.bounds[1] && lon > g.bounds[2] && lon < g.bounds[3];
// Height at a latitude/longitude, bilinear between the four nearest cell centres
function sample(g, lat, lon) {
  const { h, rows, cols, bounds: [latMin, latMax, lonMin, lonMax] } = g;
  const r = Math.min(Math.max((latMax - lat) / (latMax - latMin) * rows - 0.5, 0), rows - 1);
  const c = Math.min(Math.max((lon - lonMin) / (lonMax - lonMin) * cols - 0.5, 0), cols - 1);
  const r0 = r | 0, c0 = c | 0, r1 = Math.min(r0 + 1, rows - 1), c1 = Math.min(c0 + 1, cols - 1), fr = r - r0, fc = c - c0;
  return (h[r0 * cols + c0] * (1 - fc) + h[r0 * cols + c1] * fc) * (1 - fr) + (h[r1 * cols + c0] * (1 - fc) + h[r1 * cols + c1] * fc) * fr;
}

// RGBA pixels (n × n) of map tile z/x/y in the Mars lat/lon tile scheme (a tile is 180 / 2^z degrees wide).
// Pixels with no grid are left transparent; cells with no height data are flat grey, never drawn as flat ground.
export function shadeTile(fine, coarse, z, x, y, n = 256) {
  const deg = 180 / 2 ** z, d = deg / n, latTop = 90 - y * deg, lonLeft = -180 + x * deg, out = new Uint8ClampedArray(n * n * 4);
  const touchesFine = fine && latTop > fine.bounds[0] && latTop - deg < fine.bounds[1] && lonLeft + deg > fine.bounds[2] && lonLeft < fine.bounds[3];
  const main = touchesFine ? fine : coarse;
  if (!main) return out;
  // Slopes are measured across about one grid cell, so the shading shows the terrain, not the edges of the cells
  const cellPx = (main.bounds[1] - main.bounds[0]) / main.rows / d, k = Math.min(96, Math.max(1, Math.round(cellPx / 2))), W = n + 2 * k;
  const H = new Float32Array(W * W), isFine = new Uint8Array(W * W);
  for (let j = 0; j < W; j++) {
    const lat = latTop - (j - k + 0.5) * d;
    for (let i = 0; i < W; i++) {
      const lon = lonLeft + (i - k + 0.5) * d, f = inside(fine, lat, lon), g = f ? fine : coarse;
      H[j * W + i] = g ? sample(g, lat, lon) : NaN;
      isFine[j * W + i] = f ? 1 : 0;
    }
  }
  for (let py = 0; py < n; py++) {
    const lat = latTop - (py + 0.5) * d, mx = 2 * k * d * M_PER_DEG * Math.cos(lat * Math.PI / 180), my = 2 * k * d * M_PER_DEG;
    for (let px = 0; px < n; px++) {
      const p = (py + k) * W + px + k, h = H[p], o = (py * n + px) * 4;
      if (Number.isNaN(h)) { if (isFine[p]) { out.set(NODATA, o); out[o + 3] = 255; } continue; }
      const s = 0.7071 * ((H[p + k] - H[p - k]) / mx - (H[p - k * W] - H[p + k * W]) / my); // rise towards the south-east = faces the light
      const v = Number.isNaN(s) ? 0.5 : 0.5 + 0.5 * Math.tanh(GAIN * s), [a, b, t] = v < 0.5 ? [DARK, MID, v * 2] : [MID, LIGHT, v * 2 - 1];
      const step = contourStep(z, isFine[p]), c0 = Math.floor(h / step), c1 = Math.floor(H[p + 1] / step), c2 = Math.floor(H[p + W] / step);
      const ink = c0 === c1 && c0 === c2 ? 1 : Math.max(c0, c1, c2) % 5 === 0 ? 0.4 : 0.68; // contour line; every fifth is darker
      for (let q = 0; q < 3; q++) out[o + q] = (a[q] + (b[q] - a[q]) * t) * ink;
      out[o + 3] = 255;
    }
  }
  return out;
}
