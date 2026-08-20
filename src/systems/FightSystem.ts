/**
 * FightSystem — the referee, the judge, and both corners' cut man.
 *
 * THE MACHINE: foyer → (lobby) → countdown → round ⇄ rest → … → result,
 * with 'ko' able to interrupt a round at any moment. In practice mode the
 * machine simply runs; online the HOST is the one referee — every
 * transition is stamped with a server-time deadline and mirrored to the
 * guest as a 'phase' event, so both bouts tick the same instants. Guests
 * never transition on their own clock (except their own KO collapse,
 * which they DECLARE — see below).
 *
 * THE JUDGING LAW (rules.ts): the attacker judges contact — this system
 * watches your real fists at frame rate and calls the crossing into the
 * opponent's SDF surface; the victim judges outcome — an arriving hit is
 * tested against YOUR real gloves for the block, and your health is yours
 * to broadcast. Practice mode runs both roles on this one headset; online
 * they split across the hit event. Health 0 is self-declared: the victim
 * reports it, the host formalises the count.
 *
 * Anti-flail is rules.HandArming: speed gate, per-hand cooldown, and the
 * retract re-arm (a fist parked inside the other goop scores exactly
 * once until it visibly leaves).
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { BOT, FIGHT, MUSIC, PUNCH } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { startSet, stopSet } from '../audio/techno.js';
import { ATTACKS } from '../goop/goopConfig.js';
import type { Hand } from '../goop/GelCreature.js';
import { freshSeed } from '../game/rng.js';
import { peerDirToMine, peerPointToMine } from '../game/ring.js';
import { HandArming, judgeIncoming, punchStrength, type IncomingHit } from '../fight/rules.js';
import { fighter, match, nowS, resetBout, tracked, type Side } from '../fight/state.js';
import { hooks, net, sendEvent, serverNowMs, srvToLocalS } from '../net/transport.js';
import { type WireEvent } from '../net/protocol.js';
import { fightersView } from './FighterSystem.js';
import { playerView } from './PlayerSystem.js';

const _p = new Vector3();
const _dir = new Vector3();
const _head = new Vector3();
const _fistL = new Vector3();
const _fistR = new Vector3();

/** Everything the menus, HUD, probes and the wire drive the bout through. */
export const fightView = {
  startPractice(level: number): void {
    inst?.startPractice(level);
  },
  /** Host, once paired: the bout begins. */
  startOnline(): void {
    inst?.startOnline();
  },
  rematch(): void {
    inst?.rematch();
  },
  toFoyer(): void {
    inst?.toFoyer();
  },
  /** Seconds left in the running phase (HUD clock). */
  phaseLeft(): number {
    return inst ? Math.max(0, inst.deadline - nowS()) : 0;
  },
  /** Harness: land a synthetic punch from `side` for `dmg`. */
  debugHurt(side: Side, dmg: number): void {
    inst?.debugHurt(side, dmg);
  },
};

let inst: FightSystem | null = null;

export class FightSystem extends createSystem({}) {
  /** Absolute nowS() end of the current phase. */
  deadline = 0;
  private authority = true;
  private armL = new HandArming();
  private armR = new HandArming();
  private lastCountShown = 0;
  private lastCountdownShown = 0;
  private koStartAt = 0;
  private wobbleGate = 0;

  init(): void {
    inst = this;
    fightersView.onBotApex = (limbWorld, hand) => this.botStrikeLands(limbWorld, hand);
    hooks.onEvent = (e) => this.onWire(e);
    hooks.onPeer = (present) => this.onPeer(present);
  }

  /* ── mode entries ─────────────────────────────────────────────────────── */

  startPractice(level: number): void {
    match.mode = 'practice';
    match.botLevel = level;
    match.seed = freshSeed();
    match.foe.name = BOT.levels[level]?.name ?? 'THE HOUSE';
    this.authority = true;
    resetBout();
    match.foe.maxHealth = match.foe.health = BOT.levels[level]?.hp ?? FIGHT.health;
    match.generation++;
    this.beginBout();
  }

  startOnline(): void {
    if (net.phase !== 'paired' || net.seat !== 0) return;
    match.mode = 'online';
    match.seed = freshSeed();
    this.authority = true;
    resetBout();
    match.generation++;
    sendEvent({ t: 'start', seed: match.seed });
    this.beginBout();
  }

