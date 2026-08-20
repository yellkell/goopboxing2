# SLUGFEST — design notes

The pitch in one line: **the goop from the dance floor, but there are two
of them, they're both people, and they box.**

The lineage: GOOP built a gel creature you punch; FIRE FIGHT gave it a
boss's moveset; RAVE RAID taught it to dance and proved the cohesion laws.
SLUGFEST closes the loop — the creature goes back to boxing, but this time
**both fighters are embodied humans**. The whole game hangs off one
question: what does it take for three tracked points to wear a body of
slime honestly enough to box in?

## Pillars

- **You are the gel.** No avatars-over-skeletons: your headset and
  controllers drive the same 20-anchor blob sim the boss ran, and the
  smooth-min isosurface does the rest. If the tech reads as "a person made
  of slime" without a single keyframe, everything else follows.
- **Combat must be honest.** Your gel fist is EXACTLY where your hand is
  (kinematically pinned, re-localised after root motion — never a frame
  behind). Hits are judged against real tracked bodies, not against
  anything smoothed, interpolated, or remote.
- **The wire carries only what can't be derived.** Two bodies and their
  verdicts. Everything else — the music, the lights, the mess — every
  headset derives identically from the bout seed.
- **Feedback is flesh, not floating text.** A landed punch is a crater, a
  ripple, a wet THWUCK, a controller kick. Damage numbers live on one
  ring-side board; the bodies carry the fight.

## Embodiment (goop/embody.ts)

Three tracked points become 20 anchors:

- **Fists: pinned.** World-space pins localised inside `GelCreature.update`
  AFTER the root's own ooze/yaw for the frame, so a whipping turn can't
  leave a glove a frame behind its hand (`puppetPins`). The leash treats
  pinned blobs as gospel — corrections flow up the arm, never into it.
- **The upper column hangs off the head at the AUTHORED gaps** (neck
  −0.18, chest −0.33): anatomy doesn't compress when you crouch — your
  legs do (pelvis and below scale with head height). This is a law bought
  with blood: deriving the column as *fractions* of height packed the
  blobs tighter than the sim's separation pass allows, and the surplus
  extruded the stack upward until the chest swallowed the wearer's camera.
- **Shoulders** ride the neck, turn with a clamped share of gaze yaw,
  SHRUG toward a raised hand, reach after a far one.
- **Elbows are solved**: on the shoulder→fist line, pushed along a pole
  vector (down + out + a little back, folded under for a crossed hand)
  whose length grows with arm slack — a guard folds, a jab straightens.
- **Legs keep the boxer stance under the ROOT**, and the root chases your
  head across the floor with oozy lag (`moveTo`) — footwork reads as the
  skirt dragging after you, and the sim's inertia sloshes the body on
  every dash for free.
- **First person**: head + neck blobs are masked out of the RENDER only
  (`renderSkip`) — physics and the opponent's view keep all of you. Your
  own gel FADES IN only once the body has formed (`uFade`), because a
  mid-morph blob pours straight through your eyes; fresh bodies also
  WARM-START (formed + settled + yaw-snapped) so a rebuild never veils
  the camera. Eyes aren't built — they're the opponent's personality, and
  they watch YOU.
- **The remote fighter is the same rig** fed through critically damped
  springs (`WirePose`) — velocity-continuous tracking of the 15 Hz wire,
  no corner at every packet, never an invented bounce (the gel's own
  underdamped springs put the wobble back). Poison law throughout: a NaN
  in any channel is swallowed, never integrated.

## The judging law (fight/rules.ts)

Each headset is the only honest witness of its own body:

- **The ATTACKER judges CONTACT.** Only they see their fist at frame rate
  (the 15 Hz wire would eat every jab). Contact = the fist crossing the
  opponent's SDF (the same field the shader draws — what you see is what
  you punch), at speed, armed, and INTO the surface — the field's own
  slope a hand-width back along the travel says "came from outside" (a
  centre-direction dot test degenerates to noise once a fist is deep).
- **The VICTIM judges OUTCOME.** The block check runs against THEIR real
  gloves (glove near the contact, or guarding the line into the head),
  and their health broadcast is authoritative. Health 0 is self-declared;
  the host formalises the count.
- **Anti-flail**: speed gate (1.6 m/s), per-hand cooldown (0.28 s), and
  the RETRACT re-arm — after scoring, a hand must pull 12 cm clear of the
  surface before it may score again. An advancing opponent engulfing your
  parked fist keeps it disarmed: retract to your chin like a boxer.
- Practice mode runs both roles on one headset — and the bot's blocking is
  EMERGENT: its "gloves" are wherever its fighting style parked its fist
  blobs. The shelled-up rope-a-dope soaks head shots because its hands
  live on its face, not because a dice roll said so.

## The wire (net/)

