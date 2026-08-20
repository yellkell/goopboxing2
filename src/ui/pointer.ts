/**
 * Controller pointer kit — the laser and its cursor dot, shared by every
 * panel. Vendored from RAVE RAID with the beam re-cut to the house lime.
 *
 * The Meta interaction grammar: the beam only draws when it's actually ON
 * an interactable (a searchlight sweeping the room is noise), the dot
 * rides the hit point, and feedback is eased, never snapped — the dot
 * swells ~1.3× over a hovered button (~100 ms out, ~180 ms back), and a
 * click lands a short bright pop that decays over ~150 ms. All of it is
 * mesh/material state: nothing here touches a canvas.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';

const HOVER_IN_S = 0.1;
const HOVER_OUT_S = 0.18;
const CLICK_S = 0.15;
const DOT_R = 0.011;

export class PointerRay {
  private line: Line;
  private lineMat: LineBasicMaterial;
  private dot: Mesh;
  private dotMat: MeshBasicMaterial;
  private hoverAmt = 0;
  private clickAmt = 0;

  constructor(scene: Object3D | Scene) {
    this.lineMat = new LineBasicMaterial({
      color: 0x8cff70,
      transparent: true,
      opacity: 0.25,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    this.line = new Line(geo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.dotMat = new MeshBasicMaterial({ color: 0xf2ffe9, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    this.dot = new Mesh(new SphereGeometry(DOT_R, 12, 10), this.dotMat);
    this.dot.renderOrder = 31; // over the panel it rests on
    this.dot.visible = false;
    scene.add(this.line);
    scene.add(this.dot);
  }

  /** Feed one frame: where the ray starts, where it hit (null = no panel
   *  under it), and whether the hit is over a live button. */
  update(delta: number, origin: Vector3, end: Vector3 | null, hovering: boolean): void {
    const on = end !== null;
    this.line.visible = on;
    this.dot.visible = on;
    if (!on) {
      // Reset the feedback, not just hide it — a stale click pop or hover
      // swell must not reappear when the ray finds a panel again.
      this.hoverAmt = 0;
      this.clickAmt = 0;
      return;
    }

    const pos = this.line.geometry.getAttribute('position');
    pos.setXYZ(0, origin.x, origin.y, origin.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    this.dot.position.copy(end);

    const want = hovering ? 1 : 0;
    const rate = want > this.hoverAmt ? delta / HOVER_IN_S : delta / HOVER_OUT_S;
    this.hoverAmt =
      this.hoverAmt < want ? Math.min(want, this.hoverAmt + rate) : Math.max(want, this.hoverAmt - rate);
    this.clickAmt = Math.max(0, this.clickAmt - delta / CLICK_S);

    const swell = 1 + 0.32 * this.hoverAmt + 0.5 * this.clickAmt;
    this.dot.scale.setScalar(swell);
    this.lineMat.opacity = 0.22 + 0.26 * this.hoverAmt;
    this.dotMat.opacity = 0.8 + 0.2 * this.hoverAmt;
  }

  /** The trigger landed — pop the dot. */
  click(): void {
    this.clickAmt = 1;
  }

  hide(): void {
    this.line.visible = false;
    this.dot.visible = false;
    this.hoverAmt = 0;
  }

  dispose(): void {
    this.line.removeFromParent();
    this.dot.removeFromParent();
    this.line.geometry.dispose();
    this.lineMat.dispose();
    (this.dot.geometry as SphereGeometry).dispose();
    this.dotMat.dispose();
  }
}
