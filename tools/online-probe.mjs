#!/usr/bin/env node
/**
 * THE TALE OF TWO HEADSETS — a real online bout over the REAL Firebase.
 *
 *   npm run dev                      # terminal 1
 *   node tools/online-probe.mjs
 *
 * Two isolated browser contexts load the real app and fight each other
 * through the configured Realtime Database — no loopback, no mocks:
 *
 *   1. A hosts through the menu; B types the four digits on the keypad;
 *   2. both pair, identities cross (names dress the far corners);
 *   3. the host rings the bell — phase deadlines ride server time and
 *      both referees reach the round;
 *   4. A's tracked body streams to B and lands mirrored across the ring;
 *   5. A punches B's puppet — the hit event crosses, B's own gloves
 *      judge it, B's health drops, B's state broadcast trues A's board;
 *   6. B is worn down to a KO: B declares, the HOST formalises the count,
 *      both verdicts agree (A wins, B loses);
 *   7. A leaves — B's bout folds home and the room is torn down.
 *
 * Exits non-zero on any miss, printing both clients' net state.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
/**
 * EMULATOR MODE (default): the real Firebase SDK, the real rules, the real
 * transactions and presence — against the local emulator suite, so the
 * whole backend is provable headlessly and offline.
 *
 *   node tools/online-probe.mjs            # emulators (needs them running)
 *   LIVE=1 node tools/online-probe.mjs     # the real cloud project
 */
const emuQuery = process.env.LIVE ? '' : '?rtdb=127.0.0.1:9000&authemu=127.0.0.1:9099';
console.log(process.env.LIVE ? 'target: LIVE Firebase project' : 'target: local emulator suite');
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

