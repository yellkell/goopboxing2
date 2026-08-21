/**
 * ScreenSystem — the two live surfaces (config.SCREENS):
 *
 *  - THE JUMBOTRON: a broadcast of the match, mounted in the air above
 *    the NEAR side of your ring (the mirror-image of the scoreboard's
 *    far-side mount, following the same side when you drag the ring).
 *    A fixed ringside camera at the LEFT ropes shoots the classic
 *    side-on angle; you glance back between exchanges and see the whole
 *    fight — both goops, the ropes, the board — as television.
 *
 *  - THE MIRROR: a selfie panel beside the foyer menu. Your first-person
 *    body hides its own head and fades itself down — right for your
 *    eyes, wrong for a mirror — so the capture brackets the render with
 *    GelCreature.beginFullBody()/endFullBody(): the mirror shows ALL of
 *    you, head and all, at full opacity. The plane is X-flipped, because
 *    a mirror that doesn't mirror reads as a creature copying you.
 *
 * Both are render-to-texture and cheap BY CONSTRUCTION: small targets
 * (~1–2% of the headset's pixels), captured every Nth frame, and only
 * while their screen is up (the mirror never costs a fight frame, the
 * jumbotron never costs a menu frame). While the WebXR session presents,
 * captures temporarily disable renderer.xr so the RT pass uses the
 * broadcast camera, not the headset's.
 */

import { createSystem } from '@iwsdk/core';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { SCREENS } from '../config.js';
import { match, tracked } from '../fight/state.js';
import { ringLayout } from '../arena/ringLayout.js';
import { fightersView } from './FighterSystem.js';

const _clear = new Color();

/** One RT surface: framed plane + camera + capture cadence. */
class LiveSurface {
  readonly group = new Group();
  readonly rt: WebGLRenderTarget;
  readonly camera: PerspectiveCamera;
  readonly screen: Mesh;
  private counter = 0;

  constructor(
    name: string,
    widthM: number,
    heightM: number,
    resX: number,
    resY: number,
    private everyN: number,
    mirrorFlip: boolean,
  ) {
    this.group.name = name;
    this.rt = new WebGLRenderTarget(resX, resY);
    this.rt.texture.colorSpace = SRGBColorSpace;

    this.screen = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.rt.texture }),
    );
    if (mirrorFlip) this.screen.scale.x = -1; // a mirror MIRRORS
    this.group.add(this.screen);

    // The housing: a slim dark bezel with a lit edge line.
    const bezel = new Mesh(
      new BoxGeometry(widthM + 0.07, heightM + 0.07, 0.045),
      new MeshBasicMaterial({ color: 0x0b0e0b }),
    );
    bezel.position.z = -0.028;
    this.group.add(bezel);
    const glow = new Mesh(
      new BoxGeometry(widthM + 0.1, 0.016, 0.02),
      new MeshBasicMaterial({ color: 0x3f7a4a }),
    );
    glow.position.set(0, heightM / 2 + 0.05, -0.02);
    this.group.add(glow);

    this.camera = new PerspectiveCamera(50, resX / resY, 0.05, 40);
  }

  /** True when this frame is one of ours (cadence gate). */
  due(): boolean {
    this.counter = (this.counter + 1) % this.everyN;
    return this.counter === 0;
  }

  capture(renderer: WebGLRenderer, scene: Scene, before?: () => void, after?: () => void): void {
    const xrWas = renderer.xr.enabled;
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const prevAlpha = renderer.getClearAlpha();
    this.group.visible = false; // never film yourself filming
    renderer.xr.enabled = false;
    renderer.setClearColor(0x050705, 1); // the broadcast's own dark backdrop
    renderer.setRenderTarget(this.rt);
    before?.();
    try {
      renderer.render(scene, this.camera);
    } finally {
      after?.();
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(_clear, prevAlpha);
      renderer.xr.enabled = xrWas;
      this.group.visible = true;
    }
  }
}

/** Probe access: PNG data-URL snapshots of the live surfaces. */
export const screensView: {
  snapshot?: (which: 'jumbotron' | 'mirror') => string | null;
} = {};

