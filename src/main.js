import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo-narrow/latin-700.css';
import Chart from 'chart.js/auto';
import { haversine, cellLatLon, latLonCell, cropGrid, M_PER_DEG } from './geo.js';
import { hazardGrids } from './hazards.js';
import { ASSUMED_KMH, bearingDeg, compassWord, navState } from './nav.js';
import { peaks } from './targets.js';
import { SECTORS, FEATURES } from './hub.js';
import { shadeTile, contourStep } from './terrain.js';

const $ = id => document.getElementById(id);
// Packed Int16 grids from scripts/gridpack.py: value = raw * scale + offset, -32768 = no data
const unpack = (raw, { scale, offset }) => { const out = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw[i] === -32768 ? NaN : raw[i] * scale + offset; return out; };
const msg = t => { $('status').textContent = t; $('status').hidden = !t; };
const fmtLL = ([la, lo], n = 3) => `${Math.abs(la).toFixed(n)}°${la < 0 ? 'S' : 'N'}, ${Math.abs(lo).toFixed(n)}°${lo < 0 ? 'W' : 'E'}`;
Object.assign(Chart.defaults, { color: '#000', borderColor: '#d9d9d9' });
Object.assign(Chart.defaults.font, { family: 'Archivo, Arial, sans-serif', size: 10 });
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: '#fff', titleColor: '#000', bodyColor: '#000',
  borderColor: '#000', borderWidth: 1, cornerRadius: 0, displayColors: false, padding: 6 });

