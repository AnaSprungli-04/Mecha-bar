import * as THREE from 'three';
import Lenis from 'lenis';
import './style.css';
import { createWorld, getCurrentAnchor } from './scene.js';
import { createPostFX } from './postfx.js';
import { createAudio } from './audio.js';
import { createUI, Q_FINAL } from './ui.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const ui = createUI();
const Audio = createAudio();

if (!hasWebGL()) {
  runDegraded();
} else {
  try { runImmersive(); } catch (err) {
    console.error('WebGL init failed, falling back to degraded mode', err);
    document.body.classList.remove('locked');
    runDegraded();
  }
}

function bindCommon() {
  ui.bindSignup();
  const soundEl = document.getElementById('sound');
  soundEl.addEventListener('click', () => ui.setSoundUI(Audio.toggle()));
  soundEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') ui.setSoundUI(Audio.toggle());
  });
}

// ===================================================================
// Degraded path: no WebGL — normal document scroll, CSS fade-ins only.
// ===================================================================
function runDegraded() {
  if (!document.body.classList.contains('degraded')) {
    document.body.classList.add('degraded');
    ui.buildFallback();
  }
  bindCommon();

  function enter() {
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('sound').classList.add('on');
    Audio.start().then(() => { ui.setSoundUI(false); Audio.playHome(); });
  }
  const landEl = document.getElementById('land');
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) Audio.cue('final');
  }, { threshold: 0.3 }).observe(landEl);
  document.getElementById('enterBtn').addEventListener('click', enter);
  document.getElementById('gate').addEventListener('click', (e) => { if (e.target.id === 'gate') enter(); });
  document.getElementById('diveBtn').addEventListener('click', () => {
    document.getElementById('fallback-beats').scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('ticketsBtn').addEventListener('click', () => {
    document.getElementById('signup').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ===================================================================
// Immersive path: Three.js + FogExp2 + ghost-scroller (§11)
// ===================================================================
function runImmersive() {
  document.body.classList.add('locked');
  const canvas = document.getElementById('webgl');
  const world = createWorld(canvas);
  const fx = createPostFX(world.renderer, world.scene, world.camera);
  const distortIdx = world.memories.findIndex((m) => m.distort);
  bindCommon();

  const ghost = document.getElementById('ghost');
  const ghostContent = document.getElementById('ghost-content');

  // #ghost is permanently pointer-events:none (CSS) so it never blocks clicks
  // on the hero/UI sitting visually "below" it; eventsTarget:window means
  // wheel/touch gestures anywhere on the page still drive it.
  function createLenis() {
    return new Lenis({
      wrapper: ghost,
      content: ghostContent,
      eventsTarget: window,
      autoRaf: false,
      smoothWheel: !prefersReduced,
      lerp: prefersReduced ? 1 : 0.1,
      duration: prefersReduced ? 0 : undefined,
    });
  }
  let lenis = createLenis();

  let landed = false;
  let scrollLocked = true;
  let endingTriggered = false;
  let lastAudioCue = null;
  let running = false;
  let rafId = null;
  const clock = new THREE.Clock();

  // ── Letras de las canciones ──────────────────────────────────────────────
  // Formato: { t: segundos_desde_inicio_cancion, text: 'línea de letra' }
  // Rellenar cuando Ana nos dé el timing.
  const SONG_LYRICS = {
    deMusicaLigera: ["Que nunca sorteé", "Las trampas del amor", "De aquel amor", "De música ligera", "Nada nos libra"],
    ochoCuarenta: ["Con chamuyos elegantes, le pintó el mundo al revés", "para que siempre lo banqué, de primera la hizo bien", "El amor sobre toda diferencia social", "dentro del calendario cada día se va", "a pesar de las dudas"],
    lamentoBoliviano: ["Uoh, io, io, io-uoh-oh, ye-eh-eh-eh, yeh-eh.", "Y yo estoy aquí", "Borracho y loco", "Y mi corazón idiota", "Siempre brillará (Siempre brillará)", "Y yo te amaré"],
  };

  // Segundos desde que arranca la canción hasta el corte total → finalfinal
  // Actualizar por canción cuando Ana lo indique.
  const SONG_CUTOFF_SECS = {
    deMusicaLigera: 60,
    ochoCuarenta: 60,
    lamentoBoliviano: 60,
  };

  function triggerEnding() {
    Audio.fadeBed(1.5);
    document.getElementById('spotlight').classList.add('on');
    setTimeout(() => {
      document.getElementById('karaoke-question').classList.add('on');
      Audio.playFinal().then(() => {
        document.getElementById('song-buttons').classList.add('on');
      });
    }, 1000);
  }

  function onSongChosen(song) {
    document.getElementById('song-buttons').classList.remove('on');
    const lyricsEl = document.getElementById('karaoke-lyrics');
    lyricsEl.classList.add('on');
    Audio.startSong(song, SONG_LYRICS[song] || [], (text) => { lyricsEl.textContent = text; }, () => {
      const blackoutEl = document.getElementById('blackout');
      blackoutEl.classList.add('on');
      document.getElementById('karaoke').style.display = 'none';
      document.getElementById('spotlight').classList.remove('on');
      const overlay = document.getElementById('ui-overlay');
      overlay.classList.add('final');
      const finalQ = overlay.querySelector('[data-scene="7"]');
      finalQ.style.transform = 'translate(-50%,-50%)';
      finalQ.style.transition = 'opacity 1.8s ease';
      finalQ.style.opacity = '0';
      Audio.cutAll();
      setTimeout(() => {
        Audio.playFinalFinal();
        finalQ.style.opacity = '1';
      }, 100);

      // Después de que el usuario lea la frase, transición a la sección de reservas
      setTimeout(() => {
        land(true);
        finalQ.style.transition = 'opacity 1.5s ease';
        finalQ.style.opacity = '0';
        setTimeout(() => {
          blackoutEl.style.transition = 'opacity 2.5s ease';
          blackoutEl.classList.remove('on');
        }, 800);
      }, 4000);
    });
  }

  document.querySelectorAll('.song-btn').forEach((btn) => {
    btn.addEventListener('click', () => onSongChosen(btn.dataset.song));
  });

  function land(instant) {
    if (landed) return;
    landed = true;
    document.body.classList.remove('locked');
    document.body.classList.add('landed');
    const top = document.getElementById('land-spacer').offsetHeight;
    window.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
    // Lenis's eventsTarget:window means it preventDefaults wheel/touch input
    // on the whole page, including over the now-revealed landing section —
    // destroying it hands scrolling back to the browser natively. Stopping
    // the render loop also means we're not driving the (now invisible)
    // WebGL scene every frame, competing with the page for the main thread.
    lenis.destroy();
    stopLoop();
  }

  function unland() {
    if (!landed) return;
    landed = false;
    scrollLocked = false;
    document.body.classList.remove('landed');
    document.body.classList.add('locked');
    lenis = createLenis();
    const max = ghostContent.offsetHeight - ghost.clientHeight;
    // land back well short of the 0.999 land() threshold — landing at the
    // very edge re-triggers land() on the next frame and snaps right back.
    lenis.scrollTo(max * 0.97, { immediate: true });
    startLoop();
  }

  window.addEventListener('scroll', () => {
    if (landed && window.scrollY <= 0) unland();
  });

  function progressOf() {
    if (landed) return 1;
    return clamp(lenis.progress || 0, 0, 1);
  }

  function frame(time) {
    if (!landed && !scrollLocked) lenis.raf(time);
    const progress = progressOf();
    const t = clock.getElapsedTime();

    const { presences } = world.update(progress, t);

    // small dead-zone so residual scroll-momentum/jitter can't fade the hero
    // on its own — it only starts dissolving once the user is clearly scrolling.
    const heroOut = clamp((progress - 0.003) / 0.08, 0, 1);
    ui.updateHero(heroOut);
    ui.updateQuestions(progress, presences);

    let exploded = false;
    if (!endingTriggered) {
      const explodeVal = ui.updateFlash(progress);
      exploded = explodeVal > 0;
      ui.updateFuse(progress, exploded);
      if (explodeVal >= 1) {
        endingTriggered = true;
        scrollLocked = true;
        const flashEl = document.getElementById('flash');
        flashEl.style.transition = 'opacity 1.5s ease';
        flashEl.style.opacity = '0';
        triggerEnding();
      }
    }

    // chromatic aberration ramps up around whichever beat is flagged `distort` (the bathroom), settles after
    fx.setChromaAberration(prefersReduced || distortIdx < 0 ? 0 : presences[distortIdx] || 0);

    if (!endingTriggered) {
      const cue = exploded
        ? 'explosion'
        : (() => {
          const anchorMem = world.memories.find((m) => m.id === getCurrentAnchor(progress, world.scenes));
          return anchorMem ? anchorMem.audio : null;
        })();
      if (cue && cue !== lastAudioCue) { Audio.cue(cue); lastAudioCue = cue; }
    }

    fx.render(clock.getDelta());

    if (progress >= 0.999) land(false);

    rafId = requestAnimationFrame(frame);
  }

  function startLoop() { if (running) return; running = true; rafId = requestAnimationFrame(frame); }
  function stopLoop() { running = false; if (rafId) cancelAnimationFrame(rafId); }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (document.body.classList.contains('entered') && !landed) startLoop();
  });

  function onResize() {
    world.setSize(innerWidth, innerHeight);
    fx.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', onResize);

  function enter() {
    document.body.classList.add('entered');
    ui.setEntered();
    lenis.scrollTo(0, { immediate: true }); // discard any stray scroll accumulated while the gate was up
    Audio.start().then(() => {
      ui.setSoundUI(false);
      Audio.cutAll();
      Audio.playHome().then(() => { scrollLocked = false; });
    });
    startLoop();
  }
  document.getElementById('enterBtn').addEventListener('click', enter);
  document.getElementById('gate').addEventListener('click', (e) => { if (e.target.id === 'gate') enter(); });

  // "Vivir la noche" is intentionally inert: the hero/CTA stay put until the
  // user actually scrolls — clicking it doesn't fast-forward the journey.
  document.getElementById('diveBtn').addEventListener('click', () => {
    document.querySelector('.scrollcue')?.animate(
      [{ transform: 'translateX(-50%)' }, { transform: 'translateX(-50%) translateY(10px)' }, { transform: 'translateX(-50%)' }],
      { duration: 500, easing: 'ease-in-out' }
    );
  });
  document.getElementById('ticketsBtn').addEventListener('click', () => {
    if (!document.body.classList.contains('entered')) enter();
    land(true);
    requestAnimationFrame(() => document.getElementById('signup').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  });
}
