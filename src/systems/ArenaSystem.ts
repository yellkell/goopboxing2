/**
 * ArenaSystem — builds the AR stage once, keeps it alive (ropes breathing
 * on the techno set's beat, corner colours tracking the fighters' tints,
 * everything hotter as the bout gets desperate), and runs RING ADJUST:
 *
 * The ring is furniture in your real room, so you place it like furniture.
 * With adjust mode on (the A-button menu turns it on), each side of the
 * ring grows a glowing handle; reach toward a side, hold the TRIGGER, and
 * that side follows your hand along its own normal — one side at a time,
 * to the walls if you like. Release to drop it; the layout saves per
 * headset and greets you next session. A (or X) closes adjust mode.
 *
 * The layout is cosmetic by law (see arena/ringLayout.ts): spawns, the
 * wire mirror and every judged position ride RING.spawnBack untouched.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Vector3, type Object3D } from 'three';
import { GOOPS, MUSIC } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { beatNow, setRunning } from '../audio/techno.js';
import { match } from '../fight/state.js';
import { buildStage, type StageRig } from '../arena/stage.js';
import {
  loadLayout,
  ringAdjust,
  ringLayout,
  RING_SIDES,
  saveLayout,
  setSide,
  sideHandle,
  type RingSide,
} from '../arena/ringLayout.js';

const _hand = new Vector3();
const _h = { x: 0, y: 0, z: 0 };

/** Probes drive the adjuster through this (no controllers headless). */
export const arenaView = {
  /** Enter/exit ring-adjust mode (exit saves). */
  setAdjust(on: boolean): void {
    if (ringAdjust.active === on) return;
    ringAdjust.active = on;
    ringAdjust.grabbed = null;
    ringAdjust.grabHand = null;
    ringAdjust.dirty++;
    if (!on) saveLayout();
    sfx.uiClick();
  },
  /** Harness: move one side directly (the same path a grab drags). */
  moveSide(side: RingSide, value: number): void {
    setSide(side, value);
  },
  layout: ringLayout,
};

export class ArenaSystem extends createSystem({}) {
  private stage?: StageRig;
  private dressed = -1;

  init(): void {
    loadLayout(); // your room's saved ring, if this headset has one
    this.stage = buildStage();
    this.scene.add(this.stage.group);
  }

  update(delta: number): void {
    const stage = this.stage;
    if (!stage) return;

    if (this.dressed !== match.generation) {
      this.dressed = match.generation;
      const mine = GOOPS.tints[match.me.tintIdx] ?? GOOPS.tints[0];
      const theirs = GOOPS.tints[match.foe.tintIdx] ?? GOOPS.tints[1];
      stage.setCorners(mine, theirs);
    }

    if (ringAdjust.active) this.adjustTick();

    // The beat envelope: 1 on the kick, easing off through the beat.
    let pulse = 0;
    if (setRunning()) {
      const beat = beatNow();
      if (beat >= 0) {
        const frac = beat - Math.floor(beat);
        pulse = Math.max(0, 1 - frac * 2.4);
      }
    }

    const inFight = match.screen === 'round' || match.screen === 'ko';
    const desperate =
      inFight &&
      (match.me.health <= match.me.maxHealth * MUSIC.desperationAct ||
        match.foe.health <= match.foe.maxHealth * MUSIC.desperationAct);
    const act =
      match.screen === 'ko' ? 3 : inFight ? Math.min(2, Math.max(0, match.round - 1) + 1) : 0;

    stage.update(delta, pulse, act, desperate || match.screen === 'ko' ? 1 : 0);
  }

  /* ── ring adjust: one side, one hand, one axis ─────────────────────────── */

  private adjustTick(): void {
    // No furniture moving mid-round — the referee confiscates the wrench.
    if (match.screen === 'round' || match.screen === 'ko') {
      arenaView.setAdjust(false);
      return;
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
      const obj = spaces?.gripSpaces?.[hand]?.object3D ?? spaces?.raySpaces?.[hand]?.object3D;
      const pad = this.input?.xr?.gamepads?.[hand];
      if (!obj || !pad) continue;
      obj.getWorldPosition(_hand);
      const holding = pad.getButtonPressed(InputComponent.Trigger);

      if (ringAdjust.grabbed && ringAdjust.grabHand === hand) {
        if (!holding) {
          // Dropped: the side stays, the layout saves.
          ringAdjust.grabbed = null;
          ringAdjust.grabHand = null;
          ringAdjust.dirty++;
          saveLayout();
          sfx.uiClick();
          continue;
        }
        // Drag along the side's own normal — x for left/right, z for near/far.
        const side = ringAdjust.grabbed;
        setSide(side, side === 'left' || side === 'right' ? _hand.x : _hand.z);
        continue;
      }

      // Not holding a side with this hand: a fresh squeeze near a handle
      // (or anywhere along the side's rope line) grabs it.
      if (!ringAdjust.grabbed && pad.getButtonDown(InputComponent.Trigger)) {
        const side = this.nearestSide(_hand);
        if (side) {
          ringAdjust.grabbed = side;
          ringAdjust.grabHand = hand;
          ringAdjust.dirty++;
          sfx.uiHover();
        }
      }
    }
  }

  /** The side whose rope line is nearest the hand (within reach). */
  private nearestSide(hand: Vector3): RingSide | null {
    let best: RingSide | null = null;
    let bestD = 0.65; // grab reach (m)
    for (const side of RING_SIDES) {
      // Distance to the side's vertical rope PLANE segment: off-axis
      // distance dominates, clamped to the side's extent.
      let d: number;
      if (side === 'left' || side === 'right') {
        const withinZ = hand.z > ringLayout.far - 0.3 && hand.z < ringLayout.near + 0.3;
        d = Math.abs(hand.x - ringLayout[side]) + (withinZ ? 0 : 10);
      } else {
        const withinX = hand.x > ringLayout.left - 0.3 && hand.x < ringLayout.right + 0.3;
        d = Math.abs(hand.z - ringLayout[side]) + (withinX ? 0 : 10);
      }
      // Height counts too — reach toward the ropes, not the floor.
      sideHandle(side, _h);
      d += Math.max(0, Math.abs(hand.y - _h.y) - 0.5) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = side;
      }
    }
    return best;
  }
}
