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
 *      head and watch my own health obey the victim-judge.
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
  g.menu.press('practice');
  out.countdown = await until(() => g.match.screen === 'countdown', 3000);
  out.roundStarted = await until(() => g.match.screen === 'round', 6000);
  out.botName = g.match.foe.name;
  out.botStyle = g.fighters.brain?.styleName ?? '?';
  // Let the springs finish pouring the fighter up before judging aim.
  await until(() => g.fighters.theirs.formValue > 0.97, 4000);
  await sleep(400);

  // Harness armour: the probe scripts offence, not defence — the bot may
  // swing all it likes, this bout must not end early on MY health.
  g.match.me.maxHealth = 100000;
  g.match.me.health = 100000;

  // Their trunk is always around the root column: aim DOWNSTAIRS (under
  // most guards) and sweep THROUGH the body, the way a real punch travels.
  const head = { x: 0, y: 0, z: 0 };
  const readFoe = () => {
    const v = g.fighters.theirs.position;
    head.x = v.x;
    head.y = 0.95;
    head.z = v.z;
  };

  const hpStart = g.match.foe.health;
  let swings = 0;
  // A tight guard on the left the whole time (the block law protects the
  // scripted body from the bot's counters).
  const GL = [-0.06, 1.55, -0.12];
  const punch = async () => {
    // Wind up: hand at my chest.
    g.drive(0, 1.62, 0, 0, ...GL, 0.18, 1.32, 0.04, 0, 0);
    await sleep(80);
    // Strike LIKE A FIST: find the surface along the line and stop just
    // inside it — the field-slope gate rightly refuses hands that
    // teleport past the crossing.
    readFoe();
    const from = { x: 0.18, y: 1.32, z: 0.04 };
    const th = g.fighters.theirs;
    const pv = g.tracked.handR.clone();
    // Find the surface crossing along the line (searched past the target
    // so a lagging trunk still gets crossed)…
    let crossK = -1;
    const len = Math.hypot(head.x - from.x, head.y - from.y, head.z - from.z);
    for (let k = 0.25; k <= 1.35; k += 0.012) {
      pv.set(from.x + (head.x - from.x) * k, from.y + (head.y - from.y) * k, from.z + (head.z - from.z) * k);
      if (th.fieldAtWorld(pv) < 0) {
        crossK = k;
        break;
      }
    }
    if (crossK > 0) {
      // …then PUNCH THROUGH it the way a real hand does: ~4.5 cm per
      // frame from just outside to just past, so the contact shell is
      // genuinely crossed with real travel history (the field-slope gate
      // rightly refuses teleports that skip the crossing).
      const stepK = 0.045 / len;
      for (let s2 = -3; s2 <= 3; s2++) {
        const k = crossK + stepK * s2;
        g.drive(
          0, 1.62, 0, 0, ...GL,
          from.x + (head.x - from.x) * k,
          from.y + (head.y - from.y) * k,
          from.z + (head.z - from.z) * k,
          0, 4.2,
        );
        await frame();
      }
    }
    // Retract all the way home (the re-arm needs daylight even when the
    // other goop is marching forward), then let the cooldown pass.
    g.drive(0, 1.62, 0, 0, ...GL, 0.18, 1.32, 0.04, 0, 0);
    await sleep(330);
    swings++;
  };
  // Stop while the bot still stands — the KO act wants a live round.
  for (let i = 0; i < 12 && g.match.screen === 'round' && g.match.foe.health > 45; i++) await punch();
  out.swings = swings;
  out.hpAfter = g.match.foe.health;
  out.hpStart = hpStart;
  out.landed = g.match.me.hitsLanded;
  // My punches THEY blocked tally on their card.
  out.blocked = g.match.foe.blocks;

  // Anti-flail: park the fist INSIDE the bot at speed and hold it there.
  const parkFrom = g.match.foe.health;
  const parkT0 = performance.now();
  while (performance.now() - parkT0 < 900 && g.match.screen === 'round') {
    readFoe();
    g.drive(0, 1.62, 0, 0, ...GL, head.x, head.y, head.z, 0, 4.0);
    await frame();
  }
  // At most ONE scoring hit's worth of damage may tick while parked.
  out.parkDamage = parkFrom - g.match.foe.health;

  return out;
});

check(act1.foyer, 'starts in the foyer');
check(act1.countdown, 'PRACTICE → countdown');
check(act1.roundStarted, `bell rings (bot: ${act1.botName}, style: ${act1.botStyle})`);
check(act1.hpAfter < act1.hpStart, `punches land: bot ${act1.hpStart} → ${Math.round(act1.hpAfter)} hp over ${act1.swings} swings`);
check(act1.landed + act1.blocked >= 5, `judge tallied (landed ${act1.landed}, blocked ${act1.blocked})`);
check(act1.parkDamage <= 22, `anti-flail: a parked fist ticked ${Math.round(act1.parkDamage)} hp (≤ one hit)`);

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
  const spawnBack = 1.15;
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
  peer.event({ t: 'hit', p: [0, 1.62, -2 * spawnBack], d: [0, 0, 1], s: 4 });
  await frames(5);
  out.hpDrop = hpBefore - g.match.me.health;
  out.victimJudged = out.hpDrop > 5;

  // …and blocked when my glove guards the line.
  g.drive(0, 1.62, 0, 0, -0.05, 1.55, -0.15, 0.05, 1.5, -0.15);
  await frames(3);
  const hpBefore2 = g.match.me.health;
  peer.event({ t: 'hit', p: [0, 1.62, -2 * spawnBack], d: [0, 0, 1], s: 4 });
  await frames(5);
  const drop2 = hpBefore2 - g.match.me.health;
  out.blockDrop = drop2;
  out.blockJudged = drop2 > 0 && drop2 < out.hpDrop * 0.6;

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

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nthe whole bout holds — ding ding');
