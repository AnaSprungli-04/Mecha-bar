import * as THREE from 'three';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// fbm value-noise smoke puff, rendered to a canvas, wrapped as a CanvasTexture.
function paintSmoke(size, seed) {
  let s = seed || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  const grids = [];
  let n = 4;
  for (let o = 0; o < 5; o++) {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    grids.push({ n, g });
    n *= 2;
  }
  function sample(grid, n, x, y) {
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = grid[y0 * n + x0], b = grid[y0 * n + x1], c = grid[y1 * n + x0], d = grid[y1 * n + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let val = 0, amp = 0.5, sum = 0;
      for (const { n, g } of grids) { val += amp * sample(g, n, u, v); sum += amp; amp *= 0.5; }
      val /= sum;
      const dx = u - 0.5, dy = v - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2, fall = clamp(1 - r, 0, 1);
      const a = clamp((val - 0.34) * 2.1, 0, 1) * fall * fall;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let cache = null;

// Returns an array of THREE.CanvasTexture, generated once and reused for all smoke sprites.
export function getSmokeTextures(size = 256, seeds = [1, 7, 23, 41]) {
  if (cache) return cache;
  cache = seeds.map(seed => {
    const tex = new THREE.CanvasTexture(paintSmoke(size, seed));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
  return cache;
}
