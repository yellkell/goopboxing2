# SLUGFEST — design notes

The pitch in one line: **the goop from the dance floor, but there are two
of them, they're both people, they box — and the ring is in your living
room.**

## AR (the venue is your room)

The session is `immersive-ar`. Everything the old VR build used to draw
around you — void towers, truss, beams, mat, apron, horizon — is gone;
the stage is posts, ropes, floor trim, a centre decal (16 draw calls,
~800 triangles for the whole scene). The sky is your ceiling.

**THE RING LAYOUT** (arena/ringLayout.ts): four independent sides in your
local frame, draggable to your walls in RING ADJUST mode (A-button menu →
ADJUST RING; grab a rope side with the trigger, one side at a time),
persisted per headset in localStorage. The law that keeps multiplayer
sane: **the layout is furniture, the protocol is geometry**. Spawns, the
2-seat mirror and every judged position ride `RING.spawnBack`; your ropes
are yours alone. The scoreboard is mounted in the air above YOUR
far side, set back a metre beyond the ropes (an arena jumbotron over the
opponent's shoulder); the bot clamps its footwork inside YOUR ring.

## The frame (perf on Quest)

The raymarch buys the whole look and pays per pixel, so the frame is
bought back wholesale first: `PERF.renderScale` (0.8 framebuffer scale
≈ 64% of the pixels), `PERF.foveation` (1.0 — the lenses blur the edges
anyway), and `PERF.targetFrameRate` (72 — a device defaulting to 90
spends 25% more frame than 72 buys back in feel), all applied around
session start. Retail trims on top: the pack pinned at 20 blobs
(ONE PIECE absolute — no lumps, no drips — so all three per-pixel
shader loops shrank from 32 terms), an OVER-RELAXED march (steps
overshoot 1.4× while the field reads >0.14 — miss-rays, the most
expensive kind, get out in ~⅔ the steps; the grazing fallback forgives
the clip), step budgets 20 max with a 12-step floor, self at 0.55 /
foe at 0.8 quality, a single thickness sample at ≤18 steps, the second
specular + sheen only above 14 steps (your own body takes the flat
path; the opponent keeps the full wet look), and the second body
simply absent from the menus.

## The screens (ScreenSystem)

Two render-to-texture surfaces, cheap by construction — tiny targets
(1–2% of the headset's pixels), captured every 2nd/3rd frame, each
alive only on the screens that need it:

- **THE JUMBOTRON** above the near side (opposite the scoreboard,
  following it when the ring is dragged): a fixed ringside camera at
  the left ropes broadcasts the classic side-on angle of the match.
- **THE MIRROR** beside the foyer menu: a selfie camera at 2.6 m. The
  capture brackets your creature with beginFullBody()/endFullBody() so
  the mirror shows the head and full opacity your first-person render
  masks; the plane is X-flipped because a mirror mirrors.

While XR presents, captures flip `renderer.xr.enabled` off around the
RT pass so the broadcast camera renders, not the headset's.

## THE REACH (fight/embody: Underdogs-style ranged punching)

Three laws:

1. **The origin is your REAL shoulder** (derived from the head pose at
   human proportions, never scaled) — `REACH.start/full` are real-arm
   metres. Inside `start` the mapping is exactly 1:1: your guard is your
   guard, pin-true to the millimetre.
2. **Amplification is radial and smooth**: gain ramps 1 → `maxGain`
   (×2.1) across the extension range, plus a speed lunge — a committed
   punch throws the gel fist ~1 m past your knuckles on the shoulder line.
   Deterministic from the tracked pose alone, and the SAME function runs
   on the remote fighter's wire pose: both bodies throw the same arms.
3. **The judge reads the amplified fist** (`rig.fistWorldL/R`,
   `effSpeed`): what you watch land is what scores, and the victim's block
   check runs against THEIR amplified gloves. A reach-stretched arm swells
   (fist/elbow/shoulder radii ride the gain, the blend widens) so the
   rope of gel stays ONE PIECE at full extension — probe-enforced.

The bodies wear `GOOPS.scale` (×1.4) as bulk: your eyes stay the
creature's eyes, so the size goes into width, thickness and stumpy legs,
not height. One seam (GelCreature) converts world↔local honestly —
`fieldAtWorld` returns world metres, impact speeds scale into native sim
units — so nothing else thinks about it.

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

**ONE PIECE is absolute** (`maxLumps: 0`, `maxDrips: 0`): a fighter never
sheds globs, however hard the hit — dents, ripples and the agitation
wobble carry the impact. Same law the RAVE RAID boss shipped, for the
same two reasons: the body reads better whole, and every extra blob is
another term in the raymarch's per-pixel loop — with the pack pinned at
exactly the 20 core blobs, `MAX_BLOBS` is 20 and all three shader loops
compile that much shorter.

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
- `online-probe.mjs`: TWO isolated browsers fighting through a real
  Firebase Realtime Database (the emulator suite by default — real SDK,
  real rules, real transactions and presence; `LIVE=1` for the cloud):
  host + join by four digits, identities crossing, both referees reaching
  the round off server-time deadlines, a body streaming and landing
  mirrored (0.00 m), a punch crossing to be judged by the receiver's own
  gloves, the state broadcast truing the attacker's board, the count, and
  both verdicts agreeing. Plus the two misconfiguration paths — no auth,
  no database — which must SPEAK on the lobby card, never spin.
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
- **An unreachable database does not throw.** The RTDB SDK queues writes
  and waits forever, which reads as a lobby spinning with no explanation.
  Every opening round trip carries a deadline, and a failed anonymous
  sign-in is caught at setup and reported as a sentence, not a shrug.
- **Headless is slow motion.** SwiftShader at 3 fps + the sim's dt clamp
  = 0.07× time; transients that last a blink on-device linger half a
  minute in a probe. Measure at steady state, and never tune real
  constants to headless timing.
