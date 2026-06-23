// Web Audio: gesture-unlocked bed + per-beat one-shot cues + mute.
// Drop real files into /public/audio/ matching AUDIO_FILES and they're used
// automatically; until then everything falls back to a synthesized cue so
// the experience is never silent.
const AUDIO_FILES = {
  bed: '/audio/bed.mp3',
  salud: '/audio/salud.mp3',
  risas: '/audio/risas.mp3',
  date: '/audio/date.mp3',
  bano: '/audio/bano.mp3',
  cuadro: '/audio/cuadro.mp3',
  baile: '/audio/baile.mp3',
  explosion: '/audio/explosion.mp3',
};

export function createAudio() {
  let ctx, master, bedGain, started = false, on = false;
  const buffers = {};

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // synthesized bed fallback: filtered noise murmur, always running under master gain
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const bed = ctx.createBufferSource();
    bed.buffer = buf; bed.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    bedGain = ctx.createGain(); bedGain.gain.value = 0.12;
    bed.connect(lp); lp.connect(bedGain); bedGain.connect(master);
    bed.start();
  }

  async function preload() {
    await Promise.all(Object.entries(AUDIO_FILES).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        buffers[key] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) { /* fall back to synth cue */ }
    }));
    if (buffers.bed) {
      const src = ctx.createBufferSource();
      src.buffer = buffers.bed; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(master); src.start();
      g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
      bedGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
    }
  }

  function clink(t) {
    [880, 1320].forEach((f, n) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'triangle';
      g.gain.setValueAtTime(0, t + n * 0.06);
      g.gain.linearRampToValueAtTime(0.25, t + n * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + n * 0.06 + 0.5);
      o.connect(g); g.connect(master); o.start(t + n * 0.06); o.stop(t + n * 0.06 + 0.5);
    });
  }
  function thump(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.6);
  }
  function blip(t, f) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
  }

  return {
    async start() {
      ensure();
      await ctx.resume();
      await preload();
      on = true; started = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.4);
    },
    toggle() {
      if (!started) { this.start(); return !this.muted; }
      on = !on;
      master.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx.currentTime + 0.3);
      return !on; // returns "muted" state
    },
    get muted() { return !on; },
    get isStarted() { return started; },
    cue(name) {
      if (!started || !on || !ctx) return;
      const t = ctx.currentTime + 0.02;
      if (buffers[name]) {
        const s = ctx.createBufferSource(); s.buffer = buffers[name];
        const g = ctx.createGain(); g.gain.value = 0.8;
        s.connect(g); g.connect(master); s.start(t);
        return;
      }
      if (name === 'salud') clink(t);
      else if (name === 'risas') { blip(t, 520); blip(t + 0.12, 660); }
      else if (name === 'date') blip(t, 440);
      else if (name === 'bano') blip(t, 180);
      else if (name === 'cuadro') { blip(t, 392); blip(t + 0.15, 494); }
      else if (name === 'baile') { thump(t); thump(t + 0.5); thump(t + 1.0); }
      else if (name === 'explosion') { thump(t); blip(t, 1200); }
    },
  };
}
