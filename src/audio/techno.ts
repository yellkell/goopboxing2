/**
 * The house set — a full techno set synthesised at runtime, and the BEAT
 * CLOCK the arena lights run on. Vendored from RAVE RAID's placeholder
 * rave; in SLUGFEST it's not a placeholder, it's the venue's pulse.
 *
 * The track is seeded — the same bout seed writes the same bassline on
 * both headsets, so the ring pulses identically for both fighters without
 * shipping a byte of audio. `actAt` maps fight drama to musical intensity
 * (FightSystem wires it: rounds raise the floor, desperation raises the
 * ceiling).
 *
 * Synthesis is the classic WebAudio lookahead scheduler: a 60 ms interval
 * schedules everything up to 220 ms ahead on the AudioContext's own clock,
 * so headset frame hitches never smear the groove.
 */

import { audioContext, ensureAudio, sfxOut } from './sfx.js';
import { mix, mulberry32 } from '../game/rng.js';

const MUSIC_VOL_KEY = 'gbx-music-vol';

interface SetOptions {
  bpm: number;
  /** Count-in beats before beat 0 (hat ticks + riser). */
  countInBeats: number;
  /** Set length in beats; past it the outro thins and the set stops itself. */
  endBeat: number;
  /** Seeds the bassline/stab writing. */
  seed: number;
  /** Musical intensity 0..3 for a given (non-negative) beat. */
  actAt: (beat: number) => number;
  /** Absolute AudioContext time for beat 0 (online sync); default = now + count-in. */
  beatZeroAt?: number;
}

let musicVol = ((): number => {
  try {
    const n = parseFloat(localStorage.getItem(MUSIC_VOL_KEY) ?? '');
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  } catch {
    return 0.5;
  }
})();

let bus: GainNode | null = null;
let running: SetOptions | null = null;
let beatZero = 0; // ctx time of beat 0
let beatLen = 60 / 126;
let schedTimer: number | null = null;
let nextStep = 0; // next 16th-note step index to schedule (from count-in start)
let stepZero = 0; // ctx time of step 0 (start of count-in)
let noiseBuf: AudioBuffer | null = null;
let bassRiff: number[] = [];
let stabNotes: number[] = [];

export function musicVolume(): number {
  return musicVol;
}

export function setMusicVolume(v: number): void {
  musicVol = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(MUSIC_VOL_KEY, String(musicVol));
  } catch {
    /* fine */
  }
  if (bus) bus.gain.value = musicVol * 0.5;
}

function ctx(): AudioContext | null {
  ensureAudio();
  return audioContext();
}

