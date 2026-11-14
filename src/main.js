import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell } from './geo.js';
import { hazardGrids } from './hazards.js';

const $ = id => document.getElementById(id);
const msg = t => ($('summary').innerHTML = `<p class="note">${t}</p>`);
Object.assign(Chart.defaults, { color: '#000', borderColor: '#000' });
Object.assign(Chart.defaults.font, { family: 'Archivo, Arial, sans-serif', size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#fff', titleColor: '#000', bodyColor: '#000',
  borderColor: '#000', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

// Formats/URLs checked against each layer's WMTSCapabilities.xml:
// MOLA = 256px .jpg on trek.nasa.gov; CTX = 512px .png redirected to astro.arcgis.com (2x1 tiles at level 0).
const mola = L.tileLayer(
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, className: 'relief', attribution: 'NASA Mars Trek, USGS MOLA' });
const ctx = L.tileLayer(
  'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
  { tileSize: 512, zoomOffset: -1, minZoom: 1, maxNativeZoom: 12, maxZoom: 12, crossOrigin: true, attribution: 'NASA Mars Trek, CTX (Caltech)' });

// Map symbols (cartographic, not glowing dots)
const svg = body => `<svg width="12" height="12" viewBox="0 0 12 12">${body}</svg>`;
const SYM = {
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#000" stroke="#fff" stroke-width="1"/>'),
  poi: svg('<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="#fff" stroke="#000" stroke-width="1.5"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#000" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#000" stroke="#fff" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#f04e23" stroke-width="3"/>'),
  extent: svg('<path d="M0 6h12" stroke="#000" stroke-dasharray="3 2"/>'),
  ice: svg('<rect x="1" y="1" width="10" height="10" fill="#2f6fd6" fill-opacity=".7"/>'),
  loose: svg('<rect x="1" y="1" width="10" height="10" fill="#b06828" fill-opacity=".65"/>'),
  crater: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="#000" stroke-width="1.6"/>'),
};
const icon = (html, className = 'mk', size = 12) => L.divIcon({ html, className, iconSize: [size, size] });

const sites = await (await fetch('sites.json')).json();
const named = sites.filter(s => s.lat != null && s.lon != null);
let n = 0, p = 0;
for (const s of named) s.code = s.ref ? '' : s.poi ? `P${++p}` : `S${++n}`;

const map = L.map('map', { crs: L.CRS.EPSG4326, layers: [mola] }).setView([35.66, -174.98], 6);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
const layerControl = L.control.layers({ 'Relief (MOLA)': mola, 'Imagery (CTX)': ctx }).addTo(map);
for (const s of named)
  L.marker([s.lat, s.lon], { icon: icon(SYM[s.ref ? 'ref' : s.poi ? 'poi' : 'site'] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(`<b>${s.code} ${s.name}</b><br>${s.lat}°, ${s.lon}°<br><small>${s.source}</small>` +
      (s.source.match(/ESP_\d{6}_\d{4}/g) || []).map(id => `<br><a href="https://www.uahirise.org/${id}" target="_blank" rel="noopener">See it up close: HiRISE ${id}</a>`).join('')).addTo(map);
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => Object.assign(L.DomUtil.create('div', 'legend'), { innerHTML: [
  [SYM.site, 'Candidate landing site (S)'], [SYM.poi, 'Point of interest (P)'],
  [SYM.route, 'Safest route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Elevation data extent'],
  [SYM.ice, 'Ice likely within 1 m (SWIM)'], [SYM.loose, 'Loose or dusty ground (TES)'], [SYM.crater, 'Crater rim (Robbins catalog)'],
].map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>') });
legend.addTo(map);

// Elevation grid from scripts/prep_dem.py
const ICE_MIN = 0.25; // SWIM ice-consistency score treated as "ice likely" (strongest signal in this region)
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
  // Data layers drawn from the grid, toggled from the layer menu
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
$('ice').hidden = !layers.ice;
// Seasonal weather table from scripts/fetch_mcd.py (Mars Climate Database)
const climate = await fetch('data/climate.json').then(r => r.json()).catch(() => null);
const SEASONS = ['northern spring', 'northern summer', 'northern autumn', 'northern winter'];
$('seasonRow').hidden = !climate;
if (climate) $('season').innerHTML = climate.rows.map((r, i) =>
  `<option value="${i}">Month ${i + 1} (Ls ${r.ls}°), ${SEASONS[Math.floor(r.ls / 90)]}${r.dust_storm != null ? ', dust storm season' : ''}</option>`).join('');
$('looseRow').hidden = !hazards.loose;
$('craterRow').hidden = !hazards.crater;
$('crater').oninput = e => ($('craterv').textContent = `×${e.target.value}`);
$('loose').oninput = e => ($('loosev').textContent = `×${e.target.value}`);
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);

// Start (A) / end (B)
const pts = [], pins = [];
const setPt = (k, ll) => { pts[k] = ll; pins[k]?.remove(); pins[k] = L.marker(ll, { icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000 }).addTo(map); };
['start', 'end'].forEach((id, k) => {
  $(id).innerHTML = '<option value="">Choose a site, or click the map</option>' + named.map((s, i) => `<option value="${i}">${s.code} ${s.name}</option>`).join('');
  $(id).onchange = e => e.target.value && setPt(k, [named[e.target.value].lat, named[e.target.value].lon]);
});
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

const ask = m => new Promise(res => { worker.onmessage = e => res(e.data); worker.postMessage(m); });
async function run(toIce) {
  if (!worker) return;
  if (!pts[0] || (!toIce && !pts[1])) return msg(toIce ? 'Pick a start first.' : 'Pick a start and an end first.');
  const cells = (toIce ? [pts[0]] : [pts[0], ...stops, pts[1]]).map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('All points must be inside the dashed elevation data box.');
  if (!toIce) location.hash = [pts[0], pts[1]].flat().map(v => v.toFixed(4)).join(',');
  msg(toIce ? 'Searching for the nearest likely ice.' : 'Working out the safest route.');
  $('go').disabled = $('ice').disabled = true;
  const base = { opts: { maxSlope: +$('max').value }, weights: { loose: +$('loose').value, crater: +$('crater').value } };
  let path = [];
  if (toIce) path = await ask({ ...base, start: cells[0], end: null, iceMin: ICE_MIN });
  else for (let i = 0; i + 1 < cells.length && path; i++) { // one leg per pair of points: A, stops, B
    const leg = await ask({ ...base, start: cells[i], end: cells[i + 1] });
    path = leg && path.concat(i ? leg.slice(1) : leg);
  }
  show(path, toIce);
}
$('go').onclick = () => run(false);
$('ice').onclick = () => run(true);

// Weather block for the chosen Mars month (all values Estimated: a climate model, not a forecast)
function weather(w) {
  const sky = w.dust < 0.5 ? 'mostly clear' : w.dust < 1 ? 'hazy' : 'dusty';
  const warn = [
    w.dust_storm != null && `Dust storm season. In a storm year the model puts dust opacity here at ${w.dust_storm}, enough to cut sunlight and visibility.`,
    w.t_night < -80 && `Nights drop to about ${w.t_night} °C: plan to travel and rest inside daylight hours.`,
    w.wind > 10 && `Winds around ${w.wind} m/s can lift dust.`,
  ].filter(Boolean);
  const stat = (v, u, t) => `<div class="stat"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  return `<p class="kicker">Weather this season, estimated (Mars Climate Database)</p><div class="stats">
    ${stat(w.dust, '', `Dust opacity, ${sky}`)}${stat(`${w.t_day}/${w.t_night}`, '°C', 'Ground, 1 pm / 4 am')}
    ${stat(w.wind, 'm/s', 'Wind at 1 pm')}</div>${warn.map(t => `<p class="note">${t}</p>`).join('')}`;
}

// Marswalk plan (all Estimated): travel speed is an assumption, radiation uses the surface dose rate
// Curiosity's RAD measured at Gale (about 0.67 mSv per day, Hassler et al. 2014).
const MODES = { walk: { label: 'on foot', v: [1.5, 3] }, rover: { label: 'by unpressurised rover', v: [5, 10] } };
const DOSE_PER_H = 0.67 / 24;
function marswalk(km) {
  const m = MODES[$('mode').value], eva = +$('eva').value, back = 2 * km;
  const slow = back / m.v[0], fast = back / m.v[1], reach = (eva * m.v[0]) / 2;
  const fit = slow <= eva ? `Fits one ${eva} h EVA even at the slower pace.`
    : fast <= eva ? `Fits one ${eva} h EVA only at the faster pace: little margin.`
    : `Too far for one ${eva} h EVA ${m.label}. Options: a rover, an overnight camp, or a target within ${reach.toFixed(0)} km.`;
  const stat = (v, u, t) => `<div class="stat"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  return `<p class="kicker">Marswalk plan, estimated (2 astronauts, ${m.label})</p><div class="stats">
    ${stat(back.toFixed(0), 'km', 'Out and back')}${stat(`${fast.toFixed(1)}-${slow.toFixed(1)}`, 'h', `Out and back at ${m.v[0]} to ${m.v[1]} km/h`)}
    ${stat(reach.toFixed(0), 'km', `Furthest target for a ${eva} h EVA (slow pace)`)}${stat((Math.min(slow, eva) * DOSE_PER_H).toFixed(2), 'mSv', 'Radiation dose outside, this EVA')}</div>
    <p class="note">${fit} Astronauts move as a pair, so the plan uses the slower walker's pace. Radiation is from Curiosity's surface measurements; Arcadia is lower, so its thicker air shields slightly more.</p>`;
}

let line, steep, chart, lastPath;
function show(path, toIce) {
  lastPath = path;
  $('go').disabled = $('ice').disabled = false;
  line?.remove(); steep?.remove(); chart?.destroy();
  $('chartBox').hidden = !path;
  if (!path) return msg(toIce ? `No likely ice can be reached while staying under ${$('max').value}°.`
    : `No route stays under ${$('max').value}°. Allow a steeper slope or pick other points.`);
  const ll = path.map(([r, c]) => cellLatLon(meta, r, c)), idx = path.map(([r, c]) => r * meta.cols + c);
  if (toIce) { $('end').value = ''; setPt(1, ll.at(-1)); }
  let dist = 0, gain = 0, loss = 0, unknown = 0, looseN = 0, rimN = 0, maxS = -1, maxJ = 0;
  const prof = idx.map((i, j) => {
    if (j) {
      dist += haversine(...ll[j - 1], ...ll[j]);
      const dz = h[i] - h[idx[j - 1]];
      if (dz > 0) gain += dz; else if (dz < 0) loss -= dz;
    }
    if (Number.isNaN(h[i])) unknown++;
    if (hazards.loose?.[i] > 0.5) looseN++;
    if (hazards.crater?.[i] > 0.5) rimN++;
    if (s[i] > maxS) { maxS = s[i]; maxJ = j; }
    return { x: dist / 1000, y: h[i] };
  });
  line = L.layerGroup([L.polyline(ll, { color: '#fff', weight: 7 }), L.polyline(ll, { color: '#f04e23', weight: 3.5 })]).addTo(map);
  steep = L.marker(ll[maxJ], { icon: icon(SYM.hazard, 'hazard') }).bindPopup(`Steepest point on the route: ${maxS.toFixed(0)}°`).addTo(map);
  const km = dist / 1000, r10 = v => Math.round(v / 10) * 10;
  const stat = (v, u, t, wide) => `<div class="stat${wide ? ' wide' : ''}"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  $('summary').innerHTML = `<p class="kicker">Measured from MOLA elevation</p><div class="stats">
    ${stat(km.toFixed(0), 'km', 'Distance', true)}${stat(`${r10(gain)}/${r10(loss)}`, 'm', 'Climb / descent')}
    ${stat(maxS.toFixed(0), '°', `Steepest slope ${SYM.hazard}`)}</div>
    <p class="kicker">Estimated</p><div class="stats">
    ${stat(`${(km / MODES[$('mode').value].v[1]).toFixed(1)}-${(km / MODES[$('mode').value].v[0]).toFixed(1)}`, 'h', `One way, ${MODES[$('mode').value].label}`)}
    ${stat(Math.round(100 * unknown / idx.length), '%', 'Route over missing data')}
    ${hazards.loose ? stat(Math.round(100 * looseN / idx.length), '%', 'Route over loose or dusty ground') : ''}
    ${hazards.crater ? stat(Math.round(100 * rimN / idx.length), '%', 'Route on or near crater rims') : ''}
    ${toIce && layers.ice ? stat(layers.ice[idx.at(-1)].toFixed(2), '', 'Ice score at B (SWIM, -1 to +1)') : ''}</div>
    ${toIce ? `<p class="note">B is the nearest place where the SWIM ice score is ${ICE_MIN} or higher: the orbiter data there is consistent with ice within 1 m of the surface.</p>` : ''}
    ${marswalk(km)}
    ${climate ? weather(climate.rows[+$('season').value]) : ''}
    <p class="note">Every step stays under ${$('max').value}° at 463 m resolution. Smaller hazards are not visible.</p>`;
  chart = new Chart($('profile'), {
    type: 'line',
    data: { datasets: [{ data: prof, pointRadius: 0, borderWidth: 2, borderColor: '#f04e23' }] },
    options: { animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${i[0].parsed.x.toFixed(0)} km`, label: i => `${i.parsed.y.toFixed(0)} m` } } },
      scales: { x: { type: 'linear', max: Math.ceil(km), grid: { display: false }, ticks: { includeBounds: false, callback: v => `${v} km` } },
        y: { ticks: { callback: v => `${v} m` } } } },
  });
}

$('v3d').onclick = async () => meta && (await import('./view3d.js')).open3D(h, meta, lastPath);

// Shareable link: #startLat,startLon,endLat,endLon
const q = location.hash.slice(1).split(',').map(Number);
if (q.length === 4 && q.every(Number.isFinite)) { setPt(0, q.slice(0, 2)); setPt(1, q.slice(2)); $('go').click(); }
