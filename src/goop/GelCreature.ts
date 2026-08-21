/**
 * THE GOOP — a whole fighter as one self-contained Three.js citizen.
 * Vendored from the GOOP lineage and evolved for SLUGFEST, where there are
 * TWO of these in the ring and one of them is YOU.
 *
 * Owns the blob sim, the raymarched gel mesh, the contact shadow, its own
 * body-noises, and the punch-throwing animation. (No eyes — SLUGFEST's
 * fighters read through SILHOUETTE: the defined head, the stance, the
 * telegraph flash. A creature with your face doesn't need beads.) Knows
 * nothing about IWSDK, XR or the bout rules: systems above feed it a look
 * target and steering, and ask it to form up, swing, or take a punch.
 *
 * Two driving modes:
 *
 *  - 'ai'     — the vendored fighter: throwAttack() runs the full
 *               telegraph→strike→recover choreography (the practice bot).
 *  - 'puppet' — the body is DRIVEN: an EmbodyRig (goop/embody.ts) writes
 *               sim offsets/pins straight from tracked hardware (you) or
 *               from the wire (your opponent). The attack timeline stands
 *               down entirely; the springs, the leash, the swell, dents,
 *               lumps and drips all stay live — the body remains gel, it
 *               just answers to a human.
 *
 * First-person (`firstPerson: true`): the head/neck blobs are masked out of
 * the RENDER (you'd wear them as a gel helmet). Physics and the CPU field
 * keep the whole body — what your opponent's client simulates and punches
 * is always all of you.
 *
 * SCALE: `opts.scale` puts a uniform parent scale on the whole fighter.
 * The sim stays native man-size inside; every world↔local seam in this
 * class converts honestly (a world signed-distance is local × scale, a
 * world impact speed is local speed × scale), so callers never think
 * about it.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { ATTACKS, CREATURE, GEL_LOOK, type AttackName } from './goopConfig.js';
import * as sfx from '../audio/sfx.js';
import type { GooFx } from './splats.js';
import { createGelMaterial, type GelUniforms } from './gelMaterial.js';
import { A, ANCHOR_COUNT, BOXER_POSE } from './poses.js';
import type { StylePoseDelta } from './styles.js';
import { GoopSim, type PunchResult } from './sim.js';

export type Hand = 'left' | 'right';

export interface CreatureOptions {
  /** Body colours (defaults to the classic green — GEL_LOOK). */
  tint?: { shallow: number; deep: number; nucleus: number } | null;
  /** The fighter you inhabit: head/neck unrendered. */
  firstPerson?: boolean;
  /** Uniform parent scale on the whole fighter (1 = man-sized). */
  scale?: number;
}

