/**
 * The bout's shared state — one mutable object every system reads, in the
 * lineage's style: no event soup, no store framework. Systems that change
 * it bump `dirty` when menus need repainting; `generation` rebuilds the
 * fighters wholesale (rematch, tint change).
 *
 * TIME: `nowS()` is the one clock (seconds, monotonic). Deadlines are
 * absolute values on it (`roundEndsAt`, `koNextAt`), so a dropped frame
 * never stretches a round. Online, the HOST owns every state transition
 * and stamps it into events; the guest's FightSystem follows the wire, so
 * the two referees can't drift.
 */

import { Quaternion, Vector3 } from 'three';
import { FIGHT } from '../config.js';

export type Screen =
  | 'foyer' // menu panel, both goops idle as globs
  | 'lobby' // online: room open, waiting for the opponent
  | 'countdown' // 3‥2‥1 before a round
  | 'round' // FIGHT
  | 'rest' // between rounds — both slump to globs in their corners
  | 'ko' // the ten count is running
  | 'result'; // bout over, card up, rematch on offer

export type Mode = 'practice' | 'online';
export type Side = 'me' | 'foe';

/** One monotonic clock for every deadline (seconds). */
export function nowS(): number {
  return performance.now() / 1000;
}

export interface FighterScore {
  name: string;
  /** Index into GOOPS.tints. */
  tintIdx: number;
  health: number;
  maxHealth: number;
  /** Round wins across the bout. */
  rounds: number;
  /** This-round damage dealt (the judges' card if the clock decides). */
  roundDamage: number;
  hitsLanded: number;
  blocks: number;
  ko: boolean;
}

function freshFighter(name: string, tintIdx: number): FighterScore {
  return {
    name,
    tintIdx,
    health: FIGHT.health,
    maxHealth: FIGHT.health,
    rounds: 0,
    roundDamage: 0,
    hitsLanded: 0,
    blocks: 0,
    ko: false,
  };
}

export const match = {
  screen: 'foyer' as Screen,
  mode: 'practice' as Mode,
  /** Index into BOT.levels (practice difficulty). */
  botLevel: 1,
  /** Bout seed — the techno set and any seeded flourish come off it. */
  seed: 1,
  /** Bumped to tear down + rebuild both fighters (rematch, tint change). */
  generation: 0,
  /** Bumped whenever a menu should repaint. */
  dirty: 0,

  round: 0,
  /** Absolute nowS() deadlines for the running phase. */
  countdownEndsAt: 0,
  roundEndsAt: 0,
  restEndsAt: 0,
  /** The ten count. */
  koVictim: 'foe' as Side,
  koCount: 0,
  koNextAt: 0,
  /** Result. */
  winner: null as Side | 'draw' | null,
  resultAt: 0,

  me: freshFighter('GLOB', 0),
  foe: freshFighter('OOZE', 1),

  /** My seat on the 2-ring (0 = host side). Decides spawn + wire frames. */
  mySeat: 0,
};

/** The live tracked body (PlayerSystem writes every frame; everyone reads). */
export const tracked = {
  head: new Vector3(0, 1.65, 0),
  headQuat: new Quaternion(),
  handL: new Vector3(-0.2, 1.1, -0.3),
  handR: new Vector3(0.2, 1.1, -0.3),
  /** Smoothed hand speeds (m/s). */
  speedL: 0,
  speedR: 0,
  /** Per-hand velocity direction (unit-ish, world). */
  velL: new Vector3(),
  velR: new Vector3(),
  /** Calibration: snaps UP instantly, decays DOWN glacially. */
  standingHeight: 1.65,
  /** True once real XR input has been seen this session. */
  hasInput: false,
  /** The headless harness drives `tracked` itself; PlayerSystem stands off. */
  devDrive: false,
};

/** Reset both fighters for a fresh bout (names/tints survive). */
export function resetBout(): void {
  const me = match.me;
  const foe = match.foe;
  match.me = freshFighter(me.name, me.tintIdx);
  match.foe = freshFighter(foe.name, foe.tintIdx);
  match.round = 0;
  match.winner = null;
  match.koCount = 0;
  match.dirty++;
}

export function fighter(side: Side): FighterScore {
  return side === 'me' ? match.me : match.foe;
}

export function otherSide(side: Side): Side {
  return side === 'me' ? 'foe' : 'me';
}

/** Is a fight actually live (punches score)? */
export function fightLive(): boolean {
  return match.screen === 'round';
}