// Map symbols
const svg = body => `<svg width="12" height="12" viewBox="0 0 12 12">${body}</svg>`;
const SYM = {
  site: svg('<rect x="2" y="2" width="8" height="8" fill="#fff" stroke="#000" stroke-width="1"/>'),
  poi: svg('<path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="#000" stroke="#fff" stroke-width="1.5"/>'),
  ref: svg('<path d="M6 1v10M1 6h10" stroke="#fff" stroke-width="1.5"/>'),
  hazard: svg('<path d="M6 1.5 11 10.5H1Z" fill="#000" stroke="#fff" stroke-width="1"/>'),
  route: svg('<path d="M0 6h12" stroke="#f04e23" stroke-width="3"/>'),
  alt: svg('<path d="M0 6h12" stroke="#6b6b6b" stroke-width="3"/>'),
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
// Places for the pickers: { group, label, ll }
const sitePlaces = named.filter(x => !x.ref).map(x => ({ label: `${x.code} · ${x.name}`, ll: [x.lat, x.lon], sym: SYM[x.poi ? 'poi' : 'site'],
  group: x.poi ? 'Points of interest' : /^S\d/.test(x.code) ? 'SpaceX candidate sites' : 'NASA/SpaceX study sites' }));
const options = (items, first) => `<option value="">${first}</option>` + [...new Set(items.map(q => q.group))].map(g =>
  `<optgroup label="${g}">${items.map((q, i) => (q.group === g ? `<option value="${i}">${q.label}</option>` : '')).join('')}</optgroup>`).join('');

// Map. The world map fills the page; inside a sector the planner sits beside it.
const WORLD_VIEW = innerWidth < 760 ? [[32, -150], 2] : [[15, -95], 2]; // phones start over Arcadia
const map = L.map('map', { crs: L.CRS.EPSG4326, minZoom: 1, maxZoom: 13, zoomSnap: 0.5, maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 1 }).setView(...WORLD_VIEW);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

// Terrain: drawn here from the measured height grids (src/terrain.js). It is always on the map, under the picture layers,
// so a picture tile that is missing or still loading shows real terrain, never a hole.
const grids = { fine: null, coarse: null };
map.createPane('terrain').style.zIndex = 100;
const terrain = new (L.GridLayer.extend({
  createTile(c) {
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    if (grids.fine || grids.coarse) cv.getContext('2d').putImageData(new ImageData(shadeTile(c.z >= 5 ? grids.fine : null, grids.coarse, c.z, c.x, c.y), 256), 0, 0);
    return cv;
  },
}))({ pane: 'terrain', updateWhenZooming: false, attribution: 'Terrain drawn from MOLA heights (USGS, NASA PDS)' }).addTo(map);

// Picture layers. Formats and the deepest level of each were checked against the servers (WMTSCapabilities.xml, MapServer?f=json).
// Viking and MOLA pictures end at level 7 (about 325 m per pixel): past zoom 9 they are hidden and the terrain map shows.
// NASA's server sometimes drops a connection, so a failed tile is tried again twice.
const trek = name => `https://trek.nasa.gov/tiles/Mars/EQ/${name}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`;
const T = { crossOrigin: true, keepBuffer: 4, updateWhenZooming: false };
const retry = layer => layer.on('tileerror', ({ tile }) => {
  if ((tile.tries = (tile.tries || 0) + 1) <= 2) setTimeout(() => { const src = tile.src; tile.src = ''; tile.src = src; }, 700 * tile.tries);
});
// Real colour: Viking orbiter red and violet filter images (synthetic green), USGS MDIM 2.1 colour mosaic
const viking = retry(L.tileLayer(trek('Mars_Viking_MDIM21_ClrMosaic_global_232m'), { ...T, maxNativeZoom: 7, maxZoom: 9, attribution: 'NASA Mars Trek, USGS Viking MDIM 2.1 colour' }));
const mola = retry(L.tileLayer(trek('Mars_MGS_MOLA_ClrShade_merge_global_463m'), { ...T, maxNativeZoom: 7, maxZoom: 9, attribution: 'NASA Mars Trek, USGS MOLA' }));
// Base map buttons
const BASES = {
  viking: { label: 'Colour', title: 'Mars in its own colours: Viking orbiter mosaic', layers: [viking], top: 9 },
  mola: { label: 'Elevation', title: 'Elevation in colour: MGS MOLA', layers: [mola], top: 9 },
  terrain: { label: 'Terrain', title: 'Shaded relief and contour lines drawn from measured MOLA heights. No gaps; works offline.', layers: [], top: 13 },
};
let base = 'viking', molaOn = false;
$('bases').innerHTML = Object.entries(BASES).map(([k, b]) => `<button data-base="${k}" title="${b.title}">${b.label}</button>`).join('');
$('bases').onclick = e => e.target.dataset.base && setBase(e.target.dataset.base);
function setBase(k) {
  BASES[base].layers.forEach(l => l.remove());
  base = k;
  BASES[k].layers.forEach(l => l.addTo(map));
  for (const b of $('bases').children) b.classList.toggle('on', b.dataset.base === k);
  molaOn = k === 'mola';
  $('cbar').hidden = !molaOn;
  zoomNotes();
}
function zoomNotes() {
  const z = Math.round(map.getZoom()), past = z > BASES[base].top;
  $('baseNote').hidden = !past;
  if (past) $('baseNote').textContent = `${BASES[base].label} ends at this zoom: showing Terrain`;
  const c = $('contours'), s = contourStep(z, mode === 'sector' && z >= 5);
  if (c) c.textContent = base === 'terrain' || past ? `Terrain: contour lines every ${s.toLocaleString('en')} m, darker every ${(5 * s).toLocaleString('en')} m.` : '';
}
map.on('zoomend', zoomNotes);

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
let globe = null, cbar = null;
fetch('data/mola_global.json').then(r => r.json()).then(async g => {
  globe = { ...g, h: unpack(new Int16Array(await (await fetch('data/mola_global.i16')).arrayBuffer()), g.packed) };
  grids.coarse = { h: globe.h, rows: g.rows, cols: g.cols, bounds: [-90, 90, -180, 180] };
  terrain.redraw();
  const st = g.colorbar, lo = st[0][0], hi = st.at(-1)[0], pct = z => (100 * (z - lo)) / (hi - lo);
  cbar = { lo, hi, pct };
  $('cbarBar').style.background = `linear-gradient(90deg, ${st.map(([z, r, gr, b]) => `rgb(${r},${gr},${b}) ${pct(z).toFixed(1)}%`).join(', ')})`;
  const ticks = [];
  for (let z = Math.ceil(lo / 2000) * 2000; z <= hi; z += 2000) ticks.push(`<span style="left:${pct(z)}%">${z / 1000}</span>`);
  $('cbarTicks').innerHTML = ticks.join('');
}).catch(() => {});
map.createPane('sectorLines').style.zIndex = 450;
map.createPane('sectorMarks').style.zIndex = 620;
const showSector = on => ['sectorLines', 'sectorMarks'].forEach(k => (map.getPane(k).style.display = on ? '' : 'none'));
showSector(false);
const inSector = { pane: 'sectorMarks' };

for (const s of named)
  L.marker([s.lat, s.lon], { ...inSector, icon: icon(SYM[s.ref ? 'ref' : s.poi ? 'poi' : 'site'] + `<b>${s.code || s.name.split(',')[0]}</b>`) })
    .bindPopup(() => whatsHere([s.lat, s.lon], `${s.code} ${s.name}`, `<small>${s.source}</small>` +
      (s.source.match(/ESP_\d{6}_\d{4}/g) || []).map(id => `<br><a href="https://www.uahirise.org/${id}" target="_blank" rel="noopener">See it up close: HiRISE ${id}</a>`).join(''))).addTo(map);

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
let mode = 'world', ready = false, meta, h, s, worker, layers = {}, hazards = {}, targets = { ice: [], mineral: [], sites: [] }, overlays = {}, places = sitePlaces;
const dataReady = (async () => {
  meta = await fetch('data/dem.json').then(r => r.json()).catch(() => null);
  if (!meta) return;
  const bin = f => fetch(`data/${f}.i16`).then(r => r.arrayBuffer()).then(b => unpack(new Int16Array(b), meta.packed[f]));
  [h, s] = await Promise.all([bin('dem'), bin('slope')]);
  grids.fine = { h, rows: meta.rows, cols: meta.cols, bounds: meta.bounds };
  terrain.redraw();
  layers = Object.fromEntries(await Promise.all((meta.layers || []).map(async n => [n, await bin(n)])));
  hazards = hazardGrids(layers);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ h, s, meta, layers });
  const [a, b, c, d] = meta.bounds;
  L.rectangle([[a, c], [b, d]], { pane: 'sectorLines', color: '#000', weight: 1.5, dashArray: '5 4', fill: false, interactive: false }).addTo(map);
  // Data layers drawn from the grid, switched on in the map key. Each image is only drawn the first time it is shown.
  const overlay = (grid, rgba) => {
    const layer = L.imageOverlay(BLANK, [[a, c], [b, d]], { pane: 'sectorLines' });
    layer.once('add', () => {
      const cv = Object.assign(document.createElement('canvas'), { width: meta.cols, height: meta.rows }), g = cv.getContext('2d');
      const img = g.createImageData(meta.cols, meta.rows), px = new Uint32Array(img.data.buffer);
      for (let i = 0; i < grid.length; i++) { const [r, gr, bl, al] = rgba(grid[i]); px[i] = (al << 24) | (bl << 16) | (gr << 8) | r; }
      g.putImageData(img, 0, 0);
      cv.toBlob(blob => layer.setUrl(URL.createObjectURL(blob)));
    });
    return layer;
  };
  if (layers.ice) overlays.ice = overlay(layers.ice, v => (v > 0 ? [47, 111, 214, Math.min(1, v / 0.35) * 190] : [0, 0, 0, 0]));
  if (layers.pyroxene) overlays.mineral = overlay(layers.pyroxene, v => (v > 0 ? [224, 160, 32, Math.min(1, 0.35 + (v - 0.01) / 0.03) * 210] : [0, 0, 0, 0]));
  if (hazards.loose) overlays.loose = overlay(hazards.loose, v => [176, 104, 40, v * 170]);
  if (hazards.crater) overlays.crater = overlay(hazards.crater, v => [0, 0, 0, v > 0.3 ? v * 200 : 0]);

  // Objectives. Ice: the strongest SWIM spots, one per patch. Minerals: the strongest OMEGA pyroxene detections
  // (scripts/fetch_omega.py), plus any sites in sites.json marked "mineral". Sites: landing sites and points of interest.
  const inBox = ([la, lo]) => la >= a && la <= b && lo >= c && lo <= d;
  if (layers.ice) targets.ice = peaks(layers.ice, meta, { min: 0.3, sepKm: 50, margin: 8 }).map((t, k) =>
    ({ label: `I${k + 1} · Ice deposit ${k + 1}`, code: `I${k + 1}`, ll: t.ll, sym: SYM.iceTarget, detail: `ice score ${t.value.toFixed(2)}`, group: 'Ice deposits' }));
  targets.mineral = [
    ...(layers.pyroxene ? peaks(layers.pyroxene, meta, { min: 0.02, sepKm: 25, margin: 8 }).map(t =>
      ({ name: 'Pyroxene exposure', ll: t.ll, detail: `pyroxene index ${t.value.toFixed(3)}` })) : []),
    ...named.filter(x => x.mineral && inBox([x.lat, x.lon])).map(x => ({ name: x.name, ll: [x.lat, x.lon], detail: x.mineral })),
  ].map((x, k) => ({ ...x, label: `M${k + 1} · ${x.name} ${k + 1}`, code: `M${k + 1}`, sym: SYM.mineral, group: 'Mineral exposures' }));
  targets.sites = sitePlaces.filter(x => inBox(x.ll)).map(x => ({ ...x, detail: '' }));
  for (const t of [...targets.ice, ...targets.mineral])
    L.marker(t.ll, { ...inSector, icon: icon(t.sym + `<b>${t.code}</b>`) }).bindPopup(() => whatsHere(t.ll, t.label, `${t.detail}<br>`)).addTo(map);
  places = [...sitePlaces, ...targets.ice, ...targets.mineral];
  $('find').innerHTML = options(places, 'Go to a place…');

  // Map key: data layers you can switch on, then the symbols
  const layerRow = (k, sym, text) => (overlays[k] ? `<label><input type="checkbox" data-ov="${k}"><span class="sym">${sym}</span>${text}</label>` : '');
  const row = (sym, text) => `<div class="row"><span class="sym">${sym}</span>${text}</div>`;
  $('key').querySelector('.rows').innerHTML = '<h4>Data layers (tick to show)</h4>'
    + layerRow('ice', SYM.ice, 'Ice likely within 1 m (SWIM)') + layerRow('mineral', SYM.mineral, 'Pyroxene detected (OMEGA)')
    + layerRow('loose', SYM.loose, 'Loose or dusty ground (TES)') + layerRow('crater', SYM.crater, 'Crater rims (Robbins catalog)')
    + '<h4>Symbols</h4>' + row(SYM.site, 'Candidate landing site') + row(SYM.poi, 'Point of interest')
    + row(SYM.iceTarget, 'Ice deposit (objective)') + (targets.mineral.length ? row(SYM.mineral, 'Pyroxene exposure (objective)') : '')
    + row(SYM.route, 'Selected route') + row(SYM.alt, 'Alternative route') + row(SYM.hazard, 'Steepest point on the route')
    + row(SYM.extent, 'Edge of the sector data') + '<p id="contours"></p><p>Right-click (or long-press) the map to measure any point.</p>';
  $('key').onchange = e => e.target.dataset.ov && showOverlay(e.target.dataset.ov, e.target.checked);
  $('looseRow').hidden = !hazards.loose;
  $('craterRow').hidden = !hazards.crater;
  ready = true;
})();
function showOverlay(k, on) {
  if (!overlays[k]) return;
  on ? overlays[k].addTo(map) : overlays[k].remove();
  $('key').querySelector(`[data-ov="${k}"]`).checked = on;
}
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
  const body = () => `<div class="tag">Sector · ${fmtLL([sec.lat, sec.lon], 1)}</div>
    <h2>${sec.name}</h2><span class="status ${sec.open ? 'open' : 'locked'}">${sec.open ? 'Open' : 'Preview'}</span><p>${sec.text}</p>
    ${sec.open && ready ? `<div class="grid">${stat(Math.round(AREA(meta.bounds) / 1000), 'k km²', 'Area mapped')}
      ${stat(targets.sites.length, '', 'Landing sites and stops')}${stat(targets.ice.length, '', 'Ice deposits')}
      ${stat(targets.mineral.length || '—', '', 'Mineral targets')}</div>` : ''}
    ${sec.open ? `<button id="enter" class="wide"${ready ? '' : ' disabled'}>${ready ? 'Enter sector' : 'Loading terrain…'}</button>`
      : `${sec.facts ? `<div class="grid">${sec.facts.map(f => stat(...f)).join('')}</div>` : ''}<button class="wide alt" disabled>Not mapped yet</button>`}`;
  card.innerHTML = body();
  map.flyTo([sec.lat, sec.lon], Math.max(map.getZoom(), 3), { duration: 0.8 });
  if (sec.open && !ready) { await dataReady; if (!card.hidden) card.innerHTML = body(); }
  $('enter')?.addEventListener('click', () => enterSector());
}

