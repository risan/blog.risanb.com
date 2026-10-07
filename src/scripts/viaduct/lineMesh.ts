// What lies along the track: the ballast bed, the two rails, the sleepers' positions and the
// overhead line with its masts. Pure: it returns merged geometry and plain placements.

import { hexToLinear, MeshBuilder, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import { offsetFromTrack, track } from './track.ts';
import type { Ground } from './terrain.ts';

const BALLAST_STEP = 1.5;
const RAIL_STEP = 1;
const SLEEPER_SPACING = 0.65;
export const GAUGE = 1;
// The rail head is drawn a little wider than life: a true 7 cm rail is under one pixel on screen.
const RAIL_WIDTH = 0.15;
const RAIL_HEIGHT = 0.16;
const BALLAST_TOP = -0.22;
const WIRE_HEIGHT = 5.5;
const ARM_HEIGHT = 6.3;
const MAST_HEIGHT = 7.2;
const MAST_SPACING = 27;
const MAST_OFFSET = 2.9;
const WIRE_SWAY = 0.2;
const WIRE_STEP = 4;

const BALLAST_COLOR: Rgb = hexToLinear(0xb4ada0);
const RAIL_TOP: Rgb = hexToLinear(0xc9cdd0);
const RAIL_SIDE: Rgb = hexToLinear(0x5d5148);
const MAST_COLOR: Rgb = hexToLinear(0x8d9296);
const WIRE_COLOR: Rgb = hexToLinear(0x3a3a3c);

export interface Placement {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Mast {
  s: number;
  // Which side of the line the mast stands on: +1 right, -1 left.
  side: 1 | -1;
}

export function sleeperPlacements(): Placement[] {
  const placements: Placement[] = [];
  const point = track.sample(0);
  // Counted from where the approach begins, as everything on the line was before it was extended.
  for (let s = track.approachS % SLEEPER_SPACING; s <= track.length; s += SLEEPER_SPACING) {
    track.sample(s, point);
    placements.push({ x: point.x, y: point.y - 0.15 - 0.08, z: point.z, heading: point.heading });
  }

  return placements;
}

export function buildBallast(): BuiltMesh {
  const builder = new MeshBuilder();
  const { startS, endS } = track.viaduct;
  const ground: [number, number][] = [[-2.7, -0.95], [-1.6, BALLAST_TOP], [1.6, BALLAST_TOP], [2.7, -0.95]];
  const deck: [number, number][] = [[-1.75, -0.55], [-1.55, BALLAST_TOP], [1.55, BALLAST_TOP], [1.75, -0.55]];

  const count = Math.ceil(track.length / BALLAST_STEP);
  const rows: number[][] = [];
  for (let index = 0; index <= count; index += 1) {
    const s = (track.length * index) / count;
    const profile = s >= startS && s <= endS ? deck : ground;
    const point = track.sample(s);
    const row: number[] = [];
    for (let corner = 0; corner < profile.length; corner += 1) {
      const [lateral, drop] = profile[corner];
      const position = offsetFromTrack(s, lateral);
      const slope = corner === 0 || corner === 3;
      const sideNormal: Vec3 = [-point.tz * (corner === 0 ? -1 : 1), 0.6, point.tx * (corner === 0 ? -1 : 1)];
      const normal: Vec3 = slope ? sideNormal : [0, 1, 0];
      const length = Math.hypot(normal[0], normal[1], normal[2]);
      row.push(
        builder.vertex(
          [position.x, point.y + drop, position.z],
          [normal[0] / length, normal[1] / length, normal[2] / length],
          [lateral / 2.4, s / 2.4],
          BALLAST_COLOR,
        ),
      );
    }

    rows.push(row);
  }

  for (let index = 0; index < count; index += 1) {
    const a = rows[index];
    const b = rows[index + 1];
    for (let corner = 0; corner < 3; corner += 1) {
      builder.quad(a[corner], a[corner + 1], b[corner + 1], b[corner]);
    }
  }

  return builder.build();
}

export function buildRails(): BuiltMesh {
  const builder = new MeshBuilder();
  const count = Math.ceil(track.length / RAIL_STEP);
  for (const lateral of [-GAUGE / 2, GAUGE / 2]) {
    let previous: { top: Vec3[]; base: Vec3[] } | undefined;
    for (let index = 0; index <= count; index += 1) {
      const s = (track.length * index) / count;
      const point = track.sample(s);
      const left = offsetFromTrack(s, lateral - RAIL_WIDTH / 2);
      const right = offsetFromTrack(s, lateral + RAIL_WIDTH / 2);
      const top: Vec3[] = [[left.x, point.y, left.z], [right.x, point.y, right.z]];
      const base: Vec3[] = [[left.x, point.y - RAIL_HEIGHT, left.z], [right.x, point.y - RAIL_HEIGHT, right.z]];
      if (previous) {
        const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
        builder.flatQuad(previous.top[0], previous.top[1], top[1], top[0], uv, RAIL_TOP);
        builder.flatQuad(base[0], previous.base[0], previous.top[0], top[0], uv, RAIL_SIDE);
        builder.flatQuad(previous.base[1], base[1], top[1], previous.top[1], uv, RAIL_SIDE);
      }

      previous = { top, base };
    }
  }

  return builder.build();
}

// Masts stand on the outside of each curve, spaced about 27 m apart, and on the viaduct on the
// valley side as in the photograph.
function mastPositions(): Mast[] {
  const masts: Mast[] = [];
  const first = (track.approachS + 12) % MAST_SPACING;
  for (let s = first; s < track.length - 10; s += MAST_SPACING) {
    masts.push({ s, side: -1 });
  }

  return masts;
}

export function buildCatenary(ground: Ground): BuiltMesh {
  const builder = new MeshBuilder();
  const { startS, endS } = track.viaduct;

  for (const mast of mastPositions()) {
    const point = track.sample(mast.s);
    const onViaduct = mast.s >= startS && mast.s <= endS;
    const lateral = mast.side * (onViaduct ? 1.6 : MAST_OFFSET);
    const base = offsetFromTrack(mast.s, lateral);
    const baseY = onViaduct ? point.y - 0.5 : ground.heightAt(base.x, base.z) - 0.2;
    builder.box([base.x, baseY, base.z], [0.22, point.y + MAST_HEIGHT - baseY, 0.22], point.heading, MAST_COLOR);
    // The cantilever arm reaches over the track from the top of the mast.
    const reach = Math.abs(lateral) + 0.5;
    const armCentre = offsetFromTrack(mast.s, (lateral - mast.side * 0.5) / 2);
    builder.box([armCentre.x, point.y + ARM_HEIGHT, armCentre.z], [0.1, 0.1, reach], point.heading, MAST_COLOR);
  }

  // The contact wire hangs at 5.5 m, swaying a little from side to side as real wires do.
  let previous: Vec3 | undefined;
  for (let s = track.approachS % WIRE_STEP; s <= track.length; s += WIRE_STEP) {
    const point = track.sample(s);
    const sway = Math.sin(((s - track.approachS) / MAST_SPACING) * Math.PI) * WIRE_SWAY;
    const position = offsetFromTrack(s, sway);
    const current: Vec3 = [position.x, point.y + WIRE_HEIGHT, position.z];
    if (previous) {
      const length = Math.hypot(current[0] - previous[0], current[2] - previous[2]);
      const yaw = Math.atan2(-(current[2] - previous[2]), current[0] - previous[0]);
      builder.box(
        [(current[0] + previous[0]) / 2, (current[1] + previous[1]) / 2 - 0.04, (current[2] + previous[2]) / 2],
        [length + 0.05, 0.08, 0.08],
        yaw,
        WIRE_COLOR,
        { pitch: Math.atan2(current[1] - previous[1], length) },
      );
    }

    previous = current;
  }

  return builder.build();
}
