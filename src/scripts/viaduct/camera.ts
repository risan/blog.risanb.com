// The orthographic camera of the scene: how it frames the loop for each frame shape, and how the
// visitor's zoom, tilt, turn and pan change that framing. Pure: no DOM, no GL.
//
// By default the camera looks roughly north from above the lane in front of the viaduct, like the
// aerial photograph. Wide frames show the whole loop with hillside above; tall frames come in on
// the viaduct and the part of the loop it spans.

import { TERRAIN_BOUNDS } from './terrain.ts';

export interface CameraFrame {
  // Half the visible width and height, in metres measured on the screen.
  halfWidth: number;
  halfHeight: number;
  // The world point at the centre of the screen.
  target: [number, number, number];
  elevation: number;
  // Turns the view clockwise seen from above: zero looks due north.
  azimuth: number;
}

const DEGREE = Math.PI / 180;

interface Anchor {
  aspect: number;
  width: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  elevation: number;
}

// Frame shapes from the widest to the tallest. Between two anchors everything is interpolated.
const ANCHORS: Anchor[] = [
  { aspect: 2.1, width: 184, targetX: 8, targetY: 10, targetZ: -24, elevation: 17 },
  { aspect: 1.33, width: 160, targetX: 6, targetY: 6, targetZ: 2, elevation: 25 },
  { aspect: 0.8, width: 100, targetX: 46, targetY: 6, targetZ: -25, elevation: 34 },
];

const AZIMUTH = 4 * DEGREE;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function frameForAspect(aspect: number): CameraFrame {
  const clamped = Math.min(Math.max(aspect, ANCHORS[ANCHORS.length - 1].aspect), ANCHORS[0].aspect);
  let upper = 1;
  while (upper < ANCHORS.length - 1 && clamped < ANCHORS[upper].aspect) {
    upper += 1;
  }

  const wide = ANCHORS[upper - 1];
  const tall = ANCHORS[upper];
  const amount = (wide.aspect - clamped) / (wide.aspect - tall.aspect);
  const width = lerp(wide.width, tall.width, amount);

  return {
    halfWidth: width / 2,
    halfHeight: width / 2 / aspect,
    target: [lerp(wide.targetX, tall.targetX, amount), lerp(wide.targetY, tall.targetY, amount), lerp(wide.targetZ, tall.targetZ, amount)],
    elevation: lerp(wide.elevation, tall.elevation, amount) * DEGREE,
    azimuth: AZIMUTH,
  };
}

// The horizontal unit vector the camera looks along.
export function lookDirection(frame: CameraFrame): [number, number] {
  return [Math.sin(frame.azimuth), -Math.cos(frame.azimuth)];
}

// Where a world point lands on the screen: x and y in -1..1, y up, as for clip space.
export function projectToScreen(frame: CameraFrame, x: number, y: number, z: number): [number, number] {
  const [lookX, lookZ] = lookDirection(frame);
  const dx = x - frame.target[0];
  const dy = y - frame.target[1];
  const dz = z - frame.target[2];
  const across = dx * -lookZ + dz * lookX;
  const ahead = dx * lookX + dz * lookZ;
  const up = ahead * Math.sin(frame.elevation) + dy * Math.cos(frame.elevation);

  return [across / frame.halfWidth, up / frame.halfHeight];
}

