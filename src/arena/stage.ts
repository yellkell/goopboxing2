/**
 * THE STAGE — a neon prizefight ring floating in a dark void, built the
 * lineage's way: structure over sticks, instancing over objects, light on
 * the STRUCTURE and a sky that stays black.
 *
 * Your real floor is the mat (y = 0 always). The ring centre sits at
 * (0, 0, −spawnBack) in every fighter's local frame (game/ring.ts), so
 * this whole rig is built identically on both headsets and nobody ever
 * transforms it.
 *
 * The budget (measured intent, not hope): one draw for the mat, one for
 * its LED trim, one each for posts/pads/ropes, one for the outer floor,
 * two for the void towers (bodies + lit strips), one for the truss, four
 * additive spot cones, a handful of glow sprites. Everything animated
 * animates through per-instance colour or material opacity — zero
 * geometry uploads per frame.
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
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
import { ringCenterLocal } from '../game/ring.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

export interface StageRig {
  group: Group;
  /** Re-dress the corners in the two fighters' colours. */
  setCorners(mine: GoopTint, theirs: GoopTint): void;
  /**
   * One frame of life: `pulse` 0..1 (beat envelope), `act` 0..3 musical
   * intensity, `danger` 0..1 (someone is nearly out — the room leans in).
   */
  update(dt: number, pulse: number, act: number, danger: number): void;
}

/** The dark floor with a pool of light under the ring. */
function floorTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#030503';
  g.fillRect(0, 0, 256, 256);
  const pool = g.createRadialGradient(128, 128, 10, 128, 128, 120);
  pool.addColorStop(0, 'rgba(46, 74, 50, 0.5)');
  pool.addColorStop(0.45, 'rgba(24, 40, 28, 0.28)');
  pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, 256, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** The mat's own face: dark canvas, hairline rings, a bright border band. */
function matTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0f0b';
  g.fillRect(0, 0, 512, 512);
  // Canvas wear: faint radial scuff.
  const scuff = g.createRadialGradient(256, 256, 30, 256, 256, 250);
  scuff.addColorStop(0, 'rgba(70, 90, 74, 0.16)');
  scuff.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = scuff;
  g.fillRect(0, 0, 512, 512);
  // Centre mark: a thin ring with a blob glyph.
  g.strokeStyle = 'rgba(140, 255, 112, 0.28)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(256, 256, 88, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(256, 256, 58, 0, Math.PI * 2);
  g.fillStyle = 'rgba(140, 255, 112, 0.08)';
  g.fill();
  // Border band.
  g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  g.lineWidth = 10;
  g.strokeRect(26, 26, 460, 460);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function buildStage(): StageRig {
  const group = new Group();
  group.name = 'the-stage';
  ringCenterLocal(_p);
  const cx = _p.x;
  const cz = _p.z;
  const H = RING.half;

  /* ── the outer world's floor ─────────────────────────────────────────── */
  const floor = new Mesh(
    new PlaneGeometry(44, 44),
    new MeshBasicMaterial({ map: floorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, -0.001, cz);
  group.add(floor);

  /* ── the mat ─────────────────────────────────────────────────────────── */
  const mat = new Mesh(
    new PlaneGeometry(H * 2, H * 2),
    new MeshBasicMaterial({ map: matTexture() }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(cx, 0.001, cz);
  group.add(mat);

  // LED trim: four lit bars hugging the mat's edge (one instanced draw).
  const trimGeo = new BoxGeometry(1, 0.02, 0.05);
  const trimMat = new MeshBasicMaterial({ color: 0xffffff });
  const trim = new InstancedMesh(trimGeo, trimMat, 4);
  trim.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    _q.setFromAxisAngle(new Vector3(0, 1, 0), ang);
    _p.set(Math.sin(ang) * H, 0.012, Math.cos(ang) * H).add(new Vector3(cx, 0, cz));
    _s.set(H * 2, 1, 1);
    _m.compose(_p, _q, _s);
    trim.setMatrixAt(i, _m);
    trim.setColorAt(i, _c.setHex(0x2c5c34));
  }
  group.add(trim);

  /* ── posts, pads, ropes ──────────────────────────────────────────────── */
  const postGeo = new CylinderGeometry(0.05, 0.06, RING.postHeight, 10);
  const postMat = new MeshBasicMaterial({ color: 0x11150f });
  const posts = new InstancedMesh(postGeo, postMat, 4);
  const corners: Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 === 0 ? -1 : 1;
    const sz = i < 2 ? 1 : -1; // 0,1 = my side (+z half), 2,3 = theirs
    const corner = new Vector3(cx + sx * H, RING.postHeight / 2, cz + sz * H);
    corners.push(corner);
    _m.compose(corner, _q.identity(), _s.set(1, 1, 1));
    posts.setMatrixAt(i, _m);
  }
  group.add(posts);

  // Turnbuckle pads: 3 per post, tinted per fighter side.
  const padGeo = new BoxGeometry(0.09, 0.16, 0.09);
  const padMat = new MeshBasicMaterial({ color: 0xffffff });
  const pads = new InstancedMesh(padGeo, padMat, 12);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      _p.copy(corners[i]);
      _p.y = RING.ropeHeights[j];
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
      pads.setMatrixAt(i * 3 + j, _m);
      pads.setColorAt(i * 3 + j, _c.setHex(0x8cff70));
    }
  }
  group.add(pads);

  // Ropes: 12 neon tubes (one instanced draw, per-instance colour).
  const ropeGeo = new CylinderGeometry(0.016, 0.016, 1, 8);
  ropeGeo.rotateZ(Math.PI / 2); // unit length along +X
  const ropeMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const ropes = new InstancedMesh(ropeGeo, ropeMat, 12);
  let ri = 0;
  for (let side = 0; side < 4; side++) {
    const a = corners[side === 0 ? 0 : side === 1 ? 1 : side === 2 ? 3 : 2];
    const b = corners[side === 0 ? 1 : side === 1 ? 3 : side === 2 ? 2 : 0];
    for (let j = 0; j < 3; j++) {
      _p.copy(a).add(b).multiplyScalar(0.5);
      _p.y = RING.ropeHeights[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      _q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dz, dx));
      _s.set(len, 1, 1);
      _m.compose(_p, _q, _s);
      ropes.setMatrixAt(ri, _m);
      ropes.setColorAt(ri, _c.setHex(j === 2 ? 0x9dff85 : j === 1 ? 0x5fd66c : 0x2c8a44));
      ri++;
    }
  }
  group.add(ropes);

  // Apron skirt: a dark band below the mat line.
  const apron = new Mesh(
    new BoxGeometry(H * 2 + 0.08, RING.apron, H * 2 + 0.08),
    new MeshBasicMaterial({ color: 0x070a07 }),
  );
  apron.position.set(cx, -RING.apron / 2 - 0.01, cz);
  group.add(apron);

  // Post caps: a small glow on each corner (sprites, tinted per side).
  const caps: Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const cap = glowSprite(0x8cff70, 0.3, 0.7);
    cap.position.copy(corners[i]);
    cap.position.y = RING.postHeight + 0.05;
    group.add(cap);
    caps.push(cap);
  }

  /* ── the truss + spots ───────────────────────────────────────────────── */
  const trussGeo = new BoxGeometry(1, 0.09, 0.09);
  const trussMat = new MeshBasicMaterial({ color: 0x0c0f0c });
  const truss = new InstancedMesh(trussGeo, trussMat, 4);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    _q.setFromAxisAngle(new Vector3(0, 1, 0), ang);
    _p.set(Math.sin(ang) * (H - 0.2), RING.trussHeight, Math.cos(ang) * (H - 0.2)).add(
      new Vector3(cx, 0, cz),
    );
    _s.set((H - 0.2) * 2, 1, 1);
    _m.compose(_p, _q, _s);
    truss.setMatrixAt(i, _m);
  }
  group.add(truss);

  // Four light beams: additive cones from the truss corners down to the mat.
  const beamGeo = new ConeGeometry(0.9, RING.trussHeight - 0.3, 14, 1, true);
  const beams: Mesh[] = [];
  const beamMats: MeshBasicMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const bm = new MeshBasicMaterial({
      color: 0x3a5c40,
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
      depthWrite: false,
      side: BackSide,
    });
    const beam = new Mesh(beamGeo, bm);
    const sx = i % 2 === 0 ? -1 : 1;
    const sz = i < 2 ? 1 : -1;
    beam.position.set(cx + sx * (H - 0.35), (RING.trussHeight - 0.3) / 2 + 0.15, cz + sz * (H - 0.35));
    beam.rotation.x = Math.PI; // apex up
    group.add(beam);
    const fixture = glowSprite(0xdfffd2, 0.34, 0.8);
    fixture.position.set(beam.position.x, RING.trussHeight - 0.05, beam.position.z);
    group.add(fixture);
    beams.push(beam);
    beamMats.push(bm);
  }

  /* ── the void: towers in the dark ────────────────────────────────────── */
  const TOWERS = 26;
  const bodyGeo = new BoxGeometry(1, 1, 1);
  const bodyMat = new MeshBasicMaterial({ color: 0x060906 });
  const bodies = new InstancedMesh(bodyGeo, bodyMat, TOWERS);
  const stripGeo = new BoxGeometry(1, 1, 1);
  const stripMat = new MeshBasicMaterial({ color: 0xffffff });
  const strips = new InstancedMesh(stripGeo, stripMat, TOWERS);
  strips.instanceColor?.setUsage?.(DynamicDrawUsage);
  const towerSeed: number[] = [];
  for (let i = 0; i < TOWERS; i++) {
    const ang = (i / TOWERS) * Math.PI * 2 + (i % 3) * 0.11;
    const rad = 17 + ((i * 7.31) % 14);
    const h = 4 + ((i * 5.17) % 11);
    const w = 1.4 + ((i * 3.7) % 2.2);
    _p.set(cx + Math.sin(ang) * rad, h / 2 - 0.2, cz + Math.cos(ang) * rad);
    _q.setFromAxisAngle(new Vector3(0, 1, 0), ang + 0.3);
    _s.set(w, h, w);
    _m.compose(_p, _q, _s);
    bodies.setMatrixAt(i, _m);
    // The lit pinstripe up one face.
    _p.x += Math.sin(ang) * 0.02;
    _p.z += Math.cos(ang) * 0.02;
    _s.set(w * 0.08, h * 0.96, w * 1.02);
    _m.compose(_p, _q, _s);
    strips.setMatrixAt(i, _m);
    strips.setColorAt(i, _c.setHex(0x123618));
    towerSeed.push((i * 2.39) % (Math.PI * 2));
  }
  group.add(bodies);
  group.add(strips);

  // A low horizon glow: one big dim ring of light far out, never a wall.
  const horizon = new Mesh(
    new CylinderGeometry(40, 40, 0.7, 36, 1, true),
    new MeshBasicMaterial({
      color: 0x14301c,
      transparent: true,
      opacity: 0.35,
      blending: AdditiveBlending,
      depthWrite: false,
      side: BackSide,
    }),
  );
  horizon.position.set(cx, 0.3, cz);
  group.add(horizon);

  /* ── the live wiring ─────────────────────────────────────────────────── */
  let mine: GoopTint | null = null;
  let theirs: GoopTint | null = null;
  let clock = 0;

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
    // Trim + ropes breathe with the beat; danger runs them hot.
    const heat = 0.35 + pulse * 0.4 + danger * 0.35;
    trimMat.color.setRGB(0.18 + heat * 0.5, 0.5 + heat * 0.5, 0.25 + heat * 0.35);
    ropeMat.opacity = 0.75 + pulse * 0.25;
    // Beams sway gently and swell with the act.
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      b.rotation.z = Math.sin(clock * 0.5 + i * 1.7) * 0.05;
      b.rotation.x = Math.PI + Math.cos(clock * 0.42 + i) * 0.05;
      beamMats[i].opacity = 0.06 + act * 0.02 + pulse * 0.05 + danger * 0.05;
      // Corner beams take their side's colour when the corners are dressed.
      const tint = i < 2 ? mine : theirs;
      if (tint) beamMats[i].color.setHex(tint.deep).multiplyScalar(2.2);
    }
    // Tower strips twinkle independently — one instanced draw either way.
    for (let i = 0; i < TOWERS; i++) {
      const tw = 0.5 + 0.5 * Math.sin(clock * (0.6 + (i % 5) * 0.13) + towerSeed[i]);
      const base = 0.12 + act * 0.05;
      _c.setHex(i % 2 === 0 ? 0x1c5c2c : 0x14444c).multiplyScalar(base + tw * (0.5 + pulse * 0.5));
      strips.setColorAt(i, _c);
    }
    if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
  };

  return { group, setCorners, update };
}
