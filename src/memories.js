import * as THREE from 'three';

// The 6 beats, in order. Depths/spacing mirror the CSS prototype so the
// pacing (lots of fog between memories) feels identical.
export const START = 1100;
export const SPACING = 1750;
export const SWEET = -120;
export const N = 6;
export const MAXTRAVEL = (SWEET + START + N * SPACING) / 0.80;

const NEON = {
  amber: ['#ff8a1e', '#7a1f10'],
  green: ['#46ffb0', '#093a2a'],
  magenta: ['#ff3d8a', '#3a0a26'],
  cyan: ['#5fd0ff', '#0a1a26'],
};

export const MEMORIES = [
  { id: 'barra', neon: 'amber', audio: 'salud' },
  { id: 'tejo', neon: 'green', audio: 'risas' },
  { id: 'date', neon: 'magenta', audio: 'date' },
  { id: 'bano', neon: 'cyan', audio: 'bano', distort: true },
  { id: 'rocola', neon: 'magenta', audio: 'baile' },
  { id: 'cuadro', neon: 'amber', audio: 'cuadro' },
].map((m) => ({ ...m, pal: NEON[m.neon] }));

// Checked in this order so an `.mp4`/`.webm` next to a still takes priority —
// dropping a video loop in /public/memories/ swaps it in with no code changes.
const EXT_CANDIDATES = ['.mp4', '.webm', '.avif', '.webp', '.jpg', '.png'];
const VIDEO_EXTS = new Set(['.mp4', '.webm']);

async function resolveAssetUrl(id) {
  for (const ext of EXT_CANDIDATES) {
    const url = `/memories/${id}${ext}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      // Vite's dev server (and some static hosts' SPA fallback) answers 200
      // with text/html for *any* unmatched path — res.ok alone can't tell a
      // real asset from a miss, so gate on the content-type actually matching.
      const type = res.headers.get('content-type') || '';
      const isVideo = VIDEO_EXTS.has(ext);
      if (res.ok && type.startsWith(isVideo ? 'video/' : 'image/')) return { url, ext };
    } catch { /* network hiccup — try the next extension */ }
  }
  return null;
}

// Stills come in reasonably cinematic but still need to read as "recovered
// through smoke", never documentary-sharp — pre-bake a soft blur + desaturate
// into the texture once at load time rather than fighting for it in the shader.
async function loadBlurredImageTexture(url, blurPx = 2) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.filter = `blur(${blurPx}px) saturate(0.85) brightness(0.92)`;
  ctx.drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadVideoTexture(url) {
  const vid = document.createElement('video');
  vid.src = url;
  vid.loop = true;
  vid.muted = true;
  vid.playsInline = true;
  vid.crossOrigin = 'anonymous';
  vid.autoplay = true;
  vid.play().catch(() => {}); // autoplay rejection is fine, frame just stays blank until presence triggers a user gesture elsewhere
  const tex = new THREE.VideoTexture(vid);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, vid };
}

function gradientPlaceholder([a, b]) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.6);
  g.addColorStop(0, a);
  g.addColorStop(0.4, a + '55');
  g.addColorStop(0.8, b);
  g.addColorStop(1, '#06030a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Lazy texture/video loader per beat: only fetches the real asset while the
// camera is approaching, falls back to (and disposes back to) a cheap
// procedural placeholder otherwise. Drop real files in /public/memories/
// named `<id>.<ext>` (image or video, see EXT_CANDIDATES) and they're picked
// up automatically — no code changes needed.
export function createMemoryAssets() {
  return MEMORIES.map((m) => {
    const placeholder = gradientPlaceholder(m.pal);
    return {
      ...m,
      placeholder,
      real: null,
      video: null,
      loading: false,
      failed: false,
      load() {
        if (this.real || this.loading || this.failed) return;
        this.loading = true;
        resolveAssetUrl(this.id).then(async (found) => {
          if (!found) {
            console.warn(`[memories] no asset for "${this.id}" in /public/memories — using placeholder`);
            this.failed = true;
            this.loading = false;
            return;
          }
          try {
            if (VIDEO_EXTS.has(found.ext)) {
              const { tex, vid } = loadVideoTexture(found.url);
              this.real = tex;
              this.video = vid;
            } else {
              this.real = await loadBlurredImageTexture(found.url, 2);
            }
          } catch (err) {
            console.warn(`[memories] failed to load "${this.id}"`, err);
            this.failed = true;
          }
          this.loading = false;
        });
      },
      dispose() {
        if (this.real) { this.real.dispose(); this.real = null; }
        if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video = null; }
        this.failed = false;
      },
    };
  });
}