// What the visitor has changed. Angles are absolute, in radians; `zoom` 1 is the default framing
// and the pan is a ground offset from the default target.
export interface ViewState {
  zoom: number;
  elevation: number;
  azimuth: number;
  panX: number;
  panZ: number;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const MIN_ELEVATION = 15 * DEGREE;
export const MAX_ELEVATION = 75 * DEGREE;
export const MAX_TURN = 40 * DEGREE;
// The lowest the terrain gets in each 25 m band of z from the south edge of the bounds to the
// north, less a margin. The hillside to the north is high, the valley floor in the south low.
const GROUND_FLOOR = [34, 33, 32, 32, 30, 29, 27, 21, 15, 8, 0, -1, -4, -4, -4, -5, -6, -7, -8, -8, -3, 1, 10, 21, 30, 31, 31, 32, 32];
const GROUND_FLOOR_BAND = 25;
// The highest the terrain reaches along each edge of the bounds, plus a margin, in 25 m bands
// running south to north (west, east) and west to east (north, south). A line of sight that
// passes lower than this where it crosses an edge slips under the world instead of meeting it.
const EDGE_CEILING = {
  west: [111, 117, 119, 119, 118, 111, 109, 104, 100, 102, 103, 103, 102, 101, 104, 108, 108, 104, 102, 102, 100, 104, 111, 116, 129, 133, 135, 134, 125],
  east: [292, 266, 245, 199, 125, 95, 95, 94, 91, 91, 87, 60, 41, 40, 39, 35, 37, 37, 36, 34, 36, 47, 56, 68, 70, 69, 67, 70, 70],
  north: [110, 98, 95, 101, 103, 120, 118, 109, 125, 153, 176, 179, 184, 197, 198, 198, 198, 207, 214, 216, 211, 223, 244, 270, 267, 275, 278, 282, 292],
  south: [121, 106, 82, 79, 69, 52, 47, 48, 48, 48, 49, 45, 44, 44, 44, 44, 41, 41, 42, 42, 41, 40, 39, 41, 42, 48, 59, 66, 69],
};
export type Edge = keyof typeof EDGE_CEILING;
const RAY_STEP = 1;
const RAY_START = 600;
const PAN_MARGIN = 30;
const FIT_STEPS = 24;

export function defaultView(aspect: number): ViewState {
  const base = frameForAspect(aspect);

  return { zoom: 1, elevation: base.elevation, azimuth: base.azimuth, panX: 0, panZ: 0 };
}

export function frameForView(aspect: number, view: ViewState): CameraFrame {
  const base = frameForAspect(aspect);

  return {
    halfWidth: base.halfWidth / view.zoom,
    halfHeight: base.halfHeight / view.zoom,
    target: [base.target[0] + view.panX, base.target[1], base.target[2] + view.panZ],
    elevation: view.elevation,
    azimuth: view.azimuth,
  };
}

export function groundFloorAt(z: number): number {
  const band = Math.floor((z - TERRAIN_BOUNDS.minZ) / GROUND_FLOOR_BAND);

  return GROUND_FLOOR[Math.min(Math.max(band, 0), GROUND_FLOOR.length - 1)];
}

// How high the terrain gets at a position along an edge: z for the west and east edges, x for the
// north and south ones.
export function edgeCeilingAt(edge: Edge, along: number): number {
  const start = edge === 'west' || edge === 'east' ? TERRAIN_BOUNDS.minZ : TERRAIN_BOUNDS.minX;
  const table = EDGE_CEILING[edge];
  const band = Math.floor((along - start) / GROUND_FLOOR_BAND);

  return table[Math.min(Math.max(band, 0), table.length - 1)];
}

function insideBounds(x: number, z: number): boolean {
  return x >= TERRAIN_BOUNDS.minX && x <= TERRAIN_BOUNDS.maxX && z >= TERRAIN_BOUNDS.minZ && z <= TERRAIN_BOUNDS.maxZ;
}

// The terrain's height at the edges a line of sight has just come in over, given the point where
// it crossed and the point just before, which was outside.
function entryCeiling(x: number, z: number, outsideX: number, outsideZ: number): number {
  let ceiling = -Infinity;
  if (outsideX < TERRAIN_BOUNDS.minX) {
    ceiling = Math.max(ceiling, edgeCeilingAt('west', z));
  }

  if (outsideX > TERRAIN_BOUNDS.maxX) {
    ceiling = Math.max(ceiling, edgeCeilingAt('east', z));
  }

  if (outsideZ < TERRAIN_BOUNDS.minZ) {
    ceiling = Math.max(ceiling, edgeCeilingAt('north', x));
  }

  if (outsideZ > TERRAIN_BOUNDS.maxZ) {
    ceiling = Math.max(ceiling, edgeCeilingAt('south', x));
  }

  return ceiling;
}

// True when every pixel's line of sight meets the terrain inside its bounds: it comes in over the
// edge of the world rather than under it, and is below the ground before it leaves. So no edge of
// the world and no empty background is ever shown. The camera is orthographic, so the four corner
// rays carry the whole screen: the footprint between them is a convex parallelogram.
export function looksOnlyAtTerrain(frame: CameraFrame): boolean {
  const [lookX, lookZ] = lookDirection(frame);
  const sine = Math.sin(frame.elevation);
  const cosine = Math.cos(frame.elevation);
  for (const sideways of [-1, 1]) {
    for (const upwards of [-1, 1]) {
      const across = sideways * frame.halfWidth;
      const up = upwards * frame.halfHeight;
      const corner = [
        frame.target[0] - lookZ * across + lookX * up * sine,
        frame.target[1] + up * cosine,
        frame.target[2] + lookX * across + lookZ * up * sine,
      ];
      let distance = -RAY_START;
      let x = corner[0] + lookX * cosine * distance;
      let y = corner[1] - sine * distance;
      let z = corner[2] + lookZ * cosine * distance;
      let entered = insideBounds(x, z);
      do {
        const outsideX = x;
        const outsideZ = z;
        distance += RAY_STEP;
        x = corner[0] + lookX * cosine * distance;
        y = corner[1] - sine * distance;
        z = corner[2] + lookZ * cosine * distance;
        if (!entered && insideBounds(x, z)) {
          entered = true;
          if (y < entryCeiling(x, z, outsideX, outsideZ)) {
            return false;
          }
        }
      } while (y > groundFloorAt(z) && y > -50);

      if (!insideBounds(x, z)) {
        return false;
      }
    }
  }

  return true;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

// The nearest view the camera may take. A view that would show the edge of the world is pulled
// back toward the centre first. When even the centre cannot take that zoom, the zoom is raised
// only as far as the asked pan allows, and the pan is pulled back when that is not enough.
export function clampView(aspect: number, view: ViewState): ViewState {
  const base = frameForAspect(aspect);
  const limited: ViewState = {
    zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
    elevation: clamp(view.elevation, MIN_ELEVATION, MAX_ELEVATION),
    azimuth: clamp(view.azimuth, AZIMUTH - MAX_TURN, AZIMUTH + MAX_TURN),
    panX: clamp(view.panX, TERRAIN_BOUNDS.minX + PAN_MARGIN - base.target[0], TERRAIN_BOUNDS.maxX - PAN_MARGIN - base.target[0]),
    panZ: clamp(view.panZ, TERRAIN_BOUNDS.minZ + PAN_MARGIN - base.target[2], TERRAIN_BOUNDS.maxZ - PAN_MARGIN - base.target[2]),
  };
  const fits = (candidate: ViewState) => looksOnlyAtTerrain(frameForView(aspect, candidate));
  if (fits(limited)) {
    return limited;
  }

  const centred = { ...limited, panX: 0, panZ: 0 };
  let zoom = limited.zoom;
  while (!fits({ ...centred, zoom }) && zoom < 64) {
    zoom *= 1.02;
  }

  // The largest share of the pan that still fits at this zoom.
  const pullBack = (at: number): ViewState => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < FIT_STEPS; step += 1) {
      const middle = (low + high) / 2;
      const attempt = { ...limited, zoom: at, panX: limited.panX * middle, panZ: limited.panZ * middle };
      if (fits(attempt)) {
        low = middle;
      } else {
        high = middle;
      }
    }

    return { ...limited, zoom: at, panX: limited.panX * low, panZ: limited.panZ * low };
  };

