import { MEMORIES } from './memories.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const FLASH_AT = 0.90, Q_FINAL = 0.94, Q_CLOSE = 0.965;

export function createUI() {
  const el = {
    gate: document.getElementById('gate'),
    enterBtn: document.getElementById('enterBtn'),
    sound: document.getElementById('sound'),
    hero: document.getElementById('hero'),
    heroInner: document.querySelector('.hero-inner'),
    diveBtn: document.getElementById('diveBtn'),
    ticketsBtn: document.getElementById('ticketsBtn'),
    fuse: document.getElementById('fuse'),
    fuseBurn: document.querySelector('#fuse .burn'),
    fuseSpark: document.querySelector('#fuse .spark'),
    flash: document.getElementById('flash'),
    questions: [...document.querySelectorAll('.q')],
    notes: [...document.querySelectorAll('.q-note')],
    signupForm: document.getElementById('signupForm'),
    email: document.getElementById('email'),
    doneMsg: document.getElementById('doneMsg'),
    land: document.getElementById('land'),
  };

  function setEntered() {
    document.body.classList.add('entered');
    el.gate.classList.add('hidden');
    el.sound.classList.add('on');
    el.fuse.classList.add('on');
  }

  function setSoundUI(muted) {
    el.sound.classList.toggle('muted', muted);
    el.sound.querySelector('.txt').textContent = muted ? 'Silencio' : 'Sonido';
  }

  function updateHero(heroOut) {
    // .hero-inner gets its own dissolve transform; #hero itself also fades so
    // siblings like .scrollcue (which aren't part of hero-inner) disappear too.
    el.hero.style.opacity = (1 - heroOut).toFixed(3);
    el.heroInner.style.transform = `translateY(${-heroOut * 70}px) scale(${1 + heroOut * 0.2})`;
    el.heroInner.style.filter = `blur(${(heroOut * 14).toFixed(1)}px)`;
    el.hero.style.pointerEvents = heroOut > 0.6 ? 'none' : 'auto';
  }

  // beatPresence: array of 6 presence values (0..1) from the scene's memory planes
  function updateQuestions(progress, beatPresence) {
    for (let i = 0; i < 6; i++) {
      const pr = beatPresence[i] || 0;
      const qO = clamp((pr - 0.2) / 0.5, 0, 1);
      const q = el.questions[i];
      q.style.opacity = qO.toFixed(3);
      q.style.transform = `translate(-50%, calc(-50% + ${((1 - qO) * 22).toFixed(1)}px))`;
      if (el.notes[i]) el.notes[i].style.opacity = qO.toFixed(3);
    }
    // ramps in over 0.02 so it's at full opacity well before the 0.999 land
    // threshold, instead of finishing right on top of it (it used to flash by).
    const qc = progress > Q_CLOSE ? clamp((progress - Q_CLOSE) / 0.02, 0, 1) : 0;
    el.questions[7].style.opacity = qc.toFixed(3);
    el.questions[7].style.transform = 'translate(-50%,-50%)';
  }

  function updateFuse(progress, exploded) {
    el.fuseBurn.style.height = (progress * 100).toFixed(2) + '%';
    el.fuseSpark.style.top = (progress * 100).toFixed(2) + '%';
    el.fuseSpark.style.opacity = (progress > 0.002 && progress < 0.999 && !exploded) ? '1' : '0';
  }

  function updateFlash(progress) {
    const explode = progress > FLASH_AT ? clamp((progress - FLASH_AT) / 0.03, 0, 1) : 0;
    el.flash.style.opacity = (explode * 0.95).toFixed(3);
    return explode;
  }

  function bindSignup(onSubmit) {
    el.signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.email.value.trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        el.doneMsg.textContent = 'Listo. Te guardamos un lugar en la primera noche.';
        el.email.value = '';
        onSubmit && onSubmit(v);
      } else {
        el.doneMsg.textContent = 'Poné un mail válido y te avisamos primero.';
      }
    });
  }

  // ===== degraded (no-WebGL) fallback: stacked sections, fade in on view =====
  function buildFallback() {
    const container = document.createElement('div');
    container.id = 'fallback-beats';
    MEMORIES.forEach((beat, i) => {
      const src = el.questions[i];
      const div = document.createElement('div');
      div.className = 'fbeat';
      div.style.background = `radial-gradient(58% 50% at 50% 42%, ${beat.pal[0]}dd 0%, ${beat.pal[0]}33 40%, ${beat.pal[1]} 80%, #06030a 100%)`;
      const p = document.createElement('p');
      p.innerHTML = src.innerHTML;
      div.appendChild(p);
      container.appendChild(div);
    });
    el.hero.insertAdjacentElement('afterend', container);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('visible', entry.isIntersecting));
    }, { threshold: 0.35 });
    [...container.children].forEach((c) => io.observe(c));
  }

  return {
    el, setEntered, setSoundUI, updateHero, updateQuestions, updateFuse, updateFlash,
    bindSignup, buildFallback,
  };
}
