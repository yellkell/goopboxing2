#!/usr/bin/env node
/**
 * THE SPARRING PROBE — a whole bout, no headset.
 *
 *   npm run dev                      # terminal 1
 *   node tools/fight-probe.mjs
 *
 * Boots the REAL app page headless, takes over the tracked body through
 * the __gbx debug rig, and fights:
 *
 *   1. foyer → PRACTICE through the real menu action path,
 *   2. countdown → round on the real referee clock,
 *   3. scripted punches through the REAL pipeline (speed gate, arming,
 *      SDF contact, victim-judge, damage) — the bot must bleed,
 *   4. anti-flail: a fist PARKED inside the bot must score at most once,
 *   5. KO → the ten count → result, verdict mine,
 *   6. the wire, loopbacked: host a fake bout, watch start/phase events
 *      leave, feed peer poses in (mirror math), land a hit event on my
 *      head and watch my own health obey the victim-judge,
 *   7. THE ROOM: ring adjust — sides move one at a time, clamps hold,
 *      the layout persists.
 *
 * Punches here are RANGED (THE REACH): the probe walks in like a fighter,
 * then sweeps the raw hand along the line — the amplified gel fist is
 * what crosses the opponent's surface and scores.
 *
 * Exits non-zero on any miss.
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 160));
});

await page.goto(base + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__gbx && window.__gbx.menu.press && window.__gbx.fighters.mine, null, {
  timeout: 30000,
});
check(true, 'world booted, systems live');

/* ── Act 1: practice bout through the real pipeline ─────────────────────── */

