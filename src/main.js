import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell, M_PER_DEG } from './geo.js';
import { hazardGrids } from './hazards.js';

const $ = id => document.getElementById(id);
const msg = t => ($('summary').innerHTML = `<p class="note">${t}</p>`);
Object.assign(Chart.defaults, { color: '#000', borderColor: '#000' });
Object.assign(Chart.defaults.font, { family: 'Archivo, Arial, sans-serif', size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#fff', titleColor: '#000', bodyColor: '#000',
  borderColor: '#000', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

// Base maps. Formats/URLs checked against each layer's WMTSCapabilities.xml.
const trek = name => `https://trek.nasa.gov/tiles/Mars/EQ/${name}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`;
const mola = L.tileLayer(trek('Mars_MGS_MOLA_ClrShade_merge_global_463m'),
  { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, className: 'relief', attribution: 'NASA Mars Trek, USGS MOLA' });
// Real colour: Viking orbiter red and violet filter images (synthetic green), USGS MDIM 2.1 colour mosaic
const viking = L.tileLayer(trek('Mars_Viking_MDIM21_ClrMosaic_global_232m'),
  { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, attribution: 'NASA Mars Trek, USGS Viking MDIM 2.1 colour' });
// CTX = 512px .png redirected to astro.arcgis.com (2x1 tiles at level 0)
const ctx = L.tileLayer('https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
  { tileSize: 512, zoomOffset: -1, minZoom: 1, maxNativeZoom: 12, maxZoom: 12, crossOrigin: true, attribution: 'NASA Mars Trek, CTX (Caltech)' });

// Map symbols
const svg = body => `<svg width="12" height="12" viewBox="0 0 12 12">${body}</svg>`;
const SYM = {
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#000" stroke="#fff" stroke-width="1"/>'),
  poi: svg('<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="#fff" stroke="#000" stroke-width="1.5"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#000" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#000" stroke="#fff" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#f04e23" stroke-width="3"/>'),
  alt: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#6b6b6b" stroke-width="3"/>'),
  extent: svg('<path d="M0 6h12" stroke="#000" stroke-dasharray="3 2"/>'),
  ice: svg('<rect x="1" y="1" width="10" height="10" fill="#2f6fd6" fill-opacity=".7"/>'),
  loose: svg('<rect x="1" y="1" width="10" height="10" fill="#b06828" fill-opacity=".65"/>'),
  crater: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="#000" stroke-width="1.6"/>'),
};
const icon = (html, className = 'mk', size = 12) => L.divIcon({ html, className, iconSize: [size, size] });

const sites = await (await fetch('sites.json')).json();
const named = sites.filter(s => s.lat != null && s.lon != null);
let n = 0, p = 0;
for (const s of named) s.code ??= s.ref ? '' : s.poi ? `P${++p}` : `S${++n}`; // sites may bring their own code (AP-1)

const map = L.map('map', { crs: L.CRS.EPSG4326, layers: [mola] }).setView([39.25, -163.5], 6);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
const layerControl = L.control.layers({ 'Relief (MOLA)': mola, 'Colour (Viking)': viking, 'Imagery (CTX)': ctx }).addTo(map);
for (const s of named)
  L.marker([s.lat, s.lon], { icon: icon(SYM[s.ref ? 'ref' : s.poi ? 'poi' : 'site'] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(() => whatsHere([s.lat, s.lon], `${s.code} ${s.name}`, `<small>${s.source}</small>` +
      (s.source.match(/ESP_\d{6}_\d{4}/g) || []).map(id => `<br><a href="https://www.uahirise.org/${id}" target="_blank" rel="noopener">See it up close: HiRISE ${id}</a>`).join(''))).addTo(map);
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => Object.assign(L.DomUtil.create('div', 'legend'), { innerHTML: [
  [SYM.site, 'Candidate landing site'], [SYM.poi, 'Point of interest'],
  [SYM.route, 'Selected route'], [SYM.alt, 'Alternative route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Elevation data extent'],
  [SYM.ice, 'Ice likely within 1 m (SWIM)'], [SYM.loose, 'Loose or dusty ground (TES)'], [SYM.crater, 'Crater rim (Robbins catalog)'],
].map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>') });
legend.addTo(map);

// Scale bar measured on Mars (Leaflet's built-in scale assumes Earth)
const scale = L.control({ position: 'bottomright' });
scale.onAdd = () => L.DomUtil.create('div', 'scalebar');
scale.addTo(map);
function updateScale() {
  const b = map.getBounds(), w = map.getSize().x;
  const kmPerPx = (b.getEast() - b.getWest()) / w * M_PER_DEG / 1000 * Math.cos(map.getCenter().lat * Math.PI / 180);
  const raw = kmPerPx * 110, mag = 10 ** Math.floor(Math.log10(raw)), nice = [1, 2, 5, 10].map(m => m * mag).filter(v => v <= raw).pop();
  scale.getContainer().innerHTML = `<i style="width:${nice / kmPerPx}px"></i>${nice} km`;
}
map.on('zoomend moveend resize', updateScale);

// Elevation grid and data layers from scripts/prep_dem.py
const ICE_MIN = 0.25; // SWIM ice-consistency score treated as "ice likely"
const meta = await fetch('data/dem.json').then(r => r.json()).catch(() => null);
const bin = f => fetch(`data/${f}.bin`).then(r => r.arrayBuffer()).then(b => new Float32Array(b));
let h, s, worker, layers = {}, hazards = {};
if (meta) {
  [h, s] = await Promise.all([bin('dem'), bin('slope')]);
  layers = Object.fromEntries(await Promise.all((meta.layers || []).map(async n => [n, await bin(n)])));
  hazards = hazardGrids(layers);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ h, s, meta, layers });
  const [a, b, c, d] = meta.bounds;
  map.fitBounds(L.rectangle([[a, c], [b, d]], { color: '#000', weight: 1, opacity: 0.8, dashArray: '4 4', fill: false, interactive: false }).addTo(map).getBounds());
  const overlay = (label, grid, rgba) => {
    const cv = Object.assign(document.createElement('canvas'), { width: meta.cols, height: meta.rows }), g = cv.getContext('2d');
    const img = g.createImageData(meta.cols, meta.rows);
    grid.forEach((v, i) => img.data.set(rgba(v), i * 4));
    g.putImageData(img, 0, 0);
    layerControl.addOverlay(L.imageOverlay(cv.toDataURL(), [[a, c], [b, d]]), label);
  };
  if (layers.ice) overlay('Ice likely within 1 m (SWIM)', layers.ice, v => (v > 0 ? [47, 111, 214, Math.min(1, v / 0.35) * 190] : [0, 0, 0, 0]));
  if (hazards.loose) overlay('Loose or dusty ground (TES)', hazards.loose, v => [176, 104, 40, v * 170]);
  if (hazards.crater) overlay('Crater rims (Robbins catalog)', hazards.crater, v => [0, 0, 0, v > 0.3 ? v * 200 : 0]);
} else msg('No elevation data yet: run scripts/prep_dem.py (see README).');
updateScale();
$('ice').hidden = !layers.ice?.some(v => v >= ICE_MIN);
$('avoidLooseRow').hidden = !hazards.loose;
$('avoidCraterRow').hidden = !hazards.crater;
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);
const cellOf = ll => { const [r, c] = latLonCell(meta, ...ll); return meta && r >= 0 && c >= 0 && r < meta.rows && c < meta.cols ? r * meta.cols + c : -1; };

// "What's here?": values of every data layer at a point, with buttons to route from or to it
function whatsHere(ll, title = 'What\'s here?', extra = '') {
  const i = cellOf(ll), row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const data = i < 0 ? '<p>Outside the elevation data area.</p>' : `<table class="here">${[
    row('Elevation', `${Math.round(h[i]).toLocaleString('en-US')} m`), row('Slope', `${s[i].toFixed(1)}°`),
    layers.ice ? row('Ice score', `${layers.ice[i].toFixed(2)}${layers.ice[i] >= ICE_MIN ? ' (likely ice)' : ''}`) : '',
    hazards.loose ? row('Loose ground', `${Math.round(hazards.loose[i] * 100)}%`) : '',
    hazards.crater ? row('Crater rim', hazards.crater[i] > 0.5 ? 'yes, close' : hazards.crater[i] > 0 ? 'nearby' : 'no') : '',
  ].join('')}</table>`;
  return `<b>${title}</b><br>${ll[0].toFixed(3)}°N, ${Math.abs(ll[1]).toFixed(3)}°W<br>${extra}${data}
    <div class="here-btns"><button class="alt" data-set="0" data-ll="${ll}">Route from here</button><button class="alt" data-set="1" data-ll="${ll}">Route to here</button></div>`;
}
map.on('contextmenu', e => L.popup().setLatLng(e.latlng).setContent(whatsHere([e.latlng.lat, e.latlng.lng])).openOn(map));
map.getContainer().addEventListener('click', e => {
  const btn = e.target.closest('[data-set]');
  if (!btn) return;
  e.stopPropagation();
  const k = +btn.dataset.set, ll = btn.dataset.ll.split(',').map(Number);
  $(k ? 'end' : 'start').value = ''; setPt(k, ll); map.closePopup();
  if (pts[0] && pts[1]) run(false);
});

// From / To, swap, map clicks and science stops
const pts = [], pins = [];
const setPt = (k, ll) => { pts[k] = ll; pins[k]?.remove(); pins[k] = L.marker(ll, { icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000 }).addTo(map); };
['start', 'end'].forEach((id, k) => {
  $(id).innerHTML = '<option value="">Choose a site, or click the map</option>' + named.map((s, i) => `<option value="${i}">${s.code} ${s.name}</option>`).join('');
  $(id).onchange = e => e.target.value && setPt(k, [named[e.target.value].lat, named[e.target.value].lon]);
});
$('swap').onclick = () => {
  if (!pts[0] && !pts[1]) return;
  const [a, b] = [pts[0], pts[1]], [va, vb] = [$('start').value, $('end').value];
  pins.forEach(m => m?.remove()); pts.length = 0;
  if (b) setPt(0, b); if (a) setPt(1, a);
  $('start').value = vb; $('end').value = va;
  if (pts[0] && pts[1]) run(false);
};
let next = 0, stopMode = false;
const stops = [], stopPins = [];
map.on('click', e => {
  const ll = [e.latlng.lat, e.latlng.lng];
  if (stopMode) {
    stops.push(ll);
    stopPins.push(L.marker(ll, { icon: icon(String(stops.length), 'pin stop', 18), zIndexOffset: 900 }).addTo(map));
    $('clearStops').hidden = false;
    return;
  }
  $(next ? 'end' : 'start').value = ''; setPt(next, ll); next ^= 1;
});
$('addStop').onclick = () => {
  stopMode = !stopMode;
  $('addStop').textContent = stopMode ? 'Done adding stops' : 'Add science stops';
  $('addStop').classList.toggle('on', stopMode);
};
$('clearStops').onclick = () => { stops.length = 0; stopPins.splice(0).forEach(m => m.remove()); $('clearStops').hidden = true; };

// Search: a site code or name, or "lat, lon" (west longitudes negative)
$('placeList').innerHTML = named.map(s => `<option value="${s.code ? `${s.code} ` : ''}${s.name}">`).join('');
$('search').onkeydown = e => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(), m = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  const site = !m && named.find(s => `${s.code} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const ll = m ? [+m[1], +m[2]] : site && [site.lat, site.lon];
  if (!ll) return void ($('searchHint').textContent = 'No match. Try a code like S4 or AP-1, a name, or "39.8, -157.9".');
  $('searchHint').textContent = '';
  map.setView(ll, Math.max(map.getZoom(), 8));
  L.popup().setLatLng(ll).setContent(whatsHere(ll, site ? `${site.code} ${site.name}` : 'Search result')).openOn(map);
};

const weightsFor = f => ({ loose: $('avoidLoose').checked ? 2 * f : 0, crater: $('avoidCrater').checked ? 2 * f : 0 });

// Routing: Safest, Balanced and Shortest alternatives, each over every leg (A, stops, B)
const ALTS = [
  { name: 'Safest', note: 'Strongest hazard avoidance', k: 0.1, f: 1 },
  { name: 'Balanced', note: 'Half the hazard penalty', k: 0.05, f: 0.5 },
  { name: 'Shortest', note: 'Shortest path that is still under the slope limit', k: 0.01, f: 0 },
];
const ask = m => new Promise(res => { worker.onmessage = e => res(e.data); worker.postMessage(m); });
let routes = [], sel = 0, toIceMode = false;
async function run(toIce) {
  if (!worker) return;
  if (!pts[0] || (!toIce && !pts[1])) return msg(toIce ? 'Pick a start first.' : 'Pick a start and an end first.');
  const cells = (toIce ? [pts[0]] : [pts[0], ...stops, pts[1]]).map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('All points must be inside the dashed elevation data box.');
  if (!toIce) location.hash = [pts[0], pts[1]].flat().map(v => v.toFixed(4)).join(',');
  msg(toIce ? 'Searching for the nearest likely ice.' : 'Finding routes.');
  $('go').disabled = $('ice').disabled = true;
  toIceMode = toIce;
  routes = [];
  for (const alt of toIce ? [ALTS[0]] : ALTS) {
    const base = { opts: { maxSlope: +$('max').value, k: alt.k }, weights: weightsFor(alt.f) };
    let path = [];
    const ends = [];
    if (toIce) { path = await ask({ ...base, start: cells[0], end: null, iceMin: ICE_MIN }); if (path) ends.push(path.length - 1); }
    else for (let i = 0; i + 1 < cells.length && path; i++) {
      const leg = await ask({ ...base, start: cells[i], end: cells[i + 1] });
      path = leg && path.concat(i ? leg.slice(1) : leg);
      if (path) ends.push(path.length - 1);
    }
    if (path) routes.push(measure({ ...alt, path, ends }));
  }
  // drop alternatives that came out (almost) the same as one already found
  routes = routes.filter((r, i) => !routes.slice(0, i).some(q => Math.abs(q.km - r.km) < 0.01 * r.km && Math.abs(q.loose - r.loose) < 0.02));
  $('go').disabled = $('ice').disabled = false;
  sel = 0;
  render();
}
$('go').onclick = () => run(false);
$('ice').onclick = () => run(true);

// Distance, climb, hazards and profile of one route
function measure(r) {
  const ll = r.path.map(([y, x]) => cellLatLon(meta, y, x)), idx = r.path.map(([y, x]) => y * meta.cols + x), cum = [0];
  let gain = 0, loss = 0, unknown = 0, looseN = 0, rimN = 0, maxS = -1, maxJ = 0;
  idx.forEach((i, j) => {
    if (j) {
      cum.push(cum[j - 1] + haversine(...ll[j - 1], ...ll[j]));
      const dz = h[i] - h[idx[j - 1]];
      if (dz > 0) gain += dz; else if (dz < 0) loss -= dz;
    }
    if (Number.isNaN(h[i])) unknown++;
    if (hazards.loose?.[i] > 0.5) looseN++;
    if (hazards.crater?.[i] > 0.5) rimN++;
    if (s[i] > maxS) { maxS = s[i]; maxJ = j; }
  });
  const N = idx.length;
  return { ...r, ll, idx, cum, km: cum.at(-1) / 1000, gain, loss, maxS, maxJ, unknown: unknown / N, loose: looseN / N, rim: rimN / N };
}

// Step-by-step directions: a new step when the heading changes (after at least 1 km) or at a stop
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function bearing([la1, lo1], [la2, lo2]) {
  const y = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360), x = la2 - la1;
  return DIRS[Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) / 45) % 8];
}
function steps(r) {
  const { ll, cum, ends, idx } = r, out = [];
  const dirAt = j => { let k = j; while (k < ll.length - 1 && cum[k] - cum[j] < 400) k++; return bearing(ll[j], ll[Math.max(k, j + 1 < ll.length ? j + 1 : j)]); };
  const minLen = Math.max(1000, cum.at(-1) / 12); // longer routes get longer steps
  let start = 0, cur = dirAt(0);
  for (let j = 1; j < ll.length; j++) {
    const atStop = ends.includes(j), d = j < ll.length - 1 ? dirAt(j) : cur;
    if ((d !== cur && cum[j] - cum[start] >= minLen) || atStop) {
      let ms = 0, lo = 0, rim = 0;
      for (let k = start; k <= j; k++) { const i = idx[k]; ms = Math.max(ms, s[i]); if (hazards.loose?.[i] > 0.5) lo++; if (hazards.crater?.[i] > 0.5) rim++; }
      const notes = [ms >= 0.6 * +$('max').value && `slopes up to ${ms.toFixed(0)}°`, lo > (j - start) / 2 && 'mostly loose or dusty ground',
        rim && 'passes close to a crater rim'].filter(Boolean);
      const k = ends.indexOf(j), arrive = !atStop ? '' : k === ends.length - 1 ? (toIceMode ? 'the likely ice' : 'B') : `stop ${k + 1}`;
      out.push({ from: start, to: j, text: `Head ${cur} for ${((cum[j] - cum[start]) / 1000).toFixed(1)} km`, notes, arrive });
      start = j; cur = d;
    }
  }
  // merge neighbouring steps that head the same way (and don't end at a stop)
  return out.reduce((acc, x) => {
    const prev = acc.at(-1), dir = t => t.split(' for ')[0];
    if (prev && !prev.arrive && dir(prev.text) === dir(x.text)) {
      const km = ((cum[x.to] - cum[prev.from]) / 1000).toFixed(1);
      acc[acc.length - 1] = { ...x, from: prev.from, text: `${dir(x.text)} for ${km} km`, notes: [...new Set([...prev.notes, ...x.notes])] };
    } else acc.push(x);
    return acc;
  }, []);
}

// Draw routes, cards, directions, summary and chart for the selected route
let drawn = [], steep, chart, stepLine;
function render() {
  drawn.forEach(l => l.remove()); steep?.remove(); chart?.destroy(); stepLine?.remove(); drawn = [];
  $('chartBox').hidden = $('dirBox').hidden = !routes.length;
  $('routes').innerHTML = '';
  if (!routes.length) return msg(toIceMode ? `No likely ice can be reached while staying under ${$('max').value}°.`
    : `No route stays under ${$('max').value}°. Allow a steeper slope or pick other points.`);
  const r = routes[sel];
  if (toIceMode) { $('end').value = ''; setPt(1, r.ll.at(-1)); }
  routes.forEach((q, i) => {
    if (i === sel) return;
    const g = L.layerGroup([L.polyline(q.ll, { color: '#fff', weight: 7 }), L.polyline(q.ll, { color: '#6b6b6b', weight: 3.5 })]).addTo(map);
    g.eachLayer(l => l.on('click', ev => { L.DomEvent.stop(ev); sel = i; render(); }));
    drawn.push(g);
  });
  drawn.push(L.layerGroup([L.polyline(r.ll, { color: '#fff', weight: 8 }), L.polyline(r.ll, { color: '#f04e23', weight: 4 })]).addTo(map));
  steep = L.marker(r.ll[r.maxJ], { icon: icon(SYM.hazard, 'hazard') }).bindPopup(`Steepest point on the route: ${r.maxS.toFixed(0)}°`).addTo(map);
  // route cards
  $('routes').innerHTML = routes.map((q, i) => `<button class="card${i === sel ? ' on' : ''}" data-i="${i}">
    <span class="t"><b>${q.name}</b><span>${q.km.toFixed(0)} km</span></span>
    <span>climb ${Math.round(q.gain / 10) * 10} m, steepest ${q.maxS.toFixed(0)}°${hazards.loose ? `, ${Math.round(q.loose * 100)}% loose` : ''}${hazards.crater ? `, ${Math.round(q.rim * 100)}% rims` : ''}</span>
    <small>${q.note}</small></button>`).join('');
  $('routes').querySelectorAll('.card').forEach(b => (b.onclick = () => { sel = +b.dataset.i; render(); }));
  // directions
  const st = steps(r);
  $('dirs').innerHTML = `<li class="ends">Start at A</li>` + st.map((x, k) => `<li data-k="${k}"><b>${x.text}</b>${x.notes.length ? `<span class="warn">${x.notes.join(', ')}</span>` : ''}${x.arrive ? `<span>Arrive at ${x.arrive}</span>` : ''}</li>`).join('');
  $('dirs').querySelectorAll('li[data-k]').forEach(li => (li.onclick = () => {
    const x = st[+li.dataset.k], seg = r.ll.slice(x.from, x.to + 1);
    stepLine?.remove();
    stepLine = L.polyline(seg, { color: '#000', weight: 6, opacity: 0.7 }).addTo(map);
    map.fitBounds(L.latLngBounds(seg).pad(0.5));
  }));
  // summary
  const km = r.km, r10 = v => Math.round(v / 10) * 10;
  const stat = (v, u, t, wide) => `<div class="stat${wide ? ' wide' : ''}"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  $('summary').innerHTML = `<p class="kicker">${r.name} route, measured from MOLA elevation</p><div class="stats">
    ${stat(km.toFixed(1), 'km', 'Distance', true)}${stat(`${r10(r.gain)}/${r10(r.loss)}`, 'm', 'Climb / descent')}
    ${stat(r.maxS.toFixed(0), '°', `Steepest slope ${SYM.hazard}`)}</div>
    <p class="kicker">Ground along the route, from orbiter measurements</p><div class="stats">
    ${hazards.loose ? stat(Math.round(100 * r.loose), '%', 'Loose or dusty ground (TES)') : ''}
    ${hazards.crater ? stat(Math.round(100 * r.rim), '%', 'On or near crater rims (Robbins catalog)') : ''}
    ${stat(Math.round(100 * r.unknown), '%', 'Over missing elevation data')}
    ${toIceMode && layers.ice ? stat(layers.ice[r.idx.at(-1)].toFixed(2), '', 'Ice score at B (SWIM, -1 to +1)') : ''}</div>
    ${toIceMode ? `<p class="note">B is the nearest place where the SWIM ice score is ${ICE_MIN} or higher: the orbiter data there is consistent with ice within 1 m of the surface.</p>` : ''}
    <p class="note">Every step stays under ${$('max').value}° at 463 m resolution. Smaller hazards are not visible.</p>`;
  chart = new Chart($('profile'), {
    type: 'line',
    data: { datasets: [{ data: r.idx.map((i, j) => ({ x: r.cum[j] / 1000, y: h[i] })), pointRadius: 0, borderWidth: 2, borderColor: '#f04e23' }] },
    options: { animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${i[0].parsed.x.toFixed(0)} km`, label: i => `${i.parsed.y.toFixed(0)} m` } } },
      scales: { x: { type: 'linear', max: Math.ceil(km), grid: { display: false }, ticks: { includeBounds: false, callback: v => `${v} km` } },
        y: { ticks: { callback: v => `${v} m` } } } },
  });
}

// Shareable link: #startLat,startLon,endLat,endLon
const q = location.hash.slice(1).split(',').map(Number);
if (q.length === 4 && q.every(Number.isFinite)) { setPt(0, q.slice(0, 2)); setPt(1, q.slice(2)); run(false); }