  if (zoom === limited.zoom) {
    return pullBack(zoom);
  }

  // The centre needed a higher zoom. The asked pan may well need less.
  let panned = limited.zoom;
  while (panned < zoom && !fits({ ...limited, zoom: panned })) {
    panned *= 1.02;
  }

  return panned < zoom ? { ...limited, zoom: panned } : pullBack(zoom);
}

// Moves the view so the ground follows a drag of the given size, which is a share of the screen
// (1 is half its width or height, up and to the right positive, as in clip space).
export function panByScreen(aspect: number, view: ViewState, acrossShare: number, upShare: number): ViewState {
  const frame = frameForView(aspect, view);
  const [lookX, lookZ] = lookDirection(frame);
  const across = acrossShare * frame.halfWidth;
  const ahead = (upShare * frame.halfHeight) / Math.sin(frame.elevation);

  return {
    ...view,
    panX: view.panX - (-lookZ * across + lookX * ahead),
    panZ: view.panZ - (lookX * across + lookZ * ahead),
  };
}

// Changes the zoom and keeps the ground point under the given screen position (x and y in -1..1,
// y up) where it is.
export function zoomAtScreen(aspect: number, view: ViewState, zoom: number, screenX: number, screenY: number): ViewState {
  const before = frameForView(aspect, view);
  const after = frameForView(aspect, { ...view, zoom });
  const [lookX, lookZ] = lookDirection(before);
  const across = screenX * (before.halfWidth - after.halfWidth);
  const ahead = (screenY * (before.halfHeight - after.halfHeight)) / Math.sin(before.elevation);

  return {
    ...view,
    zoom,
    panX: view.panX + (-lookZ * across + lookX * ahead),
    panZ: view.panZ + (lookX * across + lookZ * ahead),
  };
}

export function isDefaultView(aspect: number, view: ViewState): boolean {
  const base = defaultView(aspect);

  return (
    Math.abs(view.zoom - base.zoom) < 1e-3 &&
    Math.abs(view.elevation - base.elevation) < 1e-3 &&
    Math.abs(view.azimuth - base.azimuth) < 1e-3 &&
    Math.abs(view.panX) < 0.05 &&
    Math.abs(view.panZ) < 0.05
  );
}
