/**
 * Additive "glow" toolkit — a bloom-like look without full-screen
 * post-processing (fragile/expensive in stereo WebXR). Everything renders
 * additively with depthWrite off, so hot cores bleed soft halos.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Sprite,
  SpriteMaterial,
  type ColorRepresentation,
  type Texture,
} from 'three';

let _glowTex: Texture | undefined;

/** A soft radial falloff texture (white core → transparent edge), cached. */
export function glowTexture(): Texture {
  if (_glowTex) return _glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new CanvasTexture(canvas);
  return _glowTex;
}

let _glintTex: Texture | undefined;

/**
 * A four-point lens glint — hot core, two thin crossing streaks, a faint
 * halo — the shape a real point of light leaves on a real lens. This is
 * THE particle texture for anything that sparkles: a bare (unmapped)
 * Points material renders literal SQUARES, which is exactly the retro
 * confetti look this game is not going for.
 */
export function glintTexture(): Texture {
  if (_glintTex) return _glintTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  g.globalCompositeOperation = 'lighter';
  // Faint halo.
  const halo = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  halo.addColorStop(0, 'rgba(255,255,255,0.30)');
  halo.addColorStop(0.35, 'rgba(255,255,255,0.10)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  // The two streaks: a radial gradient squashed flat, once per axis.
  for (const flip of [false, true]) {
    g.save();
    g.translate(mid, mid);
    if (flip) g.rotate(Math.PI / 2);
    g.scale(1, 0.07);
    const streak = g.createRadialGradient(0, 0, 0, 0, 0, mid);
    streak.addColorStop(0, 'rgba(255,255,255,0.95)');
    streak.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = streak;
    g.fillRect(-mid, -mid, size, size * 8);
    g.restore();
  }
  // Hot core.
  const core = g.createRadialGradient(mid, mid, 0, mid, mid, size * 0.09);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  _glintTex = new CanvasTexture(c);
  return _glintTex;
}

/** A camera-facing additive glow halo. */
export function glowSprite(color: ColorRepresentation, size: number, opacity = 1): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: new Color(color),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}
