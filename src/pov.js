import * as THREE from 'three';
import { M_PER_DEG } from './geo.js';
import { imagery } from './view3d.js';
import { ASSUMED_KMH, compassWord, etaSeconds, fmtDuration } from './nav.js';
import { createLook, headingOf, wrap } from './look.js';
import { isTouch, MOTION_HELP } from './motion.js';

// POV mode: the camera is the traveller. It moves along the planned route by itself (driven by the same playback as Go);
// the viewer only chooses where to look. There is no route line in the view: floating arrows show the way and the
// route line is on the HUD map. Units are metres; x = east, z = south, y = up.

const MAX_VERTS = 400000;
const ORANGE = '#f04e23';
// Two camera heights. Hover is drawn taller than life so the 463 m terrain grid reads as relief; Eye is true scale.
const MODES = {
  hover: { label: 'Hover', eye: 30, ex: 3, gap: 60, size: 18, lift: 4, tilt: 0.3, fog: [10000, 50000] },
  eye: { label: 'Eye level', eye: 1.7, ex: 1, gap: 7, size: 2, lift: 0.3, tilt: 0.2, fog: [5000, 40000] },
};
const ARROWS = 7, AHEAD = 1200, BEACON_FAR = 12000; // arrows shown ahead; metres of route used to judge the direction of travel

