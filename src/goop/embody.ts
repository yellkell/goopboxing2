/**
 * EMBODIMENT — three tracked points become a whole body of gel.
 *
 * This is SLUGFEST's new organ. The vendored creature was always POSED
 * (authored anchor targets); here a human wearing a headset drives it live:
 *
 *   head + two hands  ──►  20 anchor targets  ──►  the sim's springs,
 *                                                   leash, swell, wobble
 *
 * The mapping is 1:1 where honesty lives and AMPLIFIED where the fantasy
 * does (THE REACH, config.REACH): inside `start` of your shoulder the gel
 * fist IS your hand — your guard is your guard, blocks land where your
 * real gloves are — and as you extend, the fist runs out ahead of your
 * knuckles on the same line (up to ×maxGain, plus a speed lunge), the arm
 * roping out after it. Underdogs-style ranged punching, deterministic
 * from the tracked pose alone and applied identically to the remote
 * fighter's wire pose, so both bodies throw the same arms. The judge
 * reads the AMPLIFIED fist (rig.fistWorldL/R + effSpeedL/R) — what you
 * see land is what scores. Everything else is DERIVED:
 *
 *  - trunk (neck/chest/belly/pelvis) hangs off the head at fixed fractions
 *    of your live head height, leaning from the pelvis up — crouch and the
 *    whole column squashes; bow and the gel pours forward after you;
 *  - shoulders ride the neck, turn a little with your gaze, SHRUG toward a
 *    raised hand and reach after a punched one;
 *  - elbows are solved: on the shoulder→fist line, pushed along a pole
 *    vector (down + outward + a little back) that grows with arm slack —
 *    a guard folds its elbows in, a full extension straightens the rope;
 *  - legs keep the boxer stance under the body's ROOT, and the root chases
 *    your head across the floor with oozy lag (GelCreature.moveTo), so
 *    footwork reads as the skirt dragging after you — weight for free.
 *
 * The same rig drives both fighters: yours from live tracking, your
 * opponent's from the wire through critically-damped input springs (the
 * poseMotion law: real motion carries its own character, so the spring's
 * only job is velocity-continuous tracking with no invented bounce — the
 * gel's own underdamped springs put the wobble back on top).
 *
 * Poison law, inherited in blood: a NaN in any tracked channel is ignored
 * and the rig heals on the next good frame — `c += (NaN − c)·k` is NaN
 * forever, and an invisible fighter is a lost bout.
 */

import { Quaternion, Vector3 } from 'three';
import { PUNCH, REACH } from '../config.js';
import type { GelCreature } from './GelCreature.js';
import { A, ANCHOR_COUNT, BOXER_POSE } from './poses.js';

export interface TrackedPose {
  /** World-space head (eye-level) position + orientation. */
  head: Vector3;
  headQuat: Quaternion;
  /** World-space hand (grip) positions. */
  handL: Vector3;
  handR: Vector3;
  /** Live hand speeds (m/s) — drive fist swell + strike tension. */
  speedL: number;
  speedR: number;
}

/** Creature arm length (shoulder→elbow→fist along BOXER_POSE), for slack. */
const ARM_LEN = 0.58;

const _v = new Vector3();
const _head = new Vector3();
const _handL = new Vector3();
const _handR = new Vector3();
const _fwd = new Vector3();
const _s = new Vector3();
const _f = new Vector3();
const _d = new Vector3();
const _pole = new Vector3();
const _elbow = new Vector3();

function fin(n: number): boolean {
  return Number.isFinite(n);
}

function finiteV(v: Vector3): boolean {
  return fin(v.x) && fin(v.y) && fin(v.z);
}

export class EmbodyRig {
  /** Scratch anchor targets, creature-local [x,y,z] × ANCHOR_COUNT. */
  private readonly t = new Float32Array(ANCHOR_COUNT * 3);
  private lastYawOk = 0;

  /** THE REACH's output — the AMPLIFIED gel fists, world space. These are
   *  what the sim pins, what the judge tests, and what the wire's hit
   *  events carry. While guarding they equal the raw hands exactly. */
  readonly fistWorldL = new Vector3();
  readonly fistWorldR = new Vector3();
  /** Distance amplification actually applied this frame (≥ 1). */
  gainL = 1;
  gainR = 1;
  /** Hand speed × gain — the fist's effective speed for the judge. */
  effSpeedL = 0;
  effSpeedR = 0;

  private readonly shoulderW = new Vector3();

  constructor(private creature: GelCreature) {
    creature.mode = 'puppet';
  }