function musicBus(c: AudioContext): GainNode {
  if (bus) return bus;
  bus = c.createGain();
  bus.gain.value = musicVol * 0.5;
  // Ride the same output chain as the sfx master fader when available so
  // everything ducks together if the platform ducks the page.
  const out = sfxOut();
  bus.connect(out ? out.context.destination : c.destination);
  return bus;
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* ── voices ─────────────────────────────────────────────────────────────── */

function kick(c: AudioContext, t: number, punch = 1): void {
  const b = musicBus(c);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(155, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
  g.gain.setValueAtTime(0.9 * punch, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  o.connect(g).connect(b);
  o.start(t);
  o.stop(t + 0.3);
  // Click transient so the kick cuts through small speakers.
  const n = c.createBufferSource();
  n.buffer = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.32 * punch, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  n.connect(hp).connect(ng).connect(b);
  n.start(t, Math.random() * 0.4, 0.03);
}

function hat(c: AudioContext, t: number, open = false, level = 0.16): void {
  const b = musicBus(c);
  const n = c.createBufferSource();
  n.buffer = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7600;
  const g = c.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.14 : 0.045));
  n.connect(hp).connect(g).connect(b);
  n.start(t, Math.random() * 0.5, open ? 0.16 : 0.06);
}

function clapVoice(c: AudioContext, t: number): void {
  const b = musicBus(c);
  for (let i = 0; i < 3; i++) {
    const n = c.createBufferSource();
    n.buffer = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 1.4;
    const g = c.createGain();
    const tt = t + i * 0.011;
    g.gain.setValueAtTime(i === 2 ? 0.36 : 0.2, tt);
    g.gain.exponentialRampToValueAtTime(0.001, tt + (i === 2 ? 0.16 : 0.03));
    n.connect(bp).connect(g).connect(b);
    n.start(tt, Math.random() * 0.5, 0.2);
  }
}

function bassNote(c: AudioContext, t: number, freq: number, len: number, act: number): void {
  const b = musicBus(c);
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = freq;
  const sub = c.createOscillator();
  sub.type = 'square';
  sub.frequency.value = freq / 2;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260 + act * 240;
  lp.Q.value = 6;
  const g = c.createGain();
  // Sidechain feel: swell in after the kick's hit.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.30, t + 0.05);
  g.gain.setValueAtTime(0.30, t + len - 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  const sg = c.createGain();
  sg.gain.value = 0.5;
  o.connect(lp);
  sub.connect(sg).connect(lp);
  lp.connect(g).connect(b);
  o.start(t);
  o.stop(t + len + 0.02);
  sub.start(t);
  sub.stop(t + len + 0.02);
}

function stab(c: AudioContext, t: number, root: number, act: number): void {
  const b = musicBus(c);
  // Minor triad, two detuned saws per note — the rave chord.
  const semis = [0, 3, 7];
  for (const s of semis) {
    for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = root * Math.pow(2, s / 12);
      o.detune.value = det;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + act * 500;
      bp.Q.value = 1.1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.055, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(bp).connect(g).connect(b);
      o.start(t);
      o.stop(t + 0.2);
    }
  }
}

function riser(c: AudioContext, t: number, len: number): void {
  const b = musicBus(c);
  const n = c.createBufferSource();
  n.buffer = noise(c);
  n.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.exponentialRampToValueAtTime(6400, t + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + len);
  g.gain.exponentialRampToValueAtTime(0.001, t + len + 0.05);
  n.connect(bp).connect(g).connect(b);
  n.start(t);
  n.stop(t + len + 0.1);
}

function impact(c: AudioContext, t: number): void {
  const b = musicBus(c);
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  o.connect(g).connect(musicBus(c));
  o.start(t);
  o.stop(t + 0.75);
  const n = c.createBufferSource();
  n.buffer = noise(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.3, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  n.connect(lp).connect(ng).connect(b);
  n.start(t, Math.random() * 0.3, 0.35);
}

function tick(c: AudioContext, t: number, accent: boolean): void {
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = accent ? 1660 : 1108;
  const g = c.createGain();
  g.gain.setValueAtTime(accent ? 0.12 : 0.07, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g).connect(musicBus(c));
  o.start(t);
  o.stop(t + 0.07);
}

/* ── the sequencer ──────────────────────────────────────────────────────── */

/** Write the seeded riffs for this set. */
function writeRiffs(seed: number): void {
  const rng = mulberry32(mix(seed, 0xda2ce));
  // A rolling 16-step bass riff in A-minor-ish (A1 root), rests included.
  const ladder = [0, 0, 0, 3, 5, 7, 10, 12];
  bassRiff = [];
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) {
      bassRiff.push(0); // downbeats anchor the root
    } else if (rng() < 0.3) {
      bassRiff.push(-1); // rest
    } else {
      bassRiff.push(ladder[Math.floor(rng() * ladder.length)]);
    }
  }
  // Stab roots walk a small progression, one per bar.
  const prog = [0, 0, -4, 3];
  stabNotes = prog.map((p) => p + (rng() < 0.5 ? 0 : 12));
}

const A1 = 55;
const semiToFreq = (semi: number, base = A1): number => base * Math.pow(2, semi / 12);

/** Schedule every voice for one 16th-note step. `step` counts from the start
 *  of the count-in; `beat` is the song-position beat (negative in count-in). */
