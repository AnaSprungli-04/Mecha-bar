import * as THREE from 'three';
import { getSmokeTextures } from './smoke-texture.js';
import { createMemoryAssets, START, SPACING, SWEET, N, MAXTRAVEL } from './memories.js';

export { MAXTRAVEL, N };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Presence envelope for a depth value relative to camera (ez = planeZ - cameraZ).
// Far ahead → fades in (still wrapped in fog); near the camera → full presence;
// just past the camera → fades out before it'd clip through. Mirrors the CSS prototype 1:1.
const IN_A = -SPACING * 0.82, IN_B = SWEET, OUT_A = 160, OUT_B = 680;
function presence(ez) {
  const a = smooth((ez - IN_A) / (IN_B - IN_A));
  const b = 1 - smooth((ez - OUT_A) / (OUT_B - OUT_A));
  return clamp(Math.min(a, b), 0, 1);
}

const PLANE_W = 200, PLANE_H = PLANE_W * 9 / 16; // stills are 16:9 horizontal
const RECYCLE_Z = 850; // depth threshold (relative to camera) at which a smoke puff wraps back to the far end
const SHEET_GAP = 720;
const SHEET_COUNT = 50;

// Reparametrize scroll progress -> camera travel so the dolly slows to a near-stop
// right as each plane hits its sweet spot, with a smooth gaussian fade in/out around
// it, then speeds back up through the empty fog stretch to the next one. Built once
// as a lookup table (forward integral of 1/speed, normalized, inverted by lookup)
// rather than solved analytically per-frame.
const PAUSE_SIGMA = SPACING * 0.30;
const PAUSE_STRENGTH = 0.85; // fraction speed dips by at dead-center of a sweet spot
const LUT_SAMPLES = 2000;

function buildTravelLUT() {
  const sweetTravels = Array.from({ length: N }, (_, i) => START + i * SPACING + SWEET);
  const speedAt = (travel) => {
    let dip = 0;
    for (const st of sweetTravels) {
      const d = (travel - st) / PAUSE_SIGMA;
      dip = Math.max(dip, Math.exp(-d * d));
    }
    return 1 - PAUSE_STRENGTH * dip;
  };

  const dx = MAXTRAVEL / LUT_SAMPLES;
  const travels = new Float64Array(LUT_SAMPLES + 1);
  const cum = new Float64Array(LUT_SAMPLES + 1);
  let acc = 0;
  for (let k = 0; k <= LUT_SAMPLES; k++) {
    travels[k] = k * dx;
    if (k > 0) acc += dx / Math.max(speedAt(travels[k] - dx * 0.5), 0.05);
    cum[k] = acc;
  }
  const total = cum[LUT_SAMPLES];
  for (let k = 0; k <= LUT_SAMPLES; k++) cum[k] /= total;

  function travelFromProgress(p) {
    p = clamp(p, 0, 1);
    let lo = 0, hi = LUT_SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < p) lo = mid + 1; else hi = mid;
    }
    if (lo === 0) return 0;
    const k0 = lo - 1, k1 = lo;
    const span = cum[k1] - cum[k0];
    const t = span > 0 ? (p - cum[k0]) / span : 0;
    return travels[k0] + t * (travels[k1] - travels[k0]);
  }

  // Inverse of travelFromProgress. travels[] is uniformly spaced (travels[k] = k*dx),
  // so locating a travel value is a direct index lookup instead of a binary search.
  function progressFromTravel(travel) {
    travel = clamp(travel, 0, MAXTRAVEL);
    const k = travel / dx;
    const k0 = Math.min(Math.floor(k), LUT_SAMPLES - 1);
    const t = k - k0;
    return cum[k0] + t * (cum[k0 + 1] - cum[k0]);
  }

  return { travelFromProgress, progressFromTravel, sweetTravels };
}

// Named anchors along the journey, expressed as normalized scroll progress (0..1).
// Each beat's zone starts at the midpoint between its sweet spot and the previous
// one's (hero's reference point is travel 0). Read-only map — nothing here drives
// the scroll; see getCurrentAnchor.
function buildAnchorScenes(memories, sweetTravels, progressFromTravel) {
  const refTravels = [0, ...sweetTravels];
  const names = ['hero', ...memories.map((m) => m.id)];
  const scenes = {};
  refTravels.forEach((travel, i) => {
    const boundary = i === 0 ? 0 : (refTravels[i - 1] + travel) / 2;
    scenes[names[i]] = progressFromTravel(boundary);
  });
  return scenes;
}

