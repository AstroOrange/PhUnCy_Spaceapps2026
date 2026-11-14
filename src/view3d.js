import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { M_PER_DEG } from './geo.js';

const MAX_VERTS = 500;

// Height at fractional grid position (r, c), cell-centre coordinates.
export function bilinear(h, { rows, cols }, r, c) {
  r = Math.min(Math.max(r, 0), rows - 1); c = Math.min(Math.max(c, 0), cols - 1);
  const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, rows - 1), c1 = Math.min(c0 + 1, cols - 1), fr = r - r0, fc = c - c0;
  const v = (a, b) => h[a * cols + b];
  return (v(r0, c0) * (1 - fc) + v(r0, c1) * fc) * (1 - fr) + (v(r1, c0) * (1 - fc) + v(r1, c1) * fc) * fr;
}

// Real CTX imagery for the box, stitched from Mars Trek tiles and tinted Mars-red. Also returns its average colour.
// Level 8 is skipped: around Erebus Montes the server returns one repeated placeholder tile there.
async function imagery({ bounds: [latMin, latMax, lonMin, lonMax] }) {
  let L = Math.min(11, Math.max(0, Math.floor(Math.log2(4096 * 360 / ((lonMax - lonMin) * 1024))))); // floor: texture stays within 4096 px
  if (L === 8) L = 7;
  const deg = 180 / 2 ** L, px = 512 / deg;
  const x0 = Math.floor((lonMin + 180) / deg), x1 = Math.floor((lonMax + 180) / deg), y0 = Math.floor((90 - latMax) / deg), y1 = Math.floor((90 - latMin) / deg);
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round((lonMax - lonMin) * px), height: Math.round((latMax - latMin) * px) });
  const g = cv.getContext('2d');
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, cv.width, cv.height); // mosaic gaps
  await Promise.all([...Array((y1 - y0 + 1) * (x1 - x0 + 1)).keys()].map(i => new Promise(ok => {
    const x = x0 + i % (x1 - x0 + 1), y = y0 + Math.floor(i / (x1 - x0 + 1)), img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { g.drawImage(img, (x * deg - 180 - lonMin) * px, (90 - y * deg - latMax) * -px, 512, 512); ok(); };
    img.onerror = ok;
    img.src = `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${L}/${y}/${x}`;
  })));
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#f2b58e'; g.fillRect(0, 0, cv.width, cv.height);
  const one = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  one.drawImage(cv, 0, 0, 1, 1);
  const [r, gr, b] = one.getImageData(0, 0, 1, 1).data;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, avg: new THREE.Color(`rgb(${r},${gr},${b})`) };
}

