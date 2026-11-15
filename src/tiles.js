// Checks for the CTX imagery tiles used by the 3D view.
// The CTX map server sometimes returns the same picture for several different tile addresses (one crater repeated
// across the terrain) and sometimes a flat grey "no data" tile. A tile is dropped when it matches another tile from
// the same request, or when it is flat; the 3D view then shows lower-resolution imagery there instead.

export const FP = 48; // fingerprint size in pixels

// Fingerprint from RGBA pixels of a tile scaled down to FP x FP: brightness and which pixels have data.
export function fingerprint(rgba) {
  const gray = new Float32Array(FP * FP), alpha = new Uint8Array(FP * FP);
  for (let i = 0; i < FP * FP; i++) {
    gray[i] = (rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2]) / 3;
    alpha[i] = rgba[4 * i + 3] > 128 ? 1 : 0;
  }
  return { gray, alpha };
}

// Horizontal and vertical brightness steps: the texture of the ground, without slow light-to-dark trends,
// so two neighbouring tiles that are both darker on one side do not look alike.
function steps({ gray, alpha }) {
  const v = new Float32Array(2 * FP * FP), ok = new Uint8Array(2 * FP * FP);
  for (let r = 0; r < FP; r++) for (let c = 0; c < FP; c++) {
    const i = r * FP + c;
    if (c + 1 < FP && alpha[i] && alpha[i + 1]) { v[2 * i] = gray[i + 1] - gray[i]; ok[2 * i] = 1; }
    if (r + 1 < FP && alpha[i] && alpha[i + FP]) { v[2 * i + 1] = gray[i + FP] - gray[i]; ok[2 * i + 1] = 1; }
  }
  return { v, ok };
}

// Indices of tiles to drop: flat or empty tiles, and every tile whose texture matches another tile's.
export function badTiles(fps, { minCorr = 0.9, minShared = 0.2 } = {}) {
  const bad = new Set(), st = fps.map(f => (f ? steps(f) : null));
  fps.forEach((f, i) => {
    if (!f) return;
    let n = 0, s = 0, s2 = 0;
    for (let k = 0; k < f.gray.length; k++) if (f.alpha[k]) { n++; s += f.gray[k]; s2 += f.gray[k] ** 2; }
    if (n < 0.02 * f.gray.length || Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) < 0.6) bad.add(i); // nothing, or the server's uniform grey filler (smooth dusty plains are about 1.5, so they stay)
  });
  for (let a = 0; a < fps.length; a++) for (let b = a + 1; b < fps.length; b++) {
    if (!st[a] || !st[b] || (bad.has(a) && bad.has(b))) continue;
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    const A = st[a], B = st[b];
    for (let k = 0; k < A.v.length; k++) if (A.ok[k] && B.ok[k]) {
      n++; sa += A.v[k]; sb += B.v[k]; saa += A.v[k] ** 2; sbb += B.v[k] ** 2; sab += A.v[k] * B.v[k];
    }
    if (n < minShared * A.v.length) continue;
    const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    if (va > 0 && vb > 0 && cov / Math.sqrt(va * vb) > minCorr) { bad.add(a); bad.add(b); }
  }
  return bad;
}