async function enterSector(animate = true) {
  await dataReady;
  if (!meta) return;
  const sec = SECTORS.find(x => x.open);
  mode = 'sector';
  document.body.classList.add('sector');
  $('card').hidden = $('hint').hidden = true;
  map.removeLayer(world);
  $('panel').hidden = $('back').hidden = $('find').hidden = $('key').hidden = false;
  $('crumb').innerHTML = `Mars / <b>${sec.name}</b>`;
  $('sectorName').textContent = sec.name;
  const [a, b, c, d] = meta.bounds, f = v => Math.abs(v);
  $('sectorWhere').textContent = `${f(a)}°N to ${f(b)}°N, ${f(c)}°W to ${f(d)}°W · ${Math.round(AREA(meta.bounds) / 1000)},000 km²`;
  showSector(true);
  map.invalidateSize({ animate: false });
  const box = L.latLngBounds([[a, c], [b, d]]);
  animate ? map.flyToBounds(box, { padding: [16, 16], duration: 1.6 }) : map.fitBounds(box, { padding: [16, 16] });
  setTab(tab);
}
function leaveSector() {
  mode = 'world';
  document.body.classList.remove('sector');
  pov?.close(); stopNav();
  showSector(false);
  map.closePopup();
  $('panel').hidden = $('back').hidden = $('find').hidden = $('key').hidden = $('nav').hidden = true;
  $('hint').hidden = false;
  $('crumb').innerHTML = '<b>Mars</b>';
  world.addTo(map);
  map.invalidateSize({ animate: false });
  map.flyTo(...WORLD_VIEW, { duration: 1.4 });
}
$('back').onclick = leaveSector;