export function open3D(h, meta, path) {
  const { rows, cols, bounds: [latMin, latMax] } = meta;
  const W = (meta.bounds[3] - meta.bounds[2]) * M_PER_DEG * Math.cos((latMin + latMax) * Math.PI / 360) / 1000; // km
  const H = (latMax - latMin) * M_PER_DEG / 1000;
  const X = c => (c + 0.5) / cols * W - W / 2, Z = r => (r + 0.5) / rows * H - H / 2; // north = -z
  // For drawing only: unknown cells take the last known height (flat dark patch, not a fake pit)
  let hMin = Infinity, last = h.find(v => !Number.isNaN(v)) ?? 0;
  const hf = h.map(v => (Number.isNaN(v) ? last : (last = v)));
  let hMax = -Infinity;
  for (const v of hf) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  // Vertical exaggeration: at least 3×, more on flat ground (up to 12×) so relief about 5% of the width stays visible
  const EXAG = Math.round(Math.min(12, Math.max(3, 0.05 * Math.max(W, H) * 1000 / Math.max(hMax - hMin, 1))));
  const Y = v => (v - hMin) / 1000 * EXAG;

  // Terrain: downsampled heightmap; edges ease down to the ground so there is no hard slab edge
  const step = Math.ceil(Math.max(rows, cols) / MAX_VERTS), nx = Math.floor((cols - 1) / step) + 1, ny = Math.floor((rows - 1) / step) + 1;
  const border = Math.max(4, Math.round(Math.min(nx, ny) * 0.12));
  const geo = new THREE.PlaneGeometry(1, 1, nx - 1, ny - 1), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const k = i * nx + j, n = i * step * cols + j * step;
    const e = Math.min(1, Math.min(i, ny - 1 - i, j, nx - 1 - j) / border), fade = e * e * (3 - 2 * e);
    pos.setXYZ(k, X(j * step), Y(hf[n]) * fade, Z(i * step));
    col.fill(Number.isNaN(h[n]) ? 0.3 : 1, k * 3, k * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#b07a55', roughness: 1 });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.castShadow = terrain.receiveShadow = true;

  const scene = new THREE.Scene(), size = Math.max(W, H);
  const sky = Object.assign(document.createElement('canvas'), { width: 2, height: 256 }), sg = sky.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256); // Martian daytime sky: dusky up high, butterscotch at the horizon
  grad.addColorStop(0, '#2b1b1a'); grad.addColorStop(0.55, '#9c6a4a'); grad.addColorStop(1, '#d9a679');
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(sky);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog('#c8946b', size * 0.9, size * 2.6);
  const floorMat = new THREE.MeshStandardMaterial({ color: '#b07a55', roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * 12, size * 12).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  scene.add(floor, terrain, new THREE.HemisphereLight('#f3d1b0', '#3a2218', 0.8));
  const sun = new THREE.DirectionalLight('#fff1e0', 3); // low sun: long shadows show relief
  sun.position.set(-size, size * 0.3, size * 0.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, far: size * 4 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Route: grid steps smoothed (moving average, display only), draped by bilinear heights, a few metres above ground
  let focus = new THREE.Box3(new THREE.Vector3(-W / 2, 0, -H / 2), new THREE.Vector3(W / 2, 0, H / 2));
  if (path?.length > 1) {
    const k = 6, smooth = path.map((_, i) => {
      let r = 0, c = 0, n = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(path.length - 1, i + k); j++) { r += path[j][0]; c += path[j][1]; n++; }
      return [r / n, c / n];
    });
    smooth[0] = path[0]; smooth[smooth.length - 1] = path.at(-1);
    const keep = smooth.filter((_, i) => i % 3 === 0 || i === smooth.length - 1);
    const flat = new THREE.CatmullRomCurve3(keep.map(([r, c]) => new THREE.Vector3(c, 0, r)));
    const radius = size / 900;
    const pts = flat.getSpacedPoints(Math.min(3000, path.length * 4))
      .map(p => new THREE.Vector3(X(p.x), Y(bilinear(hf, meta, p.z, p.x)) + radius + 0.01, Z(p.z)));
    const glow = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.5 });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, radius, 8), glow('#f04e23')));
    for (const [p, c] of [[pts[0], '#ffffff'], [pts.at(-1), '#111111']]) { // survey stakes: A (start), B (end)
      const tall = size / 35, stake = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, tall), glow(c));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 2.5), glow(c));
      stake.position.copy(p).y += tall / 2;
      cap.position.copy(p).y += tall;
      scene.add(stake, cap);
    }
    focus = new THREE.Box3().setFromPoints(pts);
  }

  // Overlay, renderer, controls
  const box = document.createElement('div');
  box.id = 'view3d';
  box.innerHTML = `<button>◀ Back to map</button><div class="tag3d">3D view · local area ${W.toFixed(0)} × ${H.toFixed(0)} km</div><p>Heights from MOLA 463 m, exaggerated ${EXAG} times. Imagery from the CTX mosaic via NASA Mars Trek. Route smoothed for display. Drag to orbit, scroll to zoom.</p>`;
  document.body.append(box);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  box.prepend(renderer.domElement);
  imagery(meta).then(({ tex, avg }) => {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // keeps the photo sharp at low viewing angles
    mat.map = tex; mat.color.set('#fff'); mat.needsUpdate = true;
    floorMat.color.copy(avg);
  });

  // Frame the route (or the whole area) from the south, about 30 degrees above the horizon
  const target = focus.getCenter(new THREE.Vector3()), reach = Math.max(focus.getSize(new THREE.Vector3()).length(), size * 0.25);
  const camera = new THREE.PerspectiveCamera(40, 1, size / 2000, size * 6);
  camera.position.set(target.x, target.y + reach * 0.6, target.z + reach * 1.15); // far enough back to see both ends
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.maxDistance = size * 2.5;
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  addEventListener('resize', resize);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  box.querySelector('button').onclick = () => {
    renderer.setAnimationLoop(null); renderer.dispose(); removeEventListener('resize', resize); box.remove();
  };
}
