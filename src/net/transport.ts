/**
 * The wire's front door — one facade (`net`) every system talks to, with
 * swappable backends behind it:
 *
 *  - FIREBASE (net/firebase.ts): the real thing. Realtime Database rooms
 *    keyed by four digits, pose streams, event queues, presence. Loaded
 *    lazily and only if src/net/firebaseConfig.ts carries a project
 *    config — until then online reads 'unconfigured' and the menu says
 *    so instead of erroring.
 *  - LOOPBACK: an in-process pair for the headless harness and for
 *    plumbing tests — the "peer" is whatever the probe scripts into it.
 *
 * The facade owns nothing clever: callbacks in, sends out, one shared
 * server-clock estimate so the host's referee deadlines mean the same
 * instant on both headsets.
 */

import { NET } from '../config.js';
import { nowS } from '../fight/state.js';
import type { WireEvent } from './protocol.js';

export type NetPhase =
  | 'off'
  | 'unconfigured' // no Firebase config in the build
  | 'connecting'
  | 'hosting' // room open, waiting for an opponent
  | 'paired' // both seats filled — fight plumbing live
  | 'error';

export interface TransportBackend {
  host(): void;
  join(code: string): void;
  leave(): void;
  sendPose(d: number[]): void;
  sendEvent(e: WireEvent): void;
  /** Best estimate of the shared epoch (ms). */
  serverNowMs(): number;
}

export const net = {
  phase: 'off' as NetPhase,
  code: '',
  /** My seat: 0 = host side, 1 = guest side. */
  seat: 0,
  /** Opponent identity (from their hello). */
  peerName: '',
  peerTint: 1,
  error: '',
  /** Bumped on any change a menu would repaint for. */
  dirty: 0,
};

/* Inbound routing (systems register; backends call). */
export const hooks = {
  onPose: null as ((d: number[]) => void) | null,
  onEvent: null as ((e: WireEvent) => void) | null,
  /** Peer arrived (true) / left (false). */
  onPeer: null as ((present: boolean) => void) | null,
};

let backend: TransportBackend | null = null;

/** Install the active backend (firebase.ts / the loopback do this). */
export function installBackend(b: TransportBackend | null): void {
  backend = b;
}

export function activeBackend(): TransportBackend | null {
  return backend;
}

/** Open a room and wait (async backends update `net` as they go). */
export function hostBout(): void {
  void ensureBackend().then((b) => b?.host());
}

/** Join a room by its four digits. */
export function joinBout(code: string): void {
  if (code.length !== NET.codeLength) return;
  void ensureBackend().then((b) => b?.join(code));
}

/** Leave whatever room is open (safe when none is). */
export function leaveBout(): void {
  backend?.leave();
}

export function sendPose(d: number[]): void {
  if (net.phase === 'paired') backend?.sendPose(d);
}

export function sendEvent(e: WireEvent): void {
  if (net.phase === 'paired' || net.phase === 'hosting') backend?.sendEvent(e);
}

/** Shared-epoch now (ms). Off-line it's just Date.now(). */
export function serverNowMs(): number {
  return backend ? backend.serverNowMs() : Date.now();
}

/** A server-ms stamp → seconds on the local nowS() clock. */
export function srvToLocalS(srvMs: number): number {
  return nowS() + (srvMs - serverNowMs()) / 1000;
}

/* ── backend bootstrap ──────────────────────────────────────────────────── */

let backendLoad: Promise<TransportBackend | null> | null = null;

function ensureBackend(): Promise<TransportBackend | null> {
  if (backend) return Promise.resolve(backend);
  if (!backendLoad) {
    net.phase = 'connecting';
    net.dirty++;
    backendLoad = import('./firebase.js')
      .then((m) => m.createFirebaseBackend())
      .then((b) => {
        if (backend) return backend; // a loopback got there first (tests)
        if (!b) {
          net.phase = 'unconfigured';
          net.error = 'no firebase config yet';
          net.dirty++;
          return null;
        }
        backend = b;
        return b;
      })
      .catch((err) => {
        net.phase = 'error';
        net.error = err instanceof Error ? err.message : 'net init failed';
        net.dirty++;
        return null;
      })
      .finally(() => {
        backendLoad = null;
      });
  }
  return backendLoad;
}

/* ── the loopback pair (harness + plumbing tests) ───────────────────────── */

export interface LoopbackPeer {
  /** Inject a pose as the fake opponent (sender-local frame floats). */
  pose(d: number[]): void;
  /** Inject an event as the fake opponent. */
  event(e: WireEvent): void;
  /** What the local side has sent (most recent first capped at 64). */
  sentPoses: number[][];
  sentEvents: WireEvent[];
  /** Tear the fake room down. */
  leave(): void;
}

/**
 * Install an in-process backend and pair it immediately. Returns the
 * PEER's handle — the probe plays the opponent through it.
 */
export function installLoopback(seat = 0): LoopbackPeer {
  const peer: LoopbackPeer = {
    pose: (d) => hooks.onPose?.(d),
    event: (e) => hooks.onEvent?.(e),
    sentPoses: [],
    sentEvents: [],
    leave: () => {
      net.phase = 'off';
      net.code = '';
      net.dirty++;
      hooks.onPeer?.(false);
      installBackend(null);
    },
  };
  installBackend({
    host: () => undefined,
    join: () => undefined,
    leave: () => peer.leave(),
    sendPose: (d) => {
      peer.sentPoses.unshift([...d]);
      if (peer.sentPoses.length > 64) peer.sentPoses.pop();
    },
    sendEvent: (e) => {
      peer.sentEvents.unshift(e);
      if (peer.sentEvents.length > 64) peer.sentEvents.pop();
    },
    serverNowMs: () => Date.now(),
  });
  net.phase = 'paired';
  net.code = '0000';
  net.seat = seat;
  net.peerName = 'DUMMY';
  net.peerTint = 1;
  net.dirty++;
  hooks.onPeer?.(true);
  return peer;
}
