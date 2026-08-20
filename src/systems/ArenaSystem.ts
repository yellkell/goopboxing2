/**
 * ArenaSystem — builds the stage once, then keeps it alive: trim and
 * ropes breathing on the techno set's beat, corner colours tracking the
 * two fighters' tints, the whole room running hotter as the bout gets
 * desperate.
 */

import { createSystem } from '@iwsdk/core';
import { GOOPS, MUSIC } from '../config.js';
import { beatNow, setRunning } from '../audio/techno.js';
import { match } from '../fight/state.js';
import { buildStage, type StageRig } from '../arena/stage.js';

export class ArenaSystem extends createSystem({}) {
  private stage?: StageRig;
  private dressed = -1;

  init(): void {
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
}
