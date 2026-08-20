/**
 * FighterSystem — owns the two bodies in the ring and their drivers.
 *
 *  - MINE: first-person, puppet mode, driven by EmbodyRig from `tracked`
 *    (your real head + hands). You look down and you're gel.
 *  - THEIRS: either the practice bot (AI mode + BoxerBrain — the vendored
 *    fighter whole) or the remote human (puppet mode fed by WirePose:
 *    wire samples, mirrored across the ring, smoothed by critically
 *    damped springs, then the same EmbodyRig as yours).
 *
 * Form is the room's body language: fighters stand up (form 1) through
 * countdown/round/ko, and slump into breathing globs in their corners for
 * foyer/lobby/rest/result. KO overrides everything — FightSystem flips it.
 *
 * Rebuilds wholesale on match.generation (tint change, mode change,
 * rematch) — fighters are cheap to build and state is poison otherwise.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { GOOPS } from '../config.js';
import { BoxerBrain } from '../fight/bot.js';
import { match, tracked } from '../fight/state.js';
import { foeSpawnLocal } from '../game/ring.js';
import { GelCreature, type Hand } from '../goop/GelCreature.js';
import { EmbodyRig, WirePose, type TrackedPose } from '../goop/embody.js';
import { GooFx } from '../goop/splats.js';
import { net } from '../net/transport.js';

const _spawn = new Vector3();
const _v = new Vector3();

/** The rest of the game reaches the bodies through this. */
export const fightersView: {
  mine?: GelCreature;
  theirs?: GelCreature;
  brain?: BoxerBrain | null;
  wire?: WirePose;
  /** FightSystem's judge for bot strikes reaching full extension. */
  onBotApex?: (limbWorld: Vector3, hand: Hand) => void;
} = {};

export class FighterSystem extends createSystem({}) {
  private generation = -1;
  private mine?: GelCreature;
  private theirs?: GelCreature;
  private myFx?: GooFx;
  private theirFx?: GooFx;
  private myRig?: EmbodyRig;
  private theirRig?: EmbodyRig;
  private brain: BoxerBrain | null = null;
  private wire = new WirePose();

  private myPose: TrackedPose = {
    head: new Vector3(),
    headQuat: new Quaternion(),
    handL: new Vector3(),
    handR: new Vector3(),
    speedL: 0,
    speedR: 0,
  };
  private theirPose: TrackedPose = {
    head: new Vector3(),
    headQuat: new Quaternion(),
    handL: new Vector3(),
    handR: new Vector3(),
    speedL: 0,
    speedR: 0,
  };

  private rebuild(): void {
    this.generation = match.generation;
    this.mine?.dispose();
    this.theirs?.dispose();
    this.myFx?.dispose();
    this.theirFx?.dispose();

    const myTint = GOOPS.tints[match.me.tintIdx] ?? GOOPS.tints[0];
    const theirTint = GOOPS.tints[match.foe.tintIdx] ?? GOOPS.tints[1];

    this.myFx = new GooFx(myTint.splat);
    this.scene.add(this.myFx.group);
    this.mine = new GelCreature(this.myFx, { tint: myTint, firstPerson: true });
    this.mine.qualityOverride = GOOPS.selfQuality;
    this.scene.add(this.mine.group);
    this.myRig = new EmbodyRig(this.mine);
    // I arrive already standing where I stand, already FORMED and settled —
    // a mid-session rebuild must never pour a new body through my eyes.
    this.mine.group.position.set(tracked.head.x, 0, tracked.head.z);
    {
      const p = this.myPose;
      p.head.copy(tracked.head);
      p.headQuat.copy(tracked.headQuat);
      p.handL.copy(tracked.handL);
      p.handR.copy(tracked.handR);
      p.speedL = 0;
      p.speedR = 0;
      _v.set(0, 0, -1).applyQuaternion(tracked.headQuat);
      const fxz = Math.hypot(_v.x, _v.z);
      this.mine.snapYaw(fxz > 0.05 ? Math.atan2(_v.x / fxz, _v.z / fxz) : Math.PI);
      // Form first (the rig gates on it), drive the pose, settle onto it.
      this.mine.primeFormed();
      this.myRig.drive(p);
      this.mine.primeFormed();
    }

    this.theirFx = new GooFx(theirTint.splat);
    this.scene.add(this.theirFx.group);
    this.theirs = new GelCreature(this.theirFx, { tint: theirTint });
    this.theirs.qualityOverride = GOOPS.foeQuality;
    this.scene.add(this.theirs.group);
    foeSpawnLocal(_spawn);
    this.theirs.group.position.copy(_spawn);
    this.theirs.moveTo(_spawn);
    this.theirs.faceToward(tracked.head);

    if (match.mode === 'practice') {
      this.theirs.mode = 'ai';
      this.theirRig = undefined;
      this.brain = new BoxerBrain(this.theirs, match.botLevel, match.seed);
    } else {
      this.theirRig = new EmbodyRig(this.theirs); // sets puppet mode
      this.brain = null;
    }
    this.wire = new WirePose();

    fightersView.mine = this.mine;
    fightersView.theirs = this.theirs;
    fightersView.brain = this.brain;
    fightersView.wire = this.wire;
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const mine = this.mine;
    const theirs = this.theirs;
    if (!mine || !theirs) return;

    this.myFx?.update(delta);
    this.theirFx?.update(delta);

    /* ── body language by screen ─────────────────────────────────────── */
    const upScreens = match.screen === 'countdown' || match.screen === 'round' || match.screen === 'ko';
    mine.setFormTarget(upScreens || match.screen === 'foyer' || match.screen === 'lobby' ? 1 : 0);
    // Their glob idles ringside through the menus; stands for the fight.
    theirs.setFormTarget(upScreens ? 1 : 0);

    /* ── mine: the embodiment ────────────────────────────────────────── */
    const p = this.myPose;
    p.head.copy(tracked.head);
    p.headQuat.copy(tracked.headQuat);
    p.handL.copy(tracked.handL);
    p.handR.copy(tracked.handR);
    p.speedL = tracked.speedL;
    p.speedR = tracked.speedR;
    this.myRig?.drive(p);
    mine.update(delta * GOOPS.timeScale, tracked.head);

    /* ── theirs: bot brain or the wire ───────────────────────────────── */
    if (this.brain) {
      this.brain.update(delta, tracked.head, (limbWorld, hand) => {
        fightersView.onBotApex?.(limbWorld, hand);
      });
    } else if (this.theirRig) {
      if (this.wire.sample(delta, this.theirPose)) {
        this.theirRig.drive(this.theirPose);
      } else if (net.phase !== 'paired') {
        // Nobody on the wire: the puppet rests where it stands.
        foeSpawnLocal(_v);
        theirs.moveTo(_v);
        theirs.faceToward(tracked.head);
      }
    }
    theirs.update(delta * GOOPS.timeScale, tracked.head);
  }
}