const act1 = await page.evaluate(async () => {
  const g = window.__gbx;
  const out = { log: [] };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await frame();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await frame();
    }
    return true;
  };
  // Headless rAF runs uncapped, so pacing is by TIME: the cooldown and the
  // referee's clock are real seconds.

  // Stand at the spawn in guard.
  g.drive(0, 1.62, 0, 0, -0.16, 1.4, -0.24, 0.16, 1.36, -0.22);
  await frames(5);

  out.foyer = g.match.screen === 'foyer';
  // THE MENU AREA: no opponent, mirror up, jumbotron dark.
  const find = (n) => g.scene().children.find((c) => c.name === n);
  out.foyerFoeHidden = g.fighters.theirs.group.visible === false;
  out.foyerMirror = find('the-mirror')?.visible === true;
  out.foyerJumboDark = find('the-jumbotron')?.visible === false;
  g.menu.press('practice');
  out.countdown = await until(() => g.match.screen === 'countdown', 3000);
  out.roundStarted = await until(() => g.match.screen === 'round', 6000);
  // Slow software renderers stretch every scripted swing — give the acts
  // one long round to live in (the KO act ends it explicitly anyway).
  g.fight.debugExtendRound(900);
  out.botName = g.match.foe.name;
  out.botStyle = g.fighters.brain?.styleName ?? '?';
  // THE FIGHT: opponent present, jumbotron live, mirror dark.
  out.roundFoeShown = g.fighters.theirs.group.visible === true;
  out.roundJumbo = find('the-jumbotron')?.visible === true;
  out.roundMirrorDark = find('the-mirror')?.visible === false;
  // Let the springs finish pouring the fighter up before judging aim.
  await until(() => g.fighters.theirs.formValue > 0.97, 4000);
  await sleep(400);

  // Harness armour: the probe scripts offence, not defence — the bot may
  // swing all it likes, this bout must not end early on MY health.
  g.match.me.maxHealth = 100000;
  g.match.me.health = 100000;

  // The fight is RANGED now (THE REACH): the bot holds ~2 m off. The
  // probe fights like a player — WALK IN until the foe is inside punch
  // range, then sweep the raw hand; the amplified gel fist crosses their
  // surface and the judge scores it.
  const me = { x: 0, z: 0 };
  const foe = { x: 0, y: 0, z: 0 };
  const readFoe = () => {
    const v = g.fighters.theirs.position;
    foe.x = v.x;
    foe.y = 0.95;
    foe.z = v.z;
  };
  const stepIn = async () => {
    // Head walks to 1.75 m from the foe root (root ooze follows).
    readFoe();
    const dx = foe.x - me.x;
    const dz = foe.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.8) {
      me.x = foe.x - (dx / d) * 1.75;
      me.z = foe.z - (dz / d) * 1.75;
    }
    g.drive(me.x, 1.62, me.z, 0, me.x - 0.06, 1.55, me.z - 0.12, me.x + 0.18, 1.32, me.z + 0.04, 0, 0);
    await sleep(120);
  };

  const hpStart = g.match.foe.health;
  let swings = 0;
  const punch = async () => {
    await stepIn();
    readFoe();
    // Sweep the RAW hand a third of the way to the target — the gel fist
    // (gain ≈ 2×) travels the rest and punches THROUGH the body with real
    // travel history for the field-slope gate.
    const from = { x: me.x + 0.15, y: 1.32, z: me.z + 0.1 };
    const to = { x: foe.x, y: foe.y, z: foe.z };
    const STEPS = 26;
    for (let s2 = 0; s2 <= STEPS; s2++) {
      const k = 0.06 + (0.6 - 0.06) * (s2 / STEPS);
      g.drive(
        me.x, 1.62, me.z, 0,
        me.x - 0.06, 1.55, me.z - 0.12,
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        from.z + (to.z - from.z) * k,
        0, 3.4,
      );
      await frame();
    }
    // Retract all the way home (the re-arm needs daylight even when the
    // other goop is marching forward), then let the cooldown pass.
    g.drive(me.x, 1.62, me.z, 0, me.x - 0.06, 1.55, me.z - 0.12, me.x + 0.15, 1.32, me.z + 0.1, 0, 0);
    await sleep(380);
    swings++;
  };
  // Stop while the bot still stands — the KO act wants a live round.
  for (let i = 0; i < 16 && g.match.screen === 'round' && g.match.foe.health > 60; i++) await punch();
  out.swings = swings;
  out.hpAfter = g.match.foe.health;
  out.hpStart = hpStart;
  out.landed = g.match.me.hitsLanded;
  // My punches THEY blocked tally on their card.
  out.blocked = g.match.foe.blocks;

  // Anti-flail: park the RAW hand where the gel fist sits INSIDE the bot
  // and hold it there at speed.
  readFoe();
  const parkFrom = g.match.foe.health;
  const parkT0 = performance.now();
  while (performance.now() - parkT0 < 900 && g.match.screen === 'round') {
    readFoe();
    // Raw hand ~45% of the way — the amplified fist parks in their body.
    g.drive(
      me.x, 1.62, me.z, 0,
      me.x - 0.06, 1.55, me.z - 0.12,
      me.x + (foe.x - me.x) * 0.45, 1.1, me.z + (foe.z - me.z) * 0.45,
      0, 4.0,
    );
    await frame();
  }
  // At most ONE scoring hit's worth of damage may tick while parked.
  out.parkDamage = parkFrom - g.match.foe.health;

  return out;
});

check(act1.foyer, 'starts in the foyer');
check(act1.foyerFoeHidden, 'the menu area is YOURS (no opponent in the foyer)');
check(act1.foyerMirror && act1.foyerJumboDark, 'the mirror is up in the foyer, the jumbotron dark');
check(act1.countdown, 'PRACTICE → countdown');
check(act1.roundStarted, `bell rings (bot: ${act1.botName}, style: ${act1.botStyle})`);
check(act1.roundFoeShown, 'the opponent pours in for the fight');
check(act1.roundJumbo && act1.roundMirrorDark, 'the jumbotron is live in the round, the mirror dark');
check(act1.hpAfter < act1.hpStart, `punches land: bot ${act1.hpStart} → ${Math.round(act1.hpAfter)} hp over ${act1.swings} swings`);
check(act1.landed + act1.blocked >= 4, `judge tallied (landed ${act1.landed}, blocked ${act1.blocked})`);
check(act1.parkDamage <= 8, `anti-flail: a parked fist ticked ${act1.parkDamage.toFixed(1)} hp (≤ one hit)`);

/* ── Act 2: KO, the count, the verdict ──────────────────────────────────── */

