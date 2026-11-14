import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell, cropGrid } from './geo.js';
import { hazardGrids } from './hazards.js';
import { peaks } from './targets.js';
import { SECTORS, FEATURES } from './hub.js';

const $ = id => document.getElementById(id);
// Packed Int16 grids from scripts/gridpack.py: value = raw * scale + offset, -32768 = no data
const unpack = (raw, { scale, offset }) => { const out = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw[i] === -32768 ? NaN : raw[i] * scale + offset; return out; };
const msg = t => ($('summary').innerHTML = `<p class="note">${t}</p>`);
Object.assign(Chart.defaults, { color: '#8b97a3', borderColor: 'rgba(255,255,255,.08)' });
Object.assign(Chart.defaults.font, { family: 'Archivo, Arial, sans-serif', size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#0a0d11', titleColor: '#e9edf1', bodyColor: '#e9edf1',
  borderColor: 'rgba(255,255,255,.2)', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

// Formats/URLs checked against each layer's WMTSCapabilities.xml:
// MOLA = 256px .jpg on trek.nasa.gov; CTX = 512px .png redirected to astro.arcgis.com (2x1 tiles at level 0).
const viking = L.tileLayer( // Viking orbiter colour mosaic: Mars in its own colours, from real images
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, keepBuffer: 4, updateWhenZooming: false, attribution: 'NASA Mars Trek, Viking MDIM 2.1 (USGS)' });
const mola = L.tileLayer(
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, keepBuffer: 4, updateWhenZooming: false, attribution: 'NASA Mars Trek, USGS MOLA' });
const ctx = L.tileLayer(
  'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
  { tileSize: 512, zoomOffset: -1, minZoom: 1, maxNativeZoom: 12, maxZoom: 12, crossOrigin: true, keepBuffer: 4, updateWhenZooming: false, attribution: 'NASA Mars Trek, CTX (Caltech)' });

// Map symbols
const svg = body => `<svg width="12" height="12" viewBox="0 0 12 12">${body}</svg>`;
const SYM = {
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#e9edf1" stroke="#000" stroke-width="1"/>'),
  poi: svg('<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="#000" stroke="#e9edf1" stroke-width="1.5"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#e9edf1" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#ffb547" stroke="#000" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#000" stroke-width="5"/><path d="M0 6h12" stroke="#ff6a2b" stroke-width="3"/>'),
  extent: svg('<path d="M0 6h12" stroke="#7dffa8" stroke-dasharray="3 2"/>'),
  iceTarget: svg('<path d="M6 .8 10.6 3.4v5.2L6 11.2 1.4 8.6V3.4Z" fill="#3fd4ff" stroke="#000" stroke-width="1"/>'),
  mineral: svg('<path d="M6 .8 11 6 6 11.2 1 6Z" fill="#ffb547" stroke="#000" stroke-width="1"/>'),
  ice: svg('<rect x="1" y="1" width="10" height="10" fill="#3fd4ff" fill-opacity=".6"/>'),
  loose: svg('<rect x="1" y="1" width="10" height="10" fill="#c27a3a" fill-opacity=".7"/>'),
  crater: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="#e9edf1" stroke-width="1.6"/>'),
};
const icon = (html, className = 'mk', size = 12) => L.divIcon({ html, className, iconSize: [size, size] });

const sites = await (await fetch('sites.json')).json();
const named = sites.filter(s => s.lat != null && s.lon != null);
let n = 0, p = 0;
for (const s of named) s.code ??= s.ref ? '' : s.poi ? `P${++p}` : `S${++n}`; // sites may bring their own code (AP-1)

// Map. Everything that belongs to the sector lives in two panes that are hidden on the world map.
const WORLD_VIEW = innerWidth < 760 ? [[32, -150], 2] : [[15, -95], 2]; // phones start over Arcadia
const map = L.map('map', { crs: L.CRS.EPSG4326, layers: [viking], minZoom: 1, maxZoom: 12,
  maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 1 }).setView(...WORLD_VIEW);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
const layerControl = L.control.layers({ 'Mars colour (Viking orbiters)': viking, 'Elevation in colour (MGS MOLA)': mola, 'Close-up imagery (CTX)': ctx },
  null, { position: 'topleft' }).addTo(map);

