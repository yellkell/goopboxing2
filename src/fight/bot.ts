/**
 * THE HOUSE GOOP — practice mode's opponent, and the vendored fighting-style
 * AI finally back in the ring it was written for.
 *
 * Each round it privately deals a new martial identity from the shuffled
 * style deck (goop/styles.ts) and BECOMES that fighter — silhouette,
 * spacing, pacing, combo book. The player is never told; the stance is the
 * tell (the gel visibly re-pours itself between rounds):
 *
 *   INFIGHTER swarms; KICKBOXER potshots from range and spins; MUAY THAI
 *   marches forward behind a high frame; OUTBOXER struts hands-down and
 *   blurs; ROPE-A-DOPE shells up and punishes your overreach.
 *
 * Blocking is EMERGENT: the bot's gloves are its fist blobs, and the
 * victim-judge tests your contact against wherever its style parked them —
 * a shelled-up rope-a-dope soaks head shots because its hands are already
 * living on its face, not because a dice roll said so.
 *
 * Movement: circle at the style's hold range, press in behind combos,
 * back out after. All steering goes through GelCreature.moveTo — the ooze
 * IS the footwork.
 */

import { Vector3 } from 'three';
import { BOT } from '../config.js';
import { clampIntoRing } from '../arena/ringLayout.js';
import { mulberry32, mix } from '../game/rng.js';
import type { GelCreature, Hand } from '../goop/GelCreature.js';
import type { AttackName } from '../goop/goopConfig.js';
import { FIGHT_STYLES, type FightStyle } from '../goop/styles.js';

type Intent = 'circle' | 'approach' | 'combo' | 'retreat';

const _toBot = new Vector3();
const _target = new Vector3();
const _strike = new Vector3();

export class BoxerBrain {
  private style: FightStyle = FIGHT_STYLES[0];
  private deck: FightStyle[] = [];
  private rng: () => number = Math.random;

  private intent: Intent = 'circle';
  private intentUntil = 0;
  private clock = 0;
  /** Orbit direction (flips occasionally). */
  private orbitDir = 1;
  /** Queued strikes of the running combo. */
  private queue: AttackName[] = [];
  private hand: Hand = 'left';
  private active = false;

  constructor(
    private creature: GelCreature,
    private level: number,
    seed: number,
  ) {
    this.rng = mulberry32(mix(seed, 0xb0d));
    this.deck = [...FIGHT_STYLES];
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /** Deal the round's style and wake up (round start). */
  startRound(round: number): void {
    this.style = this.deck[(round - 1) % this.deck.length];
    const spec = BOT.levels[this.level] ?? BOT.levels[1];
    this.creature.setFightStyle(this.style.pose);
    this.creature.tempoScale = spec.tempo * this.style.tempoMul;
    this.creature.styleEase = 1.6; // the slow re-pour is the round's tell
    this.active = true;
    this.intent = 'circle';
    this.intentUntil = this.clock + 1.2;
    this.queue = [];
  }

  /** Corner rest / KO / bout end. */
  stop(): void {
    this.active = false;
    this.queue = [];
  }

  get styleName(): string {
    return this.style.name;
  }

  /** The style's soak: × on the stagger the bot shrugs off (spectacle). */
  get staggerScale(): number {
    return this.style.staggerScale;
  }

  /** Getting cracked interrupts the plan (sometimes). */
  onHit(strength: number): void {
    if (!this.active) return;
    // Muay thai walks through; outboxer bails at a touch.
    if (this.rng() < (0.55 * strength) / this.style.staggerScale) {
      this.queue = [];
      this.intent = 'retreat';
      this.intentUntil = this.clock + 0.5 + this.rng() * 0.5;
    }
    // The counterpuncher answers a landed hit with an instant burst.
    if (this.style.counterpuncher && this.rng() < 0.45) {
      this.queue = [...this.style.press[Math.floor(this.rng() * this.style.press.length)]];
      this.intent = 'combo';
      this.intentUntil = this.clock + 2.5;
    }
  }

  /**
   * One brain tick. `playerHead` in world; `onApex` is FightSystem's judge
   * for strikes that reach full extension.
   */
  update(dt: number, playerHead: Vector3, onApex: (limbWorld: Vector3, hand: Hand) => void): void {
    if (!this.active) return;
    this.clock += dt;
    const c = this.creature;
    const spec = BOT.levels[this.level] ?? BOT.levels[1];

    c.faceToward(playerHead);
    c.moveSpeedScale = spec.moveMul * this.style.moveMul;

    // Where the bot stands relative to the player (floor plane).
    _toBot.copy(c.position).sub(playerHead);
    _toBot.y = 0;
    const dist = Math.max(_toBot.length(), 1e-3);
    _toBot.divideScalar(dist);

    // Intent scheduling.
    if (this.clock >= this.intentUntil && this.queue.length === 0 && !c.isPunching) {
      this.nextIntent(dist);
    }

    // Steering per intent.
    const hold = BOT.holdDistance * this.style.holdScale;
    const press = BOT.pressDistance * this.style.pressScale;
    switch (this.intent) {
      case 'circle': {
        // Orbit at hold range: slide along the tangent, breathe in/out.
        const want = hold + Math.sin(this.clock * 0.9) * 0.12;
        _target.copy(playerHead).addScaledVector(_toBot, want);
        _target.x += -_toBot.z * this.orbitDir * 0.55;
        _target.z += _toBot.x * this.orbitDir * 0.55;
        break;
      }
      case 'approach':
      case 'combo':
        _target.copy(playerHead).addScaledVector(_toBot, press);
        break;
      case 'retreat':
        _target.copy(playerHead).addScaledVector(_toBot, hold * 1.25);
        break;
    }
    _target.y = 0;
    // The house goop respects YOUR furniture: it never oozes through the
    // ropes you dragged to your walls.
    clampIntoRing(_target, 0.35);
    c.moveTo(_target);

    // Swing when a combo is queued and the range is honest.
    const strikeReach = BOT.strikeDistance * this.style.strikeScale;
    if (this.queue.length > 0 && !c.isPunching && dist < strikeReach) {
      const name = this.queue.shift()!;
      this.hand = this.hand === 'left' ? 'right' : 'left';
      // Head or body, by the style's downstairs appetite.
      _strike.copy(playerHead);
      if (this.rng() < this.style.bodyRate) _strike.y = Math.max(0.9, playerHead.y - 0.55);
      c.throwAttack(name, this.hand, _strike, onApex);
      if (this.queue.length === 0) {
        // Combo spent: rest, then circle out.
        this.intent = 'retreat';
        this.intentUntil =
          this.clock + (0.5 + this.rng() * 0.8) * this.style.restScale * spec.rest;
      }
    }
  }

  private nextIntent(dist: number): void {
    if (this.rng() < 0.25) this.orbitDir *= -1;

    if (this.intent === 'circle' || this.intent === 'retreat') {
      // Time to pick a fight?
      const press = this.rng() < this.style.pressChance;
      const book = press ? this.style.press : this.style.combos;
      this.queue = [...book[Math.floor(this.rng() * book.length)]];
      this.intent = 'approach';
      this.intentUntil = this.clock + 2.2; // give the ooze time to close
    } else if (this.intent === 'approach' && dist > BOT.strikeDistance * this.style.strikeScale) {
      // Still out of range — keep closing a beat longer.
      this.intentUntil = this.clock + 0.6;
    } else {
      this.intent = 'circle';
      this.intentUntil = this.clock + (0.8 + this.rng() * 1.4) * this.style.restScale;
    }
  }
}
