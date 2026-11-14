// Shareable link in the URL hash: #region/startLat,startLon[,endLat,endLon]
// Old links without a region (#lat,lon,lat,lon) are Arcadia links.
export function parseHash(hash) {
  const text = decodeURIComponent(hash.replace(/^#/, ''));
  if (/^[a-z]/i.test(text) && !text.includes('/')) return { region: text, start: null, end: null }; // #gale
  const slash = text.indexOf('/');
  const region = slash < 0 ? (text ? 'arcadia' : null) : text.slice(0, slash);
  const nums = (slash < 0 ? text : text.slice(slash + 1)).split(',').filter(Boolean).map(Number);
  const ok = (nums.length === 2 || nums.length === 4) && nums.every(Number.isFinite);
  return { region: region || null, start: ok ? nums.slice(0, 2) : null, end: ok && nums.length === 4 ? nums.slice(2) : null };
}

export const formatHash = (region, start, end) =>
  `#${region}` + (start ? '/' + [start, end].filter(Boolean).flat().map(v => (+v).toFixed(4)).join(',') : '');