// Elevation everywhere: MOLA 4 px/degree grid (about 15 km) and the colour bar measured from the MOLA tiles
// (scripts/fetch_mola_global.py). Inside the sector the 463 m grid is used instead.
let molaOn = false, globe = null, cbar = null;
fetch('data/mola_global.json').then(r => r.json()).then(async g => {
  globe = { ...g, h: unpack(new Int16Array(await (await fetch('data/mola_global.i16')).arrayBuffer()), g.packed) };
  const st = g.colorbar, lo = st[0][0], hi = st.at(-1)[0], pct = z => (100 * (z - lo)) / (hi - lo);
  cbar = { lo, hi, pct };
  $('cbarBar').style.background = `linear-gradient(90deg, ${st.map(([z, r, gr, b]) => `rgb(${r},${gr},${b}) ${pct(z).toFixed(1)}%`).join(', ')})`;
  const ticks = [];
  for (let z = Math.ceil(lo / 2000) * 2000; z <= hi; z += 2000) ticks.push(`<span style="left:${pct(z)}%">${z / 1000}</span>`);
  $('cbarTicks').innerHTML = ticks.join('');
}).catch(() => {});
map.on('baselayerchange', e => { molaOn = e.layer === mola; $('cbar').hidden = !molaOn; });
map.createPane('sectorLines').style.zIndex = 450;
map.createPane('sectorMarks').style.zIndex = 620;
const showSector = on => ['sectorLines', 'sectorMarks'].forEach(k => (map.getPane(k).style.display = on ? '' : 'none'));
showSector(false);
const inSector = { pane: 'sectorMarks' };

for (const s of named)
  L.marker([s.lat, s.lon], { ...inSector, icon: icon(SYM[s.ref ? 'ref' : s.poi ? 'poi' : 'site'] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(`<b>${s.code} ${s.name}</b><br>${s.lat}°, ${s.lon}°<br><small>${s.source}</small>` +
      (s.source.match(/ESP_\d{6}_\d{4}/g) || []).map(id => `<br><a href="https://www.uahirise.org/${id}" target="_blank" rel="noopener">See it up close: HiRISE ${id}</a>`).join('')).addTo(map);
const legend = L.control({ position: 'bottomleft' });
const legendBox = L.DomUtil.create('div', 'legend');
legend.onAdd = () => legendBox;

// World hub: sector nodes and landmark labels
const world = L.layerGroup().addTo(map);
for (const [name, lat, lon] of FEATURES)
  L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: null, html: `<div class="feature">${name}</div>` }) }).addTo(world);