const mkPage = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`[${tag} pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) {
      console.log(`  [${tag} console.error]`, m.text().slice(0, 140));
    }
  });
  await page.goto(base + '/' + emuQuery, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__gbx?.menu?.press && window.__gbx?.fighters?.mine, null, {
    timeout: 30000,
  });
  return page;
};

const netState = (page) =>
  page.evaluate(() => {
    const g = window.__gbx;
    return {
      phase: g.net.phase,
      code: g.net.code,
      seat: g.net.seat,
      err: g.net.error,
      screen: g.match.screen,
      foe: g.match.foe.name,
      foeHp: Math.round(g.match.foe.health),
      myHp: Math.round(g.match.me.health),
      winner: g.match.winner,
    };
  });

const waitFor = async (page, fnBody, ms, label) => {
  try {
    await page.waitForFunction(new Function(`return (${fnBody})(window.__gbx)`), null, {
      timeout: ms,
    });
    return true;
  } catch {
    console.log(`    …timed out waiting: ${label}`);
    return false;
  }
};

console.log('booting two clients…');
const A = await mkPage('A');
const B = await mkPage('B');
check(true, 'both clients booted');

/* Stand both bodies at their spawns; B takes a different name. */
await A.evaluate(() => window.__gbx.drive(0, 1.62, 0, 0, -0.16, 1.4, -0.24, 0.16, 1.36, -0.22));
await B.evaluate(() => {
  window.__gbx.drive(0, 1.58, 0, 0, -0.3, 0.8, 0.1, 0.3, 0.8, 0.1); // guard LOW (blockable later)
  window.__gbx.menu.press('name'); // GLOB → OOZE
});

/* ── 1. host + join through the real menus ─────────────────────────────── */
await A.evaluate(() => window.__gbx.menu.press('host'));
const hosted = await waitFor(A, `(g) => g.net.phase === 'hosting' && g.net.code.length === 4`, 30000, 'A hosting');
check(hosted, `A hosts a room${hosted ? '' : ` (net: ${JSON.stringify(await netState(A))})`}`);
if (!hosted) {
  console.log('  A net:', JSON.stringify(await netState(A)));
  console.log('\nLikely causes: Anonymous auth not enabled, or the database rules');
  console.log('(database.rules.json) not deployed — see README → Standing up the Firebase.');
  await browser.close();
  process.exit(1);
}
const code = await A.evaluate(() => window.__gbx.net.code);
console.log(`    room code: ${code}`);

await B.evaluate((c) => {
  const g = window.__gbx;
  g.menu.press('join');
  for (const d of c) g.menu.press('k' + d);
  g.menu.press('kgo');
}, code);

const pairedA = await waitFor(A, `(g) => g.net.phase === 'paired'`, 30000, 'A paired');
const pairedB = await waitFor(B, `(g) => g.net.phase === 'paired'`, 30000, 'B paired');
check(pairedA && pairedB, 'both corners pair through the database');
if (!pairedA || !pairedB) {
  console.log('  A:', JSON.stringify(await netState(A)));
  console.log('  B:', JSON.stringify(await netState(B)));
  await browser.close();
  process.exit(1);
}

/* ── 2. identities cross ───────────────────────────────────────────────── */
const helloA = await waitFor(A, `(g) => g.match.foe.name === 'OOZE'`, 15000, 'A sees OOZE');
const helloB = await waitFor(B, `(g) => g.match.foe.name === 'GLOB'`, 15000, 'B sees GLOB');
check(helloA && helloB, `hellos dress the corners (A fights ${(await netState(A)).foe}, B fights ${(await netState(B)).foe})`);

/* ── 3. the bell, on server time ───────────────────────────────────────── */
await A.evaluate(() => window.__gbx.menu.press('bell'));
const roundA = await waitFor(A, `(g) => g.match.screen === 'round'`, 25000, 'A in round');
const roundB = await waitFor(B, `(g) => g.match.screen === 'round'`, 25000, 'B in round');
check(roundA && roundB, 'both referees reach the round');
// Two headless clients on a software renderer are SLOW — stretch the round
// so the scripted acts fit (the host is the only clock; B follows the wire).
await A.evaluate(() => window.__gbx.fight.debugExtendRound(900));

/* ── 4. poses cross and mirror ─────────────────────────────────────────── */
// A stands at (0.4, ·, -0.2); B should see A's puppet ooze toward the
// mirror point (−0.4, ·, −(−0.2) − 2·spawnBack) = (−0.4, ·, −2.5).
const SPAWN_BACK = 1.35; // MUST match config.RING.spawnBack
await A.evaluate(() => window.__gbx.drive(0.4, 1.62, -0.2, 0, 0.24, 1.4, -0.44, 0.56, 1.36, -0.42));
await B.waitForTimeout(4500);
const mirror = await B.evaluate(() => {
  const p = window.__gbx.fighters.theirs.position;
  return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
});
const mirrorErr = Math.hypot(mirror.x - -0.4, mirror.z - (0.2 - 2 * SPAWN_BACK));
check(mirrorErr < 0.45, `A's body lands mirrored on B (err ${mirrorErr.toFixed(2)} m at ${JSON.stringify(mirror)})`);

/* ── 5. a punch crosses the wire ───────────────────────────────────────── */
const bHpBefore = (await netState(B)).myHp;
// A punches its local puppet of B — THE REACH way: the raw hand sweeps a
// third of the line, the amplified gel fist crosses the puppet's surface.
await A.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const v = g.fighters.theirs.position;
  const from = { x: 0.4 + 0.15, y: 1.3, z: -0.2 };
  const to = { x: v.x, y: 1.0, z: v.z };
  const STEPS = 26;
  for (let s = 0; s <= STEPS; s++) {
    const k = 0.06 + (0.6 - 0.06) * (s / STEPS);
    g.drive(0.4, 1.62, -0.2, 0,
      0.24, 1.4, -0.44,
      from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k,
      0, 3.4);
    await frame();
  }
  g.drive(0.4, 1.62, -0.2, 0, 0.24, 1.4, -0.44, 0.55, 1.3, -0.2, 0, 0);
});
const hurtB = await waitFor(B, `(g) => g.match.me.health < ${bHpBefore}`, 15000, 'B takes the hit');
check(hurtB, `the punch crosses: B ${bHpBefore} → ${(await netState(B)).myHp} hp (victim-judged)`);
const stateBack = await waitFor(A, `(g) => g.match.foe.health < ${bHpBefore}`, 15000, "A's board trues");
check(stateBack, `B's state broadcast trues A's board (A sees foe at ${(await netState(A)).foeHp})`);

