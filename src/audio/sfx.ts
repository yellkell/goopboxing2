/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load). SLUGFEST speaks almost entirely WET: the gel
 * foley ported from the GOOP lineage (squelches, blubs, bubbles, rips)
 * plus the ring's own vocabulary — the bell, the count, the buzzer.
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame
 * loop play fine.
 */

// Two gain stages: the synth SFX sit under `_master` (0.28, the quiet mix
// bus); `_sfxOut` sits ABOVE it as the user's master SFX-volume fader.
type Ctx = AudioContext & { _master?: GainNode; _sfxOut?: GainNode };

const SFX_VOL_KEY = 'gbx-sfx-vol';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

let sfxVol = ((): number => {
  try {
    const n = parseFloat(localStorage.getItem(SFX_VOL_KEY) ?? '');
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch {
    return 1;
  }
})();

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    // User master fader → speakers.
    const sfxOut = ctx.createGain();
    sfxOut.gain.value = sfxVol;
    sfxOut.connect(ctx.destination);
    ctx._sfxOut = sfxOut;
    // A gentle glue compressor between the synth mix and the fader: the
    // one-shots will never sit at exactly one loudness, so the bus evens
    // the spread. Soft knee, low ratio: glue, not pumping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -24;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.004;
    glue.release.value = 0.18;
    glue.connect(sfxOut);
    // Quiet synth mix bus → the glue → the fader.
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(glue);
    ctx._master = master;
  }
  return ctx;
}

/** The user master SFX bus — anything louder than the synth mix (none yet)
 *  connects here so it rides the SFX-volume fader too. */
export function sfxOut(): GainNode | null {
  return getCtx()?._sfxOut ?? null;
}

/** Current master SFX volume, 0..1 (1 = full). */
export function sfxVolume(): number {
  return sfxVol;
}

/** Set + persist the master SFX volume; live-updates the running bus. */
export function setSfxVolume(v: number): void {
  sfxVol = clamp01(v);
  try {
    localStorage.setItem(SFX_VOL_KEY, sfxVol.toFixed(3));
  } catch {
    /* private mode — the choice just won't persist */
  }
  if (ctx?._sfxOut) ctx._sfxOut.gain.value = sfxVol;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** Call from a user gesture (e.g. menu click) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

/** The shared AudioContext (the techno set clocks off it too). */
export function audioContext(): AudioContext | null {
  return getCtx();
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Bandpass-filtered noise burst — the basis of every whoosh. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(c._master!);
  src.start(t0);
}

/**
 * Struck plate: an inharmonic partial stack over a sharp noise tick. In
 * SLUGFEST it carries the BELL, the wooden count knock and the UI relay —
 * never a punch (punches are wet here).
 */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  // The impact tick that sells the strike.
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/** A slow sub-bass sine swell — weight under the big moments. */
function subSwell(from: number, to: number, dur: number, gain: number, delay = 0, attack = 0.05): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(attack, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// --- wet-gel foley, ported from GOOP -----------------------------------------

/** Soft-saturation curve (tanh) — rounds transients into a crunchy, organic
 *  edge instead of the clean click of a raw oscillator. Built once. */
const SHAPE = (() => {
  const n = 512;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
})();

/**
 * The wet-impact primitive: a burst of noise driven through a RESONANT
 * low-pass whose cutoff sweeps downward, then lightly saturated. That sweep
 * is what makes it read as a wet "thwuck" of gel rather than a synth beep.
 * `q` controls how vocal/squelchy it is; higher = more of a resonant "bloop".
 */
function noiseHit(
  dur: number,
  gain: number,
  cutFrom: number,
  cutTo: number,
  q = 0.7,
  delay = 0,
): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (1 - p) ** 1.5; // fast, natural decay
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(cutFrom, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, cutTo), t0 + dur * 0.75);
  const sh = c.createWaveShaper();
  sh.curve = SHAPE;
  sh.oversample = '2x';
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(lp).connect(sh).connect(g).connect(c._master!);
  src.start(t0);
}

/** One rising bubble 'blip' — the atom of goo. */
function bubble(freq: number, gain = 0.08, delay = 0, dur = 0.07): void {
  tone({ freq, to: freq * 1.45, type: 'sine', dur, gain, delay });
}