const nodes = {};
for (const sec of SECTORS) {
  nodes[sec.id] = L.marker([sec.lat, sec.lon], { title: sec.name, riseOnHover: true, icon: L.divIcon({ className: '', iconSize: [30, 30],
    html: `<div class="node ${sec.open ? 'open' : 'locked'}" style="width:30px;height:30px">${sec.open ? '<div class="ring pulse"></div><div class="ring pulse late"></div>' : ''}
      <div class="ring"></div><div class="core"></div><div class="label">${sec.name}<small>${sec.sub}</small></div></div>` }) })
    .on('click', () => selectSector(sec)).addTo(world);
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// Terrain data loads in the background while you look around the world map
const ICE_MIN = 0.25; // SWIM ice-consistency score treated as "ice likely" (strongest signal in this region)
let ready = false, meta, h, s, worker, layers = {}, hazards = {}, climate, targets = { ice: [], mineral: [], sites: [] }, overlays = {};
const dataReady = (async () => {
  meta = await fetch('data/dem.json').then(r => r.json()).catch(() => null);
  if (!meta) return;
  const bin = f => fetch(`data/${f}.i16`).then(r => r.arrayBuffer()).then(b => unpack(new Int16Array(b), meta.packed[f]));
  [h, s] = await Promise.all([bin('dem'), bin('slope')]);
  layers = Object.fromEntries(await Promise.all((meta.layers || []).map(async n => [n, await bin(n)])));
  hazards = hazardGrids(layers);
  climate = await fetch('data/climate.json').then(r => r.json()).catch(() => null);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ h, s, meta, layers });
  const [a, b, c, d] = meta.bounds;
  L.rectangle([[a, c], [b, d]], { color: '#7dffa8', weight: 1.5, dashArray: '5 4', fill: true, fillOpacity: 0.06, interactive: false, className: 'sector-box' }).addTo(map);
  // Data layers drawn from the grid, toggled from the layer menu. Each image is only drawn the first time it is shown.
  const overlay = (label, grid, rgba) => {
    const layer = L.imageOverlay(BLANK, [[a, c], [b, d]], { pane: 'sectorLines' });
    layer.once('add', () => {
      const cv = Object.assign(document.createElement('canvas'), { width: meta.cols, height: meta.rows }), g = cv.getContext('2d');
      const img = g.createImageData(meta.cols, meta.rows), px = new Uint32Array(img.data.buffer);
      for (let i = 0; i < grid.length; i++) { const [r, gr, bl, al] = rgba(grid[i]); px[i] = (al << 24) | (bl << 16) | (gr << 8) | r; }
      g.putImageData(img, 0, 0);
      cv.toBlob(blob => layer.setUrl(URL.createObjectURL(blob)));
    });
    layerControl.addOverlay(layer, label);
    return layer;
  };
  if (layers.ice) overlays.ice = overlay('Ice likely within 1 m (SWIM)', layers.ice, v => (v > 0 ? [63, 212, 255, Math.min(1, v / 0.35) * 170] : [0, 0, 0, 0]));
  if (hazards.loose) overlay('Loose or dusty ground (TES)', hazards.loose, v => [194, 122, 58, v * 170]);
  if (hazards.crater) overlay('Crater rims (Robbins catalog)', hazards.crater, v => [233, 237, 241, v > 0.3 ? v * 200 : 0]);

  if (layers.pyroxene) overlays.mineral = overlay('Pyroxene detected (OMEGA)', layers.pyroxene, v => (v > 0 ? [255, 181, 71, Math.min(1, 0.35 + (v - 0.01) / 0.03) * 210] : [0, 0, 0, 0]));

  // Objectives. Ice: the strongest SWIM spots, one per patch. Minerals: the strongest OMEGA pyroxene detections
  // (scripts/fetch_omega.py), plus any sites in sites.json marked "mineral". Sites: landing sites and points of interest.
  const inBox = ([la, lo]) => la >= a && la <= b && lo >= c && lo <= d;
  if (layers.ice) targets.ice = peaks(layers.ice, meta, { min: 0.3, sepKm: 50, margin: 8 }).map((t, k) =>
    ({ name: `Ice deposit ${k + 1}`, code: `I${k + 1}`, ll: t.ll, sym: SYM.iceTarget, detail: `ice score ${t.value.toFixed(2)}` }));
  targets.mineral = [
    ...(layers.pyroxene ? peaks(layers.pyroxene, meta, { min: 0.02, sepKm: 25, margin: 8 }).map(t =>
      ({ name: 'Pyroxene exposure', ll: t.ll, detail: `pyroxene index ${t.value.toFixed(3)}` })) : []),
    ...named.filter(x => x.mineral && inBox([x.lat, x.lon])).map(x => ({ name: x.name, ll: [x.lat, x.lon], detail: x.mineral })),
  ].map((x, k) => ({ ...x, name: `${x.name} ${k + 1}`, code: `M${k + 1}`, sym: SYM.mineral }));
  targets.sites = named.filter(x => !x.ref && !x.mineral && inBox([x.lat, x.lon])).map(x =>
    ({ name: x.name, code: x.code, ll: [x.lat, x.lon], sym: SYM[x.poi ? 'poi' : 'site'], detail: '' }));
  for (const t of [...targets.ice, ...targets.mineral])
    L.marker(t.ll, { ...inSector, icon: icon(t.sym + `<b>${t.code}</b>`) }).bindPopup(`<b>${t.name}</b><br>${t.detail}<br>${t.ll.map(v => v.toFixed(3)).join('°, ')}°`)
      .on('click', () => pickTarget(t)).addTo(map);

  legendBox.innerHTML = [
    [SYM.site, 'Candidate landing site'], [SYM.poi, 'Point of interest'], [SYM.iceTarget, 'Ice deposit (objective)'], targets.mineral.length && [SYM.mineral, 'Pyroxene exposure (objective)'],
    [SYM.route, 'Safest route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Sector data extent'],
    layers.ice && [SYM.ice, 'Ice likely within 1 m (SWIM)'], hazards.loose && [SYM.loose, 'Loose or dusty ground (TES)'],
    hazards.crater && [SYM.crater, 'Crater rim (Robbins catalog)'],
  ].filter(Boolean).map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>');
  $('seasonRow').hidden = !climate;
  if (climate) $('season').innerHTML = climate.rows.map((r, i) =>
    `<option value="${i}">Month ${i + 1} (Ls ${r.ls}°), ${SEASONS[Math.floor(r.ls / 90)]}${r.dust_storm != null ? ', dust storm season' : ''}</option>`).join('');
  $('looseRow').hidden = !hazards.loose;
  $('craterRow').hidden = !hazards.crater;
  ready = true;
})();
const SEASONS = ['northern spring', 'northern summer', 'northern autumn', 'northern winter'];
$('crater').oninput = e => ($('craterv').textContent = `×${e.target.value}`);
$('loose').oninput = e => ($('loosev').textContent = `×${e.target.value}`);
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);