// Pure threshold lookup: returns whichever anchor's zone the current progress
// falls in. No side effects — no scroll resets, no keyframe cycling, no looping.
export function getCurrentAnchor(progress, scenes) {
  const entries = Object.entries(scenes).sort((a, b) => a[1] - b[1]);
  let current = entries[0][0];
  for (const [name, at] of entries) {
    if (progress < at) break;
    current = name;
  }
  return current;
}

export function createWorld(canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06030a, 0.00016);
  scene.background = new THREE.Color(0x06030a);

  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 1, 16000);
  camera.position.set(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ===== memory planes =====
  const memories = createMemoryAssets();
  const planeGeo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
  const planes = memories.map((mem, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: mem.placeholder,
      transparent: true,
      depthWrite: false,
      fog: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(0, 8, -(START + i * SPACING));
    mesh.userData.baseZ = -(START + i * SPACING);
    mesh.userData.mem = mem;
    scene.add(mesh);
    return mesh;
  });

  // ===== volumetric smoke sprites =====
  const smokeTex = getSmokeTextures();
  const sheets = [];
  for (let i = 0; i < SHEET_COUNT; i++) {
    const glow = i % 5 === 0;
    const tex = smokeTex[i % smokeTex.length];
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: true,
      opacity: 0,
      color: glow ? [0xff3d8a, 0x46ffb0, 0xff8a1e][i % 3] : 0xcfc6da,
      blending: THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    const w = glow ? 1100 + Math.random() * 500 : 420 + Math.random() * 480;
    sprite.scale.set(w, w * (glow ? 0.65 : 0.78), 1);
    sprite.material.rotation = Math.random() * Math.PI * 2;
    scene.add(sprite);
    sheets.push({
      sprite,
      glow,
      base: -i * SHEET_GAP,
      jx: (Math.random() - 0.5) * 1100,
      jy: (Math.random() - 0.5) * 500,
      rotSpd: (Math.random() - 0.5) * 0.12,
      drift: Math.random() * Math.PI * 2,
      maxOp: glow ? 0.14 : 0.34,
    });
  }
  const wrapFar = SHEET_COUNT * SHEET_GAP;

  const { travelFromProgress, progressFromTravel, sweetTravels } = buildTravelLUT();
  const scenes = buildAnchorScenes(memories, sweetTravels, progressFromTravel);

  function update(progress, elapsed) {
    const travel = travelFromProgress(progress);
    camera.position.z = -travel;

    // smoke: drift, slow spin, recycle to the far end as the camera advances
    for (const s of sheets) {
      let ez = s.base + travel;
      while (ez > RECYCLE_Z - 40) { s.base -= wrapFar; ez = s.base + travel; }
      const depth = -ez;
      const op = ez > RECYCLE_Z - 200 ? 0 : clamp(s.maxOp - depth / 26000, 0, s.maxOp);
      const dx = s.jx + Math.sin(elapsed * 0.12 + s.drift) * 140;
      const dy = s.jy + Math.cos(elapsed * 0.09 + s.drift) * 90;
      s.sprite.position.set(dx, dy, camera.position.z + ez);
      s.sprite.material.opacity = op;
      if (!s.glow) s.sprite.material.rotation += s.rotSpd * 0.01;
    }

    // memory planes: presence-driven opacity (cap ~0.7), lazy load/dispose, face camera
    const presences = new Array(planes.length);
    planes.forEach((mesh, i) => {
      const ez = mesh.userData.baseZ - camera.position.z;
      const pr = presence(ez);
      presences[i] = pr;
      mesh.material.opacity = pr * 0.7;
      mesh.lookAt(camera.position);

      const mem = mesh.userData.mem;
      if (pr > 0.02) {
        mem.load();
      } else if (pr <= 0.001 && mem.real) {
        mem.dispose();
      }
      // Decoupled from the branches above: a load kicked off while approaching can
      // resolve after presence has already dropped (slow asset, fast scroll) — always
      // sync the displayed map to whatever's actually available so it's never dropped.
      const wanted = mem.real || mem.placeholder;
      if (mesh.material.map !== wanted) mesh.material.map = wanted;
    });

    return { presences, camera };
  }

  function setSize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  return { scene, camera, renderer, planes, sheets, memories, scenes, update, setSize, presence };
}
