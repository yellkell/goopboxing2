/**
 * NetworkSystem — the pumps. Everything DECIDED about the wire lives in
 * FightSystem (events) and FighterSystem (the remote body); this system
 * only keeps the streams flowing:
 *
 *  - my pose out at NET.poseHz while paired,
 *  - their pose in → decoded, MIRRORED across the ring, into the WirePose
 *    springs,
 *  - my authoritative state out at NET.stateHz while a bout is live,
 *  - hello on pairing (name + corner colour), goodbye on leave.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { NET } from '../config.js';
import { match } from '../fight/state.js';
import { peerPointToMine, peerQuatToMine } from '../game/ring.js';
import { decodePose, encodePose } from '../net/protocol.js';
import { hooks, net, sendEvent, sendPose } from '../net/transport.js';
import { fightersView } from './FighterSystem.js';

const decoded = {
  head: new Vector3(),
  headQuat: new Quaternion(),
  handL: new Vector3(),
  handR: new Vector3(),
};

export class NetworkSystem extends createSystem({}) {
  private poseAcc = 0;
  private stateAcc = 0;
  private helloSent = false;
  private wire: number[] = [];

  init(): void {
    hooks.onPose = (d) => {
      if (!decodePose(d, decoded)) return;
      peerPointToMine(decoded.head);
      peerQuatToMine(decoded.headQuat);
      peerPointToMine(decoded.handL);
      peerPointToMine(decoded.handR);
      fightersView.wire?.push(decoded.head, decoded.headQuat, decoded.handL, decoded.handR);
    };
  }

  update(delta: number): void {
    if (net.phase !== 'paired') {
      this.helloSent = false;
      return;
    }

    if (!this.helloSent) {
      this.helloSent = true;
      sendEvent({ t: 'hello', name: match.me.name, tint: match.me.tintIdx });
    }

    this.poseAcc += delta;
    if (this.poseAcc >= 1 / NET.poseHz) {
      this.poseAcc = 0;
      sendPose(encodePose(this.wire));
    }

    const live = match.screen === 'round' || match.screen === 'ko' || match.screen === 'rest';
    if (live && match.mode === 'online') {
      this.stateAcc += delta;
      if (this.stateAcc >= 1 / NET.stateHz) {
        this.stateAcc = 0;
        sendEvent({
          t: 'state',
          hp: Math.round(match.me.health),
          ko: match.me.health <= 0,
          rd: Math.round(match.me.roundDamage),
          hits: match.me.hitsLanded,
          blocks: match.me.blocks,
        });
      }
    }
  }
}