export class ScreenSystem extends createSystem({}) {
  private jumbo!: LiveSurface;
  private mirror!: LiveSurface;

  init(): void {
    screensView.snapshot = (which) => this.snapshot(which);
    const J = SCREENS.jumbotron;
    this.jumbo = new LiveSurface(
      'the-jumbotron',
      J.width,
      (J.width * J.resY) / J.resX,
      J.resX,
      J.resY,
      J.everyN,
      false,
    );
    this.scene.add(this.jumbo.group);

    const M = SCREENS.mirror;
    this.mirror = new LiveSurface('the-mirror', M.width, M.height, M.resX, M.resY, M.everyN, true);
    this.mirror.camera.fov = M.fov;
    this.mirror.camera.updateProjectionMatrix();
    this.scene.add(this.mirror.group);
  }

  /** Read a surface's RT back as a PNG data URL (probes; slow — debug only). */
  private snapshot(which: 'jumbotron' | 'mirror'): string | null {
    const renderer = (this.world as unknown as { renderer?: WebGLRenderer }).renderer;
    if (!renderer) return null;
    const surf = which === 'jumbotron' ? this.jumbo : this.mirror;
    const { width, height } = surf.rt;
    const px = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(surf.rt, 0, 0, width, height, px);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(width, height);
    // GL reads bottom-up; flip rows for the canvas.
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      img.data.set(px.subarray(src, src + width * 4), y * width * 4);
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  update(): void {
    const renderer = (this.world as unknown as { renderer?: WebGLRenderer }).renderer;
    const scene = this.scene as unknown as Scene;
    const s = match.screen;

    /* ── THE JUMBOTRON: alive for the fight, mounted over the near side ── */
    const fightOn = s === 'countdown' || s === 'round' || s === 'ko' || s === 'rest';
    this.jumbo.group.visible = fightOn;
    if (fightOn) {
      const J = SCREENS.jumbotron;
      const cx = (ringLayout.left + ringLayout.right) / 2;
      const cz = (ringLayout.near + ringLayout.far) / 2;
      this.jumbo.group.position.set(cx, J.height, ringLayout.near + J.setback);
      // Yaw-billboard to the reader (mounted position, readable facing).
      this.jumbo.group.rotation.set(
        0,
        Math.atan2(
          tracked.head.x - this.jumbo.group.position.x,
          tracked.head.z - this.jumbo.group.position.z,
        ),
        0,
      );

      if (renderer && this.jumbo.due()) {
        // Ringside camera at the LEFT ropes, classic side-on broadcast.
        const cam = this.jumbo.camera;
        cam.position.set(ringLayout.left - 1.15, 1.9, cz);
        cam.lookAt(cx, 1.15, cz);
        cam.updateMatrixWorld();
        this.jumbo.capture(renderer, scene);
      }
    }

    /* ── THE MIRROR: alive in the menus, beside the panel ──────────────── */
    const menuOn = s === 'foyer' || s === 'lobby' || s === 'result';
    this.mirror.group.visible = menuOn;
    if (menuOn) {
      const M = SCREENS.mirror;
      // Beside the foyer panel (which floats at (0, 1.42, −0.98)), angled in.
      this.mirror.group.position.set(-1.02, 1.32, -0.78);
      this.mirror.group.lookAt(tracked.head.x, 1.32, tracked.head.z);

      const mine = fightersView.mine;
      if (renderer && mine && this.mirror.due()) {
        // Selfie framing: from the mirror toward your body, full height.
        const cam = this.mirror.camera;
        _at.set(tracked.head.x, 0.98, tracked.head.z);
        _dir.copy(_at).sub(this.mirror.group.position);
        _dir.y = 0;
        const d = Math.max(_dir.length(), 1e-3);
        _dir.divideScalar(d);
        cam.position.set(
          _at.x - _dir.x * M.camDist,
          1.35,
          _at.z - _dir.z * M.camDist,
        );
        cam.lookAt(_at);
        cam.updateMatrixWorld();
        this.mirror.capture(
          renderer,
          scene,
          () => mine.beginFullBody(),
          () => mine.endFullBody(),
        );
      }
    }
  }
}

const _at = new Vector3();
const _dir = new Vector3();
