/**
 * HudSystem — the fight's numbers, told twice:
 *
 *  - THE BOARD: a ring-side scoreboard floating over the far ropes —
 *    names, health bars in each corner's colour, round pips, the clock.
 *    Repainted only when a second ticks or the numbers move.
 *  - THE CARD: one big centre-stage plate for the moments — ROUND N,
 *    FIGHT!, the ten count's numerals, KO!, and the verdict. Pops in with
 *    a scale-ease, holds, fades. The ten count REPLACES the card per
 *    knock, so the number lands like a gavel.
 *
 * Everything is local-only render: both headsets build their own board
 * from the same shared numbers.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { FIGHT, GOOPS, RING } from '../config.js';
import { ringLayout } from '../arena/ringLayout.js';
import { fightView } from './FightSystem.js';
import { match, nowS, tracked } from '../fight/state.js';
import { font } from '../ui/fonts.js';
import { UI } from '../ui/panel.js';

const _look = new Vector3();

function css(hex: number, a = 1): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r},${g},${b},${a})`;
}

class BoardFace {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(1.7, 0.64),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide }),
    );
    this.mesh.renderOrder = 25;
  }

  paint(clockS: number): void {
    const g = this.canvas.getContext('2d')!;
    const W = 1024;
    const H = 384;
    g.clearRect(0, 0, W, H);

    // Glass + frame.
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 26);
    g.fillStyle = 'rgba(6,10,7,0.88)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.line;
    g.stroke();

    const mine = GOOPS.tints[match.me.tintIdx] ?? GOOPS.tints[0];
    const theirs = GOOPS.tints[match.foe.tintIdx] ?? GOOPS.tints[1];

    // Names.
    g.textBaseline = 'middle';
    g.font = font(700, 52);
    g.letterSpacing = '2px';
    g.textAlign = 'left';
    g.fillStyle = css(mine.shallow);
    g.fillText(match.me.name, 56, 78, 330);
    g.textAlign = 'right';
    g.fillStyle = css(theirs.shallow);
    g.fillText(match.foe.name, W - 56, 78, 330);
    g.letterSpacing = '0px';

    // The clock / phase word.
    g.textAlign = 'center';
    g.font = font(700, 64);
    g.fillStyle = UI.textHi;
    const phase =
      match.screen === 'round'
        ? fmtClock(clockS)
        : match.screen === 'rest'
          ? 'REST'
          : match.screen === 'ko'
            ? 'COUNT'
            : match.screen === 'countdown'
              ? 'READY'
              : match.screen === 'result'
                ? 'FINAL'
                : '';
    g.fillText(phase, W / 2, 78);
    g.font = font(600, 30);
    g.fillStyle = UI.dim;
    g.fillText(`ROUND ${Math.max(1, match.round)} / ${FIGHT.rounds}`, W / 2, 132);

    // Health bars.
    const barY = 190;
    const barH = 44;
    const barW = 400;
    const drawBar = (x: number, w: number, frac: number, tint: number, rtl: boolean): void => {
      g.beginPath();
      g.roundRect(x, barY, w, barH, 10);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fill();
      g.strokeStyle = UI.lineFaint;
      g.stroke();
      const fw = Math.max(0, Math.min(1, frac)) * (w - 8);
      if (fw > 2) {
        g.beginPath();
        if (rtl) g.roundRect(x + w - 4 - fw, barY + 4, fw, barH - 8, 7);
        else g.roundRect(x + 4, barY + 4, fw, barH - 8, 7);
        g.fillStyle = css(tint, 0.92);
        g.fill();
      }
    };
    drawBar(56, barW, match.me.health / match.me.maxHealth, mine.shallow, false);
    drawBar(W - 56 - barW, barW, match.foe.health / match.foe.maxHealth, theirs.shallow, true);

    // Round pips.
    const pip = (cx: number, on: boolean, tint: number): void => {
      g.beginPath();
      g.arc(cx, 300, 13, 0, Math.PI * 2);
      g.fillStyle = on ? css(tint) : 'rgba(255,255,255,0.10)';
      g.fill();
    };
    for (let i = 0; i < Math.ceil(FIGHT.rounds / 2) + 1; i++) {
      pip(76 + i * 44, i < match.me.rounds, mine.shallow);
      pip(W - 76 - i * 44, i < match.foe.rounds, theirs.shallow);
    }

    // Tallies.
    g.font = font(500, 26);
    g.fillStyle = UI.faint;
    g.textAlign = 'left';
    g.fillText(`HITS ${match.me.hitsLanded}   BLOCKS ${match.me.blocks}`, 56, 340);
    g.textAlign = 'right';
    g.fillText(`HITS ${match.foe.hitsLanded}   BLOCKS ${match.foe.blocks}`, W - 56, 340);

    this.tex.needsUpdate = true;
  }
}

function fmtClock(s: number): string {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

class Card {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private mat: MeshBasicMaterial;
  private age = 999;
  private hold = 1;

  constructor() {
    this.canvas.width = 768;
    this.canvas.height = 320;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      opacity: 0,
    });
    this.mesh = new Mesh(new PlaneGeometry(1.15, 0.48), this.mat);
    this.mesh.renderOrder = 26;
    this.mesh.visible = false;
  }

  show(big: string, small: string, tone: string, holdS: number): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 768, 320);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, big.length > 6 ? 128 : 170);
    g.letterSpacing = '6px';
    g.shadowColor = tone;
    g.shadowBlur = 34;
    g.fillStyle = tone;
    g.fillText(big, 384, small ? 140 : 160);
    g.shadowBlur = 0;
    if (small) {
      g.font = font(600, 44);
      g.letterSpacing = '4px';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(small, 384, 258);
    }
    g.letterSpacing = '0px';
    this.tex.needsUpdate = true;
    this.age = 0;
    this.hold = holdS;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.age += dt;
    const inT = Math.min(1, this.age / 0.18);
    const pop = 0.82 + 0.18 * (1 - (1 - inT) ** 3);
    this.mesh.scale.setScalar(pop);
    const fade = Math.max(0, Math.min(1, (this.hold + 0.35 - this.age) / 0.35));
    this.mat.opacity = Math.min(inT * 1.4, 1) * fade;
    if (this.age > this.hold + 0.4) this.mesh.visible = false;
  }
}

export class HudSystem extends createSystem({}) {
  private board = new BoardFace();
  private card = new Card();
  private rig = new Group();
  private lastScreen = '';
  private lastPainted = -1;
  private lastDirty = -1;
  private lastKoShown = 0;

  init(): void {
    this.rig.add(this.board.mesh);
    this.board.mesh.position.set(0, 2.2, -RING.spawnBack * 2);
    this.card.mesh.position.set(0, 1.78, -RING.spawnBack);
    this.rig.add(this.card.mesh);
    this.scene.add(this.rig);
  }

  update(delta: number): void {
    // AR: the board hangs over the FAR ropes of YOUR ring — drag the ring
    // to your wall and the scoreboard follows the furniture. The card
    // floats at the ring's heart. (Layout is live; this is cheap.)
    const cx = (ringLayout.left + ringLayout.right) / 2;
    this.board.mesh.position.set(cx, 2.2, ringLayout.far - 0.05);
    this.card.mesh.position.set(cx, 1.78, (ringLayout.near + ringLayout.far) / 2);

    // Board + card always face the fighter reading them (yaw only).
    _look.copy(tracked.head);
    for (const m of [this.board.mesh, this.card.mesh]) {
      m.lookAt(_look.x, m.position.y, _look.z);
    }

    const inShow = match.screen !== 'foyer' && match.screen !== 'lobby';
    this.board.mesh.visible = inShow;

    /* Repaint policy: dirty flags and the ticking second, nothing else. */
    if (inShow) {
      const clock = fightView.phaseLeft();
      const second = Math.ceil(clock);
      if (second !== this.lastPainted || match.dirty !== this.lastDirty) {
        this.lastPainted = second;
        this.lastDirty = match.dirty;
        this.board.paint(clock);
      }
    }

    /* The moments. */
    if (match.screen !== this.lastScreen) {
      this.lastScreen = match.screen;
      switch (match.screen) {
        case 'countdown':
          this.card.show(`ROUND ${match.round}`, match.mode === 'practice' ? match.foe.name : 'FIGHT NIGHT', UI.accent, 1.4);
          break;
        case 'round':
          this.card.show('FIGHT', '', UI.accent, 0.8);
          break;
        case 'rest':
          this.card.show('REST', 'breathe — you are a puddle', '#9fd8ff', 1.6);
          break;
        case 'ko':
          this.lastKoShown = 0;
          this.card.show('DOWN!', match.koVictim === 'me' ? 'you are the puddle' : 'they are the puddle', '#ffb454', 1.0);
          break;
        case 'result': {
          const w = match.winner;
          if (w === 'me') this.card.show('YOU WIN', 'the other goop is soup', UI.accent, 4);
          else if (w === 'foe') this.card.show('YOU LOSE', 'scraped off the mat', '#ff5266', 4);
          else this.card.show('DRAW', 'two puddles, one mat', '#9fd8ff', 4);
          break;
        }
        default:
          break;
      }
    }
    if (match.screen === 'ko' && match.koCount !== this.lastKoShown && match.koCount > 0) {
      this.lastKoShown = match.koCount;
      const final = match.koCount >= FIGHT.koCount;
      this.card.show(
        String(match.koCount),
        final ? 'OUT' : '',
        final ? '#ff5266' : '#ffb454',
        final ? 1.4 : 0.75,
      );
    }

    this.card.update(delta);
    void nowS;
  }
}