const act2 = await page.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const until = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await frame();
    }
    return true;
  };
  const out = {};
  if (g.match.screen !== 'round') return { skipped: true };
  g.fight.debugHurt('foe', 999);
  out.koEntered = await until(() => g.match.screen === 'ko', 2000);
  out.victim = g.match.koVictim;
  out.foeIsPuddle = g.fighters.theirs.isKo === true;
  out.countMoved = await until(() => g.match.koCount >= 3, 5000);
  out.result = await until(() => g.match.screen === 'result', 12000);
  out.winner = g.match.winner;
  g.menu.press('corner');
  out.backHome = await until(() => g.match.screen === 'foyer', 2000);
  return out;
});

check(!act2.skipped, 'round still live for the KO act');
check(act2.koEntered === true, 'health 0 → the ten count');
check(act2.victim === 'foe', 'the right goop is down');
check(act2.foeIsPuddle === true, 'the downed goop is a puddle');
check(act2.countMoved === true, 'the count climbs');
check(act2.result === true, `count out → result (winner: ${act2.winner})`);
check(act2.winner === 'me', 'verdict: mine');
check(act2.backHome === true, 'CORNER returns to the foyer');

/* ── Act 3: the wire, loopbacked ────────────────────────────────────────── */

const act3 = await page.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await frame();
  };
  const until = async (cond, ms) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await frame();
    }
    return true;
  };
  const out = {};

  const peer = g.loopback(0);
  out.paired = g.net.phase === 'paired';

  // Their identity crosses.
  peer.event({ t: 'hello', name: 'REMO', tint: 2 });
  await frames(3);
  out.helloApplied = g.match.foe.name === 'REMO' && g.match.foe.tintIdx === 2;

  // Host rings the bell: start + countdown phase leave on the wire.
  g.fight.startOnline();
  await frames(3);
  const kinds = peer.sentEvents.map((e) => e.t);
  out.startSent = kinds.includes('start');
  out.phaseSent = peer.sentEvents.some((e) => e.t === 'phase' && e.phase === 'countdown');
  out.roundStarted = await until(() => g.match.screen === 'round', 6000);
  g.fight.debugExtendRound(900); // headless renderers are slow; see act 1

  // Poses flow out at the pose rate…
  await frames(30);
  out.posesOut = peer.sentPoses.length >= 2 && peer.sentPoses[0].length === 13;

  // …and a peer pose flows IN through the mirror. Their local (0.3, 1.6,
  // 0.1) must land at (−0.3, 1.6, −0.1 − 2·spawnBack) in my frame.
  peer.pose([0.3, 1.6, 0.1, 0, 0, 0, 1, 0.1, 1.3, -0.2, 0.5, 1.3, -0.2]);
  for (let i = 0; i < 90; i++) {
    peer.pose([0.3, 1.6, 0.1, 0, 0, 0, 1, 0.1, 1.3, -0.2, 0.5, 1.3, -0.2]);
    await frame();
  }
  const spawnBack = 1.35; // MUST match config.RING.spawnBack
  const want = { x: -0.3, z: -0.1 - 2 * spawnBack };
  const theirRoot = g.fighters.theirs.position;
  out.mirrorErr = Math.hypot(theirRoot.x - want.x, theirRoot.z - want.z);
  out.mirrored = out.mirrorErr < 0.3; // the root oozes toward the head's spot

  // An incoming hit event lands on MY body under the victim-judge: aim it
  // at my head with my guard held LOW so it cannot block.
  g.drive(0, 1.62, 0, 0, -0.3, 0.8, 0.1, 0.3, 0.8, 0.1);
  await frames(3);
  const hpBefore = g.match.me.health;
  // Their frame: my head (0,1.62,0) mirrors to (−0, 1.62, −2·spawnBack).
  peer.event({ t: 'hit', p: [0, 1.62, -2 * spawnBack], d: [0, 0, 1], s: 6 });
  await frames(5);
  out.hpDrop = hpBefore - g.match.me.health;
  out.victimJudged = out.hpDrop > 4;

  // …and blocked when my glove guards the line.
  g.drive(0, 1.62, 0, 0, -0.05, 1.55, -0.15, 0.05, 1.5, -0.15);
  await frames(3);
  const hpBefore2 = g.match.me.health;
  peer.event({ t: 'hit', p: [0, 1.62, -2 * spawnBack], d: [0, 0, 1], s: 6 });
  await frames(5);
  const drop2 = hpBefore2 - g.match.me.health;
  out.blockDrop = drop2;
  out.blockJudged = drop2 > 0 && drop2 < out.hpDrop * 0.5;

  // My authoritative state went back over the wire.
  out.stateSent = peer.sentEvents.some((e) => e.t === 'state');

  peer.leave();
  await frames(3);
  out.foldsHome = g.match.screen === 'foyer' && g.net.phase === 'off';
  return out;
});