// Cursor readout: position anywhere, plus a terrain scan inside the sector
let lastMove = null;
map.on('mousemove', e => { if (!lastMove) requestAnimationFrame(readout); lastMove = e; });
function readout() {
  const { lat, lng } = lastMove.latlng;
  lastMove = null;
  const i = cellOf([lat, lng]), fine = i >= 0;
  let z = fine ? h[i] : NaN;
  if (!fine && globe) z = globe.h[Math.min(globe.rows - 1, Math.floor((90 - lat) * globe.ppd)) * globe.cols + Math.min(globe.cols - 1, Math.floor((lng + 180) * globe.ppd))];
  let t = `<b>${fmtLL([lat, lng], 2)}</b>${Number.isFinite(z) ? `   elevation <b>${fine ? '' : '≈'}${Math.round(z).toLocaleString('en')} m</b>` : ''}`;
  if (fine) t += `\nslope <b>${s[i].toFixed(1)}°</b>${layers.ice ? `   ice score <b>${layers.ice[i].toFixed(2)}</b>` : ''}${layers.pyroxene?.[i] > 0 ? `   pyroxene <b>${layers.pyroxene[i].toFixed(3)}</b>` : ''}`;
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
  return `<b>${title}</b><br>${fmtLL(ll)}<br>${extra}${data}
    ${i < 0 ? '' : `<div class="here-btns"><button data-set="0" data-ll="${ll}">Start here</button><button data-set="1" data-ll="${ll}">Go here</button></div>`}`;
}
map.on('contextmenu', e => mode === 'sector' && L.popup().setLatLng(e.latlng).setContent(whatsHere([e.latlng.lat, e.latlng.lng])).openOn(map));
map.getContainer().addEventListener('click', e => {
  const btn = e.target.closest('[data-set]');
  if (!btn) return;
  e.stopPropagation();
  map.closePopup();
  place(+btn.dataset.set, btn.dataset.ll.split(',').map(Number));
}, true);

