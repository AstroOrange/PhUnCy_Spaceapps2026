import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { M_PER_DEG } from './geo.js';

const EXAG = 3, MAX_VERTS = 500;

// Height at fractional grid position (r, c), cell-centre coordinates.
export function bilinear(h, { rows, cols }, r, c) {
  r = Math.min(Math.max(r, 0), rows - 1); c = Math.min(Math.max(c, 0), cols - 1);
  const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, rows - 1), c1 = Math.min(c0 + 1, cols - 1), fr = r - r0, fc = c - c0;
  const v = (a, b) => h[a * cols + b];
  return (v(r0, c0) * (1 - fc) + v(r0, c1) * fc) * (1 - fr) + (v(r1, c0) * (1 - fc) + v(r1, c1) * fc) * fr;
}

// Real CTX imagery for the box, stitched from Mars Trek tiles and tinted Mars-red.
// Level 8 is skipped: around Erebus Montes the server returns one repeated placeholder tile there.
async function imagery({ bounds: [latMin, latMax, lonMin, lonMax] }) {
  let L = Math.min(11, Math.max(0, Math.round(Math.log2(2048 * 360 / ((lonMax - lonMin) * 1024)))));
  if (L === 8) L = 7;
  const deg = 180 / 2 ** L, px = 512 / deg;
  const x0 = Math.floor((lonMin + 180) / deg), x1 = Math.floor((lonMax + 180) / deg), y0 = Math.floor((90 - latMax) / deg), y1 = Math.floor((90 - latMin) / deg);
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round((lonMax - lonMin) * px), height: Math.round((latMax - latMin) * px) });
  const g = cv.getContext('2d');
  g.fillStyle = '#777'; g.fillRect(0, 0, cv.width, cv.height); // mosaic gaps
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push(new Promise(ok => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { g.drawImage(img, (x * deg - 180 - lonMin) * px, (90 - y * deg - latMax) * -px, 512, 512); ok(); };
    img.onerror = ok;
    img.src = `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${L}/${y}/${x}`;
  }));
  await Promise.all(jobs);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#f2b58e'; g.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function open3D(h, meta, path) {
  const { rows, cols, bounds: [latMin, latMax] } = meta;
  const W = (meta.bounds[3] - meta.bounds[2]) * M_PER_DEG * Math.cos((latMin + latMax) * Math.PI / 360) / 1000; // km
  const H = (latMax - latMin) * M_PER_DEG / 1000;
  const X = c => (c + 0.5) / cols * W - W / 2, Z = r => (r + 0.5) / rows * H - H / 2; // north = -z
  // For drawing only: unknown cells take the last known height (flat dark patch, not a fake pit)
  let hMin = Infinity, last = h.find(v => !Number.isNaN(v)) ?? 0;
  const hf = h.map(v => (Number.isNaN(v) ? last : (last = v)));
  for (const v of hf) if (v < hMin) hMin = v;
  const Y = v => (v - hMin) / 1000 * EXAG;

  // Terrain: downsampled heightmap, unknown cells darkened
  const step = Math.ceil(Math.max(rows, cols) / MAX_VERTS), nx = Math.floor((cols - 1) / step) + 1, ny = Math.floor((rows - 1) / step) + 1;
  const geo = new THREE.PlaneGeometry(1, 1, nx - 1, ny - 1), pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const k = i * nx + j, n = i * step * cols + j * step;
    pos.setXYZ(k, X(j * step), Y(hf[n]), Z(i * step));
    col.fill(Number.isNaN(h[n]) ? 0.3 : 1, k * 3, k * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#c4734a', roughness: 1 });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.castShadow = terrain.receiveShadow = true;
  imagery(meta).then(t => { mat.map = t; mat.color.set('#fff'); mat.needsUpdate = true; });

  const scene = new THREE.Scene(), size = Math.max(W, H);
  const sky = Object.assign(document.createElement('canvas'), { width: 2, height: 256 }), sg = sky.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256); // Martian daytime sky: dusky up high, butterscotch at the horizon
  grad.addColorStop(0, '#2b1b1a'); grad.addColorStop(0.55, '#9c6a4a'); grad.addColorStop(1, '#d9a679');
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(sky);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog('#c8946b', size * 0.6, size * 2.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * 12, size * 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6b4630', roughness: 1 }));
  floor.position.y = -0.05; // plain ground around the data area, fading into the haze
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(terrain, new THREE.HemisphereLight('#f3d1b0', '#3a2218', 0.9));
  const sun = new THREE.DirectionalLight('#fff1e0', 3.2); // low sun: long shadows show relief
  sun.position.set(-size, size * 0.25, size * 0.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, far: size * 4 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Route: smoothed, draped by bilinear heights, lifted a few metres above the ground
  if (path?.length > 1) {
    const ground = (r, c) => new THREE.Vector3(X(c), Y(bilinear(hf, meta, r, c)), Z(r));
    const keep = path.filter((_, i) => i % Math.max(2, step) === 0 || i === path.length - 1);
    const flat = new THREE.CatmullRomCurve3(keep.map(([r, c]) => new THREE.Vector3(c, 0, r)));
    const radius = size / 400;
    const pts = flat.getSpacedPoints(Math.min(2000, path.length * 3)).map(p => ground(p.z, p.x).add(new THREE.Vector3(0, radius + 0.005 * EXAG, 0)));
    const mat = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.6 });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, radius, 8), mat('#d32f2f')));
    for (const [p, c] of [[pts[0], '#ffffff'], [pts.at(-1), '#1d1c1a']]) { // survey stakes: A (start), B (end)
      const tall = size / 30, stake = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, tall), mat(c));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 2), mat(c));
      stake.position.copy(p).y += tall / 2;
      cap.position.copy(p).y += tall;
      scene.add(stake, cap);
    }
  }

  // Overlay, renderer, controls
  const box = document.createElement('div');
  box.id = 'view3d';
  box.innerHTML = `<button>Back to map</button><p>Heights from MOLA 463 m, exaggerated ${EXAG} times. Imagery from the CTX mosaic via NASA Mars Trek. Drag to orbit, scroll to zoom.</p>`;
  document.body.append(box);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(devicePixelRatio);
  box.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(45, 1, size / 1000, size * 5);
  camera.position.set(0, size * 0.42, size * 0.7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  addEventListener('resize', resize);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  box.querySelector('button').onclick = () => {
    renderer.setAnimationLoop(null); renderer.dispose(); removeEventListener('resize', resize); box.remove();
  };
}
