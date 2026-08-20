/**
 * The Firebase Realtime Database backend — SLUGFEST's whole infrastructure
 * is one RTDB, because a two-body fight needs so little: a room with two
 * seats, two pose streams, two event queues, presence, and one shared
 * clock. No relay process, nothing to deploy but rules.
 *
 * The room, at bouts/{code}:
 *
 *   s0 / s1   seat presence: { uid, name, tint, t } — written on claim,
 *             removed by onDisconnect, watched by the other side.
 *   p0 / p1   pose streams: 13-float arrays, `set` at NET.poseHz. Each
 *             side writes ITS seat and subscribes to the other.
 *   e0 / e1   event queues: `push`ed WireEvents, consumed by
 *             onChildAdded on the other side. Reliable, ordered, rare.
 *
 * Judging stays end-to-end (attacker judges contact, victim judges
 * outcome) so the database never referees anything — it is a pipe with
 * presence. The host's referee deadlines ride server time: RTDB's
 * .info/serverTimeOffset gives both headsets the same epoch to convert
 * against, which is what lets "the round ends at T" mean one instant.
 *
 * Everything here FAILS SOFT and loads lazily: no Firebase code is even
 * fetched until the first host/join, and a build without a config (see
 * firebaseConfig.ts) reports null so the menu can say so.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Database, DatabaseReference, Unsubscribe } from 'firebase/database';
import { NET } from '../config.js';
import { match } from '../fight/state.js';
import { FIREBASE_CONFIG } from './firebaseConfig.js';
import { decodeEvent, type WireEvent } from './protocol.js';
import { hooks, net, type TransportBackend } from './transport.js';

/** How many random codes we try before giving up on a free room. */
const CODE_TRIES = 20;

