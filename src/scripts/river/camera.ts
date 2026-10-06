// The orthographic, tilted camera that gives the scene its isometric look. Pure: no DOM, no GL.
// World axes: x and y lie in the ground plane, z is up and the water surface is z = 0.
//
// The camera is two unit vectors in the ground plane: `across` points to the right of the screen
// and `toward` points at the viewer (down the screen). Landscape canvases look along -y with x to
// the right; portrait canvases are the same view turned a quarter turn, so the river can run
// from the top of a tall screen towards the bottom.

import type { Vec2 } from './world.ts';

// Angle of the view above the horizon.
export const ELEVATION = (35 * Math.PI) / 180;
// Ground raised above the water shifts up the screen by its height times cos(e) / sin(e), so the
// world reaches this far beyond the bottom of the frame to leave no gap there.
export const NEAR_MARGIN = 0.9;
// The world box that must fit in clip space reaches this far above and below the water.
export const WORLD_Z_SPAN = 3;

export interface CameraOptions {
  portrait: boolean;
  // The visible width of the frame and its height measured on the screen, in metres.
  viewWidth: number;
  viewHeight: number;
  elevation?: number;
}

export interface Camera {
  portrait: boolean;
  across: Vec2;
  toward: Vec2;
  elevation: number;
  // The world point (on z = 0) at the centre of the screen.
  centre: Vec2;
  // The world rectangle that covers the frame, with the margin on the near side.
  worldWidth: number;
  worldHeight: number;
  // Half the visible width, and half the visible height measured on the screen.
  halfWidth: number;
  halfHeight: number;
  depthRange: number;
  // Column-major, maps (x, y, z, 1) to clip space.
  viewProjection: Float32Array;
}

export function createCamera(options: CameraOptions): Camera {
  const elevation = options.elevation ?? ELEVATION;
  const sine = Math.sin(elevation);
  const cosine = Math.cos(elevation);
  const { portrait, viewWidth, viewHeight } = options;
  const across: Vec2 = portrait ? { x: 0, y: -1 } : { x: 1, y: 0 };
  const toward: Vec2 = portrait ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const footprint = viewHeight / sine;
  const worldWidth = portrait ? footprint + NEAR_MARGIN : viewWidth;
  const worldHeight = portrait ? viewWidth : footprint + NEAR_MARGIN;
  const centre: Vec2 = {
    x: worldWidth / 2 - toward.x * (NEAR_MARGIN / 2),
    y: worldHeight / 2 - toward.y * (NEAR_MARGIN / 2),
  };
  const halfWidth = viewWidth / 2;
  const halfHeight = viewHeight / 2;
  const depthRange = (Math.hypot(worldWidth, worldHeight) / 2 + NEAR_MARGIN) * cosine + WORLD_Z_SPAN * sine;

  const centreAcross = centre.x * across.x + centre.y * across.y;
  const centreToward = centre.x * toward.x + centre.y * toward.y;
  const viewProjection = new Float32Array(16);
  // Rows of the matrix, written column by column.
  const rows = [
    [across.x / halfWidth, across.y / halfWidth, 0, -centreAcross / halfWidth],
    [(-toward.x * sine) / halfHeight, (-toward.y * sine) / halfHeight, cosine / halfHeight, (centreToward * sine) / halfHeight],
    [(-toward.x * cosine) / depthRange, (-toward.y * cosine) / depthRange, -sine / depthRange, (centreToward * cosine) / depthRange],
    [0, 0, 0, 1],
  ];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      viewProjection[column * 4 + row] = rows[row][column];
    }
  }

  return {
    portrait,
    across,
    toward,
    elevation,
    centre,
    worldWidth,
    worldHeight,
    halfWidth,
    halfHeight,
    depthRange,
    viewProjection,
  };
}

// Screen position of a world point: u to the right and v down, both 0..1 across the frame.
export function projectToScreen(camera: Camera, x: number, y: number, z: number, out: Vec2): Vec2 {
  const dx = x - camera.centre.x;
  const dy = y - camera.centre.y;
  const right = dx * camera.across.x + dy * camera.across.y;
  const down = (dx * camera.toward.x + dy * camera.toward.y) * Math.sin(camera.elevation) - z * Math.cos(camera.elevation);
  out.x = 0.5 + right / (2 * camera.halfWidth);
  out.y = 0.5 + down / (2 * camera.halfHeight);

  return out;
}

// The point on the water surface (z = 0) under a screen position: where a tap or a cast lands.
export function screenToWater(camera: Camera, u: number, v: number, out: Vec2): Vec2 {
  const right = (u - 0.5) * 2 * camera.halfWidth;
  const down = (v - 0.5) * 2 * camera.halfHeight;
  const forward = down / Math.sin(camera.elevation);
  out.x = camera.centre.x + camera.across.x * right + camera.toward.x * forward;
  out.y = camera.centre.y + camera.across.y * right + camera.toward.y * forward;

  return out;
}
