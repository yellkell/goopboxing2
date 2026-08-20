/**
 * PlayerSystem — reads the tracked body into `tracked` (fight/state.ts),
 * measures REAL punch speed, and owns the haptics.
 *
 * Hand velocity is the whole game, so it's measured honestly: each hand
 * keeps a short ring of timestamped positions and speed is taken across
 * a ~70 ms window — long enough to flatten tracking jitter, short enough
 * that a snapped jab still reads at full speed. The velocity DIRECTION
 * rides the same window (a punch's direction is its travel, never the
 * controller's facing).
 *
 * Calibration: standing height snaps UP instantly (you can't fake tall)
 * and decays DOWN very slowly, so a bout spent crouching never quietly
 * lowers the bar ducking is judged against.
 *
 * The headless harness drives `tracked` itself (tracked.devDrive) — this
 * system then keeps its hands off, so a probe can puppet the whole fight
 * without a headset.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import type { Object3D } from 'three';
import { tracked } from '../fight/state.js';

const WINDOW_S = 0.07;
const SAMPLES = 16;

const _p = new Vector3();

class HandTracker {
  private buf = new Float32Array(SAMPLES * 4); // t,x,y,z rings
  private head = 0;
  private count = 0;

  feed(t: number, p: Vector3): void {
    const o = this.head * 4;
    this.buf[o] = t;
    this.buf[o + 1] = p.x;
    this.buf[o + 2] = p.y;
    this.buf[o + 3] = p.z;
    this.head = (this.head + 1) % SAMPLES;
    this.count = Math.min(this.count + 1, SAMPLES);
  }

  /** Speed (m/s) and direction across the window into `outDir`. */
  measure(t: number, outDir: Vector3): number {
    if (this.count < 2) {
      outDir.set(0, 0, 0);
      return 0;
    }
    // Newest sample:
    const newest = (this.head - 1 + SAMPLES) % SAMPLES;
    const no = newest * 4;
    // Oldest sample still inside the window (walk back from newest).
    let pick = newest;
    for (let i = 1; i < this.count; i++) {
      const idx = (this.head - 1 - i + SAMPLES) % SAMPLES;
      if (t - this.buf[idx * 4] > WINDOW_S) break;
      pick = idx;
    }
    const po = pick * 4;
    const dt = this.buf[no] - this.buf[po];
    if (dt < 1e-4) {
      outDir.set(0, 0, 0);
      return 0;
    }
    outDir.set(
      this.buf[no + 1] - this.buf[po + 1],
      this.buf[no + 2] - this.buf[po + 2],
      this.buf[no + 3] - this.buf[po + 3],
    );
    const dist = outDir.length();
    if (dist > 1e-5) outDir.divideScalar(dist);
    return dist / dt;
  }

  reset(): void {
    this.count = 0;
  }
}

export class PlayerSystem extends createSystem({}) {
  private handL = new HandTracker();
  private handR = new HandTracker();
  private clock = 0;

  init(): void {
    playerView.haptic = this.haptic.bind(this);
  }

  update(delta: number): void {
    this.clock += delta;
    if (tracked.devDrive) return; // the harness is the body today

    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) {
      headObj.getWorldPosition(tracked.head);
      headObj.getWorldQuaternion(tracked.headQuat);
      tracked.hasInput = true;

      // Standing height: fast attack, glacial release.
      if (tracked.head.y > tracked.standingHeight) {
        tracked.standingHeight = tracked.head.y;
      } else {
        tracked.standingHeight = Math.max(1.1, tracked.standingHeight - delta * 0.015);
      }
    }

    const spaces = (
      this.world as {
        playerSpaceEntities?: {
          gripSpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
          raySpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
        };
      }
    ).playerSpaceEntities;

    for (const hand of ['left', 'right'] as const) {
      // Grip is the fist; ray is the fallback the emulator always has.
      const obj = spaces?.gripSpaces?.[hand]?.object3D ?? spaces?.raySpaces?.[hand]?.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_p);
      const store = hand === 'left' ? tracked.handL : tracked.handR;
      store.copy(_p);
      const trackerH = hand === 'left' ? this.handL : this.handR;
      trackerH.feed(this.clock, _p);
      const dir = hand === 'left' ? tracked.velL : tracked.velR;
      const speed = trackerH.measure(this.clock, dir);
      if (hand === 'left') tracked.speedL = speed;
      else tracked.speedR = speed;
    }
  }

  /** A short controller buzz. Garnish — some browsers refuse; fine. */
  haptic(hand: 'left' | 'right' | 'both', intensity: number, ms: number): void {
    const session = (this.world as { session?: XRSession | null }).session;
    if (!session?.inputSources) return;
    for (const src of session.inputSources) {
      if (hand !== 'both' && src.handedness !== hand) continue;
      const actuator = (
        src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(Math.min(1, intensity), ms);
      } catch {
        /* unsupported pulse — it's garnish */
      }
    }
  }
}

/** FightSystem reaches the haptics through this (systems can't import
 *  each other's instances; the world registry hands them out by class). */
export const playerView: { haptic?: PlayerSystem['haptic'] } = {};