interface ActiveAttack {
  name: AttackName;
  hand: Hand;
  /** Seconds since the attack began. */
  t: number;
  /** Where the strike is going, creature-local (snapshotted at wind-up). */
  target: Vector3;
  apexFired: boolean;
  whooshFired: boolean;
  onApex?: (limbWorld: Vector3, hand: Hand) => void;
  onDone?: () => void;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Quadratic bezier, written out (no allocs in the strike loop). */
function bez(a: number, b: number, c: number, t: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(6, 14, 8, 0.55)');
  grad.addColorStop(0.7, 'rgba(6, 14, 8, 0.28)');
  grad.addColorStop(1, 'rgba(6, 14, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export class GelCreature {
  readonly group = new Group();
  readonly sim = new GoopSim();
  /** See the header: 'ai' runs the strike choreography, 'puppet' is driven. */
  mode: 'ai' | 'puppet' = 'ai';
  readonly firstPerson: boolean;
  /** Uniform parent scale (see the header). */
  readonly scale: number;

  private gel: GelUniforms;
  private gelMesh: Mesh;
  private shadow: Mesh;

  /** 0 glob .. 1 boxer (the eased live value; target set from outside). */
  private form = 0;
  private formTarget = 0;
  private koVal = 0;
  private koTarget = 0;

  /** Telegraph glow 0..1 (drives shader flash + eye colour). */
  private telegraph = 0;

  /** Difficulty tempo: scales the telegraph + recovery (1 = base). */
  tempoScale = 1;
  /** How fast the body eases into a new style pose (per second). */
  styleEase = 1.6;
  /** Fixed raymarch quality (null = distance LOD). */
  qualityOverride: number | null = null;
  /** True while it's a downed puddle — the ten count is running. */
  vulnerable = false;
  /** Movement urgency: 1 = ooze, higher = lurch. */
  moveSpeedScale = 1;

  private attack: ActiveAttack | null = null;
  /** Extra body yaw layered over face-tracking — the spinning backfist. */
  private extraYaw = 0;

  private rootTarget = new Vector3();
  private facePoint = new Vector3();
  private prevPos = new Vector3();
  private prevVel = new Vector3();
  private yaw = 0;

  /** Puppet-mode WORLD-SPACE pins (the tracked fists). Localised fresh
   *  each frame AFTER root motion, so the glove is never a frame behind
   *  the hand however hard the body whips. EmbodyRig fills this. */
  readonly puppetPins: { anchor: number; pos: Vector3 }[] = [];

  private time = 0;

  /** Fighting-style silhouette targets (sim eases toward these). */
  private styleO = new Float32Array(ANCHOR_COUNT * 3);
  private styleR = new Float32Array(ANCHOR_COUNT).fill(1);

  constructor(
    private fx: GooFx,
    opts: CreatureOptions = {},
  ) {
    this.group.name = 'goop-fighter';
    this.firstPerson = opts.firstPerson === true;
    this.scale = opts.scale && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
    this.group.scale.setScalar(this.scale);

    this.gel = createGelMaterial();
    this.gelMesh = new Mesh(new BoxGeometry(2, 2, 2), this.gel.material);
    this.gelMesh.frustumCulled = false;
    // Deterministic transparent order: the fighter you inhabit draws after
    // your opponent, so an arm thrown across their body blends over their
    // surface (both write true fragDepth, so occlusion stays honest).
    this.gelMesh.renderOrder = this.firstPerson ? 3 : 2;
    this.group.add(this.gelMesh);

    if (opts.tint) this.tint(opts.tint);

    // Contact shadow — grounds the fighter on the mat.
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.003;
    this.shadow.renderOrder = 0;
    this.group.add(this.shadow);

    if (this.firstPerson) {
      // Your own head is not for your own eyes.
      this.sim.renderSkip[A.HEAD] = 1;
      this.sim.renderSkip[A.NECK] = 1;
    }

    // The sim narrates; the creature makes the noises and the mess.
    this.sim.events = {
      onSplat: (pos, r, hard) => {
        this.group.updateMatrixWorld();
        _v3.copy(pos);
        this.group.localToWorld(_v3);
        this.fx.splat(_v3, Math.max(0.16, r * 3.2));
        sfx.splat(hard ? 0.8 : Math.min(0.6, r * 5));
      },
      onAbsorb: () => sfx.slurp(),
    };
  }

  // ------------------------------------------------------------ public state

  get formValue(): number {
    return this.form;
  }

  get isKo(): boolean {
    return this.koTarget > 0.5;
  }

  /** Ask it to become the boxer (1) or slump back into the glob (0). */
  setFormTarget(f: 0 | 1): void {
    if (this.formTarget === f || this.koTarget > 0) return;
    this.formTarget = f;
    if (f === 1) sfx.gooRise();
    else sfx.gooSink();
  }

  /**
   * Adopt a FIGHTING STYLE's silhouette — or null for the neutral stance.
   * The body oozes into the new shape; nothing is announced, the re-poured
   * stance IS the tell. (AI fighters only; a puppet wears its human.)
   */
  setFightStyle(pose: ReadonlyArray<StylePoseDelta> | null): void {
    this.styleO.fill(0);
    this.styleR.fill(1);
    if (pose) {
      for (const [i, dx, dy, dz, rs] of pose) {
        this.styleO[i * 3] = dx;
        this.styleO[i * 3 + 1] = dy;
        this.styleO[i * 3 + 2] = dz;
        this.styleR[i] = rs;
      }
    }
  }

  /**
   * Warm start: skip the glob morph and the springs' settling — the body
   * comes up FORMED and converged. Rebuilds mid-session (rematch, tint
   * change, bout start) use this so a fresh first-person body never pours
   * through its wearer's eyes; drive the puppet offsets once BEFORE
   * calling it so the settle lands on the real pose.
   */
  primeFormed(): void {
    this.form = 1;
    this.formTarget = 1;
    this.sim.form = 1;
    if (this.mode === 'puppet' && this.koTarget === 0) {
      for (const p of this.puppetPins) {
        _v.copy(p.pos);
        this.group.updateMatrixWorld();
        this.group.worldToLocal(_v);
        this.sim.pin(p.anchor, _v.x, _v.y, _v.z);
      }
    }
    for (let i = 0; i < 70; i++) this.sim.update(1 / 60);
  }

  /** Knock it out (or stand it back up for the next round). */
  setKo(down: boolean): void {
    if (down === this.koTarget > 0.5) return;
    this.koTarget = down ? 1 : 0;
    if (down) {
      this.attack = null;
      this.extraYaw = 0;
      this.telegraph = 0;
      this.sim.clearPins();
      sfx.koSplat();
    } else {
      this.sim.reabsorbAll();
      sfx.gooRise();
    }
  }

  /** DANCE RAID patch, kept: recolour the whole gel. Null restores green. */
  tint(t: { shallow: number; deep: number; nucleus: number } | null): void {
    const u = this.gel.material.uniforms;
    (u.uShallow.value as Color).setHex(t ? t.shallow : GEL_LOOK.shallowColor);
    (u.uDeep.value as Color).setHex(t ? t.deep : GEL_LOOK.deepColor);
    (u.uNucleus.value as Color).setHex(t ? t.nucleus : GEL_LOOK.nucleusColor);
  }

  /** Steering: where the body should ooze/step to (world). */
  moveTo(worldPos: Vector3): void {
    this.rootTarget.copy(worldPos);
    this.rootTarget.y = 0;
  }

  /** What it should face (world) — normally the opponent's head. */
  faceToward(worldPos: Vector3): void {
    this.facePoint.copy(worldPos);
  }

  /** Snap the body's facing instantly (rebuild warm starts — the yaw
   *  normally eases, and a fresh body settling 180° backwards would whip
   *  round through its wearer). */
  snapYaw(yaw: number): void {
    this.yaw = yaw;
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld();
  }

  /** World-space position of the creature root. */
  get position(): Vector3 {
    return this.group.position;
  }

  /** Current body yaw (root facing). */
  get bodyYaw(): number {
    return this.yaw + this.extraYaw;
  }

  headWorld(out: Vector3): Vector3 {
    this.sim.corePos(A.HEAD, out);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out);
  }

  fistWorld(hand: Hand, out: Vector3): Vector3 {
    this.sim.corePos(hand === 'left' ? A.FIST_L : A.FIST_R, out);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out);
  }

