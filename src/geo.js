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
