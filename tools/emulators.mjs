#!/usr/bin/env node
/**
 * THE LOCAL FIREBASE — the emulator suite, started the way this project
 * needs it.
 *
 *   npm run emu                  # leave running; Ctrl-C stops both
 *   npm run probe:online         # two clients fight through it
 *
 * Why not plain `firebase emulators:start`? The CLI uploads the rules to
 * the database emulator over HTTP, and in sandboxed/proxied environments
 * that upload can be intercepted — the CLI then reports the proxy's reply
 * as a rules PARSE error, which is a bewildering lie about your rules
 * file. So we start the database emulator's JAR ourselves and PUT the
 * rules straight in (no proxy in the path), and let the CLI run only the
 * auth emulator, which has no such step.
 *
 * The rules served here are database.rules.json — the very file you
 * deploy to production, so what the probes prove is what ships.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const PROJECT = process.env.FB_PROJECT ?? 'blastonpickem';
const NS = `${PROJECT}-default-rtdb`;
const DB_PORT = Number(process.env.FB_DB_PORT ?? 9000);
const AUTH_PORT = Number(process.env.FB_AUTH_PORT ?? 9099);

const cacheDir = join(homedir(), '.cache', 'firebase', 'emulators');
const jar = existsSync(cacheDir)
  ? readdirSync(cacheDir).find((f) => f.startsWith('firebase-database-emulator') && f.endsWith('.jar'))
  : null;

if (!jar) {
  console.error('No database emulator JAR found. Fetch it first:\n');
  console.error('  npx firebase setup:emulators:database\n');
  process.exit(1);
}

const children = [];
const spawnChild = (label, cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const line = (buf) => {
    for (const l of String(buf).split('\n')) {
      if (l.trim()) console.log(`  [${label}] ${l.trim().slice(0, 160)}`);
    }
  };
  child.stdout.on('data', line);
  child.stderr.on('data', line);
  children.push(child);
  return child;
};

console.log(`starting the database emulator (${NS} on :${DB_PORT})…`);
spawnChild('rtdb', 'java', ['-jar', join(cacheDir, jar), '--host', '127.0.0.1', '--port', String(DB_PORT)]);

console.log(`starting the auth emulator (:${AUTH_PORT})…`);
// The CLI honours firebase.json for ports; --only auth skips the rules path.
spawnChild('auth', process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  'firebase',
  'emulators:start',
  '--only',
  'auth',
  '--project',
  PROJECT,
]);

/** Wait for a local port to answer, then PUT the rules in. */
const reachable = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const dbUp = await reachable(`http://127.0.0.1:${DB_PORT}/.json?ns=${NS}`);
if (!dbUp) {
  console.error('the database emulator never answered');
  process.exit(1);
}

const rules = readFileSync('database.rules.json', 'utf8');
const put = await fetch(`http://127.0.0.1:${DB_PORT}/.settings/rules.json?ns=${NS}`, {
  method: 'PUT',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: rules,
});
console.log(put.ok ? '  rules loaded from database.rules.json ✓' : `  RULES REJECTED: ${await put.text()}`);
if (!put.ok) process.exit(1);

const authUp = await reachable(`http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/config`);
console.log(authUp ? '  auth emulator ready ✓' : '  auth emulator never answered ✗');

console.log('\nemulator suite up. In another terminal:\n');
console.log('  npm run dev                # if it is not already running');
console.log('  npm run probe:online       # two clients, one bout\n');
console.log('The app reaches these through ?rtdb=127.0.0.1:%d&authemu=127.0.0.1:%d', DB_PORT, AUTH_PORT);
console.log('(Ctrl-C to stop.)');

const bye = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