/** A wet downward 'blub' — the body of every impact. */
function blub(freq: number, gain: number, dur: number, delay = 0): void {
  tone({ freq, to: freq * 0.38, type: 'triangle', dur, gain, delay });
  tone({ freq: freq * 0.55, to: freq * 0.22, type: 'sine', dur: dur * 1.2, gain: gain * 0.7, delay: delay + 0.008 });
}

/** A fist landing in the gel. `intensity` 0..1 scales the meat of it. One
 *  cohesive wet THWUCK — a bright slap crack on the front, a resonant gel
 *  body that squelches down in pitch, and a sub you feel. */
export function squelch(intensity = 0.6): void {
  const i = clamp01(intensity);
  // Soft dull slap on the front — the impact arriving, not the star of the show.
  noiseHit(0.035 + 0.02 * i, 0.14 + 0.1 * i, 3000, 900, 0.7);
  // The GROSS part: three overlapping high-resonance squish sweeps, each with
  // a random cutoff and a slightly different start — mud-and-gore foley.
  for (let k = 0; k < 3; k++) {
    noiseHit(
      0.09 + Math.random() * 0.06,
      0.13 + 0.11 * i,
      800 + Math.random() * 900,
      80 + Math.random() * 130,
      6 + Math.random() * 3,
      k * 0.02 + Math.random() * 0.012,
    );
  }
  // Fat wet body under the squish.
  noiseHit(0.14 + 0.08 * i, 0.2 + 0.2 * i, 950 + 200 * Math.random(), 130, 2.4);
  // The sucking tail — goo pulling back off the impact (upward high-Q sweep).
  noiseHit(0.14 + 0.06 * i, 0.09 + 0.08 * i, 240, 1100 + Math.random() * 500, 4.5, 0.05 + 0.02 * i);
  blub(135 + 50 * Math.random(), 0.12 + 0.13 * i, 0.11 + 0.06 * i, 0.008); // liquify glug
  tone({ freq: 80, to: 40, type: 'sine', dur: 0.12 + 0.06 * i, gain: 0.14 + 0.16 * i }); // felt sub
  const pops = 2 + Math.round(i * 2);
  for (let p = 0; p < pops; p++) {
    bubble(360 + Math.random() * 520, 0.022 + 0.024 * i, 0.04 + Math.random() * 0.15);
  }
}

/** A lump tearing clean OFF the body — squelch plus a stretchy rip. */
export function tear(): void {
  squelch(1);
  whooshNoise(0.16, 0.14, 300, 1500, 0.02); // the taffy strand snapping upward
  tone({ freq: 320, to: 900, type: 'sawtooth', dur: 0.09, gain: 0.045, delay: 0.03 });
  bubble(700, 0.07, 0.12);
}

/** Goo landing on the floor. */
export function splat(size = 0.5): void {
  const s = Math.min(1, size);
  whooshNoise(0.08 + 0.1 * s, 0.14 + 0.2 * s, 480, 110);
  blub(110, 0.16 + 0.16 * s, 0.13 + 0.08 * s);
  if (s > 0.4) bubble(240, 0.05, 0.09);
}

/** A lump slurping back into the body. */
export function slurp(): void {
  whooshNoise(0.22, 0.11, 190, 850);
  tone({ freq: 130, to: 430, type: 'triangle', dur: 0.2, gain: 0.09 });
  bubble(520, 0.07, 0.16);
  bubble(760, 0.05, 0.22);
}

/** Idle jelly wobble (poked, or landing after a stagger). */
export function gooWobble(intensity = 0.5): void {
  const i = Math.min(1, intensity);
  tone({ freq: 95 + 30 * i, to: 55, type: 'sawtooth', dur: 0.22, gain: 0.05 + 0.06 * i });
  tone({ freq: 52, type: 'sine', dur: 0.26, gain: 0.1 + 0.1 * i });
  bubble(300, 0.04 * i, 0.05);
}