  /** The amplified fist for a hand (the judge's contact probe). */
  fist(hand: 'left' | 'right'): Vector3 {
    return hand === 'left' ? this.fistWorldL : this.fistWorldR;
  }

  effSpeed(hand: 'left' | 'right'): number {
    return hand === 'left' ? this.effSpeedL : this.effSpeedR;
  }

  /**
   * THE REACH: raw tracked hand → amplified gel fist, world space.
   * Shoulder is derived from the head pose alone (deterministic on both
   * ends of the wire). 1:1 inside REACH.start of the shoulder; smooth
   * gain up to ×maxGain at full extension; fast hands lunge further.
   */
  private amplify(
    head: Vector3,
    side: number,
    hand: Vector3,
    speed: number,
    outFist: Vector3,
  ): number {
    // The origin is your REAL shoulder (human proportions off the headset,
    // NEVER scaled by the creature): REACH.start/full are real-arm metres,
    // so a chin guard reads as zero extension whatever size the gel is.
    const yaw = this.lastYawOk;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    this.shoulderW.set(
      head.x + rx * side * 0.19,
      head.y - 0.24,
      head.z + rz * side * 0.19,
    );
    outFist.copy(hand).sub(this.shoulderW);
    const r = outFist.length();
    if (r < 1e-4) {
      outFist.copy(hand);
      return 1;
    }
    const t = Math.min(1, Math.max(0, (r - REACH.start) / (REACH.full - REACH.start)));
    const sm = t * t * (3 - 2 * t);
    const gain = 1 + (REACH.maxGain - 1) * sm;
    let d = r * gain + Math.max(0, speed) * REACH.lunge * sm;
    d = Math.min(d, REACH.maxWorld * this.creature.scale);
    outFist.multiplyScalar(d / r).add(this.shoulderW);
    return d / r;
  }