  rematch(): void {
    if (match.mode === 'practice') this.startPractice(match.botLevel);
    else this.startOnline();
  }

  toFoyer(): void {
    match.screen = 'foyer';
    match.dirty++;
    stopSet();
    fightersView.brain?.stop();
    fightersView.mine?.setKo(false);
    fightersView.theirs?.setKo(false);
  }

  private beginBout(): void {
    startSet({
      bpm: MUSIC.bpm,
      countInBeats: 4,
      endBeat: 100000,
      seed: match.seed,
      actAt: () => this.musicAct(),
    });
    this.enterCountdown(1, true);
  }

  private musicAct(): number {
    if (match.screen !== 'round' && match.screen !== 'ko') return Math.min(1, match.round);
    const desperate =
      match.me.health <= match.me.maxHealth * MUSIC.desperationAct ||
      match.foe.health <= match.foe.maxHealth * MUSIC.desperationAct;
    if (desperate || match.screen === 'ko') return 3;
    return Math.min(2, match.round - 1 + 1);
  }

  /* ── phase transitions (authority side) ───────────────────────────────── */

  private stamp(seconds: number, emit: WireEvent | null): number {
    if (match.mode === 'online' && this.authority && emit) {
      sendEvent(emit);
    }
    return nowS() + seconds;
  }

  private enterCountdown(round: number, first = false): void {
    match.round = round;
    match.screen = 'countdown';
    match.dirty++;
    this.lastCountdownShown = 0;
    fightersView.mine?.setKo(false);
    fightersView.theirs?.setKo(false);
    fightersView.brain?.stop();
    if (!first) {
      // Corner recovery walking back in.
      match.me.health = Math.min(match.me.maxHealth, match.me.health + FIGHT.restRecovery);
      match.foe.health = Math.min(match.foe.maxHealth, match.foe.health + FIGHT.restRecovery);
    }
    match.me.roundDamage = 0;
    match.foe.roundDamage = 0;
    this.armL.reset();
    this.armR.reset();
    this.deadline = this.stamp(FIGHT.countInSeconds, {
      t: 'phase',
      phase: 'countdown',
      round,
      deadlineSrv: serverNowMs() + FIGHT.countInSeconds * 1000,
    });
  }

  private enterRound(): void {
    match.screen = 'round';
    match.dirty++;
    sfx.roundBell();
    fightersView.brain?.startRound(match.round);
    this.deadline = this.stamp(FIGHT.roundSeconds, {
      t: 'phase',
      phase: 'round',
      round: match.round,
      deadlineSrv: serverNowMs() + FIGHT.roundSeconds * 1000,
    });
  }

  private endRoundByClock(): void {
    // The judges' card: this round goes to the bigger damage number.
    const me = match.me.roundDamage;
    const foe = match.foe.roundDamage;
    if (me > foe) match.me.rounds++;
    else if (foe > me) match.foe.rounds++;
    sfx.roundEnd(me > foe ? true : foe > me ? false : 'draw');

    if (match.round >= FIGHT.rounds) {
      const winner: Side | 'draw' =
        match.me.rounds > match.foe.rounds ? 'me' : match.foe.rounds > match.me.rounds ? 'foe' : 'draw';
      this.enterResult(winner);
      return;
    }
    match.screen = 'rest';
    match.dirty++;
    fightersView.brain?.stop();
    this.deadline = this.stamp(FIGHT.restSeconds, {
      t: 'phase',
      phase: 'rest',
      round: match.round,
      deadlineSrv: serverNowMs() + FIGHT.restSeconds * 1000,
    });
  }

  private enterKo(victim: Side): void {
    match.screen = 'ko';
    match.koVictim = victim;
    match.koCount = 0;
    match.dirty++;
    this.koStartAt = nowS();
    this.lastCountShown = 0;
    const creature = victim === 'me' ? fightersView.mine : fightersView.theirs;
    creature?.setKo(true);
    if (creature) creature.vulnerable = true;
    fightersView.brain?.stop();
    const total = FIGHT.koCount * FIGHT.koCountSeconds;
    this.deadline = this.stamp(total, {
      t: 'phase',
      phase: 'ko',
      round: match.round,
      deadlineSrv: serverNowMs() + total * 1000,
      victimSeat: victim === 'me' ? net.seat : 1 - net.seat,
    });
  }

