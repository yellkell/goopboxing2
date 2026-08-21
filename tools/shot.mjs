#!/usr/bin/env node
/**
 * Style-iteration stills: the foyer, then mid-bout, through the desktop
 * (non-XR) renderer.
 *
 *   npm run dev                      # terminal 1
 *   node tools/shot.mjs [outdir]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const outDir = process.argv[2] ?? 'shots';
mkdirSync(outDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__gbx?.menu?.press && window.__gbx?.fighters?.mine, null, {
  timeout: 30000,
});

// The landing overlay hides the canvas — lift it for the camera.
await page.evaluate(() => document.body.classList.add('app-entered'));

const settle = (ms) => page.waitForTimeout(ms);

// Foyer: stand at the spawn, panel up, both goops idling.
await page.evaluate(() => {
  window.__gbx.drive(0, 1.62, 0, 0, -0.18, 1.15, -0.3, 0.18, 1.15, -0.3);
});
await settle(5000);
await page.screenshot({ path: `${outDir}/foyer.png` });

// Mid-bout: bell rung, guard up.
await page.evaluate(() => {
  window.__gbx.menu.press('practice');
});
await page.waitForFunction(() => window.__gbx.match.screen === 'round', null, { timeout: 9000 });
await page.evaluate(() => {
  window.__gbx.drive(0, 1.62, 0, 0, -0.16, 1.42, -0.26, 0.17, 1.36, -0.24);
});
await settle(2200);
await page.screenshot({ path: `${outDir}/round.png` });

// THE REACH: a committed right at full amplified extension toward the bot.
await page.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const v = g.fighters.theirs.position;
  const from = { x: 0.15, y: 1.32, z: -0.1 };
  const to = { x: v.x, y: 1.05, z: v.z };
  for (let s = 0; s <= 20; s++) {
    const k = 0.05 + (0.55 - 0.05) * (s / 20);
    g.drive(0, 1.62, 0, 0, -0.12, 1.5, -0.2,
      from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k,
      0, 4.5);
    await frame();
  }
});
await settle(120);
await page.screenshot({ path: `${outDir}/reach.png` });

// A punch buried in the other goop.
await page.evaluate(async () => {
  const g = window.__gbx;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const v = g.fighters.theirs.position;
  for (let k = 0; k <= 1; k += 0.12) {
    g.drive(0, 1.62, 0, 0, -0.16, 1.42, -0.26, v.x * k * 0.92, 1.25, v.z * k * 0.92, 0, 4.5);
    await frame();
  }
});
await settle(120);
await page.screenshot({ path: `${outDir}/impact.png` });

console.log(`stills in ${outDir}/ — foyer.png, round.png, impact.png`);
await browser.close();