// Start (A) and destination (B)
const pts = [], pins = [];
function setPt(k, ll) {
  pts[k] = ll;
  pins[k]?.remove();
  pins[k] = L.marker(ll, { ...inSector, icon: icon(k ? 'B' : 'A', `pin ${k ? 'b' : 'a'}`, 18), zIndexOffset: 1000, draggable: true, title: 'Drag to move' })
    .on('dragend', e => { const q = e.target.getLatLng(); place(k, [q.lat, q.lng]); }).addTo(map);
  $('swap').hidden = !(pts[0] && pts[1]);
}
// Put A or B at a free point on the map (a click, a dragged pin, or a "What's here?" button)
function place(k, ll) {
  if (cellOf(ll) < 0) return msg('That point is outside the dashed sector box.');
  setPt(k, ll);
  if (k) { picked = null; tab = 'pin'; setTab(tab); } else { $('start').value = ''; $('start').options[0].textContent = `Map point · ${fmtLL(ll)}`; renderTargets(); }
  autoRoute();
}
const autoRoute = () => (pts[0] && pts[1] ? run(false) : msg(pts[0] ? 'Now choose a destination.' : pts[1] ? 'Now choose where to start.' : ''));
$('start').innerHTML = options(sitePlaces, 'Choose a landing site…');
$('start').onchange = e => {
  if (!e.target.value) return;
  $('start').options[0].textContent = 'Choose a landing site…';
  setPt(0, sitePlaces[e.target.value].ll); renderTargets(); autoRoute();
};
$('swap').onclick = () => {
  const [a, b] = pts;
  picked = null;
  setPt(0, b); setPt(1, a);
  $('start').value = ''; $('start').options[0].textContent = `Map point · ${fmtLL(b)}`;
  tab = 'pin'; setTab(tab); autoRoute();
};
// Go to a place: fly there and show what is measured at it
$('find').onchange = e => {
  const q = places[e.target.value];
  e.target.value = '';
  if (!q) return;
  map.setView(q.ll, Math.max(map.getZoom(), 8));
  L.popup().setLatLng(q.ll).setContent(whatsHere(q.ll, q.label)).openOn(map);
};

// Destination: pick a tab, then a target; the routes are found straight away
let tab = 'ice', picked = null;
const tabs = [...$('tabs').children];
tabs.forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
function setTab(k) {
  tab = k;
  tabs.forEach(b => b.classList.toggle('on', b.dataset.tab === k));
  // The Ice and Minerals tabs also show their map layer, so you can see what you are choosing between
  showOverlay('ice', k === 'ice'); showOverlay('mineral', k === 'mineral');
  renderTargets();
}
function renderTargets() {
  if (!meta) return;
  tabs.find(b => b.dataset.tab === 'mineral').classList.toggle('locked', !targets.mineral.length);
  const km = t => (pts[0] ? `${Math.round(haversine(...pts[0], ...t.ll) / 1000)} km away` : t.detail);
  const list = (arr, extra = '') => arr.map((t, i) => `<button class="target${picked === t ? ' on' : ''}" data-i="${i}">${t.sym}<span>${t.label}</span><small>${km(t)}</small></button>`).join('') + extra;
  const box = $('targets');
  box.innerHTML = tab === 'ice' ? list(targets.ice, layers.ice?.some(v => v >= ICE_MIN) ? `<button id="ice" class="alt wide"${pts[0] ? '' : ' disabled title="Choose a start first"'}>Nearest reachable ice from the start</button>` : '')
    : tab === 'mineral' ? (targets.mineral.length ? list(targets.mineral) : '<p class="box"><b>No mineral survey</b>No mineral map is loaded for this sector.</p>')
    : tab === 'sites' ? list(targets.sites)
    : `<p class="box"><b>${pts[1] && !picked ? `Destination · ${fmtLL(pts[1])}` : 'Click the map'}</b>${pts[0] ? 'Click anywhere inside the dashed box to set the destination. Drag pin B to adjust it.' : 'The first click sets the start, the next sets the destination.'}</p>`;
  const arr = targets[tab] || [];
  box.querySelectorAll('.target').forEach(b => (b.onclick = () => { picked = arr[+b.dataset.i]; setPt(1, picked.ll); renderTargets(); autoRoute(); }));
  $('ice')?.addEventListener('click', () => run(true));
}