  /**
   * Drive one frame. Call BEFORE creature.update() each frame — the rig
   * writes offsets/pins/radii the sim consumes on its next step.
   */
  drive(pose: TrackedPose): void {
    const c = this.creature;
    const sim = c.sim;

    // A collapsed or resting fighter isn't driven: the glob/KO poses own
    // the body, and stale offsets would haunt the morph.
    if (c.isKo || c.formValue < 0.65) {
      sim.offsets.fill(0);
      sim.radiusScale.fill(1);
      sim.blendScale = 1;
      sim.clearPins();
      c.puppetPins.length = 0;
      // A slumped body still has hands for the judge to find (raw, gain 1).
      this.fistWorldL.copy(pose.handL);
      this.fistWorldR.copy(pose.handR);
      this.gainL = this.gainR = 1;
      this.effSpeedL = pose.speedL;
      this.effSpeedR = pose.speedR;
      return;
    }

    // Poison gate: a single bad channel skips the whole frame (the sim
    // keeps last frame's offsets — one frame of hold, then heal).
    if (!finiteV(pose.head) || !finiteV(pose.handL) || !finiteV(pose.handR)) return;

    /* ── steering: the root oozes after the head, faces the gaze ──────── */
    _fwd.set(0, 0, -1).applyQuaternion(pose.headQuat);
    const fxz = Math.hypot(_fwd.x, _fwd.z);
    if (fxz > 0.25 && fin(_fwd.x) && fin(_fwd.z)) {
      this.lastYawOk = Math.atan2(_fwd.x / fxz, _fwd.z / fxz);
    }
    // Face 2 m along the (last good) gaze bearing — yaw-only inside.
    _v.set(
      pose.head.x + Math.sin(this.lastYawOk) * 2,
      0,
      pose.head.z + Math.cos(this.lastYawOk) * 2,
    );
    c.faceToward(_v);
    c.moveSpeedScale = 2.2;
    _v.set(pose.head.x, 0, pose.head.z);
    c.moveTo(_v);

    /* ── THE REACH: amplified gel fists, world space ──────────────────── */
    this.gainL = this.amplify(pose.head, -1, pose.handL, pose.speedL, this.fistWorldL);
    this.gainR = this.amplify(pose.head, 1, pose.handR, pose.speedR, this.fistWorldR);
    this.effSpeedL = pose.speedL * this.gainL;
    this.effSpeedR = pose.speedR * this.gainR;

    /* ── tracked points into creature-local space ─────────────────────── */
    c.group.updateMatrixWorld();
    _head.copy(pose.head);
    c.group.worldToLocal(_head);
    _handL.copy(this.fistWorldL);
    c.group.worldToLocal(_handL);
    _handR.copy(this.fistWorldR);
    c.group.worldToLocal(_handR);

    // Head blob centre sits under the eyes (the crown clears the headset).
    _head.y = Math.max(0.5, _head.y - 0.07);
    const H = _head.y; // live head height — every derived Y is a fraction of it

    const t = this.t;
    const put = (i: number, x: number, y: number, z: number): void => {
      t[i * 3] = x;
      t[i * 3 + 1] = y;
      t[i * 3 + 2] = z;
    };

    /* ── the derived spine ────────────────────────────────────────────── */
    put(A.HEAD, _head.x, H, _head.z);
    // Local gaze yaw (group chases it, so this is the transient lean).
    _fwd.set(0, 0, -1).applyQuaternion(pose.headQuat);
    c.group.getWorldQuaternion(_q);
    _q.invert();
    _fwd.applyQuaternion(_q);
    const lxz = Math.hypot(_fwd.x, _fwd.z);
    const localYaw = lxz > 0.2 ? Math.atan2(_fwd.x / lxz, _fwd.z / lxz) : 0;
    const shYaw = Math.max(-0.6, Math.min(0.6, localYaw * 0.4));
    const sYx = Math.cos(shYaw); // shoulder axis (body-right), yawed with gaze
    const sYz = -Math.sin(shYaw);

    // The UPPER column hangs off the head at the AUTHORED gaps — anatomy
    // doesn't compress when you crouch, your legs do. (Derived fractions
    // squeezed the stack tighter than the sim's separation pass allows,
    // and the surplus extruded the chest up around the wearer's eyes —
    // a first-person green-out bought with blood.)
    const neckY = H - 0.18;
    const chestY = H - 0.33;
    put(A.NECK, _head.x * 0.88, neckY, _head.z * 0.88);
    put(A.CHEST_L, _head.x * 0.72 - sYx * 0.13, chestY, _head.z * 0.72 - sYz * 0.13);
    put(A.CHEST_R, _head.x * 0.72 + sYx * 0.13, chestY, _head.z * 0.72 + sYz * 0.13);
    // The LOWER column compresses with the crouch; the belly rides between.
    const pelvisY = Math.max(0.32, H * 0.55);
    const bellyY = pelvisY + 0.55 * (chestY - pelvisY);
    put(A.BELLY, _head.x * 0.5, bellyY, _head.z * 0.5 + 0.02);
    put(A.PELVIS, _head.x * 0.32, pelvisY, _head.z * 0.32);
    put(A.HIP_L, _head.x * 0.32 - sYx * 0.15 * 0.6 - 0.15 * 0.4, pelvisY - 0.08, _head.z * 0.32 - sYz * 0.15 * 0.6);
    put(A.HIP_R, _head.x * 0.32 + sYx * 0.15 * 0.6 + 0.15 * 0.4, pelvisY - 0.08, _head.z * 0.32 + sYz * 0.15 * 0.6);

    /* ── legs: the boxer stance under the root, squashing with a crouch ── */
    const crouch = Math.min(1, H / 1.55); // 1 = standing tall
    for (const [i] of LEG_ANCHORS) {
      const b = BOXER_POSE[i];
      put(i, b[0] + _head.x * 0.12, Math.max(0.1, b[1] * crouch), b[2] + _head.z * 0.12);
    }

    /* ── arms: shoulders shrug, elbows solve, fists pin ───────────────── */
    this.arm(-1, A.SHOULDER_L, A.ELBOW_L, A.FIST_L, _handL, H, sYx, sYz);
    this.arm(1, A.SHOULDER_R, A.ELBOW_R, A.FIST_R, _handR, H, sYx, sYz);

    /* ── write the frame into the sim ─────────────────────────────────── */
    const o = sim.offsets;
    for (let i = 0; i < ANCHOR_COUNT; i++) {
      const b = BOXER_POSE[i];
      o[i * 3] = t[i * 3] - b[0];
      o[i * 3 + 1] = t[i * 3 + 1] - b[1];
      o[i * 3 + 2] = t[i * 3 + 2] - b[2];
    }

    // Fists pin in WORLD space, localised inside creature.update AFTER the
    // root's own motion — a glove is never a frame behind its hand. The
    // pins are the AMPLIFIED fists: the arm you see is the arm that hits.
    sim.clearPins();
    c.puppetPins.length = 0;
    c.puppetPins.push(
      { anchor: A.FIST_L, pos: this.fistWorldL },
      { anchor: A.FIST_R, pos: this.fistWorldR },
    );

    // Fist swell rides punch speed; a guard hand fattens a touch. Elbows
    // take a share of the swell so a fast arm reads as one thick rope
    // (the cohesion swell floors this — whichever asks for more wins).
    const spL = Math.min(1, Math.max(this.effSpeedL, 0) / PUNCH.maxSpeed);
    const spR = Math.min(1, Math.max(this.effSpeedR, 0) / PUNCH.maxSpeed);
    // Guard reads the RAW hands: a fist at your chin is a guard whatever
    // the reach layer would do with it (gain there is 1 by construction).
    const guardL = pose.handL.distanceTo(pose.head) < 0.42 ? 0.12 : 0;
    const guardR = pose.handR.distanceTo(pose.head) < 0.42 ? 0.12 : 0;
    // THE REACH swells what it stretches: an amplified arm is a LONG arm,
    // and a long arm must be a thick rope or the smooth-min tears it to
    // beads. Fist and elbow fatten with the gain (Underdogs forearms),
    // speed swells on top.
    const rchL = Math.max(0, this.gainL - 1) * 0.55;
    const rchR = Math.max(0, this.gainR - 1) * 0.55;
    sim.radiusScale.fill(1);
    sim.radiusScale[A.FIST_L] = 1 + spL * 0.45 + guardL + rchL;
    sim.radiusScale[A.FIST_R] = 1 + spR * 0.45 + guardR + rchR;
    sim.radiusScale[A.ELBOW_L] = 1 + spL * 0.3 + rchL * 1.15;
    sim.radiusScale[A.ELBOW_R] = 1 + spR * 0.3 + rchR * 1.15;
    sim.radiusScale[A.SHOULDER_L] = 1 + rchL * 0.6;
    sim.radiusScale[A.SHOULDER_R] = 1 + rchR * 0.6;

    // Strike tension: the body's fuse widens with the fastest hand AND the
    // deepest reach, so a full-extension punch stays a rope of gel, not
    // beads (the shader's uBlend follows blendScale in lock-step).
    sim.blendScale = 1 + Math.max(spL, spR) * 0.3 + Math.max(rchL, rchR) * 0.5;
  }

