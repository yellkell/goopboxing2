/**
 * The judge — pure functions over the bout's numbers. No scene access, no
 * side effects: FightSystem applies what these decide, so a headless probe
 * can interrogate every rule without a headset.
 *
 * THE JUDGING LAW (the lineage's multiplayer model, adapted to boxing):
 * each headset is the only honest witness of its own body. So:
 *
 *  - the ATTACKER judges CONTACT — only they know their fist's true path
 *    at 72 Hz (the wire's 15 Hz would eat every jab);
 *  - the VICTIM judges the OUTCOME — only they know where their gloves
 *    really were, so the block check runs on the receiving headset, and
 *    the victim's own health broadcast is authoritative.
 *
 * In practice mode both roles run on the one headset; online they split
 * across the hit event.
 */

import { Vector3 } from 'three';
import { PUNCH } from '../config.js';

export interface IncomingHit {
  /** Contact point, my world frame. */
  point: Vector3;
  /** Punch direction (unit), my world frame. */
  dir: Vector3;
  /** Impact speed m/s. */
  speed: number;
}

export interface Judgement {
  blocked: boolean;
  headshot: boolean;
  /** Health to subtract. */
  damage: number;
  /** 0..1 — meat of the connection (haptics/sfx/spectacle). */
  strength: number;
}

/** Speed → 0..1 punch strength (saturates at PUNCH.maxSpeed). */
export function punchStrength(speed: number): number {
  return Math.min(1, Math.max(0, (speed - PUNCH.hitSpeed) / (PUNCH.maxSpeed - PUNCH.hitSpeed)));
}

const _toHead = new Vector3();
const _toGlove = new Vector3();

/**
 * The victim's call on an arriving hit. `head` and the gloves are the
 * VICTIM's tracked points (their real body); `damageScale` lets the bot
 * difficulty thin its own punishment.
 */
export function judgeIncoming(
  hit: IncomingHit,
  head: Vector3,
  gloveL: Vector3,
  gloveR: Vector3,
  damageScale = 1,
): Judgement {
  const strength = punchStrength(hit.speed);
  const headshot = _toHead.copy(hit.point).sub(head).length() < PUNCH.headRadius;

  // THE BLOCK: a glove near the contact point — or standing on the line
  // between the contact and the head (the classic high guard) — soaks it.
  const blocked =
    gloveNear(gloveL, hit) || gloveNear(gloveR, hit) ||
    (headshot && (gloveOnLine(gloveL, hit, head) || gloveOnLine(gloveR, hit, head)));

  let damage = (PUNCH.dmgBase + strength * PUNCH.dmgScale) * damageScale;
  if (headshot) damage *= PUNCH.headMul;
  if (blocked) damage *= PUNCH.blockMul;

  return { blocked, headshot, damage, strength };
}

function gloveNear(glove: Vector3, hit: IncomingHit): boolean {
  return _toGlove.copy(glove).sub(hit.point).length() < PUNCH.blockRadius;
}

/** Is the glove parked on the contact→head line (a raised guard)? */
function gloveOnLine(glove: Vector3, hit: IncomingHit, head: Vector3): boolean {
  _toHead.copy(head).sub(hit.point);
  const len = _toHead.length();
  if (len < 1e-3) return false;
  _toHead.divideScalar(len);
  _toGlove.copy(glove).sub(hit.point);
  const along = _toGlove.dot(_toHead);
  if (along < 0 || along > len) return false;
  _toGlove.addScaledVector(_toHead, -along);
  return _toGlove.length() < PUNCH.blockRadius * 0.85;
}

/**
 * Per-hand punch arming — the anti-flail stack's state (speed gate is the
 * caller's; this owns cooldown + the retract re-arm).
 */
export class HandArming {
  private cooldownUntil = 0;
  private needsRetract = false;

  /** May this hand score right now? */
  armed(now: number): boolean {
    return !this.needsRetract && now >= this.cooldownUntil;
  }

  /** A scoring hit landed: start cooldown and demand a retraction. */
  fired(now: number): void {
    this.cooldownUntil = now + PUNCH.cooldown;
    this.needsRetract = true;
  }

  /** Feed the fist's signed distance to the target surface each frame. */
  feedDistance(fieldDist: number): void {
    if (this.needsRetract && fieldDist > PUNCH.rearmDist) this.needsRetract = false;
  }

  reset(): void {
    this.cooldownUntil = 0;
    this.needsRetract = false;
  }
}
