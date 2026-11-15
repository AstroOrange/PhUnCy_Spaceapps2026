// Navigation maths shared by Go (map and 3D playback) and POV mode. Pure functions: no DOM, no map.
// A measured route r has: ll (lat/lon per path point), idx (grid index per point), cum (metres from the start per point),
// ends (path index where each leg finishes).

// Assumed travel speed for the POV time estimate. An assumption, not a measurement: there are no measured speeds for
// suited astronauts on Mars. 10 km/h is a round placeholder for a slow crewed rover; change it here.
export const ASSUMED_KMH = 10;

// Position, path index j (the point just ahead) and fraction f between points j-1 and j, at distance d (m) along the route
export function at(r, d) {
  const c = r.cum;
  let j = 1;
  while (j < c.length - 1 && c[j] < d) j++;
  const f = Math.min(1, Math.max(0, (d - c[j - 1]) / (c[j] - c[j - 1] || 1))), [a, b] = [r.ll[j - 1], r.ll[j]];
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], j, f };
}

// Compass bearing in degrees (0 = north, 90 = east) from one lat/lon to another, flat-map approximation for short steps
export function bearingDeg([la1, lo1], [la2, lo2]) {
  const y = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360), x = la2 - la1;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = deg => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// First measured hazard within `range` metres ahead of distance d, as text; '' if none.
// s = slope grid (degrees), hazards = { loose, crater } grids (0..1), maxSlope = the route's slope limit (degrees)
export function hazardAhead(r, d, { s, hazards = {}, maxSlope }, range = 1000) {
  for (let k = at(r, d).j; k < r.idx.length && r.cum[k] - d < range; k++) {
    const i = r.idx[k], inM = Math.max(0, Math.round((r.cum[k] - d) / 100) * 100);
    if (s[i] > 0.7 * maxSlope) return `Steep ground in ${inM} m (${s[i].toFixed(0)}°)`;
    if (hazards.crater?.[i] > 0.5) return `Crater rim in ${inM} m`;
    if (hazards.loose?.[i] > 0.7) return `Loose ground in ${inM} m`;
  }
  return '';
}

// Climb still to come from each path point to the end (m), cached per route
const climbs = new WeakMap();
function climbFrom(r, h) {
  let c = climbs.get(r);
  if (!c) {
    c = new Float32Array(r.idx.length);
    for (let j = r.idx.length - 2; j >= 0; j--) c[j] = c[j + 1] + (Math.max(0, h[r.idx[j + 1]] - h[r.idx[j]]) || 0);
    climbs.set(r, c);
  }
  return c;
}

// Everything the navigation displays need at distance d (m) along the route. ctx = { h, s, hazards, maxSlope }
export function navState(r, d, ctx) {
  const total = r.cum.at(-1), pos = at(r, d), leg = r.ends.findIndex(e => e >= pos.j), i = r.idx[pos.j];
  return {
    d, total, pos, leg,
    toNext: r.cum[r.ends[leg]] - d, // metres to the next stop (or the end)
    left: total - d,
    headingDeg: bearingDeg(pos.ll, at(r, Math.min(total, d + 300)).ll),
    elev: ctx.h[i], slope: ctx.s[i],
    climbLeft: climbFrom(r, ctx.h)[Math.max(0, pos.j - 1)],
    warn: hazardAhead(r, d, ctx),
    arrived: d >= total,
  };
}

export const etaSeconds = (metres, kmh = ASSUMED_KMH) => metres / (kmh / 3.6);
export function fmtDuration(sec) {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