/* ── 6. the KO, declared by the victim, formalised by the host ─────────── */
await B.evaluate(() => {
  window.__gbx.match.me.health = 4; // worn down — the next clean hit ends it
});
await A.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A few more punches (cooldown-spaced) until the far corner collapses.
  for (let p = 0; p < 8 && g.match.screen === 'round'; p++) {
    const v = g.fighters.theirs.position;
    const from = { x: 0.55, y: 1.3, z: -0.2 };
    const to = { x: v.x, y: 1.0, z: v.z };
    const STEPS = 26;
    for (let s = 0; s <= STEPS; s++) {
      const k = 0.06 + (0.6 - 0.06) * (s / STEPS);
      g.drive(0.4, 1.62, -0.2, 0, 0.24, 1.4, -0.44,
        from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k,
        0, 3.4);
      await frame();
    }
    g.drive(0.4, 1.62, -0.2, 0, 0.24, 1.4, -0.44, 0.54, 1.34, -0.16, 0, 0);
    await sleep(430);
  }
});
const koB = await waitFor(B, `(g) => g.match.screen === 'ko' || g.match.screen === 'result'`, 20000, 'B down');
const koA = await waitFor(A, `(g) => g.match.screen === 'ko' || g.match.screen === 'result'`, 20000, 'A sees the count');
check(koB && koA, 'the count runs on both referees');
const resA = await waitFor(A, `(g) => g.match.screen === 'result'`, 20000, 'A result');
const resB = await waitFor(B, `(g) => g.match.screen === 'result'`, 20000, 'B result');
const winA = (await netState(A)).winner;
const winB = (await netState(B)).winner;
check(resA && resB && winA === 'me' && winB === 'foe', `the verdicts agree (A: ${winA}, B: ${winB})`);

/* ── 7. leaving folds the room ─────────────────────────────────────────── */
await A.evaluate(() => window.__gbx.menu.press('corner'));
const foldB = await waitFor(B, `(g) => g.match.screen === 'foyer' && g.net.phase !== 'paired'`, 20000, 'B folds home');
check(foldB, 'A leaving folds B back to the foyer');
await B.evaluate(() => window.__gbx.menu.press('corner'));

/* ── 8. the misconfigured-project paths must SPEAK, never spin ─────────── */
// A fresh Firebase project fails in exactly two ways, and a lobby that
// spins with no explanation is the worst possible answer to both.
const mkRaw = async (tag, query) => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 260 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => undefined); // these clients are SUPPOSED to fail
  await page.goto(base + '/' + query, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__gbx?.menu?.press, null, { timeout: 30000 });
  await page.evaluate(() => window.__gbx.menu.press('host'));
  // The reachability watchdog itself takes 12 s — on a slow software
  // renderer the whole path needs real margin.
  const spoke = await waitFor(page, `(g) => g.net.phase === 'error' && g.net.error.length > 0`, 55000, tag);
  const msg = await page.evaluate(() => window.__gbx.net.error);
  await ctx.close();
  return { spoke, msg };
};

const noAuth = await mkRaw('auth unreachable', '?rtdb=127.0.0.1:9000&authemu=127.0.0.1:9098');
check(noAuth.spoke, `sign-in failure is reported, not spun: "${noAuth.msg}"`);

const noDb = await mkRaw('database unreachable', '?rtdb=127.0.0.1:9001&authemu=127.0.0.1:9099');
check(noDb.spoke, `unreachable database is reported, not spun: "${noDb.msg}"`);

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\ntwo clients, one database, one bout — the wire is REAL. ding ding');
