# SLUGFEST

**A two-player WebXR boxing game where both fighters ARE the goop.**

You don't fight a gel creature this time — you *wear* one. Your headset is
its head, your controllers are its fists, and everything in between (the
leaning trunk, the shrugging shoulders, the folding elbows, the dragging
puddle-skirt footwork) is derived and simulated: ~20 verlet blobs fused by
a raymarched smooth-min isosurface, so what your opponent sees — and
punches — is one living body of slime. Punches carve real dents, ripple the
surface, and above tearing speed knock fist-sized lumps clean off that
splat on the mat, quiver, and crawl home.

The gel tech is vendored from the GOOP lineage (GOOP → FIRE FIGHT →
RAVE RAID) and evolved here: multi-pin kinematics for embodiment, per-corner
tints, first-person masking, and a frame-rate-honest sim.

- **PRACTICE** — fight the house goop: the lineage's fighting-style AI
  (infighter / kickboxer / muay thai / outboxer / rope-a-dope), a new
  secret style dealt every round. The stance is the tell.
- **HOST / JOIN BOUT** — two headsets over Firebase: four-digit rooms,
  15 Hz pose streams, end-to-end judging (see DESIGN.md). Lights up the
  moment a Firebase config lands — see **Standing up the Firebase** below.

Rounds of 90 seconds, three of them, corner rests where both fighters slump
into breathing globs, a ten count when someone's health hits the mat, and a
generative techno set that runs hotter as the bout gets desperate — no audio
files shipped; every sound in the game is synthesised at runtime.

## Quick start

```bash
npm install
npm run dev
```

Open the page: a headset offers **ENTER THE RING**; on desktop the IWSDK
dev plugin provides a WebXR emulator (WASD + mouse). For a Quest on your
network, WebXR needs a secure context — the easy path is ADB:

```bash
adb reverse tcp:5173 tcp:5173   # then open http://localhost:5173 on-device
```

`npm run build` typechecks and bundles to `dist/` (fully static — Pages
serves it; the deploy workflow in `.github/workflows/` does exactly that).

## The controls

There are none. Guard with your real hands, punch with your real hands,
duck with your real knees. The judge is honest:

- a scoring hit needs **real speed** at contact (≥ 1.6 m/s), a per-hand
  cooldown, and a **retraction** before that hand can score again — parking
  a fist inside the other goop ticks nothing;
- **head shots** hit harder; a glove near the contact — or guarding the
  line into your head — turns a hit into a **block** at quarter damage;
- slow contact is a *poke*: it shoves the gel around and wobbles, for free.

Menus are lasers: point either controller, pull the trigger.

## Standing up the Firebase

Online bouts need one Firebase project (free tier is plenty — the whole
infrastructure is a Realtime Database):

1. [console.firebase.google.com](https://console.firebase.google.com) →
   create a project.
2. **Build → Realtime Database → Create database** (any region; note the
   URL — it goes in the config as `databaseURL`).
3. **Build → Authentication → Sign-in method → Anonymous → Enable.**
4. Deploy the rules: copy `database.rules.json` into the Rules tab (or
   `firebase deploy --only database` with the CLI).
5. **Project settings → Your apps → Web app** → register one, copy the
   config object into `src/net/firebaseConfig.ts` (the file documents the
   exact shape).

That's the whole handoff: with the config in place, HOST BOUT hands you
four digits, JOIN BOUT takes them, and the room pairs. The config is
public by design — the database rules are the security boundary.

## The probes (no headset required)

Every load-bearing law is machine-checked against the REAL modules through
the dev server (start `npm run dev` first):

```bash
node tools/embody-check.mjs   # ONE PIECE through a boxing battery, exact
                              # fist pins, first-person eye daylight
node tools/fight-probe.mjs    # a whole bout: menu → countdown → punches
                              # through the SDF pipeline → KO → verdict,
                              # then the wire loopbacked (mirror math,
                              # victim judging, blocks, state broadcasts)
node tools/shot.mjs           # style-iteration stills into shots/
```

## The map

```
src/
  config.ts            every tunable in the game
  goop/                the vendored gel tech, evolved
    sim.ts             verlet blob soup + ONE PIECE cohesion + multi-pins
    gelMaterial.ts     the raymarched isosurface shader
    GelCreature.ts     a whole fighter (ai mode = the bot, puppet = a human)
    embody.ts          head + hands → 20 anchors; the wire's input springs
    poses.ts styles.ts goopConfig.ts splats.ts
  fight/               state machine, the judge (pure), the bot brain
  net/                 transport facade, Firebase RTDB backend, protocol
  game/                rng, the 2-seat ring transform
  arena/ audio/ ui/    the stage, the synth kit + techno set, panel kit
  systems/             Player / Fighter / Fight / Arena / Hud / Menu / Network
tools/                 headless probes (playwright against the dev server)
```

`DESIGN.md` carries the design notes — the embodiment mapping, the judging
law, the wire, and the hard-won fixes (read it before retuning the sim).

## Tuning

Everything a designer would touch is in `src/config.ts` (bout, judge, ring,
tints, bot, wire, music) and `src/goop/goopConfig.ts` (the body itself:
blend width, impact reception, the bot's moveset timings). The game title
is one constant. Debug from the console via `__gbx` (drive the tracked
body, start bouts, pair a loopback peer, read every number).

## Roadmap

- **WebRTC data channels** (RTDB as signaling) for sub-50 ms pose latency;
  the RTDB relay stays as the fallback. The transport facade is already
  the seam.
- **Stamina** — flail hard, hit soft.
- **Body-shot scoring zones** + a body-damage meter (the goop already
  carries dents anywhere).
- **Spectator seats** — extra room slots that only stream poses in.
- **Colocated mode** — two headsets, one real room, one shared ring.
- **Seasonal goops** — new bodies are new anchor decks + tints over the
  same sim.