  /** Signed distance from a world point to the gel surface, in WORLD
   *  metres (the local field × the parent scale). */
  fieldAtWorld(p: Vector3): number {
    this.group.updateMatrixWorld();
    _v.copy(p);
    this.group.worldToLocal(_v);
    return this.sim.fieldAt(_v) * this.scale;
  }

  // ---------------------------------------------------------------- attacks

  get isPunching(): boolean {
    return this.attack !== null;
  }

  /**
   * Wind up and deliver a named strike at a world point (AI mode). Fires
   * `onApex` at full extension with the striking blob's world position (the
   * bot brain checks the hit there). Every attack telegraphs in its own
   * readable silhouette — that IS the dodge language.
   */
  throwAttack(
    name: AttackName,
    hand: Hand,
    targetWorld: Vector3,
    onApex?: (limbWorld: Vector3, hand: Hand) => void,
    onDone?: () => void,
  ): boolean {
    if (this.mode !== 'ai') return false;
    if (this.attack || this.koTarget > 0 || this.form < 0.7) return false;
    this.group.updateMatrixWorld();
    const target = new Vector3().copy(targetWorld);
    this.group.worldToLocal(target);
    // Cap reach so the limb stretches heroically but not absurdly.
    const shoulder = hand === 'left' ? BOXER_POSE[A.SHOULDER_L] : BOXER_POSE[A.SHOULDER_R];
    _v.set(target.x - shoulder[0], target.y - shoulder[1], target.z - shoulder[2]);
    const reach = _v.length();
    // Kicks stretch furthest; the clap gets long arms too — both gel limbs
    // swing round from wide, so it closes distance a normal punch can't.
    const maxReach = name === 'roundhouse' || name === 'spinkick' || name === 'clap' ? 1.45 : 1.25;
    if (reach > maxReach) {
      _v.multiplyScalar(maxReach / reach);
      target.set(shoulder[0] + _v.x, shoulder[1] + _v.y, shoulder[2] + _v.z);
    }
    // A kick lands at chest/chin height, not orbit.
    if (name === 'roundhouse' || name === 'spinkick') target.y = Math.min(target.y, 1.5);
    this.attack = { name, hand, t: 0, target, apexFired: false, whooshFired: false, onApex, onDone };
    sfx.gooCharge(ATTACKS[name].telegraph * this.tempoScale);
    return true;
  }

  /** A fist arriving. Returns what the gel made of it. */
  receivePunchWorld(point: Vector3, dir: Vector3, speed: number): PunchResult {
    this.group.updateMatrixWorld();
    _v.copy(point);
    this.group.worldToLocal(_v);
    _q.copy(this.group.quaternion).invert();
    _v2.copy(dir).applyQuaternion(_q);
    const res = this.sim.punchAt(_v, _v2, speed / this.scale);
    if (res.hit) {
      // Fewer droplets — the deformation carries the impact.
      this.fx.burst(point, dir, 2 + Math.round(res.strength * 5), speed);
      if (res.lump) sfx.tear();
    }
    return res;
  }

  /** A slow fist pressing into it — gentle shove, playful wobble. */
  pokeWorld(point: Vector3, dir: Vector3, speed: number): boolean {
    this.group.updateMatrixWorld();
    _v.copy(point);
    this.group.worldToLocal(_v);
    _q.copy(this.group.quaternion).invert();
    _v2.copy(dir).applyQuaternion(_q);
    return this.sim.pokeAt(_v, _v2, speed / this.scale);
  }

