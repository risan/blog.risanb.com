// Where the livery of a vehicle sits in its texture, in metres, so the mesh and the painter agree
// without sharing any pixels. Pure: no DOM, no GL.
//
// One picture of the side serves both sides of the vehicle. The right side reads it from the rear
// to the front and the left side from the front to the rear, so the lettering reads left to right
// on both. Below the side sits the cab front (locomotives only) and a small white block that
// plain parts, which keep their vertex colours, point their texture coordinates at.

import { END_OVERHANG, type VehicleSpec } from './train.ts';

export type Side = 'right' | 'left';
export type End = 'front' | 'rear';

export const VEHICLE_HALF_WIDTH = 1.325;
const GUTTER = 0.15;
const SOLID_SIZE = 0.3;

const WALLS = {
  locomotive: { bottom: 0.55, top: 3.1 },
  panorama: { bottom: 0.45, top: 3.1 },
};

const FRONT = { bottom: 0.45, top: 3.65 };

export interface LiveryLayout {
  // The whole atlas, in metres.
  width: number;
  height: number;
  wallBottom: number;
  wallTop: number;
  // The row (in metres from the top) where the cab front starts, or null on a coach.
  frontRow: number | null;
  frontBottom: number;
  frontTop: number;
  // The row and column where the white block starts.
  solidRow: number;
  solidColumn: number;
  solidSize: number;
}

export function liveryLayout(spec: VehicleSpec): LiveryLayout {
  const wall = WALLS[spec.kind];
  const wallHeight = wall.top - wall.bottom;
  const hasFront = spec.kind === 'locomotive';
  const frontRow = hasFront ? wallHeight + GUTTER : null;
  const frontEnd = frontRow === null ? wallHeight : frontRow + (FRONT.top - FRONT.bottom);
  const solidRow = frontEnd + GUTTER;

  return {
    width: spec.length,
    height: solidRow + SOLID_SIZE + GUTTER,
    wallBottom: wall.bottom,
    wallTop: wall.top,
    frontRow,
    frontBottom: FRONT.bottom,
    frontTop: FRONT.top,
    solidRow,
    solidColumn: spec.length - SOLID_SIZE - GUTTER,
    solidSize: SOLID_SIZE,
  };
}

// Where a point on the wall of the vehicle (x along it, y up) lands in the texture.
export function sideUv(layout: LiveryLayout, side: Side, x: number, y: number): [number, number] {
  const column = side === 'right' ? x + layout.width / 2 : layout.width / 2 - x;
  const row = layout.wallTop - y;

  return [column / layout.width, 1 - row / layout.height];
}

// Where a point on a cab front (z across, y up) lands in the texture. Seen from outside, +z is on
// the left at the front end and on the right at the rear end.
export function frontUv(layout: LiveryLayout, end: End, z: number, y: number): [number, number] {
  if (layout.frontRow === null) {
    throw new Error('viaduct: this vehicle has no cab front');
  }

  const column = (end === 'front' ? -z : z) + VEHICLE_HALF_WIDTH;
  const row = layout.frontRow + (layout.frontTop - y);

  return [column / layout.width, 1 - row / layout.height];
}

export function solidUv(layout: LiveryLayout): [number, number] {
  const column = layout.solidColumn + layout.solidSize / 2;
  const row = layout.solidRow + layout.solidSize / 2;

  return [column / layout.width, 1 - row / layout.height];
}

// The body ends where the couplers or bellows begin.
export function bodyHalfLength(spec: VehicleSpec): number {
  return spec.length / 2 - END_OVERHANG;
}
