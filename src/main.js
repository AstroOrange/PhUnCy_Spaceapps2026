import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/public-sans/latin-400.css';
import '@fontsource/public-sans/latin-600.css';
import '@fontsource/public-sans/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell } from './geo.js';

const $ = id => document.getElementById(id);
const msg = t => ($('summary').innerHTML = `<p class="note">${t}</p>`);
Object.assign(Chart.defaults, { color: '#6b665d', borderColor: '#e2ddd2' });
Object.assign(Chart.defaults.font, { family: "'Public Sans', Arial, sans-serif", size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#fff', titleColor: '#1d1c1a', bodyColor: '#1d1c1a',
  borderColor: '#1d1c1a', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

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
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#1d1c1a" stroke="#fff" stroke-width="1"/>'),
  poi: svg('<path d="M6 1 11 6 6 11 1 6Z" fill="#1f5fa8" stroke="#fff" stroke-width="1"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#1d1c1a" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#1d1c1a" stroke="#fff" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#c62828" stroke-width="2.5"/>'),
  extent: svg('<path d="M0 6h12" stroke="#1d1c1a" stroke-dasharray="3 2"/>'),
};
const icon = (html, className = 'mk', size = 12) => L.divIcon({ html, className, iconSize: [size, size] });

const sites = await (await fetch('sites.json')).json();
const named = sites.filter(s => s.lat != null && s.lon != null);
let n = 0, p = 0;
for (const s of named) s.code = s.ref ? '' : s.poi ? `P${++p}` : `S${++n}`;

const map = L.map('map', { crs: L.CRS.EPSG4326, layers: [mola] }).setView([35.66, -174.98], 6);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
L.control.layers({ 'Relief (MOLA)': mola, 'Imagery (CTX)': ctx }).addTo(map);
for (const s of named)
  L.marker([s.lat, s.lon], { icon: icon(SYM[s.ref ? 'ref' : s.poi ? 'poi' : 'site'] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(`<b>${s.code} ${s.name}</b><br>${s.lat}°, ${s.lon}°<br><small>${s.source}</small>`).addTo(map);
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => Object.assign(L.DomUtil.create('div', 'legend'), { innerHTML: [
  [SYM.site, 'Candidate landing site (S)'], [SYM.poi, 'Point of interest (P)'],
  [SYM.route, 'Safest route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Elevation data extent'],
].map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>') });
legend.addTo(map);

// Elevation grid from scripts/prep_dem.py
const meta = await fetch('data/dem.json').then(r => r.json()).catch(() => null);
let h, s, worker;
if (meta) {
  [h, s] = await Promise.all(['dem', 'slope'].map(f => fetch(`data/${f}.bin`).then(r => r.arrayBuffer()).then(b => new Float32Array(b))));
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ h, s, meta });
  const [a, b, c, d] = meta.bounds;
  map.fitBounds(L.rectangle([[a, c], [b, d]], { color: '#1d1c1a', weight: 1, opacity: 0.7, dashArray: '4 4', fill: false, interactive: false }).addTo(map).getBounds());
} else msg('No elevation data yet: run scripts/prep_dem.py (see README).');
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);

// Start (A) / end (B)
const pts = [], pins = [];
const setPt = (k, ll) => { pts[k] = ll; pins[k]?.remove(); pins[k] = L.marker(ll, { icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000 }).addTo(map); };
['start', 'end'].forEach((id, k) => {
  $(id).innerHTML = '<option value="">Choose a site, or click the map</option>' + named.map((s, i) => `<option value="${i}">${s.code} ${s.name}</option>`).join('');
  $(id).onchange = e => e.target.value && setPt(k, [named[e.target.value].lat, named[e.target.value].lon]);
});
let next = 0;
map.on('click', e => { $(next ? 'end' : 'start').value = ''; setPt(next, [e.latlng.lat, e.latlng.lng]); next ^= 1; });

$('go').onclick = () => {
  if (!worker) return;
  if (!pts[0] || !pts[1]) return msg('Pick a start and an end first.');
  const cells = pts.map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('Both points must be inside the dashed elevation data box.');
  location.hash = pts.flat().map(v => v.toFixed(4)).join(',');
  msg('Working out the safest route.');
  $('go').disabled = true;
  worker.onmessage = e => show(e.data);
  worker.postMessage({ start: cells[0], end: cells[1], opts: { maxSlope: +$('max').value } });
};

let line, steep, chart, lastPath;
function show(path) {
  lastPath = path;
  $('go').disabled = false;
  line?.remove(); steep?.remove(); chart?.destroy();
  $('chartBox').hidden = !path;
  if (!path) return msg(`No route stays under ${$('max').value}°. Allow a steeper slope or pick other points.`);
  const ll = path.map(([r, c]) => cellLatLon(meta, r, c)), idx = path.map(([r, c]) => r * meta.cols + c);
  let dist = 0, gain = 0, loss = 0, unknown = 0, maxS = -1, maxJ = 0;
  const prof = idx.map((i, j) => {
    if (j) {
      dist += haversine(...ll[j - 1], ...ll[j]);
      const dz = h[i] - h[idx[j - 1]];
      if (dz > 0) gain += dz; else if (dz < 0) loss -= dz;
    }
    if (Number.isNaN(h[i])) unknown++;
    if (s[i] > maxS) { maxS = s[i]; maxJ = j; }
    return { x: dist / 1000, y: h[i] };
  });
  line = L.layerGroup([L.polyline(ll, { color: '#fff', weight: 6 }), L.polyline(ll, { color: '#c62828', weight: 3 })]).addTo(map);
  steep = L.marker(ll[maxJ], { icon: icon(SYM.hazard, 'hazard') }).bindPopup(`Steepest point on the route: ${maxS.toFixed(0)}°`).addTo(map);
  const km = dist / 1000, r10 = v => Math.round(v / 10) * 10;
  const rows = r => `<table>${r.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  $('summary').innerHTML = `<h3>Measured, from MOLA elevation</h3>${rows([
    ['Distance', `${km.toFixed(0)} km`], ['Climb / descent', `${r10(gain)} / ${r10(loss)} m`],
    [`Steepest slope ${SYM.hazard}`, `${maxS.toFixed(0)}°`]])}
    <h3>Estimated</h3>${rows([
    ['Walking time at 1.5 to 3 km/h', `${Math.round(km / 3)} to ${Math.round(km / 1.5)} h`],
    ['Route over missing data', `${Math.round(100 * unknown / idx.length)} %`]])}
    <p class="note">Every step stays under ${$('max').value}° at 463 m resolution. Smaller hazards are not visible.</p>`;
  chart = new Chart($('profile'), {
    type: 'line',
    data: { datasets: [{ data: prof, pointRadius: 0, borderWidth: 1.5, borderColor: '#c62828' }] },
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