  private enterResult(winner: Side | 'draw'): void {
    match.screen = 'result';
    match.winner = winner;
    match.resultAt = nowS();
    match.dirty++;
    stopSet(1.2);
    fightersView.brain?.stop();
    sfx.matchEnd(winner === 'me');
    this.deadline = this.stamp(FIGHT.resultLingerSeconds, {
      t: 'phase',
      phase: 'result',
      round: match.round,
      deadlineSrv: serverNowMs() + FIGHT.resultLingerSeconds * 1000,
      winnerSeat: winner === 'draw' ? -1 : winner === 'me' ? net.seat : 1 - net.seat,
    });
  }

  /* ── the wire (guest side of the referee + both sides' combat) ────────── */

  private onWire(e: WireEvent): void {
    switch (e.t) {
      case 'hello':
        match.foe.name = e.name || 'CHALLENGER';
        match.foe.tintIdx = e.tint;
        match.generation++; // re-dress their corner
        match.dirty++;
        break;
      case 'start':
        if (net.seat !== 0) {
          match.mode = 'online';
          match.seed = e.seed;
          this.authority = false;
          resetBout();
          match.generation++;
          startSet({
            bpm: MUSIC.bpm,
            countInBeats: 4,
            endBeat: 100000,
            seed: match.seed,
            actAt: () => this.musicAct(),
          });
        }
        break;
      case 'phase':
        if (!this.authority) this.applyPhase(e);
        break;
      case 'hit':
        this.incomingHit(e);
        break;
      case 'state': {
        // The victim's authoritative self — my picture of THEM.
        const f = match.foe;
        f.health = e.hp;
        f.roundDamage = e.rd;
        f.hitsLanded = e.hits;
        f.blocks = e.blocks;
        if (e.ko && this.authority && match.screen === 'round') this.enterKo('foe');
        match.dirty++;
        break;
      }
      case 'bye':
        this.onPeer(false);
        break;
    }
  }

  private applyPhase(e: WireEvent & { t: 'phase' }): void {
    this.deadline = srvToLocalS(e.deadlineSrv);
    match.round = e.round;
    match.dirty++;
    switch (e.phase) {
      case 'countdown':
        match.screen = 'countdown';
        this.lastCountdownShown = 0;
        fightersView.mine?.setKo(false);
        fightersView.theirs?.setKo(false);
        if (e.round > 1) {
          // The corner's work, mirrored (their bar trues via their state).
          match.me.health = Math.min(match.me.maxHealth, match.me.health + FIGHT.restRecovery);
          match.foe.health = Math.min(match.foe.maxHealth, match.foe.health + FIGHT.restRecovery);
        }
        match.me.roundDamage = 0;
        match.foe.roundDamage = 0;
        this.armL.reset();
        this.armR.reset();
        break;
      case 'round':
        match.screen = 'round';
        sfx.roundBell();
        break;
      case 'rest':
        match.screen = 'rest';
        sfx.roundEnd('draw');
        break;
      case 'ko': {
        match.screen = 'ko';
        match.koVictim = e.victimSeat === net.seat ? 'me' : 'foe';
        match.koCount = 0;
        this.koStartAt = nowS();
        this.lastCountShown = 0;
        const c = match.koVictim === 'me' ? fightersView.mine : fightersView.theirs;
        c?.setKo(true);
        break;
      }
      case 'result': {
        const winner: Side | 'draw' =
          e.winnerSeat === -1 ? 'draw' : e.winnerSeat === net.seat ? 'me' : 'foe';
        match.screen = 'result';
        match.winner = winner;
        match.resultAt = nowS();
        stopSet(1.2);
        sfx.matchEnd(winner === 'me');
        break;
      }
    }
  }

  private onPeer(present: boolean): void {
    if (present) {
      match.foe.name = net.peerName || match.foe.name;
      match.foe.tintIdx = net.peerTint;
      match.generation++;
      match.dirty++;
      return;
    }
    // Opponent gone: fold whatever was running back to the foyer.
    if (match.screen !== 'foyer') this.toFoyer();
    match.dirty++;
  }

  /* ── update ───────────────────────────────────────────────────────────── */