function scheduleStep(c: AudioContext, step: number, t: number): void {
  const opts = running!;
  const stepsPerBeat = 4;
  const beat = (step - opts.countInBeats * stepsPerBeat) / stepsPerBeat;
  const sixteenth = step % stepsPerBeat;
  const beatInBar = Math.floor(((beat % 4) + 4) % 4);
  const bar = Math.floor(beat / 4);

  if (beat < 0) {
    // Count-in: ticks on the beats, a riser into the drop.
    if (sixteenth === 0) tick(c, t, beatInBar === 0);
    if (beat >= -4 && sixteenth === 0 && beat === -4) riser(c, t, 4 * beatLen);
    return;
  }
  if (beat >= opts.endBeat) return; // outro silence — stop() lands shortly

  const act = Math.max(0, Math.min(3, opts.actAt(beat)));
  const beatsLeft = opts.endBeat - beat;
  const finale = beatsLeft <= 32; // last 8 bars: everything on

  // KICK: four on the floor, with an 8th-note roll driving each phrase end.
  const barInPhrase = ((bar % 8) + 8) % 8;
  const phraseFill = barInPhrase === 7 && beatInBar >= 2 && (act >= 2 || finale);
  if (sixteenth === 0) kick(c, t);
  else if (phraseFill && sixteenth === 2) kick(c, t, 0.7);

  // HATS: offbeat 8ths always; 16ths sizzle in from act 2.
  if (sixteenth === 2) hat(c, t, act >= 1 && beatInBar === 3);
  if ((act >= 2 || finale) && (sixteenth === 1 || sixteenth === 3)) hat(c, t, false, 0.07);

  // CLAP on 2 and 4 from act 1.
  if ((act >= 1 || finale) && sixteenth === 0 && (beatInBar === 1 || beatInBar === 3)) clapVoice(c, t);

  // BASS: the seeded riff, denser with the acts.
  const riffStep = step % 16;
  const note = bassRiff[riffStep] ?? 0;
  const density = act === 0 ? (riffStep % 8 === 0 ? 1 : 0) : act === 1 ? (riffStep % 2 === 0 ? 1 : 0) : 1;
  if (note >= 0 && density) {
    bassNote(c, t, semiToFreq(note), beatLen / stepsPerBeat, act);
  }

  // STABS: offbeat rave chords from act 2, walking the bar progression.
  if ((act >= 2 || finale) && sixteenth === 2 && (beatInBar === 0 || beatInBar === 2)) {
    stab(c, t, semiToFreq((stabNotes[((bar % 4) + 4) % 4] ?? 0) + 24), act);
  }

  // PHRASE DRESSING: riser through the last bar, impact on the downbeat.
  if (barInPhrase === 7 && beatInBar === 0 && sixteenth === 0) riser(c, t, 4 * 4 * (beatLen / 4));
  if (barInPhrase === 0 && beatInBar === 0 && sixteenth === 0 && bar > 0) impact(c, t);
}

function pump(): void {
  const c = audioContext();
  if (!c || !running) return;
  const ahead = c.currentTime + 0.22;
  const stepLen = beatLen / 4;
  while (stepZero + nextStep * stepLen < ahead) {
    const t = stepZero + nextStep * stepLen;
    if (t >= c.currentTime - 0.05) scheduleStep(c, nextStep, Math.max(t, c.currentTime + 0.001));
    nextStep++;
  }
}

/* ── public API ─────────────────────────────────────────────────────────── */

/** Start a set. Returns the AudioContext time of beat 0 (share it online). */
export function startSet(opts: SetOptions): number {
  stopSet();
  const c = ctx();
  running = opts;
  beatLen = 60 / opts.bpm;
  writeRiffs(opts.seed);
  if (!c) {
    // No audio (no gesture yet / test env): run the clock off performance.now.
    beatZero = performance.now() / 1000 + opts.countInBeats * beatLen;
    stepZero = beatZero - opts.countInBeats * beatLen;
    return beatZero;
  }
  beatZero = opts.beatZeroAt ?? c.currentTime + 0.1 + opts.countInBeats * beatLen;
  stepZero = beatZero - opts.countInBeats * beatLen;
  nextStep = 0;
  pump();
  schedTimer = window.setInterval(pump, 60);
  return beatZero;
}

export function stopSet(fade = 0.4): void {
  if (schedTimer !== null) {
    clearInterval(schedTimer);
    schedTimer = null;
  }
  running = null;
  const c = audioContext();
  if (c && bus) {
    // Fade the bus, then restore the fader for the next set.
    const b = bus;
    const now = c.currentTime;
    b.gain.cancelScheduledValues(now);
    b.gain.setValueAtTime(b.gain.value, now);
    b.gain.linearRampToValueAtTime(0.0001, now + fade);
    window.setTimeout(() => {
      b.gain.value = musicVol * 0.5;
    }, fade * 1000 + 60);
  }
}

export function setRunning(): boolean {
  return running !== null;
}

/** Continuous song position in beats (negative during the count-in). */
export function beatNow(): number {
  const c = audioContext();
  const now = c ? c.currentTime : performance.now() / 1000;
  return (now - beatZero) / beatLen;
}

/** AudioContext time for a given song beat (scheduling one-shots on-beat). */
export function timeOfBeat(beat: number): number {
  return beatZero + beat * beatLen;
}