// Map clicks: the first sets the start, later ones the destination; in "add stops" mode they add science stops
let stopMode = false;
const stops = [], stopPins = [];
map.on('click', e => {
  if (mode !== 'sector') { if (!e.originalEvent.target.closest?.('.node')) { $('card').hidden = true; $('hint').hidden = false; } return; }
  const ll = [e.latlng.lat, e.latlng.lng];
  if (!stopMode) return place(pts[0] ? 1 : 0, ll);
  if (cellOf(ll) < 0) return;
  stops.push(ll);
  stopPins.push(L.marker(ll, { ...inSector, icon: icon(String(stops.length), 'pin stop', 18), zIndexOffset: 900 }).addTo(map));
  $('clearStops').hidden = false;
});
$('addStop').onclick = () => {
  stopMode = !stopMode;
  $('addStop').textContent = stopMode ? 'Done adding stops' : 'Add science stops';
  $('addStop').classList.toggle('on', stopMode);
  msg(stopMode ? 'Click the map to add stops between the start and the destination.' : '');
  if (!stopMode) rerun();
};
const dropStops = () => { stops.length = 0; stopPins.splice(0).forEach(m => m.remove()); $('clearStops').hidden = true; };
$('clearStops').onclick = () => { dropStops(); rerun(); };

// Routing: Safest, Balanced and Shortest alternatives, each over every leg (A, stops, B).
// The hazard sliders set the Safest penalties; Balanced uses half, Shortest none.
const ALTS = [
  { name: 'Safest', note: 'Strongest hazard avoidance', k: 0.1, f: 1 },
  { name: 'Balanced', note: 'Half the hazard penalty', k: 0.05, f: 0.5 },
  { name: 'Shortest', note: 'Shortest path under the slope limit', k: 0.01, f: 0 },
];
const ask = m => new Promise(res => { worker.onmessage = e => res(e.data); worker.postMessage(m); });
let routes = [], sel = 0, toIceMode = false, job = 0;
async function run(toIce) {
  if (!worker || !pts[0] || (!toIce && !pts[1])) return;
  const cells = (toIce ? [pts[0]] : [pts[0], ...stops, pts[1]]).map(q => latLonCell(meta, ...q));
  if (!toIce) history.replaceState(null, '', '#' + [pts[0], pts[1]].flat().map(v => v.toFixed(4)).join(','));
  const mine = ++job; // a newer request replaces this one
  msg(toIce ? 'Searching for the nearest likely ice…' : 'Finding routes…');
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
    if (mine !== job) return;
    if (path) found.push(measure({ ...alt, path, ends }));
  }
  // drop alternatives that came out (almost) the same as one already found
  routes = found.filter((r, i) => !found.slice(0, i).some(q => Math.abs(q.km - r.km) < 0.01 * r.km && Math.abs(q.loose - r.loose) < 0.02));
  toIceMode = toIce;
  sel = 0;
  msg(routes.length ? '' : toIce ? `No likely ice can be reached while staying under ${$('max').value}°. Allow a steeper slope in Route options.`
    : `No route stays under ${$('max').value}°. Allow a steeper slope in Route options, or pick other points.`);
  if (toIce && routes.length) { picked = null; setPt(1, routes[0].ll.at(-1)); tab = 'pin'; setTab(tab); }
  render();
  if (routes.length) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const rerun = () => (toIceMode && routes.length ? run(true) : autoRoute());
for (const [id, out, fmt] of [['max', 'maxv', v => `${v}°`], ['loose', 'loosev', v => `×${v}`], ['crater', 'craterv', v => `×${v}`]]) {
  $(id).oninput = e => ($(out).textContent = fmt(e.target.value));
  $(id).onchange = rerun;
}
$('clear').onclick = () => {
  job++; stopNav(); dropStops(); map.closePopup();
  pins.splice(0).forEach(m => m?.remove());
  pts.length = 0; picked = null; routes = [];
  $('start').value = ''; $('start').options[0].textContent = 'Choose a landing site…'; $('swap').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
  msg(''); render(); renderTargets();
};

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
function heading(a, b) { // true bearing in degrees clockwise from north, and its compass name
  const deg = bearingDeg(a, b);
  return { deg: String(Math.round(deg) % 360).padStart(3, '0'), name: compassWord(deg) };
}
const endName = k => (k === routes[sel].ends.length - 1 ? (toIceMode ? 'the likely ice' : 'B') : `stop ${k + 1}`);
function steps(r) {
  const { ll, cum, ends, idx } = r, out = [];
  const dirAt = j => { let k = j; while (k < ll.length - 1 && cum[k] - cum[j] < 400) k++; return heading(ll[j], ll[Math.max(k, Math.min(j + 1, ll.length - 1))]).name; };
  const minLen = Math.max(1000, cum.at(-1) / 12); // longer routes get longer steps
  let start = 0, cur = dirAt(0);
  for (let j = 1; j < ll.length; j++) {
    const atStop = ends.includes(j), d = j < ll.length - 1 ? dirAt(j) : cur;
    if ((d !== cur && cum[j] - cum[start] >= minLen) || atStop) {
      const prev = out.at(-1);
      // a step that heads the same way as the one before it (and did not end at a stop) is joined to it
      if (prev && !prev.arrive && prev.dir === cur) prev.to = j, prev.arrive = atStop ? endName(ends.indexOf(j)) : '';
      else out.push({ from: start, to: j, dir: cur, arrive: atStop ? endName(ends.indexOf(j)) : '' });
      start = j; cur = d;
    }
  }
  const hd = x => heading(ll[x.from], ll[x.to]);
  for (let k = out.length - 1; k > 0; k--) // join neighbours that head the same way end to end
    if (!out[k - 1].arrive && hd(out[k - 1]).name === hd(out[k]).name) out.splice(k - 1, 2, { ...out[k], from: out[k - 1].from });
  for (const x of out) { // heading, length and measured hazards of each step
    let ms = 0, lo = 0, rim = 0;
    for (let k = x.from; k <= x.to; k++) { const i = idx[k]; ms = Math.max(ms, s[i]); if (hazards.loose?.[i] > 0.5) lo++; if (hazards.crater?.[i] > 0.5) rim++; }
    x.text = `Head ${hd(x).name} (${hd(x).deg}°) for ${((cum[x.to] - cum[x.from]) / 1000).toFixed(1)} km`;
    x.notes = [ms >= 0.6 * +$('max').value && `slopes up to ${ms.toFixed(0)}°`, lo > (x.to - x.from) / 2 && 'mostly loose or dusty ground', rim && 'passes close to a crater rim'].filter(Boolean);
  }
  return out;
}