export async function createFirebaseBackend(): Promise<TransportBackend | null> {
  if (!FIREBASE_CONFIG) return null;

  const [{ initializeApp, getApps }, dbMod, authMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/database'),
    import('firebase/auth'),
  ]);
  const {
    getDatabase,
    ref,
    set,
    remove,
    onValue,
    onChildAdded,
    onDisconnect,
    runTransaction,
    serverTimestamp,
  } = dbMod;

  const app: FirebaseApp = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
  const db: Database = getDatabase(app);

  // EMULATOR HOOKS (the harness only): `?rtdb=host:port&authemu=host:port`
  // points the real SDK at the local Firebase emulator suite, so the whole
  // backend — transactions, presence, rules, the shared clock — is testable
  // headlessly with the production code path. Production URLs carry no
  // such params and never come near this.
  const search = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const rtdbEmu = search.get('rtdb');
  if (rtdbEmu) {
    const [h, p] = rtdbEmu.split(':');
    dbMod.connectDatabaseEmulator(db, h, Number(p) || 9000);
  }

  /**
   * Anonymous auth. The rules demand an authenticated writer, so a failure
   * here is the FIRST thing that goes wrong on a fresh project — and the
   * one failure a player must never meet as a lobby that spins forever.
   * We keep the reason and hand it back as a readable line on the card.
   */
  let setupError = '';
  try {
    const auth = authMod.getAuth(app);
    const authEmu = search.get('authemu');
    if (authEmu) authMod.connectAuthEmulator(auth, `http://${authEmu}`, { disableWarnings: true });
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? '';
    setupError =
      code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed'
        ? 'enable Anonymous sign-in in the Firebase console'
        : code === 'auth/network-request-failed'
          ? 'no route to Firebase'
          : `sign-in failed (${code || 'unknown'})`;
  }
  const uid = ((): string => {
    try {
      return authMod.getAuth(app).currentUser?.uid ?? `anon-${Math.random().toString(36).slice(2, 10)}`;
    } catch {
      return `anon-${Math.random().toString(36).slice(2, 10)}`;
    }
  })();

  // The shared clock: RTDB serves its own offset estimate continuously.
  let srvOffsetMs = 0;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    const v = Number(snap.val());
    if (Number.isFinite(v)) srvOffsetMs = v;
  });

  let boutRef: DatabaseReference | null = null;
  let unsubs: Unsubscribe[] = [];
  let mySeat = 0;

  function boutPath(code: string): string {
    return `bouts/${code}`;
  }

  function teardown(phase: 'off' | 'error', error = ''): void {
    for (const u of unsubs.splice(0)) u();
    if (boutRef) {
      const mine = boutRef;
      boutRef = null;
      // Best effort: free my seat (host also folds the room).
      void remove(dbMod.child(mine, `s${mySeat}`)).catch(() => undefined);
      if (mySeat === 0) void remove(mine).catch(() => undefined);
    }
    net.phase = phase;
    net.error = error;
    net.code = '';
    net.dirty++;
  }

  /** Wire up streams once a room + seat are settled. */
  function subscribe(code: string): void {
    const other = 1 - mySeat;
    const base = boutPath(code);

    // Their pose stream.
    unsubs.push(
      onValue(ref(db, `${base}/p${other}`), (snap) => {
        const d = snap.val();
        if (Array.isArray(d)) hooks.onPose?.(d as number[]);
      }),
    );
    // Their event queue, in order (existing children replay on subscribe —
    // correct: a hello pushed before we listened still counts).
    unsubs.push(
      onChildAdded(ref(db, `${base}/e${other}`), (snap) => {
        const e = decodeEvent(snap.val());
        if (e) hooks.onEvent?.(e);
      }),
    );
    // Their presence: arriving pairs the room, vanishing ends it.
    let seen = false;
    unsubs.push(
      onValue(ref(db, `${base}/s${other}`), (snap) => {
        const there = snap.exists();
        if (there && !seen) {
          seen = true;
          const v = snap.val() as { name?: unknown; tint?: unknown } | null;
          if (v && typeof v.name === 'string') net.peerName = v.name.slice(0, 12);
          const tint = Number(v?.tint);
          if (Number.isFinite(tint)) net.peerTint = tint;
          net.phase = 'paired';
          net.dirty++;
          hooks.onPeer?.(true);
        } else if (!there && seen) {
          seen = false;
          net.phase = 'error';
          net.error = 'opponent left';
          net.dirty++;
          hooks.onPeer?.(false);
        }
      }),
    );
  }

  /**
   * THE WATCHDOG. An unreachable Realtime Database does not throw — the SDK
   * queues the write and waits, forever, which surfaces as a lobby card
   * that spins with no explanation. Every opening round trip gets a
   * deadline instead, so "can't reach it" is a sentence on the card.
   */
  const OPEN_TIMEOUT_MS = 12_000;

  function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
    return Promise.race([
      work,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${what} timed out — is the database reachable?`)), OPEN_TIMEOUT_MS),
      ),
    ]);
  }

  /** Refuse to open a room when the session never authenticated. */
  function blockedBySetup(): boolean {
    if (!setupError) return false;
    teardown('error', setupError);
    return true;
  }

  async function claimSeat(code: string, seat: number): Promise<boolean> {
    const seatRef = ref(db, `${boutPath(code)}/s${seat}`);
    const res = await withDeadline(
      runTransaction(seatRef, (cur) => {
        if (cur !== null) return undefined; // taken — abort
        return { uid, name: match.me.name, tint: match.me.tintIdx, t: serverTimestamp() };
      }),
      'taking the far corner',
    );
    if (!res.committed) return false;
    void onDisconnect(seatRef).remove();
    return true;
  }

  const backend: TransportBackend = {
    host(): void {
      void (async () => {
        if (blockedBySetup()) return;
        net.phase = 'connecting';
        net.dirty++;
        try {
          for (let i = 0; i < CODE_TRIES; i++) {
            const code = String(Math.floor(Math.random() * 10 ** NET.codeLength)).padStart(NET.codeLength, '0');
            const created = await withDeadline(
              runTransaction(ref(db, boutPath(code)), (cur) => {
                if (cur !== null) return undefined; // room exists — try another
                return { created: serverTimestamp(), s0: { uid, name: match.me.name, tint: match.me.tintIdx, t: serverTimestamp() } };
              }),
              'opening the room',
            );
            if (!created.committed) continue;
            mySeat = 0;
            net.seat = 0;
            net.code = code;
            net.phase = 'hosting';
            net.dirty++;
            boutRef = ref(db, boutPath(code));
            // Host folds the whole room if the headset drops.
            void onDisconnect(boutRef).remove();
            subscribe(code);
            return;
          }
          teardown('error', 'no free room codes');
        } catch (err) {
          teardown('error', err instanceof Error ? err.message : 'host failed');
        }
      })();
    },

    join(code: string): void {
      void (async () => {
        if (blockedBySetup()) return;
        net.phase = 'connecting';
        net.dirty++;
        try {
          const room = await withDeadline(dbMod.get(ref(db, `${boutPath(code)}/s0`)), 'finding the bout');
          if (!room.exists()) {
            teardown('error', 'no such bout');
            return;
          }
          if (!(await claimSeat(code, 1))) {
            teardown('error', 'bout is full');
            return;
          }
          mySeat = 1;
          net.seat = 1;
          net.code = code;
          boutRef = ref(db, boutPath(code));
          subscribe(code);
          // s0 already exists, so the presence watcher will flip us to
          // 'paired' on its first snapshot.
        } catch (err) {
          teardown('error', err instanceof Error ? err.message : 'join failed');
        }
      })();
    },

    leave(): void {
      if (boutRef) {
        void dbMod
          .push(dbMod.child(boutRef, `e${mySeat}`), { t: 'bye' } satisfies WireEvent)
          .catch(() => undefined);
      }
      teardown('off');
    },

    sendPose(d: number[]): void {
      if (!boutRef) return;
      void set(dbMod.child(boutRef, `p${mySeat}`), d).catch(() => undefined);
    },

    sendEvent(e: WireEvent): void {
      if (!boutRef) return;
      void dbMod.push(dbMod.child(boutRef, `e${mySeat}`), e).catch(() => undefined);
    },

    serverNowMs(): number {
      return Date.now() + srvOffsetMs;
    },
  };

  return backend;
}