  /** Tear the whole fighter down (a rematch builds a fresh one). */
  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
    (this.shadow.material as MeshBasicMaterial).map?.dispose();
    this.group.removeFromParent();
  }

  // ----------------------------------------------------------------- update

  /** `lookWorld`: what the LOD measures against — the LOCAL PLAYER's head
   *  on both fighters. Puppet offsets/pins must already be written for
   *  this frame. */
  update(dt: number, lookWorld: Vector3): void {
    this.time += dt;

    // Ease form + KO.
    const formRate = dt / CREATURE.formTime;
    this.form += Math.sign(this.formTarget - this.form) * Math.min(formRate, Math.abs(this.formTarget - this.form));
    const koRate = dt / 0.7; // collapse is fast, standing up uses form time
    const koStep = this.koTarget > this.koVal ? koRate : dt / CREATURE.formTime;
    this.koVal += Math.sign(this.koTarget - this.koVal) * Math.min(koStep, Math.abs(this.koTarget - this.koVal));
    this.sim.form = this.form;
    this.sim.ko = this.koVal;

    // --- root motion: ooze (or lurch) toward the steering target ---
    const speed = this.koTarget > 0 ? 0 : (0.5 + this.form * 0.4) * this.moveSpeedScale;
    _v.copy(this.rootTarget).sub(this.group.position);
    _v.y = 0;
    const dist = _v.length();
    if (dist > 0.02) {
      const step = Math.min(dist, speed * dt * Math.min(1, dist * 2.2));
      this.group.position.addScaledVector(_v.normalize(), step);
    }

    // Face the face-point (yaw only, springy) — unless mid-spin: the
    // backfist/spinkick own the body's rotation while coiling/whipping.
    if (this.attack?.name !== 'backfist' && this.attack?.name !== 'spinkick') {
      _v.copy(this.facePoint).sub(this.group.position);
      const targetYaw = Math.atan2(_v.x, _v.z);
      let dYaw = targetYaw - this.yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      this.yaw += dYaw * Math.min(1, dt * (1.5 + this.form * 2.5));
    }
    this.group.rotation.set(0, this.yaw + this.extraYaw, 0);

    // Inertia: the gel lags when the root accelerates.
    if (dt > 1e-4) {
      _v.copy(this.group.position).sub(this.prevPos).divideScalar(dt);
      _v2.copy(_v).sub(this.prevVel);
      this.prevVel.copy(_v);
      this.prevPos.copy(this.group.position);
      _q.copy(this.group.quaternion).invert();
      _v2.applyQuaternion(_q);
      _v2.divideScalar(this.scale); // world m/s -> native sim units
      const cap = 6;
      _v2.clampLength(0, cap);
      this.sim.applyInertia(-_v2.x * 0.5, -_v2.y * 0.5, -_v2.z * 0.5);
    }

    this.group.updateMatrixWorld();

    // --- fighting-style silhouette: ooze toward the active stance ---
    const sk = Math.min(1, dt * this.styleEase);
    for (let i = 0; i < this.styleO.length; i++) {
      this.sim.styleOffsets[i] += (this.styleO[i] - this.sim.styleOffsets[i]) * sk;
    }
    for (let i = 0; i < this.styleR.length; i++) {
      this.sim.styleRadius[i] += (this.styleR[i] - this.sim.styleRadius[i]) * sk;
    }

    // --- attack timeline (AI) / the puppeteer's frame (puppet) ---
    if (this.mode === 'ai') {
      this.updateAttack(dt);
    } else {
      // A puppet's offsets, radius scales and blendScale were written by
      // its EmbodyRig before this call; the fist pins are world-space and
      // localised HERE — after the root moved — so they land exactly.
      this.telegraph = Math.max(0, this.telegraph - dt * 6);
      if (this.koTarget === 0 && this.form > 0.65) {
        for (const p of this.puppetPins) {
          _v.copy(p.pos);
          this.group.worldToLocal(_v);
          this.sim.pin(p.anchor, _v.x, _v.y, _v.z);
        }
      }
    }

    // --- simulate the body ---
    this.sim.update(dt);

    // --- feed the renderer ---
    this.sim.bounds(_v, _v2);
    this.gelMesh.updateMatrixWorld();
    _m.copy(this.gelMesh.matrixWorld).invert();
    this.gel.update(
      this.sim.packed,
      this.sim.packedCount,
      this.sim.packedDents,
      this.sim.packedDentCount,
      _v,
      _v2,
      this.time,
      this.sim.agitation,
      this.telegraph,
      _m,
    );
    // Strike-time blend widening — shader stays in lock-step with the CPU field.
    this.gel.material.uniforms.uBlend.value = CREATURE.blend * this.sim.blendScale;
    // First person: your own gel fades in only once the body has FORMED —
    // the mid-morph blob would otherwise pour straight through your eyes
    // as a green veil at every bout start. A ghost of you stays visible
    // slumped in the corner (rest) so looking down never reads as empty.
    // CAPPED well under full: at the big body scale your own shoulders and
    // chest live at the edge of view, and self-gel at foe opacity washes
    // the whole world green — presence, not a veil.
    if (this.firstPerson) {
      const formed = Math.max(0, Math.min(1, (this.form - 0.86) / 0.12));
      this.gel.material.uniforms.uFade.value = 0.22 + 0.36 * formed;
    }

    // Shadow hugs the current mass footprint.
    const spread = Math.max(_v2.x, _v2.z) * 2.4;
    this.shadow.scale.set(spread, spread, 1);
    this.shadow.position.x = _v.x;
    this.shadow.position.z = _v.z;
    (this.shadow.material as MeshBasicMaterial).opacity = 0.5 + this.koVal * 0.2;

    // Distance LOD: past ~3.5 body-heights the full step budget is
    // invisible — shed it. (Fighters normally carry a qualityOverride.)
    const near = 3.5 * this.scale;
    const camDist = this.group.position.distanceTo(lookWorld);
    this.gel.setQuality(this.qualityOverride ?? (camDist < near ? 1 : near / camDist));
  }

  /**
   * The moveset choreography (AI mode). Every attack is telegraph → strike
   * → recover: the telegraph is offset-driven (springy, organic, READABLE —
   * each move has its own silhouette), the strike PINS the striking blob to
   * a kinematic path (a spring can't chase a 0.2 s strike; without the pin
   * every swing whiffs), and recovery hands the extended limb back to the
   * spring for the snap-back wobble.
   */
  private updateAttack(dt: number): void {
    const a = this.attack;
    this.sim.offsets.fill(0);
    this.sim.radiusScale.fill(1);
    this.sim.clearPins(); // the strike phase below re-pins each frame
    if (!a) {
      this.extraYaw = 0;
      this.sim.blendScale = 1;
      this.telegraph = Math.max(0, this.telegraph - dt * 6);
      return;
    }

    a.t += dt;
    const spec = ATTACKS[a.name];
    // Difficulty stretches the readable parts; the strike stays snappy.
    const T = spec.telegraph * this.tempoScale;
    const S = spec.strike;
    const R = spec.recover * this.tempoScale;

    const left = a.hand === 'left';
    const kick = a.name === 'roundhouse' || a.name === 'spinkick';
    const limbI = kick ? (left ? A.KNEE_L : A.KNEE_R) : left ? A.FIST_L : A.FIST_R;
    const elbowI = left ? A.ELBOW_L : A.ELBOW_R;
    const shoulderI = left ? A.SHOULDER_L : A.SHOULDER_R;
    const hipI = left ? A.HIP_L : A.HIP_R;
    const baseI = left ? A.BASE_L : A.BASE_R;
    const side = left ? -1 : 1; // this limb's outward X
    const base = BOXER_POSE[limbI];

    // Aim from the limb's rest pose to the snapshotted target.
    _v.set(a.target.x - base[0], a.target.y - base[1], a.target.z - base[2]);
    const aimLen = Math.max(_v.length(), 1e-4);
    const ax = _v.x / aimLen;
    const ay = _v.y / aimLen;
    const az = _v.z / aimLen;

    // Target's horizontal bearing from the body centre (spin + kick paths).
    const hd = Math.max(Math.hypot(a.target.x, a.target.z), 1e-4);
    const dirX = a.target.x / hd;
    const dirZ = a.target.z / hd;

    const o = this.sim.offsets;
    const put = (i: number, x: number, y: number, z: number): void => {
      o[i * 3] += x;
      o[i * 3 + 1] += y;
      o[i * 3 + 2] += z;
    };

    // ---- CLAP: the two-handed slap ----
    // Unlike every other move this is BOTH arms at once — they rear up and
    // out wide, then swing together and smack in the middle where your head
    // is. Handled entirely here (own telegraph/strike/recover), then return.
    if (a.name === 'clap') {
      const hd2 = Math.max(Math.hypot(a.target.x, a.target.z), 1e-4);
      const reach = Math.min(hd2, 1.35); // long arms — the clap closes real distance
      const mX = (a.target.x / hd2) * reach; // meet point: centred in front,
      const mY = a.target.y; //                at your head height,
      const mZ = (a.target.z / hd2) * reach; //  where the clap lands.
      const lb = BOXER_POSE[A.FIST_L];
      const rb = BOXER_POSE[A.FIST_R];
      // Wound-up wide-open pose — arms reared up and thrown out to the sides.
      const wlx = -0.52;
      const wrx = 0.52;
      const wy = 1.66;
      const wz = 0.1;

      let lx = lb[0];
      let ly = lb[1];
      let lz = lb[2];
      let rx = rb[0];
      let ry = rb[1];
      let rz = rb[2];
      let sw = 1;
      let mid = 1;

      if (a.t < T) {
        const k = easeOutCubic(a.t / T);
        this.telegraph = Math.min(1, this.telegraph + dt * 3.5);
        this.sim.blendScale = 1 + 0.4 * k;
        lx = lb[0] + (wlx - lb[0]) * k;
        ly = lb[1] + (wy - lb[1]) * k;
        lz = lb[2] + (wz - lb[2]) * k;
        rx = rb[0] + (wrx - rb[0]) * k;
        ry = rb[1] + (wy - rb[1]) * k;
        rz = rb[2] + (wz - rb[2]) * k;
        sw = 1 + 0.4 * k;
        mid = 1 + 0.35 * k;
        put(A.CHEST_L, -0.05 * k, 0.02 * k, -0.05 * k);
        put(A.CHEST_R, 0.05 * k, 0.02 * k, -0.05 * k);
      } else if (a.t < T + S) {
        const k = easeOutCubic((a.t - T) / S);
        this.telegraph = Math.max(0, this.telegraph - dt * 10);
        if (!a.whooshFired) {
          a.whooshFired = true;
          sfx.gooWhoosh();
        }
        lx = wlx + (mX - wlx) * k;
        ly = wy + (mY - wy) * k;
        lz = wz + (mZ - wz) * k;
        rx = wrx + (mX - wrx) * k;
        ry = wy + (mY - wy) * k;
        rz = wz + (mZ - wz) * k;
        sw = 1.5;
        mid = 1.5;
        this.sim.blendScale = 1.4;
        // Pin the right hand to its slam path so the clap lands on time;
        // the left chases into the same point and they smack together.
        this.sim.pin(A.FIST_R, rx, ry, rz);
        if (!a.apexFired && k > 0.86) {
          a.apexFired = true;
          sfx.gooSlam();
          _v3.set(mX, mY, mZ);
          this.group.updateMatrixWorld();
          this.group.localToWorld(_v3);
          a.onApex?.(_v3, a.hand);
        }
      } else if (a.t < T + S + R) {
        const k = 1 - easeOutCubic((a.t - T - S) / R);
        lx = lb[0] + (mX - lb[0]) * k;
        ly = lb[1] + (mY - lb[1]) * k;
        lz = lb[2] + (mZ - lb[2]) * k;
        rx = rb[0] + (mX - rb[0]) * k;
        ry = rb[1] + (mY - rb[1]) * k;
        rz = rb[2] + (mZ - rb[2]) * k;
        sw = 1 + 0.45 * k;
        mid = 1 + 0.4 * k;
        this.sim.blendScale = 1 + 0.35 * k;
      } else {
        const done = a.onDone;
        this.attack = null;
        this.extraYaw = 0;
        done?.();
        return;
      }

      const placeArm = (fistI: number, elbowI2: number, shoulderI2: number, X: number, Y: number, Z: number): void => {
        const fb = BOXER_POSE[fistI];
        put(fistI, X - fb[0], Y - fb[1], Z - fb[2]);
        const eb = BOXER_POSE[elbowI2];
        const shb = BOXER_POSE[shoulderI2];
        o[elbowI2 * 3] += shb[0] + (X - shb[0]) * 0.6 - eb[0];
        o[elbowI2 * 3 + 1] += shb[1] + (Y - shb[1]) * 0.6 - eb[1];
        o[elbowI2 * 3 + 2] += shb[2] + (Z - shb[2]) * 0.6 - eb[2];
        this.sim.radiusScale[fistI] = sw;
        this.sim.radiusScale[elbowI2] = mid;
      };
      placeArm(A.FIST_L, A.ELBOW_L, A.SHOULDER_L, lx, ly, lz);
      placeArm(A.FIST_R, A.ELBOW_R, A.SHOULDER_R, rx, ry, rz);
      put(A.BELLY, 0, 0, 0.04);
      return;
    }

    /** The strike path — where the striking blob is at strike-phase k. */
    const pathAt = (k: number, out: { x: number; y: number; z: number }): void => {
      const e = easeOutCubic(k);
      switch (a.name) {
        case 'jab':
        case 'cross': {
          // Straight line from the windup pullback to the target.
          const w = a.name === 'jab' ? 0.14 : 0.26;
          out.x = base[0] - ax * w + (a.target.x - base[0] + ax * w) * e;
          out.y = base[1] - ay * w + (a.target.y - base[1] + ay * w) * e;
          out.z = base[2] - az * w + (a.target.z - base[2] + az * w) * e;
          break;
        }
        case 'hook': {
          // Wide horizontal arc: out to the side, then curving in.
          out.x = bez(base[0] + side * 0.38, (base[0] + a.target.x) / 2 + side * 0.5, a.target.x, e);
          out.y = bez(base[1] + 0.08, (base[1] + a.target.y) / 2 + 0.06, a.target.y, e);
          out.z = bez(base[2] - 0.1, (base[2] + a.target.z) / 2, a.target.z, e);
          break;
        }
        case 'uppercut': {
          // Drop low, then rocket up through the chin.
          out.x = bez(base[0], a.target.x, a.target.x, e);
          out.y = bez(base[1] - 0.5, a.target.y - 0.45, a.target.y + 0.08, e);
          out.z = bez(base[2] + 0.02, a.target.z - 0.12, a.target.z, e);
          break;
        }
        case 'overhand': {
          // The big looping right: high and back, over the top, crashing
          // DOWN onto the head at the end of the arc.
          out.x = bez(base[0] + side * 0.12, (base[0] + a.target.x) / 2 + side * 0.15, a.target.x, e);
          out.y = bez(base[1] + 0.48, Math.max(base[1] + 0.62, a.target.y + 0.5), a.target.y - 0.04, e);
          out.z = bez(base[2] - 0.28, (base[2] + a.target.z) / 2, a.target.z, e);
          break;
        }
        case 'backfist': {
          // Arm held rigid at extension; the BODY's spin delivers it.
          const ext = Math.min(Math.max(hd, 0.55), 1.0);
          out.x = dirX * ext;
          out.y = a.target.y;
          out.z = dirZ * ext;
          break;
        }
        case 'roundhouse': {
          // The puddle skirt whips up into a leg sweeping a horizontal arc.
          const theta = side * 1.9 * (1 - e);
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          const r = 0.5 + (Math.min(hd, 1.35) - 0.5) * e;
          out.x = (dirX * cos + dirZ * sin) * r;
          out.z = (-dirX * sin + dirZ * cos) * r;
          out.y = 0.3 + (a.target.y - 0.3) * e;
          break;
        }
        case 'spinkick': {
          // SPINNING BACK KICK: the leg is held out rigid and the whole body
          // rotates through it, rising from the floor to chest height.
          const ext = 0.55 + (Math.min(hd, 1.4) - 0.55) * e;
          out.x = dirX * ext;
          out.z = dirZ * ext;
          out.y = 0.28 + (a.target.y - 0.28) * e;
          break;
        }
      }
    };

    let fx = 0;
    let fy = 0;
    let fz = 0;
    let swell = 1;
    let midSwell = 1; // the elbow/hip fattens with the stretch — keeps the
    // extended limb one continuous rope instead of beads on a string

    if (a.t < T) {
      // ---- telegraph: each attack's own readable silhouette ----
      const k = easeOutCubic(a.t / T);
      this.telegraph = Math.min(1, this.telegraph + dt * 3.5);
      // Fatten the whole body's fuse as the arm lifts, and swell the mid
      // joint, so the raised fist stays connected by a thick neck.
      this.sim.blendScale = 1 + 0.35 * k;
      midSwell = 1 + 0.35 * k;
      switch (a.name) {
        case 'jab':
          fx = -ax * 0.14 * k;
          fy = -ay * 0.14 * k;
          fz = -az * 0.14 * k;
          swell = 1 + 0.25 * k;
          break;
        case 'cross':
          fx = -ax * 0.26 * k;
          fy = -0.06 * k;
          fz = -az * 0.26 * k;
          swell = 1 + 0.45 * k;
          break;
        case 'hook':
          fx = side * 0.38 * k;
          fy = 0.08 * k;
          fz = -0.1 * k;
          swell = 1 + 0.4 * k;
          put(elbowI, side * 0.3 * k, 0.16 * k, -0.05 * k);
          break;
        case 'uppercut':
          fy = -0.5 * k;
          fz = 0.02 * k;
          swell = 1 + 0.4 * k;
          put(elbowI, 0, -0.3 * k, 0);
          break;
        case 'overhand':
          // Fist climbs high behind the shoulder; the body rears back.
          fx = side * 0.12 * k;
          fy = 0.48 * k;
          fz = -0.28 * k;
          swell = 1 + 0.45 * k;
          put(elbowI, side * 0.1 * k, 0.3 * k, -0.18 * k);
          put(A.CHEST_L, 0, 0.03 * k, -0.07 * k);
          put(A.CHEST_R, 0, 0.03 * k, -0.07 * k);
          break;
        case 'backfist':
          // Coil the whole body the wrong way — the unmistakable wind-up.
          this.extraYaw = -0.9 * side * k;
          fx = -side * 0.3 * k;
          fy = 0.05 * k;
          fz = -0.08 * k;
          swell = 1 + 0.35 * k;
          put(shoulderI, -side * 0.12 * k, 0, 0);
          break;
        case 'roundhouse':
          // Mass shifts off the kicking side; the skirt gathers.
          fx = -side * 0.12 * k;
          fy = 0.05 * k;
          fz = -0.15 * k;
          swell = 1 + 0.5 * k;
          put(hipI, -side * 0.08 * k, 0.05 * k, -0.08 * k);
          put(A.CHEST_L, -side * 0.1 * k, 0, 0);
          put(A.CHEST_R, -side * 0.1 * k, 0, 0);
          break;
        case 'spinkick':
          // Coil the body the wrong way (like the backfist) AND gather the
          // leg — the unmistakable spinning-kick wind-up.
          this.extraYaw = -0.8 * side * k;
          fx = -side * 0.1 * k;
          fy = 0.06 * k;
          fz = -0.16 * k;
          swell = 1 + 0.5 * k;
          put(hipI, -side * 0.1 * k, 0.04 * k, -0.1 * k);
          put(A.CHEST_L, -side * 0.12 * k, 0, 0);
          put(A.CHEST_R, -side * 0.12 * k, 0, 0);
          break;
      }
    } else if (a.t < T + S) {
      // ---- strike: pin the limb to the path ----
      const k = (a.t - T) / S;
      this.telegraph = Math.max(0, this.telegraph - dt * 10);
      if (!a.whooshFired) {
        a.whooshFired = true;
        if (a.name === 'backfist') sfx.spinWhoosh();
        else if (a.name === 'roundhouse' || a.name === 'spinkick') sfx.kickWhoosh();
        else sfx.gooWhoosh();
      }
      if (a.name === 'backfist') {
        // The spin itself: coil releases through a full rotation.
        this.extraYaw = side * (-0.9 + (Math.PI * 2 + 0.9) * easeInOut(k));
      } else if (a.name === 'spinkick') {
        // Body spins through the leg — a touch under a full turn to face you.
        this.extraYaw = side * (-0.8 + (Math.PI * 1.9 + 0.8) * easeInOut(k));
      }
      pathAt(k, this._pin);
      fx = this._pin.x - base[0];
      fy = this._pin.y - base[1];
      fz = this._pin.z - base[2];
      swell = kick ? 1.35 : 1.45;
      midSwell = 1.5;
      this.sim.blendScale = 1.35;
      this.sim.pin(limbI, this._pin.x, this._pin.y, this._pin.z);
      const apexK = a.name === 'backfist' ? 0.93 : 0.9;
      if (!a.apexFired && k > apexK) {
        a.apexFired = true;
        // Report the path END (full extension), not last frame's blob.
        pathAt(1, this._pin);
        _v3.set(this._pin.x, this._pin.y, this._pin.z);
        this.group.updateMatrixWorld();
        this.group.localToWorld(_v3);
        a.onApex?.(_v3, a.hand);
      }
    } else if (a.t < T + S + R) {
      // ---- recover: hand the extended limb back to the springs ----
      const k = 1 - easeOutCubic((a.t - T - S) / R);
      this.extraYaw = 0; // 2π ≡ 0 — the spin lands facing you again
      pathAt(1, this._pin);
      fx = (this._pin.x - base[0]) * k;
      fy = (this._pin.y - base[1]) * k;
      fz = (this._pin.z - base[2]) * k;
      swell = 1 + (kick ? 0.4 : 0.45) * k;
      midSwell = 1 + 0.5 * k;
      this.sim.blendScale = 1 + 0.35 * k;
    } else {
      const done = a.onDone;
      this.attack = null;
      this.extraYaw = 0;
      done?.();
      return;
    }

    // Drive the chain. Joints interpolate ALONG THE LINE from their root to
    // the strike point — fraction-of-offset following detaches the arm at
    // full extension (the smooth-min can only bridge so far); a joint ladder
    // keeps the limb one connected rope of gel however far it stretches.
    put(limbI, fx, fy, fz);
    const px = base[0] + fx;
    const py = base[1] + fy;
    const pz = base[2] + fz;
    const ladder = (jointI: number, rootI: number, frac: number, lift = 0): void => {
      const jb = BOXER_POSE[jointI];
      const rb = BOXER_POSE[rootI];
      o[jointI * 3] += rb[0] + (px - rb[0]) * frac - jb[0];
      o[jointI * 3 + 1] += rb[1] + (py - rb[1]) * frac - jb[1] + lift;
      o[jointI * 3 + 2] += rb[2] + (pz - rb[2]) * frac - jb[2];
    };
    if (kick) {
      ladder(hipI, hipI, 0.52);
      ladder(baseI, baseI, 0.24, 0.05);
    } else {
      ladder(elbowI, shoulderI, 0.6);
      ladder(shoulderI, shoulderI, 0.24);
    }
    put(A.CHEST_L, 0, 0, fz * 0.1);
    put(A.CHEST_R, 0, 0, fz * 0.1);
    put(A.BELLY, 0, 0, fz * 0.08);
    this.sim.radiusScale[limbI] = swell;
    this.sim.radiusScale[kick ? hipI : elbowI] = midSwell;
  }

  private readonly _pin = { x: 0, y: 0, z: 0 };

}
