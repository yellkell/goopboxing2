/**
 * THE RECORD BOX, STOLEN — five masters lifted whole from DANCE (the
 * sibling repo whose gel this game wears), replacing the synthesised
 * techno set. CHILL spins in the foyer; fight night deals one of four
 * records off the bout seed, so a rematch can change the soundtrack.
 *
 * The numbers are DANCE's measured metadata (onset-flux BPM, phase-locked
 * downbeats, EBU R128 loudness) — carried over verbatim so `beatNow()`
 * stays honest: the ropes, the panel glow and the trim all breathe on the
 * REAL kick, not a guessed grid. Gain-matching to −14 LUFS happens with
 * plain element volume (every master here is hotter than target, so the
 * gains all land ≤ 1 — no WebAudio graph needed).
 *
 * The API mirrors the old techno set's exact surface (startSet / stopSet /
 * beatNow / setRunning) so the systems that dance to the music never
 * changed a line.
 */

import chillUrl from '../assets/music/chill.m4a';
import combatUrl from '../assets/music/combat.m4a';
import breakcoreUrl from '../assets/music/breakcore.mp3';
import dynastyUrl from '../assets/music/dynasty.mp3';
import fusionUrl from '../assets/music/fusion.mp3';

interface Record_ {
  id: string;
  url: string;
  /** Measured tempo (fractions deliberate — see DANCE's tracks.ts). */
  bpm: number;
  /** Seconds from file start to bar 1 beat 1. */
  downbeat: number;
  /** EBU R128 integrated loudness of the master. */
  lufs: number;
}

const TARGET_LUFS = -14;

const MENU_RECORD: Record_ = { id: 'chill', url: chillUrl, bpm: 125.001, downbeat: 1.4922, lufs: -8.9 };

const FIGHT_RECORDS: Record_[] = [
  { id: 'combat', url: combatUrl, bpm: 135.0, downbeat: 0.4909, lufs: -13.2 },
  { id: 'breakcore', url: breakcoreUrl, bpm: 174.0, downbeat: 1.6347, lufs: -8.3 },
  { id: 'dynasty', url: dynastyUrl, bpm: 155.0, downbeat: 1.5444, lufs: -9.6 },
  { id: 'fusion', url: fusionUrl, bpm: 122.0, downbeat: 1.963, lufs: -8.1 },
];

function gainOf(r: Record_): number {
  return Math.min(1, Math.pow(10, (TARGET_LUFS - r.lufs) / 20));
}

let el: HTMLAudioElement | null = null;
let current: Record_ | null = null;
let mode: 'off' | 'menu' | 'fight' = 'off';
let fadeTimer: number | null = null;
let unlocked = false;

function ensureEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = 'auto';
  }
  return el;
}

function spin(r: Record_): void {
  const a = ensureEl();
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  current = r;
  a.src = r.url;
  a.volume = gainOf(r);
  a.currentTime = 0;
  void a.play().catch(() => {
    /* autoplay policy — the next user gesture (any menu press) retries */
  });
}

/** Call inside a user gesture (ENTER THE RING) — unlocks + starts the foyer record. */
export function menuMusic(): void {
  unlocked = true;
  if (mode === 'fight') return; // the bell outranks the lobby
  mode = 'menu';
  if (current?.id !== MENU_RECORD.id) spin(MENU_RECORD);
}

/** The bell: deal a fight record off the bout seed. (Signature kept from
 *  the techno set; only `seed` steers anything here.) */
export function startSet(opts: { seed?: number } & Partial<Record<string, unknown>>): void {
  mode = 'fight';
  const pick = FIGHT_RECORDS[Math.abs(Math.trunc(opts.seed ?? 0)) % FIGHT_RECORDS.length];
  if (current?.id !== pick.id || ensureEl().paused) spin(pick);
}

/** Bout over: fade the fight record out, hand the floor back to CHILL. */
export function stopSet(fadeS = 0.8): void {
  if (mode !== 'fight') return;
  mode = 'menu';
  const a = ensureEl();
  if (!current || a.paused || fadeS <= 0.01) {
    if (unlocked) spin(MENU_RECORD);
    return;
  }
  const from = a.volume;
  const t0 = performance.now();
  if (fadeTimer !== null) clearInterval(fadeTimer);
  fadeTimer = window.setInterval(() => {
    const k = (performance.now() - t0) / (fadeS * 1000);
    if (k >= 1) {
      if (fadeTimer !== null) clearInterval(fadeTimer);
      fadeTimer = null;
      if (unlocked && mode === 'menu') spin(MENU_RECORD);
      return;
    }
    a.volume = from * (1 - k);
  }, 50);
}

/** Beats since bar 1 beat 1 of whatever's spinning (−1 when silent). */
export function beatNow(): number {
  if (!el || !current || el.paused) return -1;
  return ((el.currentTime - current.downbeat) * current.bpm) / 60;
}

/** Is a record spinning (menu or fight)? The breathers key off this. */
export function setRunning(): boolean {
  return el !== null && !el.paused && current !== null;
}