  update(dt: number): void {
    void dt;
    const now = nowS();

    /* machine ticks */
    switch (match.screen) {
      case 'countdown': {
        const left = Math.ceil(this.deadline - now);
        if (left !== this.lastCountdownShown && left > 0 && left <= FIGHT.countInSeconds) {
          this.lastCountdownShown = left;
          sfx.countdownTick(left === 1);
          match.dirty++;
        }
        if (now >= this.deadline && this.authority) this.enterRound();
        break;
      }
      case 'round':
        this.punchDetection();
        if (now >= this.deadline && this.authority) this.endRoundByClock();
        break;
      case 'rest':
        if (now >= this.deadline && this.authority) this.enterCountdown(match.round + 1);
        break;
      case 'ko': {
        const count = Math.min(
          FIGHT.koCount,
          Math.floor((now - this.koStartAt) / FIGHT.koCountSeconds) + 1,
        );
        if (count !== this.lastCountShown) {
          this.lastCountShown = count;
          match.koCount = count;
          sfx.countKnock(count >= FIGHT.koCount);
          match.dirty++;
        }
        if (now >= this.deadline && this.authority) {
          this.enterResult(match.koVictim === 'me' ? 'foe' : 'me');
        }
        break;
      }
      default:
        break;
    }

    /* playful pokes outside the fight */
    this.pokes(now);
  }

  /* ── my fists vs their body ───────────────────────────────────────────── */

  private punchDetection(): void {
    const theirs = fightersView.theirs;
    if (!theirs || theirs.isKo) return;
    const now = nowS();

    for (const hand of ['left', 'right'] as const) {
      const pos = hand === 'left' ? tracked.handL : tracked.handR;
      const vel = hand === 'left' ? tracked.velL : tracked.velR;
      const speed = hand === 'left' ? tracked.speedL : tracked.speedR;
      const arming = hand === 'left' ? this.armL : this.armR;

      const dist = theirs.fieldAtWorld(pos);
      arming.feedDistance(dist);
      if (dist > PUNCH.contactDepth) continue;
      if (speed < PUNCH.hitSpeed) continue; // slow contact is the pokes' job
      if (!arming.armed(now)) continue;
      // INTO them, not out: the fist must have COME from outside — the
      // field a hand-width back along the travel reads higher than here.
      // (A center-direction dot test degenerates to noise once the fist
      // is deep; the field's own slope never lies.)
      _p.copy(pos).addScaledVector(vel, -0.07);
      if (theirs.fieldAtWorld(_p) < dist - 0.005) continue;

      arming.fired(now);
      const strength = punchStrength(speed);
      theirs.receivePunchWorld(pos, vel, speed);

      if (match.mode === 'practice') {
        // Both judging roles run here: their "gloves" are wherever the
        // style parked their fists — the shell soaks, the showboat pays.
        theirs.headWorld(_head);
        theirs.fistWorld('left', _fistL);
        theirs.fistWorld('right', _fistR);
        const j = judgeIncoming({ point: pos, dir: vel, speed }, _head, _fistL, _fistR, 1);
        this.applyDamage('foe', j.damage, j.blocked);
        fightersView.brain?.onHit(j.strength);
        if (j.blocked) sfx.gelBlock();
        else sfx.squelch(0.3 + strength * 0.7);
        playerView.haptic?.(hand, j.blocked ? 0.3 : 0.45 + strength * 0.5, j.blocked ? 30 : 55);
      } else {
        // Online: contact is my call, outcome is theirs. Provisional feel
        // now; their state broadcast trues the health bar shortly.
        sendEvent({
          t: 'hit',
          p: [pos.x, pos.y, pos.z],
          d: [vel.x, vel.y, vel.z],
          s: speed,
        });
        sfx.squelch(0.25 + strength * 0.6);
        playerView.haptic?.(hand, 0.4 + strength * 0.5, 50);
        match.me.hitsLanded++;
      }
    }
  }

  /* ── their strikes vs my body ─────────────────────────────────────────── */