  /** One arm: shoulder (derived), elbow (solved), fist (tracked). */
  private arm(
    side: number,
    shoulderI: number,
    elbowI: number,
    fistI: number,
    hand: Vector3,
    H: number,
    sYx: number,
    sYz: number,
  ): void {
    const t = this.t;
    const neckX = t[A.NECK * 3];
    const neckZ = t[A.NECK * 3 + 2];

    // Shoulder: off the neck along the (gaze-yawed) body-right axis, with
    // a SHRUG toward a raised hand and a small reach after a far one.
    const baseY = H - 0.23;
    const shrug = Math.max(0, Math.min(0.13, (hand.y - baseY) * 0.22));
    let sx = neckX + side * sYx * 0.27;
    let sz = neckZ + side * sYz * 0.27;
    const reachX = hand.x - sx;
    const reachZ = hand.z - sz;
    const reachLen = Math.hypot(reachX, reachZ);
    if (reachLen > 0.45) {
      const k = Math.min(0.09, (reachLen - 0.45) * 0.3);
      sx += (reachX / reachLen) * k;
      sz += (reachZ / reachLen) * k;
    }
    _s.set(sx, baseY + shrug, sz);
    put3(t, shoulderI, _s.x, _s.y, _s.z);

    // Fist: the tracked hand, exactly.
    _f.copy(hand);
    put3(t, fistI, _f.x, _f.y, _f.z);

    // Elbow: along the shoulder→fist line, pushed down/out/back by a pole
    // vector whose length grows with arm slack — the fold of a guard.
    _d.copy(_f).sub(_s);
    const L = Math.max(_d.length(), 1e-4);
    _d.divideScalar(L);
    const slack = Math.max(0, ARM_LEN - L);
    // Pole: down + outward + slightly back, made perpendicular to the arm.
    _pole.set(side * 0.55, -0.85, -0.18);
    const along = _pole.dot(_d);
    _pole.addScaledVector(_d, -along).normalize();
    // A hand crossed past the midline folds the elbow down-and-under
    // instead of chicken-winging through the chest.
    if (hand.x * side < -0.05) {
      _pole.y -= 0.35;
      _pole.x *= 0.4;
      _pole.normalize();
    }
    _elbow.copy(_s).addScaledVector(_d, L * 0.5).addScaledVector(_pole, 0.07 + slack * 0.55);
    if (_elbow.y < 0.08) _elbow.y = 0.08;
    put3(t, elbowI, _elbow.x, _elbow.y, _elbow.z);
  }
}