// cells = the route's [row, col] steps inside this (cropped) grid; cum = metres from the start at each step;
// ends = step index where each leg finishes. onControl('pause' | 'faster' | 'slower') asks the playback to change.
// motion = a motionPermission() promise started by the tap that opened POV (phones), so look-around by turning the
// phone starts straight away.
export function openPOV(h, meta, cells, { cum, ends, motion, onClose, onControl }) {
  const { rows, cols, bounds: [latMin, latMax, lonMin, lonMax] } = meta, total = cum.at(-1);
  const W = (lonMax - lonMin) * M_PER_DEG * Math.cos((latMin + latMax) * Math.PI / 360), H = (latMax - latMin) * M_PER_DEG;
  const X = c => (c + 0.5) / cols * W - W / 2, Z = r => (r + 0.5) / rows * H - H / 2; // north = -z
  // Unknown cells take the last known height (as in the 3D view); heights are measured from the start of the route
  let last = h.find(v => !Number.isNaN(v)) ?? 0, hMin = Infinity;
  const hf = h.map(v => (Number.isNaN(v) ? last : (last = v)));
  for (const v of hf) if (v < hMin) hMin = v;
  const h0 = hf[cells[0][0] * cols + cells[0][1]];

  // Terrain mesh, thinned only if the area is very large
  const step = Math.max(1, Math.ceil(Math.sqrt(rows * cols / MAX_VERTS))), nx = Math.floor((cols - 1) / step) + 1, ny = Math.floor((rows - 1) / step) + 1;
  const geo = new THREE.PlaneGeometry(1, 1, nx - 1, ny - 1), pos = geo.attributes.position, uv = geo.attributes.uv;
  const hv = (i, j) => hf[Math.min(i, ny - 1) * step * cols + Math.min(j, nx - 1) * step] - h0;
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const k = i * nx + j;
    pos.setXYZ(k, X(j * step), hv(i, j), Z(i * step));
    uv.setXY(k, (j * step + 0.5) / cols, 1 - (i * step + 0.5) / rows);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#755a57', roughness: 1 });
  const terrain = new THREE.Mesh(geo, mat);
  // Height of the drawn surface at grid position (r, c): the same two triangles per cell that the mesh uses,
  // so the camera and the arrows never sink below the ground they are drawn over
  const ground = (r, c) => {
    const y = Math.min(Math.max(r / step, 0), ny - 1), x = Math.min(Math.max(c / step, 0), nx - 1);
    const i = Math.min(Math.floor(y), ny - 2), j = Math.min(Math.floor(x), nx - 2), fr = y - i, fc = x - j;
    const a = hv(i, j), b = hv(i + 1, j), cc = hv(i + 1, j + 1), d = hv(i, j + 1);
    return fr + fc <= 1 ? a + (d - a) * fc + (b - a) * fr : cc + (b - cc) * (1 - fc) + (d - cc) * (1 - fr);
  };

  // The way: grid steps smoothed (moving average, display only) so the view does not zig-zag. One point per route step,
  // so a distance along the route maps to exactly the same place as on the map.
  const K = 6, way = cells.map((_, i) => {
    let r = 0, c = 0, n = 0;
    for (let j = Math.max(0, i - K); j <= Math.min(cells.length - 1, i + K); j++) { r += cells[j][0]; c += cells[j][1]; n++; }
    return [r / n, c / n];
  });
  way[0] = cells[0]; way[way.length - 1] = cells.at(-1);
  const posAt = d => {
    d = Math.min(total, Math.max(0, d));
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
    const f = Math.min(1, Math.max(0, (d - cum[lo - 1]) / (cum[lo] - cum[lo - 1] || 1)));
    const r = way[lo - 1][0] + (way[lo][0] - way[lo - 1][0]) * f, c = way[lo - 1][1] + (way[lo][1] - way[lo - 1][1]) * f;
    return { x: X(c), z: Z(r), g: ground(r, c) };
  };
  const headingAt = (d, span) => { // radians clockwise from north, or null where the route has ended
    const p = posAt(d), q = posAt(d + span);
    return Math.hypot(q.x - p.x, q.z - p.z) < 1 ? null : Math.atan2(q.x - p.x, p.z - q.z);
  };

  // Scene: sky dome and haze in the colours measured from Viking Lander 2's photo (as in the 3D view)
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#e4cbbd', ...MODES.hover.fog);
  const gradTex = (stops, w = 2, hgt = 256) => {
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: hgt }), g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, hgt);
    stops.forEach(([at, col]) => grad.addColorStop(at, col));
    g.fillStyle = grad; g.fillRect(0, 0, w, hgt);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50000, 32, 16),
    new THREE.MeshBasicMaterial({ map: gradTex([[0, '#d0bdae'], [0.5, '#e4cbbd'], [1, '#e4cbbd']]), side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1;
  const floorMat = new THREE.MeshStandardMaterial({ color: '#755a57', roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2), floorMat);
  const sun = new THREE.DirectionalLight('#fff1e0', 2.6);
  sun.position.set(-1, 0.35, 0.35);
  scene.add(dome, floor, terrain, new THREE.HemisphereLight('#e4cbbd', '#584649', 0.9), sun);

  // Holographic arrows: see-through chevrons with moving scan lines, placed along the way ahead
  const chevron = s => new THREE.ShapeGeometry(new THREE.Shape([[0, 0.5], [0.5, -0.1], [0.5, -0.5], [0, 0], [-0.5, -0.5], [-0.5, -0.1]]
    .map(([x, y]) => new THREE.Vector2(x * s, y * s)))).rotateX(-Math.PI / 2); // flat, pointing north
  const lines = gradTex(Array.from({ length: 16 }, (_, i) => [i / 16, i % 2 ? '#ffffff' : '#9a9a9a']), 2, 64);
  lines.wrapT = THREE.RepeatWrapping; lines.repeat.set(1, 5);
  const holo = (color, map) => new THREE.MeshBasicMaterial({ color, map, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const fillGeo = chevron(1), rimGeo = chevron(1.22);
  const arrows = Array.from({ length: ARROWS }, () => {
    const g = new THREE.Group(), rim = new THREE.Mesh(rimGeo, holo('#ffffff')), fill = new THREE.Mesh(fillGeo, holo(ORANGE, lines));
    rim.position.y = -0.02; rim.renderOrder = 1; fill.renderOrder = 2;
    g.add(rim, fill); g.rotation.order = 'YXZ';
    scene.add(g);
    return { g, rim: rim.material, fill: fill.material };
  });
  // Beacon: a see-through column of light over the next stop (or the end)
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0),
    holo(ORANGE, gradTex([[0, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0.9)']])));
  scene.add(beacon);

  // Overlay and HUD
  const box = document.createElement('div');
  box.id = 'pov';
  box.innerHTML = `<i class="pv-ret"></i>
    <button class="pv-back alt">Back to map</button>
    <div class="pv pv-compass"><canvas></canvas><b></b></div>
    <canvas class="pv-map" title="Route map. Click to enlarge (M)"></canvas>
    <div class="pv-edge l" hidden>&#9664; Route</div><div class="pv-edge r" hidden>Route &#9654;</div>
    <div class="pv-warn" hidden></div><div class="pv-msg" hidden></div>
    <div class="pv pv-trip"><div class="next"><b data-f="toNext"></b><span data-f="toName"></span></div>
      <div class="row"><span data-f="left"></span></div><div class="row"><span data-f="eta"></span></div></div>
    <div class="pv pv-ground"><div><b data-f="elev"></b><span>Elevation</span></div><div><b data-f="slope"></b><span>Slope here</span></div>
      <div><b data-f="climb"></b><span>Climb left</span></div></div>
    <div class="pv-bottom"><div class="pv-prog"><i></i>${ends.slice(0, -1).map(e => `<u style="left:${100 * cum[e] / total}%"></u>`).join('')}</div>
      <div class="pv-ctl"><button data-a="pause">Pause</button><button data-a="slower" class="alt" aria-label="Slower">&minus;</button>
      <output data-f="mult" title="Playback speed, as a multiple of the assumed ${ASSUMED_KMH} km/h"></output>
      <button data-a="faster" class="alt" aria-label="Faster">+</button><button data-a="height" class="alt"></button>
      <button data-a="center" class="alt">Recentre</button><button data-a="gyro" class="alt" hidden>Use motion</button><span class="pv-note"></span></div></div>`;
  document.body.append(box);
  const f = Object.fromEntries([...box.querySelectorAll('[data-f]')].map(el => [el.dataset.f, el]));
  const btn = a => box.querySelector(`[data-a="${a}"]`), q = sel => box.querySelector(sel);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.className = 'gl';
  box.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 60000);
  const look = createLook(renderer.domElement);

  // HUD map: the area's imagery with the whole route line, A, stops and B; the moving dot and view cone are drawn each frame
  const mapCv = q('.pv-map'), mg = mapCv.getContext('2d'), still = document.createElement('canvas');
  let photo = null, big = false, fit = null;
  function sizeMap() {
    const boxPx = big ? Math.min(innerWidth, innerHeight) * 0.72 : innerWidth < 760 ? 120 : 220, asp = W / H;
    const w = asp >= 1 ? boxPx : Math.max(boxPx * asp, boxPx * 0.45), hh = asp >= 1 ? Math.max(boxPx / asp, boxPx * 0.45) : boxPx, dpr = Math.min(devicePixelRatio, 2);
    mapCv.style.width = `${w}px`; mapCv.style.height = `${hh}px`;
    mapCv.width = still.width = Math.round(w * dpr); mapCv.height = still.height = Math.round(hh * dpr);
    const sc = Math.min(mapCv.width / W, mapCv.height / H);
    fit = { sc, ox: (mapCv.width - W * sc) / 2, oy: (mapCv.height - H * sc) / 2, dpr };
    const g = still.getContext('2d'), px = ([r, c]) => [fit.ox + (c + 0.5) / cols * W * sc, fit.oy + (r + 0.5) / rows * H * sc];
    g.fillStyle = '#584649'; g.fillRect(0, 0, still.width, still.height);
    if (photo) g.drawImage(photo, fit.ox, fit.oy, W * sc, H * sc);
    g.lineJoin = g.lineCap = 'round';
    for (const [col, wd] of [['#fff', 5], [ORANGE, 2.5]]) {
      g.beginPath(); cells.forEach((cell, i) => g[i ? 'lineTo' : 'moveTo'](...px(cell)));
      g.strokeStyle = col; g.lineWidth = wd * dpr; g.stroke();
    }
    [0, ...ends].forEach((e, k) => { // A white, stops orange, B black
      const [x, y] = px(cells[e]);
      g.beginPath(); g.arc(x, y, 4.5 * dpr, 0, 7);
      g.fillStyle = k === 0 ? '#fff' : k === ends.length ? '#000' : ORANGE; g.fill();
      g.strokeStyle = k === ends.length ? '#fff' : '#000'; g.lineWidth = dpr; g.stroke();
    });
  }
  function drawMap(p, heading) {
    const { sc, ox, oy, dpr } = fit, x = ox + (p.x + W / 2) * sc, y = oy + (p.z + H / 2) * sc;
    mg.drawImage(still, 0, 0);
    mg.beginPath(); mg.moveTo(x, y); mg.arc(x, y, 30 * dpr, heading - Math.PI / 2 - 0.5, heading - Math.PI / 2 + 0.5); mg.closePath();
    mg.fillStyle = 'rgba(255,255,255,.45)'; mg.fill();
    mg.beginPath(); mg.arc(x, y, 5 * dpr, 0, 7);
    mg.fillStyle = ORANGE; mg.fill(); mg.strokeStyle = '#fff'; mg.lineWidth = 2 * dpr; mg.stroke();
  }
  // Compass tape: the direction being looked at in the middle, an orange mark for the direction of travel
  const tape = q('.pv-compass canvas'), tg = tape.getContext('2d'), CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function drawCompass(view, travel) {
    const dpr = Math.min(devicePixelRatio, 2), w = tape.clientWidth * dpr, hh = tape.clientHeight * dpr;
    if (tape.width !== w || tape.height !== hh) { tape.width = w; tape.height = hh; }
    const deg = THREE.MathUtils.radToDeg(view), per = w / 100; // 100 degrees across
    tg.clearRect(0, 0, w, hh);
    tg.fillStyle = tg.strokeStyle = '#fff'; tg.lineWidth = dpr; tg.textAlign = 'center'; tg.font = `700 ${11 * dpr}px Archivo, Arial, sans-serif`;
    for (let a = Math.ceil((deg - 50) / 5) * 5; a <= deg + 50; a += 5) {
      const x = w / 2 + (a - deg) * per, n = ((a % 360) + 360) % 360, major = n % 45 === 0;
      tg.beginPath(); tg.moveTo(x, hh); tg.lineTo(x, hh - (major ? 9 : n % 15 === 0 ? 6 : 3) * dpr); tg.stroke();
      if (major) tg.fillText(CARD[n / 45], x, 12 * dpr);
    }
    const off = Math.max(-48, Math.min(48, THREE.MathUtils.radToDeg(wrap(travel - view)))), x = w / 2 + off * per;
    tg.fillStyle = ORANGE;
    tg.beginPath(); tg.moveTo(x, hh - 11 * dpr); tg.lineTo(x - 5 * dpr, hh - 19 * dpr); tg.lineTo(x + 5 * dpr, hh - 19 * dpr); tg.fill();
    tg.fillStyle = '#fff'; tg.fillRect(w / 2 - dpr, 0, 2 * dpr, hh);
    const n = ((Math.round(deg) % 360) + 360) % 360;
    q('.pv-compass b').textContent = `${String(n).padStart(3, '0')}° ${compassWord(n)}`;
  }

  imagery(meta).then(({ tex, avg }) => {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mat.map = tex; mat.color.set('#fff'); mat.needsUpdate = true;
    floorMat.color.copy(avg);
    photo = tex.image; sizeMap();
  });

  // Controls
  let mode = 'hover', st = null, open = true;
  const setMode = m => {
    mode = m;
    btn('height').textContent = `Height: ${MODES[m].label}`;
    q('.pv-note').textContent = `Heights: MOLA, one sample every 463 m${MODES[m].ex > 1 ? `, drawn ${MODES[m].ex} times taller in Hover` : ', true scale'}. Imagery: CTX mosaic. A playback of the plan, not a position fix.`;
  };
  setMode('hover');
  const act = {
    pause: () => onControl?.('pause'), faster: () => onControl?.('faster'), slower: () => onControl?.('slower'),
    height: () => setMode(mode === 'hover' ? 'eye' : 'hover'),
    center: () => look.recenter(),
    map: () => { big = !big; mapCv.classList.toggle('big', big); sizeMap(); },
    async gyro(asked) {
      if (look.gyroOn) { look.disableGyro(); btn('gyro').textContent = 'Use motion'; return; }
      const res = await look.enableGyro(asked);
      if (!open) return;
      btn('gyro').textContent = res === 'on' ? 'Motion on' : 'Use motion';
      say(res === 'on' ? 'Turn the phone to look around. Recentre makes the way you are facing straight ahead.' : MOTION_HELP[res], res === 'on' ? 5000 : 12000);
    },
  };
  let msgTimer;
  function say(text, ms) { // a short notice in the middle of the view
    const el = q('.pv-msg');
    el.textContent = text; el.hidden = false;
    clearTimeout(msgTimer); msgTimer = setTimeout(() => (el.hidden = true), ms);
  }
  box.querySelectorAll('[data-a]').forEach(b => (b.onclick = () => { act[b.dataset.a](); b.blur(); }));
  mapCv.onclick = act.map;
  btn('gyro').hidden = !isTouch();
  const KEY = { ' ': 'pause', '[': 'slower', '-': 'slower', ']': 'faster', '=': 'faster', '+': 'faster', h: 'height', c: 'center', m: 'map' };
  const onKey = e => {
    if (e.key === 'Escape') return api.close();
    const a = KEY[e.key.toLowerCase()];
    if (a) { act[a](); e.preventDefault(); }
  };
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.fov = camera.aspect < 1 ? 90 : 70; camera.updateProjectionMatrix(); sizeMap(); }; // taller view on upright phones
  resize();
  addEventListener('resize', resize);
  addEventListener('keydown', onKey);

  // Each frame: put the camera at the traveller, turn it, and place the arrows ahead
  const clock = new THREE.Clock();
  let ex = MODES.hover.ex, eye = MODES.hover.eye, travel = headingAt(0, AHEAD) ?? 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime, m = MODES[mode], ease = 1 - Math.exp(-dt * 4);
    ex += (m.ex - ex) * ease; eye += (m.eye - eye) * ease;
    scene.fog.near += (m.fog[0] - scene.fog.near) * ease; scene.fog.far += (m.fog[1] - scene.fog.far) * ease;
    terrain.scale.y = ex; floor.position.y = (hMin - h0) * ex - 5;
    const d = st?.d ?? 0, p = posAt(d), want = headingAt(d, AHEAD);
    if (want != null) travel += wrap(want - travel) * (1 - Math.exp(-dt * 3));
    camera.position.set(p.x, p.g * ex + eye, p.z);
    look.apply(camera, travel, dt);
    dome.position.copy(camera.position);

    const first = (Math.floor(d / m.gap) + 1) * m.gap;
    lines.offset.y = -t * 0.6; // scan lines run toward the tip
    arrows.forEach((a, k) => {
      const da = first + k * m.gap, dir = headingAt(da, Math.max(m.gap, 400));
      a.g.visible = da < total && dir != null;
      if (!a.g.visible) return;
      const ap = posAt(da), near = (da - d) / m.gap;
      a.g.position.set(ap.x, ap.g * ex + m.lift, ap.z);
      a.g.rotation.set(m.tilt, -dir, 0);
      a.g.scale.setScalar(m.size);
      const o = Math.min(1, near / 0.6) * (1 - near / (ARROWS + 1)) ** 1.5 * (0.6 + 0.4 * Math.sin(t * 5 - near * 1.1)); // fade in and out, pulse forward
      a.fill.opacity = 0.9 * o; a.rim.opacity = 0.5 * o;
    });
    // The beacon stands over the next stop; a stop too far to draw is shown in its direction, at a fixed distance
    const leg = st ? Math.max(0, st.leg) : 0, bp = posAt(cum[ends[leg]]), gone = Math.hypot(bp.x - p.x, bp.z - p.z), far = Math.min(gone, BEACON_FAR), pull = far / (gone || 1);
    beacon.position.set(p.x + (bp.x - p.x) * pull, (gone > BEACON_FAR ? p.g : bp.g) * ex, p.z + (bp.z - p.z) * pull);
    beacon.scale.set(Math.max(1, far * 0.01), Math.max(30, far * 0.12), Math.max(1, far * 0.01));
    beacon.material.opacity = 0.5 + 0.2 * Math.sin(t * 2);

    const view = headingOf(camera.quaternion), offRoute = wrap(travel - view);
    q('.pv-edge.l').hidden = !(offRoute < -0.9); q('.pv-edge.r').hidden = !(offRoute > 0.9);
    drawCompass(view, travel);
    if (fit) drawMap(p, view);
    renderer.render(scene, camera);
  });

  const api = {
    // st = navState() from the playback, plus toName (where the current leg ends), paused and mult (playback multiplier)
    update(s) {
      st = s;
      const km = v => `${(v / 1000).toFixed(1)}<small>km</small>`;
      f.toNext.innerHTML = km(s.toNext);
      f.toName.textContent = s.arrived ? `Arrived at ${s.toName}` : `to ${s.toName}`;
      f.left.textContent = `${(s.left / 1000).toFixed(1)} km left of ${(s.total / 1000).toFixed(1)} km`;
      f.eta.textContent = s.arrived ? '' : `About ${fmtDuration(etaSeconds(s.left))} left at an assumed ${ASSUMED_KMH} km/h`;
      f.elev.innerHTML = `${Math.round(s.elev).toLocaleString('en')}<small>m</small>`;
      f.slope.textContent = `${s.slope.toFixed(0)}°`;
      f.climb.innerHTML = `${Math.round(s.climbLeft / 10) * 10}<small>m</small>`;
      f.mult.textContent = `×${s.mult}`;
      btn('pause').textContent = s.arrived ? 'Replay' : s.paused ? 'Play' : 'Pause';
      q('.pv-warn').hidden = !s.warn; q('.pv-warn').textContent = s.warn ? `Ahead: ${s.warn}` : '';
      q('.pv-prog i').style.width = `${100 * s.d / s.total}%`;
    },
    close() {
      if (!open) return;
      open = false; clearTimeout(msgTimer);
      renderer.setAnimationLoop(null); renderer.dispose(); look.dispose();
      removeEventListener('resize', resize); removeEventListener('keydown', onKey);
      box.remove(); onClose?.();
    },
  };
  q('.pv-back').onclick = api.close;
  if (motion) act.gyro(motion);
  return api;
}
