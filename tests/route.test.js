import { expect, test } from 'vitest';
import { haversine, slopeDeg, M_PER_DEG } from '../src/geo.js';
import { astar } from '../src/astar.js';
import { loose } from '../src/hazards.js';

test('haversine: 1 degree and a quarter of the equator', () => {
  expect(haversine(0, 0, 0, 1)).toBeCloseTo(M_PER_DEG, 0);
  expect(haversine(0, 0, 0, 90)).toBeCloseTo(Math.PI * 3389500 / 2, 0);
});

test('slope in degrees', () => {
  expect(slopeDeg(1, 1)).toBeCloseTo(45);
  expect(slopeDeg(-10, 0.0001)).toBeCloseTo(90, 1);
  expect(slopeDeg(0, 5)).toBe(0);
});

// 5x5 flat grid at the equator; 'X' = too steep, '?' = no data.
const grid = rows => {
  const s = new Float32Array(rows.join('').split('').map(ch => ch === 'X' ? 30 : ch === '?' ? NaN : 0));
  return { h: s.map(v => (Number.isNaN(v) ? NaN : 0)), s, meta: { bounds: [-0.025, 0.025, 0, 0.05], rows: 5, cols: 5 } };
};
const run = (rows, opts) => { const g = grid(rows); return astar(g.h, g.s, g.meta, [2, 0], [2, 4], opts); };

test('A*: straight line on flat ground', () => {
  expect(run(['.....', '.....', '.....', '.....', '.....'])).toEqual([[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]]);
});

test('A*: detours through the only gap in a steep wall', () => {
  const p = run(['..X..', '..X..', '..X..', '..X..', '.....']);
  expect(p).toContainEqual([4, 2]);
  expect(p.some(([r, c]) => c === 2 && r < 4)).toBe(false);
});

test('A*: prefers known ground over a no-data cell', () => {
  const p = run(['.....', '.....', '..?..', '.....', '.....']);
  expect(p).not.toContainEqual([2, 2]);
});

test('A*: returns null when the wall is complete', () => {
  expect(run(['..X..', '..X..', '..X..', '..X..', '..X..'])).toBeNull();
});

test('A*: with a goal mask, stops at the nearest goal cell', () => {
  const g = grid(['.....', '.....', '.....', '.....', '.....']);
  const goal = new Uint8Array(25); goal[2 * 5 + 4] = 1; goal[0] = 1; // (2,4) is 4 steps away, (0,0) is 2
  const p = astar(g.h, g.s, g.meta, [2, 0], null, { goal });
  expect(p.at(-1)).toEqual([0, 0]);
});

test('A*: extra cost steers around an expensive cell', () => {
  const g = grid(['.....', '.....', '.....', '.....', '.....']);
  const extra = new Float32Array(25); extra[2 * 5 + 2] = 10;
  expect(astar(g.h, g.s, g.meta, [2, 0], [2, 4], { extra })).not.toContainEqual([2, 2]);
});

test('loose ground: firm and dust-free is 0, powdery or dusty is 1, no data is 0', () => {
  expect(loose(300, 0.97)).toBe(0);
  expect(loose(60, 0.97)).toBe(1);
  expect(loose(300, 0.92)).toBeCloseTo(1);
  expect(loose(105, 0.97)).toBeCloseTo(0.5);
  expect(loose(NaN, NaN)).toBe(0);
});

import { peaks } from '../src/targets.js';

test('targets: strongest spots first, spaced apart, below-threshold cells ignored', () => {
  const meta = { bounds: [0, 1, 0, 1], rows: 10, cols: 10 }; // ~5.9 km cells
  const g = new Float32Array(100);
  g[0] = 0.9; g[1] = 0.8; g[99] = 0.7; g[50] = 0.1;
  const t = peaks(g, meta, { min: 0.3, sepKm: 20 });
  expect(t.map(x => x.value.toFixed(1))).toEqual(['0.9', '0.7']); // cell 1 is next to cell 0, so it is merged
  expect(t[1].cell).toEqual([9, 9]);
});

import { cropGrid, cellLatLon } from '../src/geo.js';

test('3D crop: keeps the route inside, shifts its cells, and places them at the same lat/lon', () => {
  const m = { bounds: [0, 10, 0, 20], rows: 100, cols: 200 }, h = new Float32Array(100 * 200).map((_, i) => i);
  const route = [[40, 50], [45, 70]];
  const c = cropGrid(h, m, route, { minPad: 5, minSize: 10 });
  expect(c.meta.rows * c.meta.cols).toBe(c.h.length);
  c.cells.forEach(([r, col], k) => {
    expect(c.h[r * c.meta.cols + col]).toBe(h[route[k][0] * 200 + route[k][1]]);
    cellLatLon(c.meta, r, col).forEach((v, j) => expect(v).toBeCloseTo(cellLatLon(m, ...route[k])[j], 9));
  });
  expect(cropGrid(h, m, [[0, 0]]).meta.bounds[1]).toBe(10); // clamped at the grid edge
  expect(cropGrid(h, m, []).h).toBe(h);
});

import { badTiles, FP } from '../src/tiles.js';

test('imagery tiles: repeated pictures and flat grey tiles are dropped, real neighbours are kept', () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tile = f => { const gray = new Float32Array(FP * FP), alpha = new Uint8Array(FP * FP).fill(1); for (let i = 0; i < gray.length; i++) gray[i] = f(i % FP, (i / FP) | 0); return { gray, alpha }; };
  const texA = tile(() => 100 + 60 * rnd()), texB = tile(() => 100 + 60 * rnd());
  const copyA = { gray: texA.gray.map(v => v * 0.9 + 12 + 3 * rnd()), alpha: texA.alpha.slice() }; // same picture, re-encoded
  copyA.alpha.fill(0, FP * FP * 0.6); // and with a no-data band, like the real repeats
  const rampL = tile((c, r) => 60 + c * 2 + 8 * rnd()), rampR = tile((c, r) => 160 + c * 2 + 8 * rnd()); // neighbours with the same light trend
  const flat = tile(() => 140), dust = tile(() => 140 + 5 * rnd()); // filler tile vs. real smooth dusty plain (std ~1.5)
  const bad = badTiles([texA, texB, copyA, rampL, rampR, flat, null, dust]);
  expect([...bad].sort()).toEqual([0, 2, 5]);
});
