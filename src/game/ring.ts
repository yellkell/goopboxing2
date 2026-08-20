/**
 * Two-seat ring math — the lineage's "me at the origin" trick, cut down to
 * a prizefight.
 *
 * CANONICAL frame: ring centre at the origin; seat 0 stands at
 * (0, 0, +spawnBack) facing −Z, seat 1 at (0, 0, −spawnBack) facing +Z.
 *
 * LOCAL frame (what each headset renders): MY spawn is my world origin and
 * I face −Z — my real floor is the mat, my playspace is my half of the
 * ring. Because both seats face the centre at the same distance, the ring
 * centre lands at (0, 0, −spawnBack) in BOTH fighters' local frames: the
 * ring, the lights and the HUD are built identically on every client, and
 * only the OPPONENT's stream crosses frames.
 *
 * With exactly two seats the cross-frame map collapses to one mirror:
 *   p_mine = (−p.x, p.y, −p.z − 2·spawnBack)   for points,
 *   v_mine = (−v.x, v.y, −v.z)                 for directions,
 *   q_mine = R_y(π) · q                        for orientations.
 */

import { Quaternion, Vector3 } from 'three';
import { RING } from '../config.js';

const FLIP = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

/** The ring centre in my local frame. */
export function ringCenterLocal(out: Vector3): Vector3 {
  return out.set(0, 0, -RING.spawnBack);
}

/** The opponent's spawn in my local frame. */
export function foeSpawnLocal(out: Vector3): Vector3 {
  return out.set(0, 0, -RING.spawnBack * 2);
}

/** A point in the OPPONENT's local frame → my local frame (in place). */
export function peerPointToMine(p: Vector3): Vector3 {
  return p.set(-p.x, p.y, -p.z - 2 * RING.spawnBack);
}

/** A direction in the OPPONENT's local frame → mine (in place). */
export function peerDirToMine(v: Vector3): Vector3 {
  return v.set(-v.x, v.y, -v.z);
}

/** An orientation in the OPPONENT's local frame → mine (in place). */
export function peerQuatToMine(q: Quaternion): Quaternion {
  return q.premultiply(FLIP);
}
