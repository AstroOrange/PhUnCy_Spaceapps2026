import { expect, test } from 'vitest';
import { haversine, slopeDeg, M_PER_DEG } from '../src/geo.js';
import { astar } from '../src/astar.js';

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