One Firebase Realtime Database is the whole infrastructure — a room with
two seats, two pose streams (13 floats at 15 Hz, sender-local frame), two
event queues, presence by `onDisconnect`, and one shared clock
(`.info/serverTimeOffset`).

- **The 2-seat ring transform** (game/ring.ts): my spawn is my world
  origin facing −Z; the ring centre lands at (0, 0, −spawnBack) in BOTH
  local frames, so the whole stage is built identically per client and
  only the opponent's stream crosses frames — one mirror:
  `p' = (−x, y, −z − 2·spawnBack)`.
- **The HOST is the one referee**: every phase transition (countdown /
  round / rest / ko / result) is stamped with a server-time deadline and
  mirrored as an event; the guest's machine follows the wire. Two clocks,
  one bout.
- The transport facade (`net/transport.ts`) is the seam: the Firebase
  backend loads lazily behind it, an in-process loopback drives the
  headless probes, and a WebRTC upgrade slots in later without touching a
  system.

## The sim, evolved (goop/sim.ts)

Three changes to the vendored gel:

1. **Multi-pin.** The boss pinned one striking fist; an embodied fighter
   pins both (and could pin more). Every leash rule generalises: pinned
   blobs carry zero projection weight; a segment pinned at both ends is
   left alone (two gospels don't argue; the swell bridges them).
2. **dt-scaled separation.** The pairwise separation push was a fixed
   per-CALL nudge while the springs recovering from it are per-SECOND —
   at 120 Hz it won double and slowly extruded any tight pose. Scaled by
   `h·60`, every refresh rate now behaves like the 60 Hz the constant was
   tuned at (verified identical at 60/240/500 Hz).
3. **Render masking** (`renderSkip`) for first person, pack-level only —
   the CPU field never lies to the other player.

Lumps are BACK ON (`maxLumps: 5`): the boss disabled them for a 24-player
frame budget; a bout is two bodies in one small ring, and a heavy hit
tearing a glob off your opponent — which crawls home across the mat — is
half the reason to play.

## The stage (arena/stage.ts)

A neon prizefight ring in a dark void, built the lineage's way: one draw
per family (mat, trim, posts, pads, ropes, truss — instanced), four
additive spot cones, 26 void towers as two instanced draws (bodies + lit
pinstripes twinkling through per-instance colour), a low horizon glow that
stays a LINE — the sky stays black. Corners dress in the two fighters'
tints; the trim and ropes breathe on the techno set's beat and run hot
when someone's nearly out.

UI (panel, pointers, scoreboard, cards) is OVERLAY: `depthTest: false`,
layered by renderOrder — a first-person gel writes real fragDepth right at
the camera, and any UI that depth-tests against it loses.

## Sound (audio/)

Everything synthesised at runtime, nothing shipped: the wet-gel foley
ported whole (squelch, tear, splat, slurp, the charge, the slam), the ring
bell, a wooden ten-count knock (inharmonic — a rhythm, never a note), and
SLUGFEST's own voices: the whiff, the dense dead gel-on-gel BLOCK, and the
detuned skull-ring of taking one to the head. The techno set (seeded, so
both headsets hear the same record) follows the bout: acts rise with the
rounds, everything-on when either fighter drops under 25%.

## Verification (tools/)

The lineage's law: laws are machine-checked against the REAL modules, in a
real browser, before every push.

- `embody-check.mjs`: drives creature + rig through a boxing battery
  (guard, long jab, cross-body hook, low duck, deep bow, hands behind
  back, a 6 m/s flurry, a whip 180) and asserts ONE PIECE on every formed
  frame (bridge graph over the actual field), exact fist pins (~1e-7 m),
  and first-person eye daylight through guard/crouch/flurry.
- `fight-probe.mjs`: a whole practice bout through the real pipeline
  (menu press → countdown → punches crossing the SDF at speed → damage →
  KO → ten count → verdict → foyer), the anti-flail park test, then the
  wire loopbacked: start/phase events, pose mirror math (error 0.00 m),
  victim-judged incoming hits, the guard block at quarter damage, state
  broadcasts, and the fold-home on peer loss.

## Hard-won laws (so nobody re-buys them)

- **The camera is sacred.** Every first-person defence exists because a
  body of gel WILL find its wearer's eyes: the render mask, the fade, the
  warm start, the authored-gap column, the dt-scaled separation.
- **Pins after root motion.** Any pin computed before the root moves is a
  frame stale — 2 cm of glove error at a whip's peak.
- **The field never lies.** Hit tests, block tests, eye placement, probe
  assertions — everything reads the same SDF the shader draws. When a
  gate needs "which way is in", ask the field's slope, not geometry
  heuristics.
- **Headless is slow motion.** SwiftShader at 3 fps + the sim's dt clamp
  = 0.07× time; transients that last a blink on-device linger half a
  minute in a probe. Measure at steady state, and never tune real
  constants to headless timing.
