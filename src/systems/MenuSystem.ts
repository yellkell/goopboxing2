/**
 * MenuSystem — the foyer: one panel floating over the mat between you and
 * the ring. Pick a name, pick your corner's colour, fight the house goop,
 * or open a room and shout four digits at a friend.
 *
 * Interaction is the lineage's laser grammar: the beam draws only over
 * the panel, the dot rides the hit, trigger presses. Headless probes
 * drive the same buttons through `menuView.press(id)` — the panel's
 * hit-test IS the API.
 *
 * THE QUICK MENU: press A (or X) on either controller — outside a live
 * round — and a small card floats up at your gaze with the room tools:
 * ADJUST RING (drag the ropes to your real walls, one side at a time —
 * see ArenaSystem), RESET RING, CLOSE. While adjust mode is on, A ends
 * it and saves. This is how an AR game does a settings drawer: on your
 * wrist's button, not on a wall.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import { Group, Quaternion, Raycaster, type Intersection } from 'three';
import { FIGHTER_NAMES, BOT, GAME_TITLE, GOOPS, NET } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { beatNow, setRunning } from '../audio/jukebox.js';
import { match, tracked } from '../fight/state.js';
import { resetLayout, ringAdjust } from '../arena/ringLayout.js';
import { arenaView } from './ArenaSystem.js';
import { hostBout, joinBout, leaveBout, net } from '../net/transport.js';
import { font } from '../ui/fonts.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import { PointerRay } from '../ui/pointer.js';
import { fightView } from './FightSystem.js';

type MenuMode = 'main' | 'keypad';

/** Headless probes press the same buttons the lasers do. */
export const menuView: {
  press?: (id: string) => void;
  buttons?: () => string[];
  mode?: () => MenuMode;
  /** Probe access: is the A-button quick menu up? */
  quickOpen?: () => boolean;
  /** Probe access: open/close the quick menu (the A button headless). */
  setQuick?: (open: boolean) => void;
} = {};

function tintCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class MenuSystem extends createSystem({}) {
  private panel!: Panel;
  private rig = new Group();
  private quick!: Panel;
  private quickRig = new Group();
  private quickOpen = false;
  private mode: MenuMode = 'main';
  private code = '';
  private hover: string | null = null;
  private lastDirty = -1;
  private lastNetDirty = -1;
  private nameIdx = 0;
  private pointers!: Record<'left' | 'right', PointerRay>;
  private caster = new Raycaster();
  private clock = 0;

  init(): void {
    this.panel = new Panel(1.0, 1.0, 1024, 1024);
    this.rig.add(this.panel.group);
    this.rig.position.set(0, 1.42, -0.98);
    this.rig.rotation.x = -0.12;
    this.scene.add(this.rig);
    this.quick = new Panel(0.5, 0.42, 512, 430);
    this.quickRig.add(this.quick.group);
    this.scene.add(this.quickRig);
    this.quick.setShown(false, true);
    this.pointers = {
      left: new PointerRay(this.scene),
      right: new PointerRay(this.scene),
    };
    menuView.press = (id) => this.press(id);
    menuView.buttons = () => this.panel.liveButtons();
    menuView.mode = () => this.mode;
    menuView.quickOpen = () => this.quickOpen;
    menuView.setQuick = (open) => this.toggleQuick(open);
    this.repaint();
  }

  /* ── the quick (A-button) menu ────────────────────────────────────────── */

  private toggleQuick(open: boolean): void {
    this.quickOpen = open;
    if (open) {
      // Float at gaze: 0.85 m out, a touch below eye line, facing you.
      const fwd = _dir.set(0, 0, -1).applyQuaternion(tracked.headQuat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      this.quickRig.position.set(
        tracked.head.x + fwd.x * 0.85,
        Math.max(1.0, tracked.head.y - 0.12),
        tracked.head.z + fwd.z * 0.85,
      );
      this.quickRig.rotation.set(0, Math.atan2(fwd.x, fwd.z) + Math.PI, 0);
      this.repaintQuick();
    }
    sfx.uiClick();
  }

  private quickButtons(): PanelButton[] {
    const adjusting = ringAdjust.active;
    return [
      {
        id: 'qadjust',
        label: adjusting ? 'DONE ADJUSTING' : 'ADJUST RING',
        sub: adjusting ? 'saves your room layout' : 'drag the ropes to your walls',
        primary: true,
        x: 36,
        y: 130,
        w: 440,
        h: 104,
      },
      { id: 'qreset', label: 'RESET RING', small: true, x: 36, y: 254, w: 440, h: 76 },
      { id: 'qclose', label: 'CLOSE', small: true, x: 36, y: 348, w: 440, h: 64 },
    ];
  }

  private repaintQuick(): void {
    this.quick.paint(
      'THE ROOM',
      (g) => {
        g.font = font(500, 22);
        g.fillStyle = UI.faint;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(
          ringAdjust.active ? 'hold TRIGGER on a rope side · one at a time' : 'the ring is furniture — place it',
          256,
          104,
        );
      },
      this.quickButtons(),
      this.hover,
    );
  }

  /* ── the button sets ──────────────────────────────────────────────────── */

  private buttons(): PanelButton[] {
    const s = match.screen;
    if (s === 'lobby') {
      const paired = net.phase === 'paired';
      const bs: PanelButton[] = [];
      if (paired && net.seat === 0) {
        bs.push({ id: 'bell', label: 'RING THE BELL', sub: 'both corners are in', primary: true, x: 72, y: 620, w: 880, h: 140 });
      }
      bs.push({ id: 'cancel', label: paired ? 'LEAVE' : 'CANCEL', x: 72, y: 800, w: 880, h: 100 });
      return bs;
    }
    if (s === 'result') {
      const canRestart = match.mode === 'practice' || net.seat === 0;
      const bs: PanelButton[] = [];
      if (canRestart) {
        bs.push({ id: 'rematch', label: 'REMATCH', sub: 'same corners, fresh gel', primary: true, x: 72, y: 560, w: 880, h: 140 });
      }
      bs.push({ id: 'corner', label: 'BACK TO THE FOYER', x: 72, y: 740, w: 880, h: 100 });
      return bs;
    }
    if (this.mode === 'keypad') {
      const bs: PanelButton[] = [];
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      keys.forEach((k, i) => {
        bs.push({
          id: `k${k}`,
          label: k,
          x: 262 + (i % 3) * 176,
          y: 280 + Math.floor(i / 3) * 128,
          w: 160,
          h: 112,
        });
      });
      bs.push({ id: 'k0', label: '0', x: 438, y: 664, w: 160, h: 112 });
      bs.push({ id: 'kdel', label: '⌫', x: 262, y: 664, w: 160, h: 112 });
      bs.push({
        id: 'kgo',
        label: 'STEP IN',
        disabled: this.code.length !== NET.codeLength,
        primary: this.code.length === NET.codeLength,
        x: 614,
        y: 664,
        w: 160,
        h: 112,
      });
      bs.push({ id: 'kback', label: 'BACK', small: true, x: 72, y: 860, w: 880, h: 80 });
      return bs;
    }
    // MAIN
    const online = net.phase !== 'unconfigured';
    const bs: PanelButton[] = [
      { id: 'name', label: match.me.name, sub: 'TAP TO RENAME', x: 72, y: 150, w: 430, h: 110 },
      // Tint swatches are ghost buttons — the body paints them.
      { id: 'tint0', label: '', ghost: true, x: 540, y: 150, w: 96, h: 110 },
      { id: 'tint1', label: '', ghost: true, x: 646, y: 150, w: 96, h: 110 },
      { id: 'tint2', label: '', ghost: true, x: 752, y: 150, w: 96, h: 110 },
      { id: 'tint3', label: '', ghost: true, x: 858, y: 150, w: 96, h: 110 },
    ];
    BOT.levels.forEach((lv, i) => {
      bs.push({
        id: `level${i}`,
        label: lv.name,
        small: true,
        selected: match.botLevel === i,
        x: 72 + i * 300,
        y: 320,
        w: 284,
        h: 92,
      });
    });
    bs.push({
      id: 'practice',
      label: 'PRACTICE',
      sub: 'fight the house goop',
      primary: true,
      x: 72,
      y: 452,
      w: 880,
      h: 140,
    });
    bs.push({
      id: 'adjust',
      label: 'ADJUST RING',
      sub: 'fit it to your room',
      small: true,
      x: 72,
      y: 812,
      w: 880,
      h: 84,
    });
    bs.push({
      id: 'host',
      label: 'HOST BOUT',
      sub: online ? 'get four digits' : 'needs firebase',
      disabled: !online,
      x: 72,
      y: 632,
      w: 430,
      h: 120,
    });
    bs.push({
      id: 'join',
      label: 'JOIN BOUT',
      sub: online ? 'type four digits' : 'needs firebase',
      disabled: !online,
      x: 522,
      y: 632,
      w: 430,
      h: 120,
    });
    return bs;
  }

  private body(): (g: CanvasRenderingContext2D) => void {
    const s = match.screen;
    const mode = this.mode;
    const code = this.code;
    return (g) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (s === 'lobby') {
        g.font = font(600, 34);
        g.fillStyle = UI.dim;
        g.fillText(net.phase === 'paired' ? 'CHALLENGER IN THE FAR CORNER' : 'THE FOUR DIGITS', 512, 210);
        g.font = font(700, 200);
        g.letterSpacing = '18px';
        g.fillStyle = UI.accent;
        g.shadowColor = UI.accentDim;
        g.shadowBlur = 30;
        g.fillText(net.code || '····', 512, 370);
        g.shadowBlur = 0;
        g.letterSpacing = '0px';
        g.font = font(500, 30);
        g.fillStyle = UI.faint;
        const line =
          net.phase === 'connecting'
            ? 'opening the room…'
            : net.phase === 'paired'
              ? net.seat === 0
                ? `${match.foe.name} is here — ring the bell`
                : 'waiting for the host to ring the bell'
              : net.phase === 'error'
                ? net.error
                : 'shout them at a friend';
        g.fillText(line, 512, 520);
        return;
      }
      if (s === 'result') {
        const w = match.winner;
        g.font = font(700, 120);
        g.fillStyle = w === 'me' ? UI.accent : w === 'foe' ? UI.danger : UI.info;
        g.fillText(w === 'me' ? 'VICTORY' : w === 'foe' ? 'DEFEAT' : 'DRAW', 512, 250);
        g.font = font(500, 34);
        g.fillStyle = UI.dim;
        g.fillText(`rounds ${match.me.rounds}–${match.foe.rounds}`, 512, 380);
        return;
      }
      if (mode === 'keypad') {
        g.font = font(600, 30);
        g.fillStyle = UI.dim;
        g.fillText('THE BOUT’S FOUR DIGITS', 512, 170);
        g.font = font(700, 96);
        g.letterSpacing = '14px';
        g.fillStyle = UI.textHi;
        g.fillText((code + '····').slice(0, 4), 512, 236);
        g.letterSpacing = '0px';
        return;
      }
      // MAIN body: corner caption + swatches.
      g.font = font(500, 26);
      g.fillStyle = UI.faint;
      g.textAlign = 'left';
      g.fillText('YOUR NAME', 72, 128);
      g.fillText('YOUR CORNER', 540, 128);
      g.textAlign = 'center';
      GOOPS.tints.forEach((tint, i) => {
        const x = 540 + i * 106;
        const y = 150;
        const sel = match.me.tintIdx === i;
        g.beginPath();
        g.roundRect(x, y, 96, 110, 16);
        const grad = g.createLinearGradient(0, y, 0, y + 110);
        grad.addColorStop(0, tintCss(tint.shallow));
        grad.addColorStop(1, tintCss(tint.deep));
        g.fillStyle = grad;
        g.fill();
        g.lineWidth = sel ? 5 : 2;
        g.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.25)';
        g.stroke();
      });
      g.font = font(500, 26);
      g.fillStyle = UI.faint;
      g.textAlign = 'left';
      g.fillText('SPARRING LEVEL', 72, 300);
      g.textAlign = 'center';
      // Net state footnote.
      g.font = font(500, 25);
      g.fillStyle = net.phase === 'unconfigured' ? UI.warn : UI.faint;
      const note =
        net.phase === 'unconfigured'
          ? 'online bouts wake up when the Firebase config lands (src/net/firebaseConfig.ts)'
          : net.phase === 'error'
            ? net.error
            : 'two goops enter · one goop schlorps';
      g.fillText(note, 512, 782);
    };
  }

  /* ── actions ──────────────────────────────────────────────────────────── */

  private press(id: string): void {
    sfx.uiClick();
    this.panel.press(id);
    if (id.startsWith('k')) {
      if (id === 'kback') this.mode = 'main';
      else if (id === 'kdel') this.code = this.code.slice(0, -1);
      else if (id === 'kgo') {
        if (this.code.length === NET.codeLength) {
          match.mode = 'online';
          joinBout(this.code);
          match.screen = 'lobby';
          this.mode = 'main';
        }
      } else {
        const digit = id.slice(1);
        if (this.code.length < NET.codeLength && digit.length === 1) this.code += digit;
      }
      match.dirty++;
      return;
    }
    switch (id) {
      case 'adjust':
        arenaView.setAdjust(true);
        this.quickOpen = false;
        break;
      case 'qadjust':
        arenaView.setAdjust(!ringAdjust.active);
        this.quickOpen = false;
        break;
      case 'qreset':
        resetLayout();
        break;
      case 'qclose':
        this.quickOpen = false;
        break;
      case 'name': {
        this.nameIdx = (this.nameIdx + 1) % FIGHTER_NAMES.length;
        match.me.name = FIGHTER_NAMES[this.nameIdx];
        match.dirty++;
        break;
      }
      case 'tint0':
      case 'tint1':
      case 'tint2':
      case 'tint3': {
        const idx = Number(id.slice(4));
        if (idx !== match.me.tintIdx) {
          match.me.tintIdx = idx;
          // The other corner never wears my colour (practice bot re-dresses).
          if (match.foe.tintIdx === idx) match.foe.tintIdx = (idx + 1) % GOOPS.tints.length;
          match.generation++;
          match.dirty++;
        }
        break;
      }
      case 'level0':
      case 'level1':
      case 'level2':
        match.botLevel = Number(id.slice(5));
        match.dirty++;
        break;
      case 'practice':
        fightView.startPractice(match.botLevel);
        break;
      case 'host':
        match.mode = 'online';
        hostBout();
        match.screen = 'lobby';
        match.dirty++;
        break;
      case 'join':
        this.mode = 'keypad';
        this.code = '';
        match.dirty++;
        break;
      case 'bell':
        fightView.startOnline();
        break;
      case 'cancel':
        leaveBout();
        match.mode = 'practice';
        fightView.toFoyer();
        break;
      case 'rematch':
        fightView.rematch();
        break;
      case 'corner':
        if (match.mode === 'online') leaveBout();
        match.mode = 'practice';
        fightView.toFoyer();
        break;
    }
  }

  private repaint(): void {
    const title =
      match.screen === 'lobby' ? 'THE BOUT' : match.screen === 'result' ? 'THE VERDICT' : GAME_TITLE;
    this.panel.paint(title, this.body(), this.buttons(), this.hover);
  }

  /* ── frame loop ───────────────────────────────────────────────────────── */

  update(delta: number): void {
    this.clock += delta;

    /* The A-button drawer. In a live round the button is a boxing glove. */
    const fighting = match.screen === 'round' || match.screen === 'ko';
    for (const hand of ['left', 'right'] as const) {
      const pad = this.input?.xr?.gamepads?.[hand];
      if (!pad) continue;
      const pressed =
        pad.getButtonDown(InputComponent.A_Button) || pad.getButtonDown(InputComponent.X_Button);
      if (!pressed || fighting) continue;
      if (ringAdjust.active) {
        arenaView.setAdjust(false); // A ends adjust mode and saves
        continue;
      }
      this.toggleQuick(!this.quickOpen);
    }
    if (fighting && this.quickOpen) this.quickOpen = false;

    const quickShown = this.quickOpen && !ringAdjust.active;
    this.quick.setShown(quickShown);
    this.quick.tick(delta, 0.4);
    if (quickShown && (match.dirty !== this.lastDirty || ringAdjust.dirty >= 0)) {
      this.repaintQuick();
    }

    const shown =
      (match.screen === 'foyer' || match.screen === 'lobby' || match.screen === 'result') &&
      !ringAdjust.active;
    this.panel.setShown(shown);
    if (!shown && !quickShown) {
      this.pointers.left.hide();
      this.pointers.right.hide();
      this.panel.tick(delta, 0);
      return;
    }

    if (match.dirty !== this.lastDirty || net.dirty !== this.lastNetDirty) {
      this.lastDirty = match.dirty;
      this.lastNetDirty = net.dirty;
      // A join that failed folds the lobby back to the foyer honestly.
      if (match.screen === 'lobby' && (net.phase === 'error' || net.phase === 'off')) {
        if (net.phase === 'error') {
          // Leave the message readable on the lobby card for a beat.
        } else {
          match.screen = 'foyer';
        }
      }
      this.repaint();
    }

    /* Lasers. */
    let hover: string | null = null;
    let hoverHand: 'left' | 'right' | null = null;
    for (const hand of ['left', 'right'] as const) {
      const obj = (
        this.world as {
          playerSpaceEntities?: { raySpaces?: Record<string, { object3D?: import('three').Object3D } | undefined> };
        }
      ).playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      const pointer = this.pointers[hand];
      if (!obj) {
        pointer.hide();
        continue;
      }
      obj.getWorldPosition(_origin);
      obj.getWorldQuaternion(_quat);
      _dir.set(0, 0, -1).applyQuaternion(_quat);
      this.caster.set(_origin, _dir);
      this.caster.far = 4;
      let target: Panel | null = null;
      let hits: Intersection[] = [];
      if (shown) {
        hits = this.caster.intersectObject(this.panel.mesh, false);
        if (hits.length > 0 && hits[0].uv) target = this.panel;
      }
      if (!target && quickShown) {
        hits = this.caster.intersectObject(this.quick.mesh, false);
        if (hits.length > 0 && hits[0].uv) target = this.quick;
      }
      if (!target) {
        pointer.update(delta, _origin, null, false);
        continue;
      }
      const id = target.buttonAt(hits[0].uv!.x, hits[0].uv!.y);
      pointer.update(delta, _origin, hits[0].point as Vector3, id !== null);
      if (id && !hover) {
        hover = id;
        hoverHand = hand;
      }
      const pad = this.input?.xr?.gamepads?.[hand];
      if (id && pad?.getButtonDown(InputComponent.Trigger)) {
        pointer.click();
        this.press(id);
      }
    }
    void hoverHand;
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
      this.repaint();
    }

    const pulse = setRunning() && beatNow() >= 0 ? Math.max(0, 1 - (beatNow() % 1) * 2.2) : 0.5 + 0.5 * Math.sin(this.clock * 1.4);
    this.panel.tick(delta, pulse);
  }
}

const _origin = new Vector3();
const _quat = new Quaternion();
const _dir = new Vector3();
