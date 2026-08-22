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

/** A defending glove for the clash check: where it is, how fast it moves. */
export interface Glove {
  pos: Vector3;
  speed: number;
}

/** Speed → 0..1 punch strength (saturates at PUNCH.maxSpeed). */
export function punchStrength(speed: number): number {
  return Math.min(1, Math.max(0, (speed - PUNCH.hitSpeed) / (PUNCH.maxSpeed - PUNCH.hitSpeed)));
}

const _toHead = new Vector3();
const _toGlove = new Vector3();

/**
 * The victim's call on an arriving hit. `head` is the VICTIM's real head;
 * the gloves are their GEL fists with their live speeds; `damageScale`
 * lets the bot difficulty thin its own punishment.
 *
 * THE CLASH LAW: blocking is MEETING their strike with your own. A hit is
 * blocked only when one of the defender's fists is near the contact AND
 * moving at strike speed itself — two punches cancelling in the air. A
 * parked guard soaks nothing: hands still, chin pays.
 */
export function judgeIncoming(
  hit: IncomingHit,
  head: Vector3,
  gloveL: Glove,
  gloveR: Glove,
  damageScale = 1,
): Judgement {
  const strength = punchStrength(hit.speed);
  const headshot = _toHead.copy(hit.point).sub(head).length() < PUNCH.headRadius;

  const blocked = clashes(gloveL, hit) || clashes(gloveR, hit);

  let damage = (PUNCH.dmgBase + strength * PUNCH.dmgScale) * damageScale;
  if (headshot) damage *= PUNCH.headMul;
  if (blocked) damage *= PUNCH.blockMul;

  return { blocked, headshot, damage, strength };
}

/** The clash: this glove is near the contact AND striking itself. */
function clashes(glove: Glove, hit: IncomingHit): boolean {
  if (glove.speed < PUNCH.clashSpeed) return false;
  return _toGlove.copy(glove.pos).sub(hit.point).length() < PUNCH.blockRadius;
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
