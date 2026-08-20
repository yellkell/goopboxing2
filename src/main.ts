/**
 * SLUGFEST — entry point.
 *
 * Boots an IWSDK World as a FULL VR session. Your real floor is the mat
 * (roomscale reference space keeps y = 0 at your actual floor), the ring
 * is built around your spawn, and the void is the only world.
 *
 * `npm run dev` and open the page: a headset offers ENTER THE RING; on
 * desktop the IWSDK dev plugin provides a WebXR emulator (WASD + mouse).
 * Online bouts light up once src/net/firebaseConfig.ts carries a project.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { Color } from 'three';
import { ensureAudio } from './audio/sfx.js';
import { ArenaSystem } from './systems/ArenaSystem.js';
import { FighterSystem, fightersView } from './systems/FighterSystem.js';
import { FightSystem, fightView } from './systems/FightSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { MenuSystem, menuView } from './systems/MenuSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

/** The created world, for the debug hook below (set once boot resolves). */
let worldRef: World | null = null;

enterButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterButton?.removeAttribute('disabled');
}

World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
  },
  // A boxing game: your body IS the controller. Nothing is grabbed and
  // nobody teleports — footwork is footwork.
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    defaultLighting: false,
    far: 90,
    camera: { position: [0, 1.65, 0] },
  },
}).then(async (world) => {
  worldRef = world;
  world.scene.background = new Color(0x030503);

  // Order matters lightly: the tracked body first, then the bodies that
  // wear it, then the referee that reads both, then the room and the ink.
  world.registerSystem(PlayerSystem);
  world.registerSystem(FighterSystem);
  world.registerSystem(FightSystem);
  world.registerSystem(ArenaSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(NetworkSystem);

  const xrSupported =
    (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveVR).catch(() => false)) === true;

  if (enterButton && xrSupported) {
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', () => {
      enterButton.setAttribute('disabled', '');
      ensureAudio(); // unlock the AudioContext inside the tap gesture
      launchXR(world, { sessionMode: SessionMode.ImmersiveVR });

      const watchForSession = (): void => {
        if (world.session) {
          hideLanding();
          world.session.addEventListener('end', showLanding, { once: true });
          return;
        }
        if (!document.body.classList.contains('app-entered')) {
          requestAnimationFrame(watchForSession);
        }
      };
      requestAnimationFrame(watchForSession);
      window.setTimeout(() => {
        if (!world.session) enterButton.removeAttribute('disabled');
      }, 4000);
    });
  } else if (enterButton) {
    enterButton.textContent = 'XR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[SLUGFEST] World ready — the mat is warm, the gel is warmer.');
});

/* Dev/debug hook: drive the whole bout from the console or a headless
 * probe without controllers — e.g. __gbx.fight.startPractice(1), or
 * __gbx.drive(0,1.6,0, …) to puppet the tracked body. */
import { match, tracked, resetBout } from './fight/state.js';
import { installLoopback, net } from './net/transport.js';

declare global {
  interface Window {
    __gbx?: {
      match: typeof match;
      tracked: typeof tracked;
      net: typeof net;
      fight: typeof fightView;
      menu: typeof menuView;
      fighters: typeof fightersView;
      resetBout: typeof resetBout;
      /** Pair an in-process fake opponent (probe drives it). */
      loopback: typeof installLoopback;
      /** Take over the tracked body: head pos, head yaw, both hands. */
      drive: (
        hx: number, hy: number, hz: number, yaw: number,
        lx: number, ly: number, lz: number,
        rx: number, ry: number, rz: number,
        speedL?: number, speedR?: number,
      ) => void;
      /** Hand the body back to the headset. */
      undrive: () => void;
      /** Draw calls / triangles this frame — the scenery's budget check. */
      info: () => { calls: number; triangles: number } | null;
      scene: () => import('three').Scene | null;
    };
  }
}

window.__gbx = {
  match,
  tracked,
  net,
  fight: fightView,
  menu: menuView,
  fighters: fightersView,
  resetBout,
  loopback: installLoopback,
  drive: (hx, hy, hz, yaw, lx, ly, lz, rx, ry, rz, speedL = 0, speedR = 0) => {
    tracked.devDrive = true;
    tracked.hasInput = true;
    const prevL = tracked.handL.clone();
    const prevR = tracked.handR.clone();
    tracked.head.set(hx, hy, hz);
    tracked.headQuat.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, yaw);
    tracked.handL.set(lx, ly, lz);
    tracked.handR.set(rx, ry, rz);
    tracked.speedL = speedL;
    tracked.speedR = speedR;
    // Direction from the jump the probe just made (falls back to forward).
    tracked.velL.copy(tracked.handL).sub(prevL);
    if (tracked.velL.lengthSq() > 1e-8) tracked.velL.normalize();
    tracked.velR.copy(tracked.handR).sub(prevR);
    if (tracked.velR.lengthSq() > 1e-8) tracked.velR.normalize();
    if (tracked.head.y > tracked.standingHeight) tracked.standingHeight = tracked.head.y;
  },
  undrive: () => {
    tracked.devDrive = false;
  },
  info: () => {
    const r = (worldRef as unknown as { renderer?: { info: { render: { calls: number; triangles: number } } } } | null)
      ?.renderer;
    return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles } : null;
  },
  scene: () =>
    (worldRef as unknown as { scene?: import('three').Scene } | null)?.scene ?? null,
};