/** A fighter pulling itself up into its fighting shape — bubbling swell. */
export function gooRise(): void {
  whooshNoise(1.25, 0.15, 85, 420);
  tone({ freq: 42, to: 95, type: 'sine', dur: 1.15, gain: 0.18 });
  for (let i = 0; i < 6; i++) {
    bubble(240 + i * 130 + Math.random() * 80, 0.05, 0.1 + i * 0.16, 0.08);
  }
}

/** Collapsing back into the glob (the corner rest). */
export function gooSink(): void {
  whooshNoise(0.9, 0.13, 380, 90);
  tone({ freq: 95, to: 40, type: 'sine', dur: 0.85, gain: 0.16 });
  for (let i = 0; i < 4; i++) {
    bubble(620 - i * 120, 0.04, 0.08 + i * 0.14, 0.07);
  }
  splat(0.7);
}

/** Attack telegraph — a rising bubbly whine ending exactly at the strike.
 *  (The bot's warning voice; humans warn with their shoulders.) */
export function gooCharge(dur: number): void {
  tone({ freq: 90, to: 640, type: 'sawtooth', dur, gain: 0.07 });
  whooshNoise(dur, 0.065, 160, 1200);
  for (let i = 0; i < 4; i++) {
    bubble(300 + i * 180, 0.055, dur * (0.25 + i * 0.18), 0.06);
  }
}

/** A gel limb whipping out. */
export function gooWhoosh(): void {
  whooshNoise(0.28, 0.24, 260, 1500);
  tone({ freq: 150, to: 55, type: 'triangle', dur: 0.16, gain: 0.14 });
}

/** A heavy strike landing — a wet sledgehammer you feel in your teeth. */
export function gooSlam(): void {
  tone({ freq: 85, to: 22, type: 'sine', dur: 0.5, gain: 0.4 }); // deep gut sub, felt
  noiseHit(0.22, 0.36, 1900, 100, 1.5); // the big wet body caving in
  noiseHit(0.06, 0.2, 4200, 1300, 0.7); // duller front slap — weight, not sting
  noiseHit(0.24, 0.16, 640, 100, 5.0, 0.015); // watery glug under the impact
  tone({ freq: 140, to: 44, type: 'sine', dur: 0.22, gain: 0.22, delay: 0.005 }); // low thud
}

/** The spinning attack — a long sweeping rotor of air and slime. */
export function spinWhoosh(): void {
  whooshNoise(0.4, 0.22, 180, 1300);
  whooshNoise(0.34, 0.14, 500, 2000, 0.08);
  tone({ freq: 90, to: 240, type: 'sawtooth', dur: 0.32, gain: 0.06 });
  bubble(340, 0.05, 0.2);
}

/** The kick — heavier, lower, a whole limb's worth of gel in flight. */
export function kickWhoosh(): void {
  whooshNoise(0.3, 0.28, 160, 900);
  tone({ freq: 120, to: 45, type: 'triangle', dur: 0.24, gain: 0.18 });
  blub(140, 0.1, 0.14, 0.05);
}

/** The KO collapse — everything lets go at once. */
export function koSplat(): void {
  splat(1);
  blub(70, 0.3, 0.3, 0.02);
  whooshNoise(0.5, 0.2, 300, 60, 0.02);
  for (let i = 0; i < 8; i++) {
    bubble(180 + Math.random() * 700, 0.05, 0.05 + Math.random() * 0.5);
  }
}

// --- SLUGFEST's own ring vocabulary ------------------------------------------

/** Your swing cutting only air — the whiff that teaches range. */
export function whiff(): void {
  whooshNoise(0.14, 0.1, 700, 2400);
}

/** Two gel gloves meeting — a BLOCK: dense, wet, dead. No ring, no sting,
 *  the sound of mass refusing to move. */
export function gelBlock(): void {
  noiseHit(0.06, 0.26, 1400, 300, 1.2); // the dense wet smack
  noiseHit(0.1, 0.14, 500, 120, 3.5, 0.01); // gel compressing under it
  tone({ freq: 110, to: 60, type: 'sine', dur: 0.12, gain: 0.2 }); // dead thump
  blub(180, 0.08, 0.09, 0.01);
}

/** Getting your head rung — a muffled drone with a detuned wobble, the
 *  inside-your-skull answer to the squelch the room heard. */