// Sector card (world map)
const AREA = ([a, b, c, d]) => (b - a) * 59.157 * (d - c) * 59.157 * Math.cos((a + b) * Math.PI / 360); // km², small box
async function selectSector(sec) {
  Object.values(nodes).forEach(m => m.getElement()?.firstElementChild.classList.remove('on'));
  nodes[sec.id].getElement()?.firstElementChild.classList.add('on');
  const card = $('card');
  card.hidden = false;
  $('hint').hidden = true;
  const stat = (v, u, t) => `<div><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  const body = () => `<div class="tag">Sector · ${sec.lat.toFixed(1)}°${sec.lat < 0 ? 'S' : 'N'} ${Math.abs(sec.lon).toFixed(1)}°${sec.lon < 0 ? 'W' : 'E'}</div>
    <h2>${sec.name}</h2><span class="status ${sec.open ? 'open' : 'locked'}">${sec.open ? 'Open' : 'Preview'}</span><p>${sec.text}</p>
    ${sec.open && ready ? `<div class="grid">${stat(Math.round(AREA(meta.bounds) / 1000), 'k km²', 'Area mapped')}
      ${stat(targets.sites.length, '', 'Landing sites and stops')}${stat(targets.ice.length, '', 'Ice deposits')}
      ${stat(targets.mineral.length || '—', '', 'Mineral targets')}</div>` : ''}
    ${sec.open ? `<button id="enter" class="wide"${ready ? '' : ' disabled'}>${ready ? 'Enter sector ▶' : 'Loading terrain…'}</button>`
      : `${sec.facts ? `<div class="grid">${sec.facts.map(f => stat(...f)).join('')}</div>` : ''}<button class="wide alt" disabled>Coming soon</button>`}`;
  card.innerHTML = body();
  map.flyTo([sec.lat, sec.lon], Math.max(map.getZoom(), 3), { duration: 0.8 });
  if (sec.open && !ready) { await dataReady; if (!card.hidden) card.innerHTML = body(); }
  $('enter')?.addEventListener('click', () => enterSector());
}
map.on('click', e => { if (mode === 'world' && !e.originalEvent.target.closest?.('.node')) { $('card').hidden = true; $('hint').hidden = false; } });

let mode = 'world';
async function enterSector(animate = true) {
  await dataReady;
  if (!meta) return;
  const sec = SECTORS.find(x => x.open);
  mode = 'sector';
  $('card').hidden = $('hint').hidden = true;
  map.removeLayer(world);
  $('panel').hidden = $('back').hidden = false;
  $('crumb').innerHTML = `World map / <b>${sec.name}</b>`;
  $('sectorName').textContent = sec.name;
  const [a, b, c, d] = meta.bounds, f = v => Math.abs(v);
  $('sectorWhere').textContent = `${f(a)}°N to ${f(b)}°N, ${f(c)}°W to ${f(d)}°W · ${sec.sub.split(' ·')[0]}`;
  showSector(true);
  legend.addTo(map);
  const box = L.latLngBounds([[a, c], [b, d]]), opt = { paddingTopLeft: [20, 70], paddingBottomRight: [400, 20] };
  animate ? map.flyToBounds(box, { ...opt, duration: 1.6 }) : map.fitBounds(box, opt);
  setTab(tab);
}
function leaveSector() {
  mode = 'world';
  stopNav();
  showSector(false);
  legend.remove();
  $('panel').hidden = $('back').hidden = $('nav').hidden = true;
  $('hint').hidden = false;
  $('crumb').innerHTML = '<b>World map</b>';
  world.addTo(map);
  map.flyTo(...WORLD_VIEW, { duration: 1.4 });
}
$('back').onclick = leaveSector;

// Cursor readout: position anywhere, plus a terrain scan inside the sector
let lastMove = null;
map.on('mousemove', e => { if (!lastMove) requestAnimationFrame(readout); lastMove = e; });
function readout() {
  const { lat, lng } = lastMove.latlng;
  lastMove = null;
  let t = `LAT <b>${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}</b>  LON <b>${Math.abs(lng).toFixed(2)}°${lng < 0 ? 'W' : 'E'}</b>`;
  let i = -1, z = NaN, fine = false;
  if (meta) {
    const [r, c] = latLonCell(meta, lat, lng);
    if (r >= 0 && c >= 0 && r < meta.rows && c < meta.cols) { i = r * meta.cols + c; z = h[i]; fine = true; }
  }
  if (!fine && globe) z = globe.h[Math.min(globe.rows - 1, Math.floor((90 - lat) * globe.ppd)) * globe.cols + Math.min(globe.cols - 1, Math.floor((lng + 180) * globe.ppd))];
  const elev = Number.isFinite(z) ? `  ELEV <b>${fine ? '' : '≈'}${Math.round(z).toLocaleString('en')} m</b>` : '';
  if (molaOn) t += elev; // next to latitude and longitude while the elevation map is shown
  if (i >= 0) t += `\n${molaOn ? '' : elev.trim() + '  '}SLOPE <b>${s[i].toFixed(1)}°</b>${layers.ice ? `  ICE <b>${layers.ice[i].toFixed(2)}</b>` : ''}${layers.pyroxene?.[i] > 0 ? `  PYX <b>${layers.pyroxene[i].toFixed(3)}</b>` : ''}`;
  $('readout').innerHTML = t;
  if (molaOn && cbar && Number.isFinite(z)) {
    $('cbarMark').hidden = false;
    $('cbarMark').style.left = `${Math.min(100, Math.max(0, cbar.pct(z)))}%`;
  }
}

// Start (A), destination (B) and science stops
const pts = [], pins = [];
function setPt(k, ll) {
  pts[k] = ll;
  pins[k]?.remove();
  pins[k] = L.marker(ll, { ...inSector, icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000, draggable: true, title: 'Drag to move' })
    .on('dragend', e => { const q = e.target.getLatLng(); pts[k] = [q.lat, q.lng]; if (!k) $('start').value = ''; renderTargets(); autoRoute(); })
    .addTo(map);
  if (!k) renderTargets();
}
const autoRoute = () => pts[0] && pts[1] && run(false);
const startable = named.filter(x => !x.ref);
$('start').innerHTML = '<option value="">Choose a landing site, or click the map</option>' + startable.map((x, i) => `<option value="${i}">${x.code} ${x.name}</option>`).join('');
$('start').onchange = e => { if (e.target.value) { const x = startable[e.target.value]; setPt(0, [x.lat, x.lon]); autoRoute(); } };

// Objectives: pick a tab, then a target; the route is plotted straight away
let tab = 'ice', picked = null;
const tabs = [...document.querySelectorAll('.tabs button')];
tabs.forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
function setTab(k) {
  tab = k;
  tabs.forEach(b => b.classList.toggle('on', b.dataset.tab === k));
  // The Ice and Minerals tabs also show their map layer, so you can see what you are choosing between
  for (const [name, layer] of Object.entries(overlays))
    if (name === 'ice' || name === 'mineral') name === k ? layer.addTo(map) : layer.remove();
  renderTargets();
}
function renderTargets() {
  if (!meta) return;
  tabs.find(b => b.dataset.tab === 'mineral').classList.toggle('locked', !targets.mineral.length);
  const km = t => (pts[0] ? `${Math.round(haversine(...pts[0], ...t.ll) / 1000)} km` : t.detail);
  const list = (arr, extra = '') => arr.map((t, i) => `<button class="target${picked === t ? ' on' : ''}" data-i="${i}">${t.sym}<span>${t.name}</span><small>${km(t)}</small></button>`).join('') + extra;
  const box = $('targets');
  box.innerHTML = tab === 'ice' ? list(targets.ice, layers.ice?.some(v => v >= ICE_MIN) ? '<button id="ice" class="alt wide">Nearest reachable ice from A</button>' : '')
    : tab === 'mineral' ? (targets.mineral.length ? list(targets.mineral)
      : '<div class="locked-box"><b>Locked · no mineral survey</b>No mineral map is loaded for this sector yet. Run scripts/fetch_omega.py, or add mineral sites to public/sites.json with a "mineral" field.</div>')
      + (layers.pyroxene ? '<p class="note">From the OMEGA orbiter\'s pyroxene map (Ody et al. 2012). Pyroxene is an iron and magnesium mineral of volcanic rock; here it shows where darker, less dusty rock is exposed, mostly in the south-east. The index is a spectral band depth, not an amount. OMEGA detected no olivine and no water-bearing minerals in this sector; the rest is mostly dust-covered.</p>' : '')
    : tab === 'sites' ? list(targets.sites)
    : '<div class="locked-box"><b>Custom pin</b>Click anywhere inside the green box to drop destination B. Drag the pin to adjust; the route updates.</div>';
  const arr = targets[tab] || [];
  box.querySelectorAll('.target').forEach(b => (b.onclick = () => pickTarget(arr[+b.dataset.i])));
  $('ice')?.addEventListener('click', () => run(true));
}
function pickTarget(t) {
  picked = t;
  setPt(1, t.ll);
  renderTargets();
  if (pts[0]) run(false); else msg('Objective set. Now choose where to deploy from (01).');
}

let stopMode = false;
const stops = [], stopPins = [];
map.on('click', e => {
  if (mode !== 'sector') return;
  const ll = [e.latlng.lat, e.latlng.lng];
  if (stopMode) {
    stops.push(ll);
    stopPins.push(L.marker(ll, { ...inSector, icon: icon(String(stops.length), 'pin stop', 18), zIndexOffset: 900 }).addTo(map));
    $('clearStops').hidden = false;
    return;
  }
  if (!pts[0]) { $('start').value = ''; setPt(0, ll); return; }
  picked = null;
  setPt(1, ll);
  renderTargets();
  autoRoute();
});
$('addStop').onclick = () => {
  stopMode = !stopMode;
  $('addStop').textContent = stopMode ? 'Done adding stops' : 'Add science stops';
  $('addStop').classList.toggle('on', stopMode);
};
$('clearStops').onclick = () => { stops.length = 0; stopPins.splice(0).forEach(m => m.remove()); $('clearStops').hidden = true; };

const busy = on => ['go', 'ice'].forEach(id => $(id) && ($(id).disabled = on));
const ask = m => new Promise(res => { worker.onmessage = e => res(e.data); worker.postMessage(m); });
async function run(toIce) {
  if (!worker) return;
  if (!pts[0] || (!toIce && !pts[1])) return msg(toIce ? 'Choose where to deploy from first (01).' : 'Choose a start (01) and an objective (02) first.');
  const cells = (toIce ? [pts[0]] : [pts[0], ...stops, pts[1]]).map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('All points must be inside the green sector box.');
  if (!toIce) history.replaceState(null, '', '#' + [pts[0], pts[1]].flat().map(v => v.toFixed(4)).join(','));
  msg(toIce ? 'Scanning for the nearest likely ice.' : 'Plotting the safest route.');
  busy(true);
  const base = { opts: { maxSlope: +$('max').value }, weights: { loose: +$('loose').value, crater: +$('crater').value } };
  let path = [];
  legEnds = [];
  if (toIce) { path = await ask({ ...base, start: cells[0], end: null, iceMin: ICE_MIN }); if (path) legEnds.push(path.length - 1); }
  else for (let i = 0; i + 1 < cells.length && path; i++) { // one leg per pair of points: A, stops, B
    const leg = await ask({ ...base, start: cells[i], end: cells[i + 1] });
    path = leg && path.concat(i ? leg.slice(1) : leg);
    if (path) legEnds.push(path.length - 1);
  }
  show(path, toIce);
}
$('go').onclick = () => run(false);

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
    <p class="note">${fit} Astronauts move as a pair, so the plan uses the slower walker's pace. Radiation is from Curiosity's surface measurements; higher ground has thinner air and gets slightly more.</p>`;
}