function put3(t: Float32Array, i: number, x: number, y: number, z: number): void {
  t[i * 3] = x;
  t[i * 3 + 1] = y;
  t[i * 3 + 2] = z;
}

const _q = new Quaternion();

/** The leg anchors the stance keeps under the root (see drive()). */
const LEG_ANCHORS: ReadonlyArray<readonly [number]> = [
  [A.KNEE_L],
  [A.KNEE_R],
  [A.BASE_L],
  [A.BASE_R],
  [A.BASE_F],
  [A.BASE_B],
];

/* ────────────────────────── the wire's springs ──────────────────────────
 * The remote fighter's TrackedPose is rebuilt from 15 Hz samples through
 * critically damped springs: velocity-continuous tracking, no corner at
 * every packet, and never an invented bounce. (The gel's own underdamped
 * springs sit beneath and put the wobble back.)
 */

class DampedV3 {
  readonly pos = new Vector3();
  private vel = new Vector3();
  private started = false;

  /** ω ≈ how stiffly we chase (rad/s). 18 tracks a 15 Hz wire cleanly. */
  constructor(private omega = 18) {}

  reset(to: Vector3): void {
    this.pos.copy(to);
    this.vel.set(0, 0, 0);
    this.started = true;
  }

  step(target: Vector3, dt: number): Vector3 {
    if (!finiteV(target)) return this.pos; // poison shrugged off
    if (!this.started) {
      this.reset(target);
      return this.pos;
    }
    // Critically damped: x'' = ω²(target−x) − 2ω x', semi-implicit Euler.
    const w = this.omega;
    const h = Math.min(dt, 1 / 20);
    this.vel.x += (w * w * (target.x - this.pos.x) - 2 * w * this.vel.x) * h;
    this.vel.y += (w * w * (target.y - this.pos.y) - 2 * w * this.vel.y) * h;
    this.vel.z += (w * w * (target.z - this.pos.z) - 2 * w * this.vel.z) * h;
    this.pos.addScaledVector(this.vel, h);
    return this.pos;
  }

  /** Live speed of the smoothed point (m/s) — the remote's punch speed. */
  get speed(): number {
    return this.vel.length();
  }
}

/**
 * Rebuilds a smooth TrackedPose from sparse wire samples. Feed samples as
 * they arrive (`push`), read a continuous pose every frame (`sample`).
 */
export class WirePose {
  private readonly head = new DampedV3(16);
  private readonly handL = new DampedV3(20);
  private readonly handR = new DampedV3(20);
  private readonly targetHead = new Vector3();
  private readonly targetL = new Vector3();
  private readonly targetR = new Vector3();
  private readonly quat = new Quaternion();
  private readonly targetQuat = new Quaternion();
  private hasSample = false;
  private lastSampleAt = 0;

  /** A wire sample in MY world space (already seat-transformed). */
  push(head: Vector3, headQuat: Quaternion, handL: Vector3, handR: Vector3): void {
    if (!finiteV(head) || !finiteV(handL) || !finiteV(handR)) return;
    if (![headQuat.x, headQuat.y, headQuat.z, headQuat.w].every(fin)) return;
    this.targetHead.copy(head);
    this.targetQuat.copy(headQuat);
    this.targetL.copy(handL);
    this.targetR.copy(handR);
    if (!this.hasSample) {
      this.head.reset(head);
      this.handL.reset(handL);
      this.handR.reset(handR);
      this.quat.copy(headQuat);
    }
    this.hasSample = true;
    this.lastSampleAt = performance.now();
  }

  get live(): boolean {
    return this.hasSample;
  }

  /** ms since the last wire sample (staleness gate). */
  get ageMs(): number {
    return this.hasSample ? performance.now() - this.lastSampleAt : Infinity;
  }

  /** Advance the springs and fill `out` for EmbodyRig.drive(). */
  sample(dt: number, out: TrackedPose): boolean {
    if (!this.hasSample) return false;
    out.head.copy(this.head.step(this.targetHead, dt));
    out.handL.copy(this.handL.step(this.targetL, dt));
    out.handR.copy(this.handR.step(this.targetR, dt));
    // Heads chase exponentially (an overshooting head reads drunk).
    this.quat.slerp(this.targetQuat, Math.min(1, dt * 12));
    out.headQuat.copy(this.quat);
    out.speedL = this.handL.speed;
    out.speedR = this.handR.speed;
    return true;
  }
}