export function headRing(): void {
  tone({ freq: 420, to: 380, type: 'sine', dur: 0.55, gain: 0.1 });
  tone({ freq: 427, to: 372, type: 'sine', dur: 0.55, gain: 0.08, delay: 0.01 });
  tone({ freq: 90, to: 44, type: 'sine', dur: 0.3, gain: 0.24 });
  noiseHit(0.08, 0.16, 900, 200, 2.2);
}

/** UI: a relay snapping closed. */
export function uiClick(): void {
  clank(1500, 0.05, 0.04);
  tone({ freq: 110, type: 'sine', dur: 0.04, gain: 0.08 });
}

/** UI: the pointer landing on a panel — softer echo of the click. */
export function uiHover(): void {
  clank(1500, 0.024, 0.035);
  tone({ freq: 110, type: 'sine', dur: 0.035, gain: 0.038 });
}

/** One strike of the ring bell — long metallic decay. */
function bellStrike(delay: number): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  // Fundamental + inharmonic partials = a passable steel bell.
  for (const [f, g, d] of [[660, 0.3, 1.1], [1320, 0.12, 0.7], [1980, 0.06, 0.45], [392, 0.08, 0.9]] as const) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(env).connect(c._master!);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }
  // The hammer hitting the bell.
  whooshNoise(0.025, 0.16, 2800, 1500, delay);
}

/** DING DING — a round begins. */
export function roundBell(): void {
  bellStrike(0);
  bellStrike(0.32);
}

/** End-of-round cue. */
export function roundEnd(win: boolean | 'draw'): void {
  bellStrike(0);
  if (win === 'draw') {
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.16, delay: 0.24 });
    tone({ freq: 440, type: 'sine', dur: 0.16, gain: 0.12, delay: 0.4 });
  } else if (win) {
    tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.2, delay: 0.25 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, gain: 0.2, delay: 0.35 });
  } else {
    tone({ freq: 392, to: 300, type: 'sine', dur: 0.2, gain: 0.2, delay: 0.25 });
  }
}

/** End-of-bout fanfare / sad cue. */
export function matchEnd(win: boolean): void {
  if (win) {
    // Wooshing triumph — no tune. A big air-rush builds and lands on a
    // gut-punch impact, then a low power drone (root + octave) rings out.
    const HIT = 0.62; // when the rising whoosh lands
    whooshNoise(HIT + 0.05, 0.26, 130, 2200);
    whooshNoise(HIT + 0.05, 0.18, 320, 3600, 0.06);
    tone({ freq: 60, to: 150, type: 'sine', dur: HIT, gain: 0.22 });
    bellStrike(HIT);
    clank(150, 0.16, 0.5, HIT);
    clank(300, 0.1, 0.35, HIT + 0.02);
    whooshNoise(0.5, 0.24, 2600, 200, HIT);
    tone({ freq: 80, to: 44, type: 'sine', dur: 0.45, gain: 0.26, delay: HIT });
    [98, 196].forEach((f) =>
      tone({ freq: f, to: f * 1.005, type: 'sawtooth', dur: 1.6, gain: 0.1, delay: HIT + 0.04 }),
    );
    bellStrike(HIT + 0.04);
    bellStrike(HIT + 0.55);
  } else {
    bellStrike(0);
    bellStrike(0.28);
    bellStrike(0.56);
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, to: f * 0.9, type: 'sine', dur: 0.24, gain: 0.2, delay: 0.7 + i * 0.16 }),
    );
  }
}

/** The referee's count — a dry wooden knock, never a note (an inharmonic
 *  stack has no pitch class, so it lands on the moment, not the harmony). */
export function countKnock(final = false): void {
  clank(final ? 620 : 820, final ? 0.22 : 0.16, final ? 0.14 : 0.085);
  if (final) subSwell(60, 30, 0.5, 0.18, 0, 0.02);
}

/** The pre-round count-in tick (3‥2‥1). */
export function countdownTick(last: boolean): void {
  const o: OscillatorType = 'square';
  tone({ freq: last ? 1660 : 1108, type: o, dur: 0.05, gain: last ? 0.12 : 0.07 });
}