  /** Practice: a bot strike reached full extension at `limbWorld`. */
  private botStrikeLands(limbWorld: Vector3, hand: Hand): void {
    void hand;
    if (match.screen !== 'round') return;
    // Contact: near my head, or near my trunk line under it.
    const headDist = _p.copy(limbWorld).sub(tracked.head).length();
    _p.copy(tracked.head);
    _p.y = Math.max(0.35, Math.min(limbWorld.y, tracked.head.y));
    const trunkDist = _p.sub(limbWorld).length();
    if (headDist > 0.5 && trunkDist > 0.45) {
      sfx.whiff();
      return;
    }
    _dir.copy(tracked.head).sub(limbWorld);
    _dir.y *= 0.4;
    _dir.normalize();
    const spec = BOT.levels[match.botLevel] ?? BOT.levels[1];
    const hit: IncomingHit = { point: limbWorld, dir: _dir, speed: 3.4 };
    const j = judgeIncoming(hit, tracked.head, tracked.handL, tracked.handR, spec.damageMul);
    this.takeHit(j.damage, j.blocked, j.headshot, hit);
  }

  /** Online: their fist event, mirrored into my frame, judged by my gloves. */
  private incomingHit(e: WireEvent & { t: 'hit' }): void {
    if (match.screen !== 'round') return;
    _p.set(e.p[0], e.p[1], e.p[2]);
    peerPointToMine(_p);
    _dir.set(e.d[0], e.d[1], e.d[2]);
    peerDirToMine(_dir);
    const hit: IncomingHit = { point: _p, dir: _dir, speed: e.s };
    const j = judgeIncoming(hit, tracked.head, tracked.handL, tracked.handR, 1);
    this.takeHit(j.damage, j.blocked, j.headshot, hit);
    this.broadcastState();
  }

  private takeHit(damage: number, blocked: boolean, headshot: boolean, hit: IncomingHit): void {
    this.applyDamage('me', damage, blocked);
    fightersView.mine?.receivePunchWorld(hit.point, hit.dir, blocked ? hit.speed * 0.45 : hit.speed);
    if (blocked) {
      sfx.gelBlock();
      playerView.haptic?.('both', 0.35, 40);
    } else {
      if (headshot) sfx.headRing();
      else sfx.squelch(0.7);
      playerView.haptic?.('both', 0.8, 120);
    }
    if (match.me.health <= 0 && match.screen === 'round') {
      if (this.authority) this.enterKo('me');
      else {
        // The guest declares; the host formalises the count.
        fightersView.mine?.setKo(true);
        this.broadcastState(true);
      }
    }
  }

  private applyDamage(side: Side, damage: number, blocked: boolean): void {
    const victim = fighter(side);
    const dealer = fighter(side === 'me' ? 'foe' : 'me');
    victim.health = Math.max(0, victim.health - damage);
    if (blocked) victim.blocks++;
    else dealer.hitsLanded++;
    dealer.roundDamage += damage;
    match.dirty++;
    if (side === 'foe' && victim.health <= 0 && this.authority && match.screen === 'round') {
      this.enterKo('foe');
    }
  }

  private broadcastState(ko = false): void {
    if (match.mode !== 'online') return;
    sendEvent({
      t: 'state',
      hp: Math.round(match.me.health),
      ko: ko || match.me.health <= 0,
      rd: Math.round(match.me.roundDamage),
      hits: match.me.hitsLanded,
      blocks: match.me.blocks,
    });
  }

  /* ── the pokes (fun outside the bell) ─────────────────────────────────── */

  private pokes(now: number): void {
    if (match.screen === 'round') return;
    const theirs = fightersView.theirs;
    if (!theirs) return;
    for (const hand of ['left', 'right'] as const) {
      const pos = hand === 'left' ? tracked.handL : tracked.handR;
      const vel = hand === 'left' ? tracked.velL : tracked.velR;
      const speed = hand === 'left' ? tracked.speedL : tracked.speedR;
      if (theirs.pokeWorld(pos, vel, Math.max(speed, 0.2)) && now > this.wobbleGate) {
        this.wobbleGate = now + 1.1;
        sfx.gooWobble(Math.min(0.7, speed));
      }
    }
  }

  /* ── harness hooks ────────────────────────────────────────────────────── */

  debugHurt(side: Side, dmg: number): void {
    this.applyDamage(side, dmg, false);
    if (side === 'me' && match.me.health <= 0 && this.authority && match.screen === 'round') {
      this.enterKo('me');
    }
  }
}

/** ATTACKS re-exported for the probe (bot expectations). */
export { ATTACKS };
