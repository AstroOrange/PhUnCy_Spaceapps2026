import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell } from './geo.js';
import { hazardGrids } from './hazards.js';
import { parseHash, formatHash } from './link.js';

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
  landing: svg('<circle cx="6" cy="6" r="4.6" fill="#000" stroke="#fff" stroke-width="1"/><circle cx="6" cy="6" r="1.7" fill="#fff"/>'),
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

const regions = await (await fetch('data/regions.json')).json();
const sites = (await (await fetch('sites.json')).json()).filter(s => s.lat != null && s.lon != null);
const kind = s => (s.ref ? 'ref' : s.landing ? 'landing' : s.poi ? 'poi' : 'site');
for (const r of regions) { // codes per region: S candidate sites, L rover landing sites, P points of interest
  const count = {};
  for (const s of sites.filter(s => s.region === r.id))
    s.code = s.ref ? '' : `${{ landing: 'L', poi: 'P', site: 'S' }[kind(s)]}${(count[kind(s)] = (count[kind(s)] || 0) + 1)}`;
}

const map = L.map('map', { crs: L.CRS.EPSG4326, layers: [mola] }).setView([20, 0], 2);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
const layerControl = L.control.layers({ 'Relief (MOLA)': mola, 'Imagery (CTX)': ctx }).addTo(map);
for (const s of sites)
  L.marker([s.lat, s.lon], { icon: icon(SYM[kind(s)] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(`<b>${s.code} ${s.name}</b><br>${s.lat}°, ${s.lon}°<br><small>${s.source}</small>`).addTo(map);
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => L.DomUtil.create('div', 'legend');
legend.addTo(map);
function drawLegend(here) {
  const has = k => here.some(s => kind(s) === k);
  legend.getContainer().innerHTML = [
    has('landing') && [SYM.landing, 'Rover landing site (L)'], has('site') && [SYM.site, 'Candidate landing site (S)'],
    has('poi') && [SYM.poi, 'Point of interest (P)'], has('ref') && [SYM.ref, 'Named feature'],
    [SYM.route, 'Safest route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Elevation data extent'],
    layers.ice && [SYM.ice, 'Ice likely within 1 m (SWIM)'], hazards.loose && [SYM.loose, 'Loose or dusty ground (TES)'],
    hazards.crater && [SYM.crater, 'Crater rim (Robbins catalog)'],
  ].filter(Boolean).map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>');
}

const ICE_MIN = 0.25; // SWIM ice-consistency score treated as "ice likely" (strongest signal in Arcadia)
const SEASONS = ['northern spring', 'northern summer', 'northern autumn', 'northern winter'];
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const json = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
const fmtLat = v => `${Math.abs(v)}°${v < 0 ? 'S' : 'N'}`, fmtLon = v => `${Math.abs(v)}°${v < 0 ? 'W' : 'E'}`;
let region, here = [], meta, h, s, layers = {}, hazards = {}, climate, regionLayers = [], loading = 0;

// Load one region's grids (from scripts/prep_dem.py) and weather (from scripts/fetch_mcd.py) from public/data/<id>/
async function loadRegion(id) {
  const token = ++loading;
  region = regions.find(r => r.id === id) || regions[0];
  $('region').value = region.id;
  clearRoute(); pins.forEach(p => p?.remove()); pins.length = pts.length = 0; setMode(0);
  regionLayers.forEach(l => { l.remove(); layerControl.removeLayer(l); });
  regionLayers = [];
  meta = h = s = climate = null; layers = {}; hazards = {};
  const [a, b, c, d] = region.bounds;
  $('where').innerHTML = `${region.about}<br>${region.name}, ${fmtLat(a)} to ${fmtLat(b)}, ${fmtLon(c)} to ${fmtLon(d)}`;
  here = sites.filter(x => x.region === region.id);
  ['start', 'end'].forEach(id => ($(id).innerHTML = `<option value="">${id === 'start' ? 'Choose a landing site, or click the map' : 'Click the map to drop a pin, or choose'}</option>`
    + here.map((x, i) => `<option value="${i}">${x.code ? x.code + ' ' : ''}${x.name}</option>`).join('')));
  const box = L.rectangle([[a, c], [b, d]], { color: '#000', weight: 1, opacity: 0.8, dashArray: '4 4', fill: false, interactive: false }).addTo(map);
  regionLayers.push(box);
  map.fitBounds(box.getBounds());
  $('go').disabled = $('v3d').disabled = $('ice').disabled = true;
  msg('Loading elevation data.');

  const m = await json(`data/${region.id}/dem.json`);
  const bin = f => fetch(`data/${region.id}/${f}.bin`).then(r => r.arrayBuffer()).then(x => new Float32Array(x));
  const grids = m && await Promise.all([bin('dem'), bin('slope'), ...(m.layers || []).map(bin)]);
  const clim = await json(`data/${region.id}/climate.json`);
  if (token !== loading) return; // the user switched region again while this was loading
  climate = clim;
  if (m) {
    meta = m; [h, s] = grids;
    layers = Object.fromEntries((m.layers || []).map((n, i) => [n, grids[i + 2]]));
    hazards = hazardGrids(layers);
    worker.postMessage({ h, s, meta, layers });
    // Data layers drawn from the grid, toggled from the layer menu
    const [a, b, c, d] = meta.bounds;
    const overlay = (label, grid, rgba) => {
      const cv = Object.assign(document.createElement('canvas'), { width: meta.cols, height: meta.rows }), g = cv.getContext('2d');
      const img = g.createImageData(meta.cols, meta.rows);
      grid.forEach((v, i) => img.data.set(rgba(v), i * 4));
      g.putImageData(img, 0, 0);
      const layer = L.imageOverlay(cv.toDataURL(), [[a, c], [b, d]]);
      layerControl.addOverlay(layer, label);
      regionLayers.push(layer);
    };
    if (layers.ice) overlay('Ice likely within 1 m (SWIM)', layers.ice, v => (v > 0 ? [47, 111, 214, Math.min(1, v / 0.35) * 190] : [0, 0, 0, 0]));
    if (hazards.loose) overlay('Loose or dusty ground (TES)', hazards.loose, v => [176, 104, 40, v * 170]);
    if (hazards.crater) overlay('Crater rims (Robbins catalog)', hazards.crater, v => [0, 0, 0, v > 0.3 ? v * 200 : 0]);
    $('go').disabled = $('v3d').disabled = $('ice').disabled = false;
    msg('No route yet. Pick a start, then click the map to drop your destination.');
  } else msg(`Elevation data for ${region.name} hasn't been prepared yet: run scripts/prep_dem.py for this region (see README). The sites are still shown on the map.`);
  $('ice').hidden = !layers.ice;
  $('looseRow').hidden = !hazards.loose;
  $('craterRow').hidden = !hazards.crater;
  $('seasonRow').hidden = !climate;
  if (climate) $('season').innerHTML = climate.rows.map((r, i) =>
    `<option value="${i}">Month ${i + 1} (Ls ${r.ls}°), ${SEASONS[Math.floor(r.ls / 90)]}${r.dust_storm != null ? ', dust storm season' : ''}</option>`).join('');
  drawLegend(here);
}

$('region').innerHTML = regions.map(r => `<option value="${r.id}">${r.name} (${r.about})</option>`).join('');
$('region').onchange = e => { history.replaceState(null, '', formatHash(e.target.value)); loadRegion(e.target.value); };
$('crater').oninput = e => ($('craterv').textContent = `×${e.target.value}`);
$('loose').oninput = e => ($('loosev').textContent = `×${e.target.value}`);
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);

// Start (A) and destination (B): choose from the lists, click the map, or drag the pins
const pts = [], pins = [];
function setPt(k, ll) {
  pts[k] = ll;
  pins[k]?.remove();
  pins[k] = L.marker(ll, { icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000, draggable: true, title: 'Drag to move' })
    .on('dragend', e => { const p = e.target.getLatLng(); pts[k] = [p.lat, p.lng]; $(k ? 'end' : 'start').value = ''; autoRoute(); })
    .addTo(map);
}
const autoRoute = () => pts[0] && pts[1] && meta && run(false);
['start', 'end'].forEach((id, k) => ($(id).onchange = e => {
  if (!e.target.value) return;
  const x = here[e.target.value];
  setPt(k, [x.lat, x.lon]);
  if (!k) setMode(1);
  autoRoute();
}));
let mode = 0; // which pin a map click places: 0 = start A, 1 = destination B
function setMode(k) { mode = k; $('setA').classList.toggle('on', !k); $('setB').classList.toggle('on', !!k); }
$('setA').onclick = () => setMode(0);
$('setB').onclick = () => setMode(1);
map.on('click', e => {
  $(mode ? 'end' : 'start').value = '';
  setPt(mode, [e.latlng.lat, e.latlng.lng]);
  if (!mode) setMode(1);
  autoRoute();
});

function run(toIce) {
  if (!meta) return;
  if (!pts[0] || (!toIce && !pts[1])) return msg(toIce ? 'Pick a start first.' : 'Pick a start and an end first.');
  const cells = pts.slice(0, toIce ? 1 : 2).map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('Both pins must be inside the dashed elevation data box.');
  history.replaceState(null, '', formatHash(region.id, pts[0], toIce ? null : pts[1]));
  msg(toIce ? 'Searching for the nearest likely ice.' : 'Working out the safest route.');
  $('go').disabled = $('ice').disabled = true;
  const token = loading;
  worker.onmessage = e => token === loading && show(e.data, toIce);
  worker.postMessage({ start: cells[0], end: toIce ? null : cells[1], iceMin: toIce ? ICE_MIN : null, opts: { maxSlope: +$('max').value }, weights: { loose: +$('loose').value, crater: +$('crater').value } });
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

let line, steep, chart, lastPath;
function clearRoute() {
  line?.remove(); steep?.remove(); chart?.destroy();
  line = steep = chart = lastPath = null;
  $('chartBox').hidden = true;
}
function show(path, toIce) {
  clearRoute();
  lastPath = path;
  $('go').disabled = $('ice').disabled = false;
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
    ${stat(`${Math.round(km / 3)}-${Math.round(km / 1.5)}`, 'h', 'Walking time at 1.5 to 3 km/h')}
    ${stat(Math.round(100 * unknown / idx.length), '%', 'Route over missing data')}
    ${hazards.loose ? stat(Math.round(100 * looseN / idx.length), '%', 'Route over loose or dusty ground') : ''}
    ${hazards.crater ? stat(Math.round(100 * rimN / idx.length), '%', 'Route on or near crater rims') : ''}
    ${toIce && layers.ice ? stat(layers.ice[idx.at(-1)].toFixed(2), '', 'Ice score at B (SWIM, -1 to +1)') : ''}</div>
    ${toIce ? `<p class="note">B is the nearest place where the SWIM ice score is ${ICE_MIN} or higher: the orbiter data there is consistent with ice within 1 m of the surface.</p>` : ''}
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

// Shareable link: #region/startLat,startLon,endLat,endLon
const link = parseHash(location.hash);
await loadRegion(link.region || regions[0].id);
if (link.start) { setPt(0, link.start); setMode(1); }
if (link.end) { setPt(1, link.end); autoRoute(); }