// Draw the routes and fill the result: cards, then Summary, Directions or Profile
let drawn = [], steep, chart, stepLine, view = 'summary';
const views = [...$('views').children];
views.forEach(b => (b.onclick = () => showView(b.dataset.view)));
function showView(k) {
  view = k;
  views.forEach(b => b.classList.toggle('on', b.dataset.view === k));
  $('summary').hidden = k !== 'summary'; $('dirBox').hidden = k !== 'dirs'; $('chartBox').hidden = k !== 'profile';
  chart?.destroy();
  const r = routes[sel];
  if (k !== 'profile' || !r) return;
  chart = new Chart($('profile'), {
    type: 'line',
    data: { datasets: [{ data: r.idx.map((i, j) => ({ x: r.cum[j] / 1000, y: h[i] })), pointRadius: 0, borderWidth: 2, borderColor: '#f04e23' }] },
    options: { animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${i[0].parsed.x.toFixed(1)} km from A`, label: i => `${i.parsed.y.toFixed(0)} m` } } },
      scales: { x: { type: 'linear', max: Math.ceil(r.km), grid: { display: false }, ticks: { includeBounds: false, callback: v => `${v} km` } },
        y: { ticks: { callback: v => `${v.toLocaleString('en')} m` } } } },
  });
}
function render() {
  drawn.forEach(l => l.remove()); steep?.remove(); stepLine?.remove(); drawn = [];
  pov?.close(); stopNav();
  $('result').hidden = !routes.length;
  if (!routes.length) return;
  const r = routes[sel];
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
    <small>${q.note}. Steepest ${q.maxS.toFixed(0)}°${hazards.loose ? `, ${Math.round(q.loose * 100)}% loose ground` : ''}${hazards.crater ? `, ${Math.round(q.rim * 100)}% crater rims` : ''}</small></button>`).join('');
  $('routes').querySelectorAll('.card').forEach(b => (b.onclick = () => { sel = +b.dataset.i; render(); }));
  // directions
  const st = steps(r);
  $('dirs').innerHTML = `<li class="ends">Start at A · ${fmtLL(r.ll[0])}</li>` + st.map((x, k) => `<li data-k="${k}"><b>${x.text}</b>${x.notes.length ? `<span class="warn">${x.notes.join(', ')}</span>` : ''}${x.arrive ? `<span>Arrive at ${x.arrive}</span>` : ''}</li>`).join('');
  $('dirs').querySelectorAll('li[data-k]').forEach(li => (li.onclick = () => {
    const x = st[+li.dataset.k], seg = r.ll.slice(x.from, x.to + 1);
    stepLine?.remove();
    stepLine = L.polyline(seg, { pane: 'sectorLines', color: '#000', weight: 6, opacity: 0.7 }).addTo(map);
    map.fitBounds(L.latLngBounds(seg).pad(0.5));
  }));
  // summary
  const r10 = v => Math.round(v / 10) * 10;
  const stat = (v, u, t, wide) => `<div class="stat${wide ? ' wide' : ''}"><b>${v}<small>${u}</small></b><span>${t}</span></div>`;
  $('summary').innerHTML = `<p class="kicker">${r.name} route, measured from MOLA elevation</p><div class="stats">
    ${stat(r.km.toFixed(1), 'km', 'Distance', true)}${stat(`${r10(r.gain)} / ${r10(r.loss)}`, 'm', 'Climb / descent')}
    ${stat(r.maxS.toFixed(0), '°', `Steepest slope ${SYM.hazard}`)}</div>
    <p class="kicker">Ground along the route, from orbiter measurements</p><div class="stats">
    ${hazards.loose ? stat(Math.round(100 * r.loose), '%', 'Loose or dusty ground (TES)') : ''}
    ${hazards.crater ? stat(Math.round(100 * r.rim), '%', 'On or near crater rims') : ''}
    ${r.unknown ? stat(Math.round(100 * r.unknown), '%', 'Over missing elevation data') : ''}
    ${toIceMode && layers.ice ? stat(layers.ice[r.idx.at(-1)].toFixed(2), '', 'Ice score at B (SWIM, -1 to +1)') : ''}</div>
    ${toIceMode ? `<p class="note">B is the nearest place where the SWIM ice score is ${ICE_MIN} or higher: the orbiter data there is consistent with ice within 1 m of the surface.</p>` : ''}
    <p class="note">Every step stays under ${$('max').value}° at 463 m resolution. Smaller hazards are not visible.</p>`;
  showView(view);
}

// Go: a marker plays the selected route from A to B in about a minute, showing the distance left, the heading
// and measured hazards in the next kilometre. It is a playback of the plan, not a position fix (Mars has no GPS).
// POV plays the same route from the traveller's own eyes, at a multiple of an assumed travel speed, and can be paused.
const PLAY_S = 60, POV_MULT = [10, 30, 100, 300, 1000];
let nav = null, view3d = null, pov = null;
function stopNav() {
  if (nav) cancelAnimationFrame(nav.raf), nav.me.remove(), view3d?.stop();
  nav = null;
  $('navGo').textContent = 'Go';
  $('nav').hidden = true;
}
// mult: index into POV_MULT for POV playback; left out for Go's fixed one-minute playback
function startNav(mult) {
  const r = routes[sel];
  if (!r) return;
  const total = r.cum.at(-1);
  map.closePopup();
  map.fitBounds(L.latLngBounds(r.ll).pad(0.15), { animate: false }); // the whole route stays in view during the playback
  nav = { me: L.marker(r.ll[0], { ...inSector, icon: icon('', 'me', 16), zIndexOffset: 2000 }).addTo(map), d: 0, last: 0, paused: false, mult };
  $('navGo').textContent = 'Stop';
  $('nav').hidden = false;
  const tick = now => {
    const dt = nav.last ? Math.min(0.25, (now - nav.last) / 1000) : 0;
    nav.last = now;
    const rate = nav.mult == null ? total / PLAY_S : ASSUMED_KMH / 3.6 * POV_MULT[nav.mult]; // metres of route per second
    if (!nav.paused) nav.d = Math.min(total, nav.d + dt * rate);
    const st = navState(r, nav.d, { h, s, hazards, maxSlope: +$('max').value }), { d, pos } = st;
    nav.me.setLatLng(pos.ll);
    $('nav').innerHTML = `<div class="next"><b>${(st.toNext / 1000).toFixed(1)}<small>km</small></b>
      <span>to ${endName(st.leg)}${d < total ? `, head ${compassWord(st.headingDeg)} (${String(Math.round(st.headingDeg) % 360).padStart(3, '0')}°)` : ''}</span></div>
      <div class="row"><span>${(d / 1000).toFixed(1)} of ${(total / 1000).toFixed(1)} km</span><span>Elevation ${Math.round(st.elev).toLocaleString('en')} m</span></div>
      ${st.warn ? `<div class="warn">Ahead: ${st.warn}</div>` : ''}
      ${st.arrived ? `<div class="row"><span>Arrived at ${endName(r.ends.length - 1)}. Playback of the plan, not GPS.</span></div>` : ''}`;
    view3d?.setProgress(d / total, $('nav').innerHTML);
    pov?.update({ ...st, toName: endName(st.leg), paused: nav.paused, mult: POV_MULT[nav.mult] });
    if (!st.arrived || pov) nav.raf = requestAnimationFrame(tick); // POV keeps listening so it can be replayed
    else { $('navGo').textContent = 'Go'; view3d?.stop(); }
  };
  nav.raf = requestAnimationFrame(tick);
}
$('navGo').onclick = () => (nav && $('navGo').textContent === 'Stop' ? stopNav() : (stopNav(), startNav()));

// POV: first-person playback with a head-up display. The route line is on the HUD map; arrows in the view show the way.
$('navPov').onclick = async () => {
  const r = routes[sel];
  if (!r || pov) return;
  stopNav();
  const local = cropGrid(h, meta, r.path, { minPad: 40 });
  const { openPOV } = await import('./pov.js');
  pov = openPOV(local.h, local.meta, local.cells, {
    cum: r.cum, ends: r.ends,
    onClose: () => { pov = null; stopNav(); $('nav').hidden = true; },
    onControl: a => {
      if (!nav) return;
      if (a === 'pause') { if (nav.d >= r.cum.at(-1)) nav.d = 0, nav.paused = false; else nav.paused = !nav.paused; }
      else nav.mult = Math.min(POV_MULT.length - 1, Math.max(0, nav.mult + (a === 'faster' ? 1 : -1)));
    },
  });
  startNav(1);
};

// Local 3D view: the terrain around the route at full resolution. Go plays the route there too.
$('v3d').onclick = async () => {
  const path = routes[sel]?.path;
  if (!path) return;
  const local = cropGrid(h, meta, path);
  view3d = (await import('./view3d.js')).open3D(local.h, local.meta, local.cells, {
    onGo: () => (stopNav(), startNav()), // the same playback drives the map and the 3D view
    onClose: () => (stopNav(), view3d = null),
  });
};

setBase('viking');
// Shareable link: #startLat,startLon,endLat,endLon opens the sector with that route
const q = location.hash.slice(1).split(',').map(Number);
if (q.length === 4 && q.every(Number.isFinite)) { await enterSector(false); place(0, q.slice(0, 2)); place(1, q.slice(2)); }
