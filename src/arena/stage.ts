/**
 * THE STAGE, AR EDITION — a neon prizefight ring standing in YOUR room.
 *
 * Passthrough is the venue, so the stage is furniture, not a world: four
 * posts, twelve glowing ropes, corner pads and caps, a floor trim line
 * and a centre emblem. Nothing opaque covers your real floor, nothing
 * fills your real sky, and there is no "outside" to draw — the old void
 * (towers, truss, beams, horizon, mat, apron) is gone with the room it
 * dressed. What's left is one visual signature: ropes of light boxing a
 * piece of your actual home.
 *
 * The GEOMETRY is the live ring layout (arena/ringLayout.ts): four
 * independently placed sides, draggable to your walls. `applyLayout()`
 * re-poses every instance in place — no geometry rebuilds, ever — and
 * runs whenever the layout's dirty counter moves, so a grabbed rope
 * follows the hand at frame rate.
 *
 * Adjust mode dresses the same ring: side handles glow at mid-rope
 * height, the grabbed side runs hot, the rest breathe slow.
 */

import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  Vector3,
} from 'three';
import { RING, type GoopTint } from '../config.js';
import { glowSprite } from '../materials/glow.js';
import { ringAdjust, ringLayout, sideHandle, RING_SIDES, type RingSide } from './ringLayout.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _h = { x: 0, y: 0, z: 0 };

export interface StageRig {
  group: Group;
  /** Re-dress the corners in the two fighters' colours. */
  setCorners(mine: GoopTint, theirs: GoopTint): void;
  /**
   * One frame of life: `pulse` 0..1 (beat envelope), `act` 0..3 musical
   * intensity, `danger` 0..1 (someone is nearly out — the ropes run hot).
   */
  update(dt: number, pulse: number, act: number, danger: number): void;
}

