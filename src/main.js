import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell, cropGrid, M_PER_DEG } from './geo.js';
import { hazardGrids } from './hazards.js';
import { peaks } from './targets.js';
import { SECTORS, FEATURES } from './hub.js';

const $ = id => document.getElementById(id);
// Packed Int16 grids from scripts/gridpack.py: value = raw * scale + offset, -32768 = no data
const unpack = (raw, { scale, offset }) => { const out = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw[i] === -32768 ? NaN : raw[i] * scale + offset; return out; };
const msg = t => ($('summary').innerHTML = `<p class="note">${t}</p>`);
Object.assign(Chart.defaults, { color: '#000', borderColor: '#000' });
Object.assign(Chart.defaults.font, { family: 'Archivo, Arial, sans-serif', size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#fff', titleColor: '#000', bodyColor: '#000',
  borderColor: '#000', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

// Base maps. Formats/URLs checked against each layer's WMTSCapabilities.xml.
const trek = name => `https://trek.nasa.gov/tiles/Mars/EQ/${name}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`;
const tileOpts = { maxNativeZoom: 7, maxZoom: 12, crossOrigin: true, keepBuffer: 4, updateWhenZooming: false };
// Real colour: Viking orbiter red and violet filter images (synthetic green), USGS MDIM 2.1 colour mosaic
const viking = L.tileLayer(trek('Mars_Viking_MDIM21_ClrMosaic_global_232m'), { ...tileOpts, attribution: 'NASA Mars Trek, USGS Viking MDIM 2.1 colour' });
const mola = L.tileLayer(trek('Mars_MGS_MOLA_ClrShade_merge_global_463m'), { ...tileOpts, attribution: 'NASA Mars Trek, USGS MOLA' });
// CTX = 512px .png redirected to astro.arcgis.com (2x1 tiles at level 0)
const ctx = L.tileLayer('https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
  { ...tileOpts, tileSize: 512, zoomOffset: -1, minZoom: 1, maxNativeZoom: 12, attribution: 'NASA Mars Trek, CTX (Caltech)' });

// Map symbols
const svg = body => `<svg width="12" height="12" viewBox="0 0 12 12">${body}</svg>`;
const SYM = {
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#fff" stroke="#000" stroke-width="1"/>'),
  poi: svg('<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="#000" stroke="#fff" stroke-width="1.5"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#fff" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#000" stroke="#fff" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#f04e23" stroke-width="3"/>'),
  alt: svg('<path d="M0 6h12" stroke="#fff" stroke-width="5"/><path d="M0 6h12" stroke="#6b6b6b" stroke-width="3"/>'),
  extent: svg('<path d="M0 6h12" stroke="#000" stroke-dasharray="3 2"/>'),
  iceTarget: svg('<path d="M6 .8 10.6 3.4v5.2L6 11.2 1.4 8.6V3.4Z" fill="#2f6fd6" stroke="#fff" stroke-width="1"/>'),
  mineral: svg('<path d="M6 .8 11 6 6 11.2 1 6Z" fill="#e0a020" stroke="#000" stroke-width="1"/>'),
  ice: svg('<rect x="1" y="1" width="10" height="10" fill="#2f6fd6" fill-opacity=".7"/>'),
  loose: svg('<rect x="1" y="1" width="10" height="10" fill="#b06828" fill-opacity=".65"/>'),
  crater: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="#000" stroke-width="1.6"/>'),
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
const layerControl = L.control.layers({ 'Colour (Viking)': viking, 'Elevation (MOLA)': mola, 'Imagery (CTX)': ctx }, null, { position: 'topleft' }).addTo(map);

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
updateScale();

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
    .bindPopup(() => whatsHere([s.lat, s.lon], `${s.code} ${s.name}`, `<small>${s.source}</small>` +
      (s.source.match(/ESP_\d{6}_\d{4}/g) || []).map(id => `<br><a href="https://www.uahirise.org/${id}" target="_blank" rel="noopener">See it up close: HiRISE ${id}</a>`).join(''))).addTo(map);
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
let ready = false, meta, h, s, worker, layers = {}, hazards = {}, targets = { ice: [], mineral: [], sites: [] }, overlays = {};
const dataReady = (async () => {
  meta = await fetch('data/dem.json').then(r => r.json()).catch(() => null);
  if (!meta) return;
  const bin = f => fetch(`data/${f}.i16`).then(r => r.arrayBuffer()).then(b => unpack(new Int16Array(b), meta.packed[f]));
  [h, s] = await Promise.all([bin('dem'), bin('slope')]);
  layers = Object.fromEntries(await Promise.all((meta.layers || []).map(async n => [n, await bin(n)])));
  hazards = hazardGrids(layers);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ h, s, meta, layers });
  const [a, b, c, d] = meta.bounds;
  L.rectangle([[a, c], [b, d]], { pane: 'sectorLines', color: '#000', weight: 1.5, dashArray: '5 4', fill: false, interactive: false }).addTo(map);
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
  if (layers.ice) overlays.ice = overlay('Ice likely within 1 m (SWIM)', layers.ice, v => (v > 0 ? [47, 111, 214, Math.min(1, v / 0.35) * 190] : [0, 0, 0, 0]));
  if (hazards.loose) overlay('Loose or dusty ground (TES)', hazards.loose, v => [176, 104, 40, v * 170]);
  if (hazards.crater) overlay('Crater rims (Robbins catalog)', hazards.crater, v => [0, 0, 0, v > 0.3 ? v * 200 : 0]);
  if (layers.pyroxene) overlays.mineral = overlay('Pyroxene detected (OMEGA)', layers.pyroxene, v => (v > 0 ? [224, 160, 32, Math.min(1, 0.35 + (v - 0.01) / 0.03) * 210] : [0, 0, 0, 0]));

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
    ({ name: `${x.code} ${x.name}`, code: x.code, ll: [x.lat, x.lon], sym: SYM[x.poi ? 'poi' : 'site'], detail: '' }));
  for (const t of [...targets.ice, ...targets.mineral])
    L.marker(t.ll, { ...inSector, icon: icon(t.sym + `<b>${t.code}</b>`) }).bindPopup(() => whatsHere(t.ll, t.name, `${t.detail}<br>`))
      .on('click', () => pickTarget(t)).addTo(map);

  legendBox.innerHTML = [
    [SYM.site, 'Candidate landing site'], [SYM.poi, 'Point of interest'], [SYM.iceTarget, 'Ice deposit (objective)'], targets.mineral.length && [SYM.mineral, 'Pyroxene exposure (objective)'],
    [SYM.route, 'Selected route'], [SYM.alt, 'Alternative route'], [SYM.hazard, 'Steepest point on route'], [SYM.extent, 'Sector data extent'],
    layers.ice && [SYM.ice, 'Ice likely within 1 m (SWIM)'], hazards.loose && [SYM.loose, 'Loose or dusty ground (TES)'],
    hazards.crater && [SYM.crater, 'Crater rim (Robbins catalog)'],
  ].filter(Boolean).map(([s, t]) => `<span class="sym">${s}</span>${t}`).join('<br>');
  $('looseRow').hidden = !hazards.loose;
  $('craterRow').hidden = !hazards.crater;
  ready = true;
})();
$('crater').oninput = e => ($('craterv').textContent = `×${e.target.value}`);
$('loose').oninput = e => ($('loosev').textContent = `×${e.target.value}`);
$('max').oninput = e => ($('maxv').textContent = `${e.target.value}°`);
const cellOf = ll => { if (!meta) return -1; const [r, c] = latLonCell(meta, ...ll); return r >= 0 && c >= 0 && r < meta.rows && c < meta.cols ? r * meta.cols + c : -1; };

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
    ${sec.open ? `<button id="enter" class="wide"${ready ? '' : ' disabled'}>${ready ? 'Enter sector' : 'Loading terrain…'}</button>`
      : `${sec.facts ? `<div class="grid">${sec.facts.map(f => stat(...f)).join('')}</div>` : ''}<button class="wide alt" disabled>Coming soon</button>`}`;
  card.innerHTML = body();
  map.flyTo([sec.lat, sec.lon], Math.max(map.getZoom(), 3), { duration: 0.8 });
  if (sec.open && !ready) { await dataReady; if (!card.hidden) card.innerHTML = body(); }
  $('enter')?.addEventListener('click', () => enterSector());
}

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
  const i = cellOf([lat, lng]), fine = i >= 0;
  let z = fine ? h[i] : NaN;
  if (!fine && globe) z = globe.h[Math.min(globe.rows - 1, Math.floor((90 - lat) * globe.ppd)) * globe.cols + Math.min(globe.cols - 1, Math.floor((lng + 180) * globe.ppd))];
  const elev = Number.isFinite(z) ? `  ELEV <b>${fine ? '' : '≈'}${Math.round(z).toLocaleString('en')} m</b>` : '';
  if (molaOn) t += elev; // next to latitude and longitude while the elevation map is shown
  if (fine) t += `\n${molaOn ? '' : elev.trim() + '  '}SLOPE <b>${s[i].toFixed(1)}°</b>${layers.ice ? `  ICE <b>${layers.ice[i].toFixed(2)}</b>` : ''}${layers.pyroxene?.[i] > 0 ? `  PYX <b>${layers.pyroxene[i].toFixed(3)}</b>` : ''}`;
  $('readout').innerHTML = t;
  if (molaOn && cbar && Number.isFinite(z)) {
    $('cbarMark').hidden = false;
    $('cbarMark').style.left = `${Math.min(100, Math.max(0, cbar.pct(z)))}%`;
  }
}

// "What's here?": values of every data layer at a point, with buttons to route from or to it
function whatsHere(ll, title = 'What\'s here?', extra = '') {
  const i = cellOf(ll), row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const data = i < 0 ? '<p>Outside the sector\'s elevation data.</p>' : `<table class="here">${[
    row('Elevation', `${Math.round(h[i]).toLocaleString('en-US')} m`), row('Slope', `${s[i].toFixed(1)}°`),
    layers.ice ? row('Ice score', `${layers.ice[i].toFixed(2)}${layers.ice[i] >= ICE_MIN ? ' (likely ice)' : ''}`) : '',
    layers.pyroxene?.[i] > 0 ? row('Pyroxene index', layers.pyroxene[i].toFixed(3)) : '',
    hazards.loose ? row('Loose ground', `${Math.round(hazards.loose[i] * 100)}%`) : '',
    hazards.crater ? row('Crater rim', hazards.crater[i] > 0.5 ? 'yes, close' : hazards.crater[i] > 0 ? 'nearby' : 'no') : '',
  ].join('')}</table>`;
  return `<b>${title}</b><br>${Math.abs(ll[0]).toFixed(3)}°${ll[0] < 0 ? 'S' : 'N'}, ${Math.abs(ll[1]).toFixed(3)}°${ll[1] < 0 ? 'W' : 'E'}<br>${extra}${data}
    ${i < 0 ? '' : `<div class="here-btns"><button class="alt" data-set="0" data-ll="${ll}">Route from here</button><button class="alt" data-set="1" data-ll="${ll}">Route to here</button></div>`}`;
}
map.on('contextmenu', e => mode === 'sector' && L.popup().setLatLng(e.latlng).setContent(whatsHere([e.latlng.lat, e.latlng.lng])).openOn(map));
map.getContainer().addEventListener('click', e => {
  const btn = e.target.closest('[data-set]');
  if (!btn) return;
  e.stopPropagation();
  const k = +btn.dataset.set, ll = btn.dataset.ll.split(',').map(Number);
  if (k) picked = null; else $('start').value = '';
  setPt(k, ll); map.closePopup(); renderTargets(); autoRoute();
}, true);

// Start (A), destination (B), swap and science stops
const pts = [], pins = [];
function setPt(k, ll) {
  pts[k] = ll;
  pins[k]?.remove();
  pins[k] = L.marker(ll, { ...inSector, icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000, draggable: true, title: 'Drag to move' })
    .on('dragend', e => { const q = e.target.getLatLng(); pts[k] = [q.lat, q.lng]; if (!k) $('start').value = ''; else picked = null; renderTargets(); autoRoute(); })
    .addTo(map);
  if (!k) renderTargets();
}
const autoRoute = () => pts[0] && pts[1] && run(false);
const startable = named.filter(x => !x.ref);
$('start').innerHTML = '<option value="">Choose a landing site, or click the map</option>' + startable.map((x, i) => `<option value="${i}">${x.code} ${x.name}</option>`).join('');
$('start').onchange = e => { if (e.target.value) { const x = startable[e.target.value]; setPt(0, [x.lat, x.lon]); autoRoute(); } };
$('swap').onclick = () => {
  if (!pts[0] || !pts[1]) return;
  const [a, b] = pts;
  picked = null; $('start').value = '';
  setPt(0, b); setPt(1, a); autoRoute();
};

// Search: a site code or name, an objective (I1, M2), or "lat, lon" (west longitudes negative)
const places = () => [...named.map(x => ({ label: `${x.code ? `${x.code} ` : ''}${x.name}`, ll: [x.lat, x.lon] })),
  ...[...targets.ice, ...targets.mineral].map(t => ({ label: `${t.code} ${t.name}`, ll: t.ll }))];
$('search').onfocus = () => ($('placeList').innerHTML = places().map(x => `<option value="${x.label}">`).join(''));
$('search').onkeydown = e => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(), m = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  const hit = !m && q && places().find(x => x.label.toLowerCase().includes(q.toLowerCase()));
  const ll = m ? [+m[1], +m[2]] : hit?.ll;
  if (!ll) return void ($('searchHint').textContent = 'No match. Try a code like S4, AP-1 or I1, a name, or "39.8, -157.9".');
  $('searchHint').textContent = 'Right-click anywhere on the map for "What\'s here?".';
  map.setView(ll, Math.max(map.getZoom(), 8));
  L.popup().setLatLng(ll).setContent(whatsHere(ll, hit ? hit.label : 'Search result')).openOn(map);
};

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
    : '<div class="locked-box"><b>Custom pin</b>Click anywhere inside the dashed box to drop destination B. Drag the pin to adjust; the route updates.</div>';
  const arr = targets[tab] || [];
  box.querySelectorAll('.target').forEach(b => (b.onclick = () => pickTarget(arr[+b.dataset.i])));
  $('ice')?.addEventListener('click', () => run(true));
}
function pickTarget(t) {
  picked = t;
  setPt(1, t.ll);
  renderTargets();
  if (pts[0]) run(false); else msg('Objective set. Now choose where to start from (01).');
}

let stopMode = false;
const stops = [], stopPins = [];
map.on('click', e => {
  if (mode !== 'sector') { if (!e.originalEvent.target.closest?.('.node')) { $('card').hidden = true; $('hint').hidden = false; } return; }
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

// Routing: Safest, Balanced and Shortest alternatives, each over every leg (A, stops, B).
// The hazard sliders set the Safest penalties; Balanced uses half, Shortest none.
const ALTS = [
  { name: 'Safest', note: 'Strongest hazard avoidance', k: 0.1, f: 1 },
  { name: 'Balanced', note: 'Half the hazard penalty', k: 0.05, f: 0.5 },
  { name: 'Shortest', note: 'Shortest path that is still under the slope limit', k: 0.01, f: 0 },
];
const busy = on => ['go', 'ice'].forEach(id => $(id) && ($(id).disabled = on));
const ask = m => new Promise(res => { worker.onmessage = e => res(e.data); worker.postMessage(m); });
let routes = [], sel = 0, toIceMode = false;
async function run(toIce) {
  if (!worker) return;
  if (!pts[0] || (!toIce && !pts[1])) return msg(toIce ? 'Choose where to start from first (01).' : 'Choose a start (01) and an objective (02) first.');
  const cells = (toIce ? [pts[0]] : [pts[0], ...stops, pts[1]]).map(p => latLonCell(meta, ...p));
  if (cells.flat().some((v, i) => v < 0 || v >= (i % 2 ? meta.cols : meta.rows)))
    return msg('All points must be inside the dashed sector box.');
  if (!toIce) history.replaceState(null, '', '#' + [pts[0], pts[1]].flat().map(v => v.toFixed(4)).join(','));
  msg(toIce ? 'Searching for the nearest likely ice.' : 'Finding routes.');
  busy(true);
  toIceMode = toIce;
  const found = [];
  for (const alt of toIce ? [ALTS[0]] : ALTS) {
    const base = { opts: { maxSlope: +$('max').value, k: alt.k }, weights: { loose: +$('loose').value * alt.f, crater: +$('crater').value * alt.f } };
    let path = [];
    const ends = [];
    if (toIce) { path = await ask({ ...base, start: cells[0], end: null, iceMin: ICE_MIN }); if (path) ends.push(path.length - 1); }
    else for (let i = 0; i + 1 < cells.length && path; i++) {
      const leg = await ask({ ...base, start: cells[i], end: cells[i + 1] });
      path = leg && path.concat(i ? leg.slice(1) : leg);
      if (path) ends.push(path.length - 1);
    }
    if (path) found.push(measure({ ...alt, path, ends }));
  }
  // drop alternatives that came out (almost) the same as one already found
  routes = found.filter((r, i) => !found.slice(0, i).some(q => Math.abs(q.km - r.km) < 0.01 * r.km && Math.abs(q.loose - r.loose) < 0.02));
  busy(false);
  sel = 0;
  render();
}
$('go').onclick = () => run(false);

// Distance, climb and hazards of one route
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
const endName = k => (k === routes[sel].ends.length - 1 ? (toIceMode ? 'the likely ice' : 'B') : `stop ${k + 1}`);
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
      out.push({ from: start, to: j, text: `Head ${cur} for ${((cum[j] - cum[start]) / 1000).toFixed(1)} km`, notes, arrive: atStop ? endName(ends.indexOf(j)) : '' });
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
  stopNav(); $('nav').hidden = true;
  $('chartBox').hidden = $('dirBox').hidden = $('navGo').hidden = !routes.length;
  $('routes').innerHTML = '';
  if (!routes.length) return msg(toIceMode ? `No likely ice can be reached while staying under ${$('max').value}°.`
    : `No route stays under ${$('max').value}°. Allow a steeper slope or pick other points.`);
  const r = routes[sel];
  if (toIceMode) { picked = null; setPt(1, r.ll.at(-1)); }
  routes.forEach((q, i) => {
    if (i === sel) return;
    const g = L.layerGroup([L.polyline(q.ll, { pane: 'sectorLines', color: '#fff', weight: 7 }), L.polyline(q.ll, { pane: 'sectorLines', color: '#6b6b6b', weight: 3.5 })]).addTo(map);
    g.eachLayer(l => l.on('click', ev => { L.DomEvent.stop(ev); sel = i; render(); }));
    drawn.push(g);
  });
  drawn.push(L.layerGroup([L.polyline(r.ll, { pane: 'sectorLines', color: '#fff', weight: 8 }), L.polyline(r.ll, { pane: 'sectorLines', color: '#f04e23', weight: 4 })]).addTo(map));
  steep = L.marker(r.ll[r.maxJ], { ...inSector, icon: icon(SYM.hazard, 'hazard') }).bindPopup(`Steepest point on the route: ${r.maxS.toFixed(0)}°`).addTo(map);
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
    stepLine = L.polyline(seg, { pane: 'sectorLines', color: '#000', weight: 6, opacity: 0.7 }).addTo(map);
    map.fitBounds(L.latLngBounds(seg).pad(0.5), { paddingBottomRight: [380, 0] });
  }));
  // summary
  const r10 = v => Math.round(v / 10) * 10;
  const stat = (v, u, t, wide) => `<div class="stat${wide ? ' wide' : ''}"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  $('summary').innerHTML = `<p class="kicker">${r.name} route, measured from MOLA elevation</p><div class="stats">
    ${stat(r.km.toFixed(1), 'km', 'Distance', true)}${stat(`${r10(r.gain)}/${r10(r.loss)}`, 'm', 'Climb / descent')}
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
      scales: { x: { type: 'linear', max: Math.ceil(r.km), grid: { display: false }, ticks: { includeBounds: false, callback: v => `${v} km` } },
        y: { ticks: { callback: v => `${v} m` } } } },
  });
}

// Go: a marker plays the selected route from A to B in about a minute, showing the distance left, the heading
// and measured hazards in the next kilometre. It is a playback of the plan, not a position fix (Mars has no GPS).
const PLAY_S = 60;
let nav = null, view3d = null;
function at(r, d) { // position and path index at distance d (m) along the route
  const c = r.cum;
  let j = 1;
  while (j < c.length - 1 && c[j] < d) j++;
  const f = Math.min(1, Math.max(0, (d - c[j - 1]) / (c[j] - c[j - 1] || 1))), [a, b] = [r.ll[j - 1], r.ll[j]];
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], j };
}
function stopNav() {
  if (nav) cancelAnimationFrame(nav.raf), nav.me.remove(), view3d?.stop();
  nav = null;
  $('navGo').textContent = 'Go';
}
function startNav() {
  const r = routes[sel];
  if (!r) return;
  const total = r.cum.at(-1);
  map.fitBounds(L.latLngBounds(r.ll).pad(0.4), { animate: false, paddingBottomRight: [380, 0] }); // zoom to the route so the playback is visible
  nav = { me: L.marker(r.ll[0], { ...inSector, icon: icon('', 'me', 16), zIndexOffset: 2000 }).addTo(map), t0: performance.now() };
  $('navGo').textContent = 'Stop';
  $('nav').hidden = false;
  const tick = now => {
    const d = Math.min(total, ((now - nav.t0) / 1000 / PLAY_S) * total), pos = at(r, d);
    nav.me.setLatLng(pos.ll);
    if (!map.getBounds().pad(-0.2).contains(pos.ll)) map.panTo(pos.ll, { animate: false });
    const leg = r.ends.findIndex(e => e >= pos.j), endD = r.cum[r.ends[leg]];
    let warn = ''; // look 1 km ahead for hazards
    for (let k = pos.j; k < r.idx.length && r.cum[k] - d < 1000; k++) {
      const i = r.idx[k], inM = Math.max(0, Math.round((r.cum[k] - d) / 100) * 100);
      if (s[i] > 0.7 * +$('max').value) { warn = `Steep ground in ${inM} m (${s[i].toFixed(0)}°)`; break; }
      if (hazards.crater?.[i] > 0.5) { warn = `Crater rim in ${inM} m`; break; }
      if (hazards.loose?.[i] > 0.7) { warn = `Loose ground in ${inM} m`; break; }
    }
    $('nav').innerHTML = `<div class="next"><b>${((endD - d) / 1000).toFixed(1)}<small>km</small></b>
      <span>to ${endName(leg)}${d < total ? `, head ${bearing(pos.ll, at(r, Math.min(total, d + 300)).ll)}` : ''}</span></div>
      <div class="row"><span>${(d / 1000).toFixed(1)} of ${(total / 1000).toFixed(1)} km</span><span>Elevation ${Math.round(h[r.idx[pos.j]]).toLocaleString('en')} m</span></div>
      ${warn ? `<div class="warn">Ahead: ${warn}</div>` : ''}
      ${d >= total ? `<div class="row"><span>Arrived at ${endName(r.ends.length - 1)}. Playback of the plan, not GPS.</span></div>` : ''}`;
    view3d?.setProgress(d / total, $('nav').innerHTML);
    if (d < total) nav.raf = requestAnimationFrame(tick);
    else { $('navGo').textContent = 'Go'; view3d?.stop(); }
  };
  nav.raf = requestAnimationFrame(tick);
}
$('navGo').onclick = () => (nav && $('navGo').textContent === 'Stop' ? stopNav() : (stopNav(), startNav()));

// Local 3D view: the terrain around the route (or around the pins), at full resolution. Go plays the route there too.
$('v3d').onclick = async () => {
  if (!meta) return;
  const path = routes[sel]?.path;
  const cells = path || [pts[0], ...stops, pts[1]].filter(Boolean).map(q => latLonCell(meta, ...q))
    .filter(([r, c]) => r >= 0 && c >= 0 && r < meta.rows && c < meta.cols);
  const local = cropGrid(h, meta, cells);
  view3d = (await import('./view3d.js')).open3D(local.h, local.meta, path ? local.cells : null, {
    onGo: () => (stopNav(), startNav()), // the same playback drives the map and the 3D view
    onClose: () => (stopNav(), view3d = null),
  });
};

// Shareable link: #startLat,startLon,endLat,endLon opens the sector with that route
const q = location.hash.slice(1).split(',').map(Number);
if (q.length === 4 && q.every(Number.isFinite)) { await enterSector(false); setPt(0, q.slice(0, 2)); setPt(1, q.slice(2)); run(false); }
