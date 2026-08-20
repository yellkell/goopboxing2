#!/usr/bin/env node
/**
 * ONE PIECE, EMBODIED — does a human-driven body hold together, and do the
 * gel fists actually live where the hands are?
 *
 *   npm run dev                      # terminal 1
 *   node tools/embody-check.mjs
 *
 * The vendored cohesion law was proven for AUTHORED poses; SLUGFEST adds a
 * driver the authors never met — a real player's head and hands, pinned
 * and derived (goop/embody.ts). This battery drives the REAL creature +
 * EmbodyRig through the poses boxing actually produces:
 *
 *   guard · long jab · cross-body hook · low crouch duck · deep bow ·
 *   hands-behind-back taunt · a full-speed flurry · a whip-fast 180 turn
 *
 * and after every sim step checks (a) the bridge graph over the actual
 * field — one component = one creature — and (b) PIN TRUTH: each fist
 * blob within 1 cm of the tracked hand (a glove that isn't where your
 * hand is would make every punch a lie).
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base + '/harness.html', { waitUntil: 'load', timeout: 30000 });

const result = await page.evaluate(async () => {
  const { GelCreature } = await import('/src/goop/GelCreature.ts');
  const { EmbodyRig } = await import('/src/goop/embody.ts');
  const { A, ANCHOR_COUNT } = await import('/src/goop/poses.ts');
  const { CREATURE } = await import('/src/goop/goopConfig.ts');

  const NAME = Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k]));
  const CORE = ANCHOR_COUNT;

  const fx = { splat() {}, burst() {}, update() {}, flash() {}, group: null };
  const creature = new GelCreature(fx, { firstPerson: false });
  creature.setFormTarget(1);
  const rig = new EmbodyRig(creature);
  // Bare 'three' can't resolve from an inline evaluate — borrow the
  // classes off live objects instead (the vendored tools' trick).
  const Vector3 = creature.position.constructor;
  const Quaternion = creature.group.quaternion.constructor;

  const pose = {
    head: new Vector3(0, 1.62, 0),
    headQuat: new Quaternion(),
    handL: new Vector3(-0.2, 1.3, -0.35),
    handR: new Vector3(0.22, 1.25, -0.32),
    speedL: 0,
    speedR: 0,
  };

  /* ---- the ONE PIECE check: bridge graph over the actual field ---- */
  const _p = new Vector3();
  const solidBridge = (sim, i, j, eps) => {
    const P = sim.packed;
    const ax = P[i * 4], ay = P[i * 4 + 1], az = P[i * 4 + 2], ar = P[i * 4 + 3];
    const bx = P[j * 4], by = P[j * 4 + 1], bz = P[j * 4 + 2], br = P[j * 4 + 3];
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    if (d - ar - br > CREATURE.blend * sim.blendScale * 0.75) return false;
    let worst = -1e5;
    for (let s = 1; s <= 9; s++) {
      const t = s / 10;
      _p.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      const f = sim.fieldAt(_p);
      if (f > worst) worst = f;
    }
    return worst <= -eps;
  };
  const pieces = (sim, eps) => {
    const parent = Array.from({ length: CORE }, (_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < CORE; i++) {
      for (let j = i + 1; j < CORE; j++) {
        if (solidBridge(sim, i, j, eps)) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    for (let i = 0; i < CORE; i++) {
      const r = find(i);
      groups.set(r, (groups.get(r) ?? []).concat(NAME[i]));
    }
    if (groups.size === 1) return null;
    // Report the smallest stray island.
    return [...groups.values()].sort((a, b) => a.length - b.length)[0].join('+');
  };

  const DT = 1 / 60;
  const world = new Vector3(0, 1.6, 2);
  const fist = new Vector3();
  const stats = { frames: 0, splits: 0, worstSplit: '', worstPinErr: 0 };

  const step = () => {
    rig.drive(pose);
    creature.update(DT, world);
    stats.frames++;
    if (creature.formValue > 0.95) {
      const s = pieces(creature.sim, 0.02);
      if (s) {
        stats.splits++;
        if (!stats.worstSplit) stats.worstSplit = s;
      }
      // PIN TRUTH: fist blobs where the hands are (creature-local check —
      // transform tracked hands into local space the same way drive did).
      for (const [hand, anchor] of [
        [pose.handL, A.FIST_L],
        [pose.handR, A.FIST_R],
      ]) {
        creature.group.updateMatrixWorld();
        _p.copy(hand);
        creature.group.worldToLocal(_p);
        creature.sim.corePos(anchor, fist);
        const err = fist.distanceTo(_p);
        if (err > stats.worstPinErr) stats.worstPinErr = err;
      }
    }
  };

  // Warm up: form up from the glob (worth ~2.5 s).
  for (let i = 0; i < 200; i++) step();

  const runPose = (name, frames, fn) => {
    for (let f = 0; f < frames; f++) {
      fn(f / frames, f);
      step();
    }
    return name;
  };

  const yawq = (yaw) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);

  // THE BATTERY.
  runPose('guard', 60, () => {
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.16, 1.42, -0.24);
    pose.handR.set(0.16, 1.38, -0.22);
    pose.speedL = pose.speedR = 0;
  });
  runPose('long jab', 80, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.handL.set(-0.08, 1.35, -0.25 - k * 0.55);
    pose.speedL = k * 5;
  });
  runPose('cross-body hook', 80, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.handR.set(0.2 - k * 0.55, 1.3 + k * 0.1, -0.3 - k * 0.3);
    pose.speedR = k * 4.5;
  });
  runPose('low duck', 90, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.head.set(0, 1.62 - k * 0.7, 0.05 * k);
    pose.handL.set(-0.18, 1.42 - k * 0.7, -0.22);
    pose.handR.set(0.18, 1.38 - k * 0.7, -0.2);
    pose.speedL = pose.speedR = 0;
  });
  runPose('deep bow', 90, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.head.set(0, 1.62 - k * 0.5, -0.45 * k);
    pose.headQuat.copy(yawq(0));
    pose.handL.set(-0.2, 1.0 - k * 0.4, -0.5 * k - 0.2);
    pose.handR.set(0.2, 1.0 - k * 0.4, -0.5 * k - 0.2);
  });
  runPose('hands behind back', 80, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.15, 1.0, 0.3 * k);
    pose.handR.set(0.15, 1.0, 0.3 * k);
  });
  runPose('flurry', 140, (t, f) => {
    const w = f * 0.45;
    pose.handL.set(-0.1 + Math.sin(w) * 0.1, 1.35, -0.3 - Math.max(0, Math.sin(w)) * 0.5);
    pose.handR.set(0.1 + Math.sin(w + Math.PI) * 0.1, 1.3, -0.3 - Math.max(0, Math.sin(w + Math.PI)) * 0.5);
    pose.speedL = Math.abs(Math.cos(w)) * 6;
    pose.speedR = Math.abs(Math.cos(w + Math.PI)) * 6;
  });
  runPose('whip 180', 120, (t) => {
    const yaw = t * Math.PI;
    pose.headQuat.copy(yawq(yaw));
    pose.head.set(Math.sin(yaw) * 0.15, 1.62, 0);
    pose.handL.set(-0.18 * Math.cos(yaw), 1.4, -0.24 * Math.cos(yaw) + Math.sin(yaw) * -0.18);
    pose.handR.set(0.18 * Math.cos(yaw), 1.36, -0.22 * Math.cos(yaw) + Math.sin(yaw) * 0.18);
  });
  runPose('settle', 60, () => {
    pose.headQuat.copy(yawq(Math.PI));
    pose.speedL = pose.speedR = 0;
  });

  /* ---- FIRST-PERSON DAYLIGHT: the wearer's eyes must stay clear of the
   * RENDERED field (head/neck skipped) through guard, crouch and flurry —
   * a body that swallows its own camera is a green screen. ---- */
  const fpCreature = new GelCreature(fx, { firstPerson: true });
  fpCreature.setFormTarget(1);
  const fpRig = new EmbodyRig(fpCreature);
  let minEye = 1e9;
  const eyeField = () => {
    const sim = fpCreature.sim;
    fpCreature.group.updateMatrixWorld();
    _p.set(pose.head.x, pose.head.y, pose.head.z);
    fpCreature.group.worldToLocal(_p);
    let d = 1e9;
    for (let i = 0; i < sim.packedCount; i++) {
      const dx = _p.x - sim.packed[i * 4];
      const dy = _p.y - sim.packed[i * 4 + 1];
      const dz = _p.z - sim.packed[i * 4 + 2];
      d = Math.min(d, Math.hypot(dx, dy, dz) - sim.packed[i * 4 + 3]);
    }
    return d;
  };
  pose.headQuat.copy(yawq(0));
  const fpStep = () => {
    fpRig.drive(pose);
    fpCreature.update(DT, world);
    if (fpCreature.formValue > 0.95) minEye = Math.min(minEye, eyeField());
  };
  const fpPose = (frames, fn) => {
    for (let f = 0; f < frames; f++) {
      fn(f / frames, f);
      fpStep();
    }
  };
  fpPose(220, () => {
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.16, 1.42, -0.24);
    pose.handR.set(0.16, 1.38, -0.22);
    pose.speedL = pose.speedR = 0;
  });
  fpPose(120, (t) => {
    const k = Math.sin(t * Math.PI);
    pose.head.set(0.1 * k, 1.62 - k * 0.55, 0.05 * k);
    pose.handL.set(-0.18, 1.42 - k * 0.55, -0.22);
    pose.handR.set(0.18, 1.38 - k * 0.55, -0.2);
  });
  fpPose(120, (t, f) => {
    const w = f * 0.45;
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.1, 1.35, -0.3 - Math.max(0, Math.sin(w)) * 0.5);
    pose.handR.set(0.1, 1.3, -0.3 - Math.max(0, Math.sin(w + Math.PI)) * 0.5);
    pose.speedL = Math.abs(Math.cos(w)) * 6;
    pose.speedR = Math.abs(Math.cos(w + Math.PI)) * 6;
  });
  stats.minEyeField = minEye;

  return stats;
});

console.log('EMBODY CHECK —', JSON.stringify(result));
check(result.frames > 800, `battery ran (${result.frames} frames)`);
check(result.splits === 0, `ONE PIECE on every formed frame (splits: ${result.splits}${result.worstSplit ? ' first stray: ' + result.worstSplit : ''})`);
check(result.worstPinErr < 0.005, `fists live on the hands (worst pin error ${(result.worstPinErr * 100).toFixed(2)} cm)`);
check(result.minEyeField > 0.1, `first-person eyes stay in daylight (min clearance ${(result.minEyeField * 100).toFixed(1)} cm)`);

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nembodiment holds — one piece, honest fists');