/** The centre emblem: a thin ring + blob glyph, floor decal, mostly air. */
function emblemTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(140, 255, 112, 0.5)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(128, 128, 64, 0, Math.PI * 2);
  g.fillStyle = 'rgba(140, 255, 112, 0.10)';
  g.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function buildStage(): StageRig {
  const group = new Group();
  group.name = 'the-stage';

  /* ── the pieces (built once at unit size, POSED by applyLayout) ──────── */

  // Floor trim: four thin lit bars hugging the ring's edge on the floor.
  const trimGeo = new BoxGeometry(1, 0.018, 0.045);
  const trimMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const trim = new InstancedMesh(trimGeo, trimMat, 4);
  trim.instanceMatrix.setUsage(DynamicDrawUsage);
  group.add(trim);

  // Posts: one instanced draw.
  const postGeo = new CylinderGeometry(0.05, 0.06, RING.postHeight, 10);
  const postMat = new MeshBasicMaterial({ color: 0x11150f });
  const posts = new InstancedMesh(postGeo, postMat, 4);
  posts.instanceMatrix.setUsage(DynamicDrawUsage);
  group.add(posts);

  // Turnbuckle pads: 3 per post, tinted per fighter side.
  const padGeo = new BoxGeometry(0.09, 0.16, 0.09);
  const padMat = new MeshBasicMaterial({ color: 0xffffff });
  const pads = new InstancedMesh(padGeo, padMat, 12);
  pads.instanceMatrix.setUsage(DynamicDrawUsage);
  group.add(pads);

  // Ropes: 12 neon tubes (one instanced draw, per-instance colour).
  const ropeGeo = new CylinderGeometry(0.016, 0.016, 1, 8);
  ropeGeo.rotateZ(Math.PI / 2); // unit length along +X
  const ropeMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const ropes = new InstancedMesh(ropeGeo, ropeMat, 12);
  ropes.instanceMatrix.setUsage(DynamicDrawUsage);
  group.add(ropes);

  // Post caps: a small glow on each corner (sprites, tinted per side).
  const caps: Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const cap = glowSprite(0x8cff70, 0.3, 0.7);
    group.add(cap);
    caps.push(cap);
  }

  // Centre emblem: a faint decal on your real floor.
  const emblem = new Mesh(
    new PlaneGeometry(1.5, 1.5),
    new MeshBasicMaterial({ map: emblemTexture(), transparent: true, depthWrite: false }),
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = 0.004;
  group.add(emblem);

  // Adjust-mode side handles: one glow orb per side at mid-rope height.
  const handles: Record<RingSide, Sprite> = {
    left: glowSprite(0xffffff, 0.24, 0.85),
    right: glowSprite(0xffffff, 0.24, 0.85),
    near: glowSprite(0xffffff, 0.24, 0.85),
    far: glowSprite(0xffffff, 0.24, 0.85),
  };
  for (const side of RING_SIDES) group.add(handles[side]);

  /* ── the layout pass: pose every instance from ringLayout ────────────── */

  // Corner order — 0: near-left, 1: near-right (MY side), 2: far-left,
  // 3: far-right (THEIR side). setCorners keys off this.
  const corner = (i: number, out: Vector3): Vector3 => {
    const x = i % 2 === 0 ? ringLayout.left : ringLayout.right;
    const z = i < 2 ? ringLayout.near : ringLayout.far;
    return out.set(x, 0, z);
  };

  const applyLayout = (): void => {
    const cx = (ringLayout.left + ringLayout.right) / 2;
    const cz = (ringLayout.near + ringLayout.far) / 2;
    const width = ringLayout.right - ringLayout.left;
    const depth = ringLayout.near - ringLayout.far;

    // Posts + pads + caps at the four corners.
    for (let i = 0; i < 4; i++) {
      corner(i, _p);
      _p.y = RING.postHeight / 2;
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
      posts.setMatrixAt(i, _m);
      for (let j = 0; j < 3; j++) {
        _p.y = RING.ropeHeights[j];
        _m.compose(_p, _q, _s);
        pads.setMatrixAt(i * 3 + j, _m);
      }
      caps[i].position.set(_p.x, RING.postHeight + 0.05, _p.z);
    }
    posts.instanceMatrix.needsUpdate = true;
    pads.instanceMatrix.needsUpdate = true;

    // Ropes: sides in RING_SIDES order × 3 heights (instance = side*3+j).
    const seg = (side: RingSide, j: number, idx: number): void => {
      let x = cx;
      let z = cz;
      let len = width;
      let yaw = 0;
      if (side === 'left' || side === 'right') {
        x = ringLayout[side];
        len = depth;
        yaw = Math.PI / 2;
      } else {
        z = ringLayout[side];
      }
      _p.set(x, RING.ropeHeights[j], z);
      _q.setFromAxisAngle(_up, yaw);
      _s.set(len, 1, 1);
      _m.compose(_p, _q, _s);
      ropes.setMatrixAt(idx, _m);
    };
    RING_SIDES.forEach((side, si) => {
      for (let j = 0; j < 3; j++) seg(side, j, si * 3 + j);
    });
    ropes.instanceMatrix.needsUpdate = true;

    // Floor trim mirrors the ropes at floor level.
    RING_SIDES.forEach((side, si) => {
      let x = cx;
      let z = cz;
      let len = width;
      let yaw = 0;
      if (side === 'left' || side === 'right') {
        x = ringLayout[side];
        len = depth;
        yaw = Math.PI / 2;
      } else {
        z = ringLayout[side];
      }
      _p.set(x, 0.012, z);
      _q.setFromAxisAngle(_up, yaw);
      _s.set(len, 1, 1);
      _m.compose(_p, _q, _s);
      trim.setMatrixAt(si, _m);
    });
    trim.instanceMatrix.needsUpdate = true;

    // Emblem rides the layout centre.
    emblem.position.x = cx;
    emblem.position.z = cz;

    // Handles hug their sides.
    for (const side of RING_SIDES) {
      sideHandle(side, _h);
      handles[side].position.set(_h.x, _h.y, _h.z);
    }
  };

  /* ── the live wiring ─────────────────────────────────────────────────── */

  let mine: GoopTint | null = null;
  let theirs: GoopTint | null = null;
  let clock = 0;
  let laidOut = -1;

  const setCorners = (m: GoopTint, t: GoopTint): void => {
    mine = m;
    theirs = t;
    for (let i = 0; i < 4; i++) {
      const tint = i < 2 ? m : t; // 0,1 my side; 2,3 theirs
      for (let j = 0; j < 3; j++) pads.setColorAt(i * 3 + j, _c.setHex(tint.shallow));
      (caps[i].material as { color: Color }).color.setHex(tint.shallow);
    }
    if (pads.instanceColor) pads.instanceColor.needsUpdate = true;
  };

  const update = (dt: number, pulse: number, act: number, danger: number): void => {
    clock += dt;
    if (laidOut !== ringAdjust.dirty) {
      laidOut = ringAdjust.dirty;
      applyLayout();
    }

    // Trim + ropes breathe with the beat; danger runs them hot.
    const heat = 0.35 + pulse * 0.4 + danger * 0.35 + act * 0.04;
    trimMat.color.setRGB(0.18 + heat * 0.5, 0.5 + heat * 0.5, 0.25 + heat * 0.35);
    ropeMat.opacity = 0.75 + pulse * 0.25;

    // Rope colours: my side vs theirs when dressed, heights shading.
    for (let si = 0; si < 4; si++) {
      for (let j = 0; j < 3; j++) {
        const base = j === 2 ? 0x9dff85 : j === 1 ? 0x5fd66c : 0x2c8a44;
        _c.setHex(base);
        const side = RING_SIDES[si];
        if (side === 'near' && mine) _c.setHex(mine.shallow).multiplyScalar(0.55 + j * 0.2);
        if (side === 'far' && theirs) _c.setHex(theirs.shallow).multiplyScalar(0.55 + j * 0.2);
        ropes.setColorAt(si * 3 + j, _c);
      }
    }
    if (ropes.instanceColor) ropes.instanceColor.needsUpdate = true;

    // Adjust mode: handles surface and breathe; the grabbed side runs hot.
    const showHandles = ringAdjust.active;
    for (const side of RING_SIDES) {
      const h = handles[side];
      h.visible = showHandles;
      if (!showHandles) continue;
      const grabbed = ringAdjust.grabbed === side;
      const mat = h.material as { color: Color; opacity: number };
      mat.color.setHex(grabbed ? 0xffd27a : 0xdfffd2);
      mat.opacity = grabbed ? 0.95 : 0.55 + 0.3 * Math.sin(clock * 2.4);
      const s = grabbed ? 0.34 : 0.24 + 0.03 * Math.sin(clock * 2.4);
      h.scale.set(s, s, 1);
    }
  };

  applyLayout();
  return { group, setCorners, update };
}

const _up = new Vector3(0, 1, 0);
