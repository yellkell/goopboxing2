/**
 * The wire's whole vocabulary. Deliberately tiny — the lineage's law says
 * the wire never carries anything derivable, and in a two-body fight
 * almost everything is derivable except the two bodies themselves:
 *
 *  - POSE (15 Hz): 13 floats — head pos + quat, two hand positions, in the
 *    SENDER's local frame (the receiver mirrors across the ring:
 *    game/ring.ts). Hands need no orientation — a fist is a sphere of gel.
 *  - HIT (event): the attacker's verdict that their fist crossed my
 *    surface, with the contact point/direction/speed. I judge the outcome
 *    (rules.judgeIncoming) — my gloves, my call.
 *  - STATE (4 Hz): my authoritative self — health, ko, tallies.
 *  - PHASE (event): the HOST's referee transitions with server-time
 *    deadlines, so both machines tick the same bout.
 *
 * Every decode is poison-proof: a frame that fails validation is dropped
 * whole (a NaN in a spring is NaN forever — armour bought with blood).
 */

import { Quaternion, Vector3 } from 'three';
import { tracked } from '../fight/state.js';

export const POSE_LEN = 13;

/** Encode my tracked pose (my local frame) for the wire. */
export function encodePose(out: number[] = []): number[] {
  out.length = 0;
  const t = tracked;
  out.push(
    r3(t.head.x), r3(t.head.y), r3(t.head.z),
    r3(t.headQuat.x), r3(t.headQuat.y), r3(t.headQuat.z), r3(t.headQuat.w),
    r3(t.handL.x), r3(t.handL.y), r3(t.handL.z),
    r3(t.handR.x), r3(t.handR.y), r3(t.handR.z),
  );
  return out;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface DecodedPose {
  head: Vector3;
  headQuat: Quaternion;
  handL: Vector3;
  handR: Vector3;
}

/** Decode a peer pose (STILL in the sender's frame — mirror it after). */
export function decodePose(d: unknown, out: DecodedPose): boolean {
  if (!Array.isArray(d) || d.length < POSE_LEN) return false;
  for (let i = 0; i < POSE_LEN; i++) {
    if (!Number.isFinite(Number(d[i]))) return false;
  }
  const n = d as number[];
  out.head.set(n[0], n[1], n[2]);
  out.headQuat.set(n[3], n[4], n[5], n[6]).normalize();
  out.handL.set(n[7], n[8], n[9]);
  out.handR.set(n[10], n[11], n[12]);
  return true;
}

/* ── events ─────────────────────────────────────────────────────────────── */

/** Bout phases the host referee announces. */
export type WirePhase = 'countdown' | 'round' | 'rest' | 'ko' | 'result';

export type WireEvent =
  /** Identity, sent on join and on change. */
  | { t: 'hello'; name: string; tint: number }
  /** Host: the bout begins (seed for the shared set). */
  | { t: 'start'; seed: number }
  /**
   * Host referee transition. `round` 1-based; `deadlineSrv` the phase's
   * end in SERVER ms (each side converts via its own clock offset).
   * For 'ko': `victimSeat` says whose count it is; for 'result':
   * `winnerSeat` (−1 = draw).
   */
  | { t: 'phase'; phase: WirePhase; round: number; deadlineSrv: number; victimSeat?: number; winnerSeat?: number }
  /** Attacker: my fist crossed your surface (my local frame; mirror it). */
  | { t: 'hit'; p: [number, number, number]; d: [number, number, number]; s: number }
  /** Authoritative self-state (victim's outcome law). */
  | { t: 'state'; hp: number; ko: boolean; rd: number; hits: number; blocks: number }
  /** Leaving on purpose. */
  | { t: 'bye' };

/** Validate an inbound event just enough to trust its shape. */
export function decodeEvent(raw: unknown): WireEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  switch (e.t) {
    case 'hello':
      if (typeof e.name !== 'string') return null;
      return { t: 'hello', name: e.name.slice(0, 12), tint: num(e.tint, 0) };
    case 'start':
      return { t: 'start', seed: num(e.seed, 1) };
    case 'phase': {
      const phase = e.phase;
      if (phase !== 'countdown' && phase !== 'round' && phase !== 'rest' && phase !== 'ko' && phase !== 'result') {
        return null;
      }
      return {
        t: 'phase',
        phase,
        round: num(e.round, 1),
        deadlineSrv: num(e.deadlineSrv, 0),
        victimSeat: e.victimSeat === undefined ? undefined : num(e.victimSeat, 0),
        winnerSeat: e.winnerSeat === undefined ? undefined : num(e.winnerSeat, -1),
      };
    }
    case 'hit': {
      const p = vec3(e.p);
      const d = vec3(e.d);
      if (!p || !d || !Number.isFinite(Number(e.s))) return null;
      return { t: 'hit', p, d, s: Number(e.s) };
    }
    case 'state':
      return {
        t: 'state',
        hp: num(e.hp, 0),
        ko: e.ko === true,
        rd: num(e.rd, 0),
        hits: num(e.hits, 0),
        blocks: num(e.blocks, 0),
      };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = Number(v[0]);
  const b = Number(v[1]);
  const c = Number(v[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}
