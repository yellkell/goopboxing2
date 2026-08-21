/**
 * THE RING LAYOUT — where YOUR ropes stand in YOUR room.
 *
 * AR law: the game's geometry is protocol, the ring is furniture. The
 * 2-seat mirror, spawns and every judged position are built from
 * RING.spawnBack and never move; the VISIBLE ring is four independent
 * sides you drag out to your real walls, saved per headset. Your opponent
 * never sees your layout and yours never moves them.
 *
 * Frame: my local frame (my spawn at origin, facing −Z). Sides:
 *   left  = the −X rope's x   (negative)
 *   right = the +X rope's x   (positive)
 *   near  = the rope BEHIND ME's z  (positive-ish)
 *   far   = the rope BEHIND THE OPPONENT's z (negative)
 *
 * Adjustment is one side at a time — grab a side with the trigger while
 * RING ADJUST is on (the A-button menu turns it on) and slide it along
 * its own normal. Clamps keep the ring a ring (RING.minWidth/minDepth)
 * and inside arm's reach of the playspace (RING.maxSide).
 */

import { RING } from '../config.js';

export type RingSide = 'left' | 'right' | 'near' | 'far';
export const RING_SIDES: readonly RingSide[] = ['left', 'right', 'near', 'far'];

export interface RingLayout {
  left: number;
  right: number;
  near: number;
  far: number;
}

const STORE_KEY = 'slugfest-ring-v1';

export function defaultLayout(): RingLayout {
  const cz = -RING.spawnBack; // ring centre z in my frame
  return {
    left: -RING.half,
    right: RING.half,
    near: cz + RING.half,
    far: cz - RING.half,
  };
}

/** The live layout singleton — read by the stage, written by the adjuster. */
export const ringLayout: RingLayout = defaultLayout();

/** Bumped on every layout change — the stage re-lays instances when it moves. */
export const ringAdjust = {
  /** RING ADJUST mode is on (handles visible, sides grabbable). */
  active: false,
  /** The side currently held (one at a time — that's the law). */
  grabbed: null as RingSide | null,
  /** Which hand holds it ('left'/'right' controller). */
  grabHand: null as 'left' | 'right' | null,
  dirty: 1,
};

function clampLayout(l: RingLayout): void {
  const M = RING.maxSide;
  l.left = Math.min(-0.6, Math.max(-M, l.left));
  l.right = Math.max(0.6, Math.min(M, l.right));
  l.near = Math.min(M, l.near);
  l.far = Math.max(-M - RING.spawnBack, l.far);
  // The ring stays a ring: sides can't cross closer than the minima.
  if (l.right - l.left < RING.minWidth) {
    const mid = (l.right + l.left) / 2;
    l.left = mid - RING.minWidth / 2;
    l.right = mid + RING.minWidth / 2;
  }
  if (l.near - l.far < RING.minDepth) {
    const mid = (l.near + l.far) / 2;
    l.far = mid - RING.minDepth / 2;
    l.near = mid + RING.minDepth / 2;
  }
}

/** Move ONE side to a coordinate (the grab drags this every frame). */
export function setSide(side: RingSide, value: number): void {
  if (!Number.isFinite(value)) return;
  if (side === 'left' || side === 'right') ringLayout[side] = value;
  else ringLayout[side] = value;
  clampLayout(ringLayout);
  ringAdjust.dirty++;
}

export function resetLayout(): void {
  Object.assign(ringLayout, defaultLayout());
  ringAdjust.dirty++;
  saveLayout();
}

export function saveLayout(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(ringLayout));
  } catch {
    /* storage may be unavailable — the session keeps the live value */
  }
}

export function loadLayout(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<RingLayout>;
    if (
      typeof v.left === 'number' && Number.isFinite(v.left) &&
      typeof v.right === 'number' && Number.isFinite(v.right) &&
      typeof v.near === 'number' && Number.isFinite(v.near) &&
      typeof v.far === 'number' && Number.isFinite(v.far)
    ) {
      Object.assign(ringLayout, { left: v.left, right: v.right, near: v.near, far: v.far });
      clampLayout(ringLayout);
      ringAdjust.dirty++;
    }
  } catch {
    /* a corrupt save is just the default ring */
  }
}

/** Ring centre of the CURRENT layout (the stage's decal + HUD anchor). */
export function layoutCenter(): { x: number; z: number } {
  return { x: (ringLayout.left + ringLayout.right) / 2, z: (ringLayout.near + ringLayout.far) / 2 };
}

/** Clamp a point into the current ring with a margin (bot steering). */
export function clampIntoRing(p: { x: number; z: number }, margin = 0.3): void {
  p.x = Math.max(ringLayout.left + margin, Math.min(ringLayout.right - margin, p.x));
  p.z = Math.max(ringLayout.far + margin, Math.min(ringLayout.near - margin, p.z));
}

/** The coordinate of a side (its position along its own normal axis). */
export function sideValue(side: RingSide): number {
  return ringLayout[side];
}

/** Where a side's grab handle floats (world/local of my frame). */
export function sideHandle(side: RingSide, out: { x: number; y: number; z: number }): void {
  const cx = (ringLayout.left + ringLayout.right) / 2;
  const cz = (ringLayout.near + ringLayout.far) / 2;
  const y = RING.ropeHeights[1];
  if (side === 'left') {
    out.x = ringLayout.left;
    out.z = cz;
  } else if (side === 'right') {
    out.x = ringLayout.right;
    out.z = cz;
  } else if (side === 'near') {
    out.x = cx;
    out.z = ringLayout.near;
  } else {
    out.x = cx;
    out.z = ringLayout.far;
  }
  out.y = y;
}