let line, steep, chart, lastPath;
function show(path, toIce) {
  lastPath = path;
  busy(false);
  line?.remove(); steep?.remove(); chart?.destroy(); stopNav(); trip = null; $('nav').hidden = true;
  $('chartBox').hidden = !path;
  if (!path) return msg(toIce ? `No likely ice can be reached while staying under ${$('max').value}°.`
    : `No route stays under ${$('max').value}°. Allow a steeper slope or pick other points.`);
  const ll = path.map(([r, c]) => cellLatLon(meta, r, c)), idx = path.map(([r, c]) => r * meta.cols + c);
  if (toIce) { picked = null; setPt(1, ll.at(-1)); }
  let dist = 0, gain = 0, loss = 0, unknown = 0, looseN = 0, rimN = 0, maxS = -1, maxJ = 0;
  const cum = [];
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
    cum.push(dist);
    return { x: dist / 1000, y: h[i] };
  });
  line = L.layerGroup([L.polyline(ll, { pane: 'sectorLines', color: '#000', weight: 7, opacity: 0.7 }),
    L.polyline(ll, { pane: 'sectorLines', color: '#ff6a2b', weight: 10, opacity: 0.25 }),
    L.polyline(ll, { pane: 'sectorLines', color: '#ff6a2b', weight: 3.5 })]).addTo(map);
  const ends = legEnds.length ? legEnds : [idx.length - 1];
  trip = { ll, idx, cum, ends, names: ends.map((_, k) => (k === ends.length - 1 ? (toIce ? 'the ice' : 'B') : `stop ${k + 1}`)) };
  $('navGo').hidden = false;
  steep = L.marker(ll[maxJ], { ...inSector, icon: icon(SYM.hazard, 'hazard') }).bindPopup(`Steepest point on the route: ${maxS.toFixed(0)}°`).addTo(map);
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
    data: { datasets: [{ data: prof, pointRadius: 0, borderWidth: 2, borderColor: '#ff6a2b', fill: true, backgroundColor: 'rgba(255,106,43,.12)' }] },
    options: { animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${i[0].parsed.x.toFixed(0)} km`, label: i => `${i.parsed.y.toFixed(0)} m` } } },
      scales: { x: { type: 'linear', max: Math.ceil(km), grid: { display: false }, ticks: { includeBounds: false, callback: v => `${v} km` } },
        y: { ticks: { callback: v => `${v} m` } } } },
  });
}

// Simulated navigation ("Go"): an astronaut marker moves along the route at the slower planned speed,
// about 60 s for the whole trip. Real missions would get position from suit or rover motion tracking
// and camera matching to orbital maps, since Mars has no GPS.
let trip = null, nav = null, legEnds = [];
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function bearing([la1, lo1], [la2, lo2]) {
  const y = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360), x = la2 - la1;
  return DIRS[Math.round(((Math.atan2(y, x) * 180 / Math.PI + 360) % 360) / 45) % 8];
}
function at(d) { // position and path index at distance d (m) along the route
  const c = trip.cum;
  let j = 1;
  while (j < c.length - 1 && c[j] < d) j++;
  const f = Math.min(1, Math.max(0, (d - c[j - 1]) / (c[j] - c[j - 1] || 1))), [a, b] = [trip.ll[j - 1], trip.ll[j]];
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], j };
}
function stopNav() {
  if (nav) cancelAnimationFrame(nav.raf), nav.me.remove();
  nav = null;
  $('navGo').textContent = 'Go';
}
function startNav() {
  if (!trip) return;
  const m = MODES[$('mode').value], v = m.v[0] * 1000, eva = +$('eva').value, total = trip.cum.at(-1);
  map.fitBounds(L.latLngBounds(trip.ll).pad(0.4), { animate: false, paddingBottomRight: [380, 0] }); // zoom to the route so the walk is visible
  const me = L.marker(trip.ll[0], { ...inSector, icon: icon('', 'me', 16), zIndexOffset: 2000 }).addTo(map);
  nav = { me, t0: performance.now(), scale: Math.max(total / v, 0.05) * 3600 / 60 }; // sim seconds per real second
  $('navGo').textContent = 'Stop';
  $('nav').hidden = false;
  const tick = now => {
    const hrs = ((now - nav.t0) / 1000) * nav.scale / 3600, d = Math.min(total, hrs * v), pos = at(d);
    nav.me.setLatLng(pos.ll);
    if (!map.getBounds().pad(-0.2).contains(pos.ll)) map.panTo(pos.ll, { animate: false });
    const leg = trip.ends.findIndex(e => e >= pos.j), endD = trip.cum[trip.ends[leg]], name = trip.names[leg];
    const ahead = at(Math.min(total, d + 300)).ll;
    // look 1 km ahead for hazards
    let warn = '';
    for (let k = pos.j; k < trip.idx.length && trip.cum[k] - d < 1000; k++) {
      const i = trip.idx[k], inM = Math.max(0, Math.round((trip.cum[k] - d) / 100) * 100);
      if (s[i] > 0.7 * +$('max').value) { warn = `Steep ground in ${inM} m (${s[i].toFixed(0)}°)`; break; }
      if (hazards.crater?.[i] > 0.5) { warn = `Crater rim in ${inM} m`; break; }
      if (hazards.loose?.[i] > 0.7) { warn = `Loose ground in ${inM} m`; break; }
    }
    const back = d / v; // hours to walk back to the start the same way
    const turn = hrs + back >= eva ? 'Turn back now: the walk home uses the rest of your EVA.'
      : hrs + back >= 0.85 * eva ? `Turn back within ${((eva - hrs - back) * 60 / 2).toFixed(0)} min to get home in time.` : '';
    $('nav').innerHTML = `<div class="next"><b>${((endD - d) / 1000).toFixed(1)}<small>km</small></b>
      <span>to ${name}${d < total ? `, head ${bearing(pos.ll, ahead)}` : ''}</span></div>
      <div class="row"><span>EVA ${hrs.toFixed(1)} h used, ${Math.max(0, eva - hrs).toFixed(1)} h left</span><span>${(hrs * DOSE_PER_H).toFixed(2)} mSv</span><span>${(d / 1000).toFixed(1)} of ${(total / 1000).toFixed(1)} km</span></div>
      ${warn ? `<div class="warn">Ahead: ${warn}</div>` : ''}${turn ? `<div class="warn">${turn}</div>` : ''}
      ${d >= total ? `<div class="row"><span>Arrived at ${trip.names.at(-1)}. Simulated position, not GPS.</span></div>` : ''}`;
    if (d < total) nav.raf = requestAnimationFrame(tick);
    else $('navGo').textContent = 'Go';
  };
  nav.raf = requestAnimationFrame(tick);
}
$('navGo').onclick = () => (nav && $('navGo').textContent === 'Stop' ? stopNav() : (stopNav(), startNav()));

// Local 3D view: the terrain around the route (or around the pins), at full resolution
$('v3d').onclick = async () => {
  if (!meta) return;
  const cells = lastPath || [pts[0], ...stops, pts[1]].filter(Boolean).map(q => latLonCell(meta, ...q))
    .filter(([r, c]) => r >= 0 && c >= 0 && r < meta.rows && c < meta.cols);
  const local = cropGrid(h, meta, cells);
  (await import('./view3d.js')).open3D(local.h, local.meta, lastPath ? local.cells : null);
};

// Shareable link: #startLat,startLon,endLat,endLon opens the sector with that route
const q = location.hash.slice(1).split(',').map(Number);
if (q.length === 4 && q.every(Number.isFinite)) { await enterSector(false); setPt(0, q.slice(0, 2)); setPt(1, q.slice(2)); run(false); }
