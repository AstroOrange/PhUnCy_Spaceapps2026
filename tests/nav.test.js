import { expect, test } from 'vitest';
import { at, bearingDeg, compassWord, hazardAhead, navState, etaSeconds, fmtDuration, ASSUMED_KMH } from '../src/nav.js';
import { deviceQuat, headingOf, wrap } from '../src/look.js';

// A straight 4-point route heading east along the equator, 1000 m between points, with a stop at point 2
const route = { ll: [[0, 0], [0, 0.01], [0, 0.02], [0, 0.03]], idx: [0, 1, 2, 3], cum: [0, 1000, 2000, 3000], ends: [2, 3] };
const ctx = { h: Float32Array.of(100, 110, 105, 125), s: Float32Array.of(1, 2, 12, 3), hazards: {}, maxSlope: 15 };

test('at: position, next point and fraction along the route', () => {
  expect(at(route, 0)).toMatchObject({ j: 1, f: 0 });
  const mid = at(route, 1500);
  expect(mid.j).toBe(2); expect(mid.f).toBeCloseTo(0.5); expect(mid.ll[1]).toBeCloseTo(0.015);
  expect(at(route, 9999)).toMatchObject({ j: 3, f: 1, ll: [0, 0.03] }); // past the end stays at the end
});

test('bearing in degrees and as a compass word', () => {
  expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0);
  expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90);
  expect(bearingDeg([0, 0], [-1, -1])).toBeCloseTo(225, 0);
  expect(compassWord(0)).toBe('north'); expect(compassWord(350)).toBe('north');
  expect(compassWord(135)).toBe('south-east'); expect(compassWord(-90)).toBe('west');
});

test('hazard ahead: steep ground within 1 km, nothing beyond it', () => {
  expect(hazardAhead(route, 0, ctx)).toBe('');                 // the 12° cell is 2 km away
  expect(hazardAhead(route, 1200, ctx)).toBe('Steep ground in 800 m (12°)');
  expect(hazardAhead(route, 1200, { ...ctx, hazards: { crater: Float32Array.of(0, 0, 0.9, 0) }, maxSlope: 30 })).toBe('Crater rim in 800 m');
});

test('navState: distances, leg, heading, ground and climb left', () => {
  const st = navState(route, 500, ctx);
  expect(st).toMatchObject({ total: 3000, left: 2500, leg: 0, toNext: 1500, arrived: false });
  expect(st.headingDeg).toBeCloseTo(90);
  expect(st.elev).toBe(110);
  expect(st.climbLeft).toBe(30); // +10, then down 5, then +20
  const end = navState(route, 3000, ctx);
  expect(end).toMatchObject({ left: 0, leg: 1, toNext: 0, arrived: true, climbLeft: 20 });
});

test('time estimate from the assumed speed', () => {
  expect(etaSeconds(10000, 10)).toBeCloseTo(3600);
  expect(etaSeconds(ASSUMED_KMH * 1000)).toBeCloseTo(3600);
  expect(fmtDuration(40 * 60)).toBe('40 min');
  expect(fmtDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
});

test('phone orientation to view heading', () => {
  const deg = q => ((headingOf(q) * 180 / Math.PI) + 360) % 360;
  expect(deg(deviceQuat(0, 90, 0))).toBeCloseTo(0);     // held upright, back of the phone facing north
  expect(deg(deviceQuat(90, 90, 0))).toBeCloseTo(270);  // turned a quarter turn to the left: facing west
  expect(deg(deviceQuat(270, 90, 0))).toBeCloseTo(90);  // to the right: facing east
  expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI); expect(wrap(-0.5)).toBeCloseTo(-0.5);
});
