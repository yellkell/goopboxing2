#!/usr/bin/env node
/**
 * THE SHIPPED ARTIFACT, SMOKE-TESTED — does the built `dist/` actually
 * boot, and does it boot from a SUBPATH the way GitHub Pages serves it
 * (`/goopboxing2/`, not `/`)?
 *
 *   npm run build
 *   node tools/dist-smoke.mjs
 *
 * The dev server has been proving the SOURCE all along; this proves the
 * BUNDLE — minified, tree-shaken, relative-pathed, no vite in the loop.
 * It serves dist/ under the same subpath Pages uses, loads it headless,
 * and drives a practice bout to the bell: if the ring builds, the goops
 * form, the menu presses through and a round starts, the deploy is real.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.SMOKE_PORT ?? 8099);
const BASE_PATH = process.env.SMOKE_BASE ?? '/goopboxing2';
const ROOT = 'dist';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '' || path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Pages serves cross-origin-isolated? No — but WebXR doesn't need it.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const url = `http://127.0.0.1:${PORT}${BASE_PATH}/`;
console.log(`serving ./dist at ${url}`);

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
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const missing = [];
page.on('response', (r) => {
  if (r.status() >= 400) missing.push(`${r.status()} ${r.url().slice(0, 110)}`);
});

await page.goto(url, { waitUntil: 'load', timeout: 40000 });

const booted = await page
  .waitForFunction(() => window.__gbx?.menu?.press && window.__gbx?.fighters?.mine, null, { timeout: 40000 })
  .then(() => true)
  .catch(() => false);
check(booted, 'the bundle boots (world + systems live)');
check(missing.length === 0, `every asset resolves under ${BASE_PATH}/${missing.length ? ` — misses: ${missing.join(', ')}` : ''}`);

if (booted) {
  // The menu is painted and offering the real buttons.
  const buttons = await page.evaluate(() => window.__gbx.menu.buttons());
  check(buttons.includes('practice'), `the foyer offers its buttons (${buttons.length} live)`);

  // Drive a practice bout to the bell — the whole stack in the built code.
  await page.evaluate(() => {
    window.__gbx.drive(0, 1.62, 0, 0, -0.16, 1.4, -0.24, 0.16, 1.36, -0.22);
    window.__gbx.menu.press('practice');
  });
  const rang = await page
    .waitForFunction(() => window.__gbx.match.screen === 'round', null, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(rang, 'PRACTICE reaches the bell in the shipped build');

  const scene = await page.evaluate(() => {
    const g = window.__gbx;
    const info = g.info();
    return {
      stage: !!g.scene().children.find((c) => c.name === 'the-stage'),
      blobs: g.fighters.theirs.sim.packedCount,
      calls: info?.calls ?? -1,
      tris: info?.triangles ?? -1,
    };
  });
  check(scene.stage, 'the ring is built');
  check(scene.blobs > 12, `the opponent is a whole body (${scene.blobs} blobs packed)`);
  console.log(`    draw calls: ${scene.calls}, triangles: ${scene.tris}`);
  await page.screenshot({ path: 'shots/deployed.png' });
  console.log('    still: shots/deployed.png');
}

check(errors.length === 0, `no page errors${errors.length ? ` — ${errors.slice(0, 2).join(' | ')}` : ''}`);

await browser.close();
server.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s) — the deployed bundle is NOT sound`);
  process.exit(1);
}
console.log('\nthe shipped bundle is sound — it boots and it fights');