check(act3.paired, 'loopback pairs the room');
check(act3.helloApplied, 'hello dresses the far corner');
check(act3.startSent && act3.phaseSent, 'host bell → start + phase on the wire');
check(act3.roundStarted, 'online bout reaches the round');
check(act3.posesOut, 'poses stream out (13 floats)');
check(act3.mirrored, `peer pose mirrors across the ring (err ${act3.mirrorErr?.toFixed(2)} m)`);
check(act3.victimJudged, `incoming hit judged by my gloves (−${act3.hpDrop?.toFixed(1)} hp)`);
check(act3.blockJudged, `guarded hit blocks (−${act3.blockDrop?.toFixed(1)} hp vs −${act3.hpDrop?.toFixed(1)})`);
check(act3.stateSent, 'authoritative self-state broadcast');
check(act3.foldsHome, 'peer leaving folds back to the foyer');

/* ── Act 4: THE ROOM — ring adjust, clamps, persistence ─────────────────── */

const act4 = await page.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const frames = async (n) => {
    for (let i = 0; i < n; i++) await frame();
  };
  const out = {};

  // The A-button menu path: qadjust turns adjust mode on.
  g.menu.press('qadjust');
  await frames(2);
  out.adjustOn = g.ring.state.active === true;

  // Drag one side at a time (the same code path a trigger-grab drives).
  g.ring.move('far', -3.6);
  g.ring.move('near', 1.2);
  g.ring.move('left', -1.4);
  g.ring.move('right', 1.9);
  await frames(3);
  out.far = g.ring.layout.far;
  out.near = g.ring.layout.near;
  out.left = g.ring.layout.left;
  out.right = g.ring.layout.right;
  out.moved =
    Math.abs(out.far - -3.6) < 0.01 &&
    Math.abs(out.near - 1.2) < 0.01 &&
    Math.abs(out.left - -1.4) < 0.01 &&
    Math.abs(out.right - 1.9) < 0.01;

  // Clamps: sides cannot cross closer than the minima.
  g.ring.move('right', -3); // absurd — would cross left
  await frames(2);
  out.clampWidth = g.ring.layout.right - g.ring.layout.left;
  out.clamped = out.clampWidth >= 1.69;

  // A (or DONE) ends adjust mode and SAVES.
  g.ring.adjust(false);
  await frames(2);
  out.adjustOff = g.ring.state.active === false;
  try {
    const saved = JSON.parse(localStorage.getItem('slugfest-ring-v1'));
    out.persisted = saved && Math.abs(saved.far - out.far) < 0.01;
  } catch {
    out.persisted = false;
  }

  // The stage is still one group and the HUD board follows the far side.
  out.stage = !!g.scene().children.find((c) => c.name === 'the-stage');

  // Home for the next probe run: default layout back, saved.
  g.menu.press('qadjust');
  g.ring.move('far', -3.45);
  g.ring.move('near', 0.75);
  g.ring.move('left', -2.1);
  g.ring.move('right', 2.1);
  g.ring.adjust(false);
  return out;
});

check(act4.adjustOn, 'A-menu ADJUST RING arms the wrench');
check(act4.moved, `sides move one at a time (far ${act4.far?.toFixed(2)}, near ${act4.near?.toFixed(2)}, left ${act4.left?.toFixed(2)}, right ${act4.right?.toFixed(2)})`);
check(act4.clamped, `clamps hold the ring a ring (width ${act4.clampWidth?.toFixed(2)} ≥ 1.7)`);
check(act4.adjustOff, 'DONE disarms');
check(act4.persisted, 'the layout persists to this headset');
check(act4.stage, 'the stage stands');

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nthe whole bout holds — ding ding');
