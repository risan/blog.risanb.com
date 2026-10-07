// The ground of the Brusio valley: a smooth heightfield that follows the railway where it lies on
// the ground, falls away under the viaduct so the arches stand open, and climbs into the steep
// hillside to the north. Pure: no DOM, no GL.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, mixColor, type Rgb } from './meshBuilder.ts';
import { ARCH_SPAN, CROSSING_DROP, CROWN_BELOW_RAIL, PIER_THICKNESS, track } from './track.ts';

// The ground the camera can see, in metres: x east, z south (so the hillside has negative z).
// The valley runs on to the west, where the village lies, and the mountain sides rise to the north.
export const TERRAIN_BOUNDS = { minX: -520, maxX: 200, minZ: -330, maxZ: 380 };
// The ground the scene showed before the valley was extended. Its heights are kept as they were,
// and it keeps the fine grid; the new ground beyond it is meshed more coarsely.
export const NEAR_BOUNDS = { minX: -200, maxX: 200, minZ: -205, maxZ: 150 };

export const BED_HALF_WIDTH = 2.7;
const BED_SHOULDER = 11;
// The flat bed lies this far below the rail top: ballast and sleepers fill the gap.
export const BED_DEPTH = 0.85;
const TRACK_SAMPLE_STEP = 2;
const DISTANCE_SOFTENING = 12;
const FAR_DISTANCE = 90;
const VIADUCT_CLEAR_HALF_WIDTH = 8;
const VIADUCT_CLEAR_FADE = 14;
const VIADUCT_CLEAR_END = 0.5;

// The meadow inside the loop is a low broad mound with soft terrace steps, not a flat lawn. The
// relief fades out towards the track bed and the viaduct, which keep their own ground.
const MOUND_CENTRE = { x: -6, z: 12 };
const MOUND_RADII = { x: 58, z: 52 };
const MOUND_HEIGHT = 5.5;
// Terrace banks are arcs about this point (x east, z south), as the low wall's own arc: the wall
// stands on the middle one. Each step raises the ground on the hillside (inner) side by `rise`.
const TERRACE_CENTRE = { x: -90, z: -40 };
const TERRACE_EDGES = [
  { radius: 83, rise: 0.55 },
  { radius: 68, rise: 0.7 },
  { radius: 53, rise: 0.55 },
];
const TERRACE_SOFTNESS = 2.4;
const RELIEF_BED_CLEARANCE = [9, 26];
const RELIEF_VIADUCT_CLEARANCE = [24, 42];

// Beyond the old bounds the mountain sides do not level off at 50 m above the line but keep rising
// at about thirty-five degrees, past 150 m, and lower ridges close the west and north-west of the valley.
const MOUNTAIN_SLOPE = 0.78;
const MOUNTAIN_FOOT = 30;
const OUTSIDE_RAMP = 70;
const WEST_WALL = { start: -380, slope: 0.6 };
const NORTH_WALL = { start: 200, slope: 0.6, eastEnd: -300 };
// The far side of the valley, to the south, only rises gently: it must never stand in the way of
// the view across the loop, which looks over it from above.
const SOUTH_SIDE = { start: 170, end: 300, rise: 32 };
// How far the line's far end is carried on in a straight line, so that the ground north of its
// end is still reckoned as hillside.
const VIRTUAL_END_LENGTH = 500;
const FOOT_SAMPLE_STEP = 5;

// How high the arch opening reaches above the ground, arch by arch from the east end. The ground
// is shaped to this: tall openings over the valley, lower ones where the line meets the slope.
// The fourth is the arch over the exit track, whose bed is CROSSING_DROP below the rail above.
const OPENING_HEIGHTS = [16.5, 16, 15, CROSSING_DROP - CROWN_BELOW_RAIL, 13, 12, 10.5, 9, 7];

export interface Ground {
  heightAt(x: number, z: number): number;
  // The steepness of the ground, as rise over run.
  slopeAt(x: number, z: number): number;
  // How far the point is from the nearest track bed (rails excluded on the viaduct).
  distanceToBed(x: number, z: number): number;
  // How far north of the upper track a point is: the slope that rises above the line.
  uphillAt(x: number, z: number): number;
  // How far a point is from the viaduct's centre line, and the distance along the line there.
  viaductAt(x: number, z: number): { distance: number; s: number };
}

export interface TerrainGrid {
  columns: number;
  rows: number;
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  // 0 for grass, 1 for scree: the shader mixes the two textures with it.
  rock: Float32Array;
  indices: Uint32Array;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);

  return t * t * (3 - 2 * t);
}

function hash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;

  return value - Math.floor(value);
}

export function valueNoise(x: number, z: number): number {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const fx = x - cellX;
  const fz = z - cellZ;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const top = hash(cellX, cellZ) * (1 - u) + hash(cellX + 1, cellZ) * u;
  const bottom = hash(cellX, cellZ + 1) * (1 - u) + hash(cellX + 1, cellZ + 1) * u;

  return top * (1 - v) + bottom * v;
}

export function openingHeight(s: number): number {
  const archIndex = (s - track.viaduct.startS - (track.viaduct.arches[0].startS - track.viaduct.startS)) / (ARCH_SPAN + PIER_THICKNESS) - 0.5;
  const clamped = Math.min(Math.max(archIndex, 0), OPENING_HEIGHTS.length - 1);
  const lower = Math.floor(clamped);
  const upper = Math.min(lower + 1, OPENING_HEIGHTS.length - 1);
  const t = clamped - lower;

  return OPENING_HEIGHTS[lower] * (1 - t) + OPENING_HEIGHTS[upper] * t;
}

// A distance past a start, as 0 before it, easing into a straight rise of one metre per metre.
function risePast(distance: number): number {
  if (distance <= 0) {
    return 0;
  }

  return distance < 30 ? (distance * distance) / 60 : distance - 15;
}

function distanceOutsideNear(x: number, z: number): number {
  const dx = Math.max(NEAR_BOUNDS.minX - x, 0, x - NEAR_BOUNDS.maxX);
  const dz = Math.max(NEAR_BOUNDS.minZ - z, 0, z - NEAR_BOUNDS.maxZ);

  return Math.hypot(dx, dz);
}

export function createGround(): Ground {
  const bedX: number[] = [];
  const bedZ: number[] = [];
  const bedY: number[] = [];
  const bedS: number[] = [];
  const point = track.sample(0);
  const { startS, endS } = track.viaduct;

  // Samples lie on the old spacing, counted from where the approach begins.
  for (let s = track.approachS % TRACK_SAMPLE_STEP; s <= track.length; s += TRACK_SAMPLE_STEP) {
    if (s > startS && s < endS) {
      continue;
    }

    track.sample(s, point);
    bedX.push(point.x);
    bedZ.push(point.z);
    bedY.push(point.y - BED_DEPTH);
    bedS.push(s);
  }

  const axisX: number[] = [];
  const axisZ: number[] = [];
  const axisS: number[] = [];
  const axisUnder: number[] = [];
  for (let s = startS; s <= endS; s += 1) {
    track.sample(s, point);
    axisX.push(point.x);
    axisZ.push(point.z);
    axisS.push(s);
    axisUnder.push(point.y - 1.2 - openingHeight(s));
  }

  // The upper approach as a curve over x, to tell how far a point lies up the hill above it.
  const upperX: number[] = [];
  const upperZ: number[] = [];
  for (let s = track.approachS; s <= track.circleStartS; s += 4) {
    track.sample(s, point);
    upperX.push(point.x);
    upperZ.push(point.z);
  }

  function upperTrackZ(x: number): number {
    if (x >= upperX[upperX.length - 1]) {
      return upperZ[upperZ.length - 1];
    }

    let index = 0;
    while (index < upperX.length - 2 && upperX[index + 1] < x) {
      index += 1;
    }

    const t = Math.min(Math.max((x - upperX[index]) / (upperX[index + 1] - upperX[index]), 0), 1);

    return upperZ[index] + (upperZ[index + 1] - upperZ[index]) * t;
  }

  // The line up to the approach, with its far end carried on as a straight: the foot of the
  // mountain side. The hill lies on its left, the way the train looks.
  const footX: number[] = [];
  const footZ: number[] = [];
  const footDirX: number[] = [];
  const footDirZ: number[] = [];
  const first = track.sample(0);
  for (let length = VIRTUAL_END_LENGTH; length > 0; length -= FOOT_SAMPLE_STEP) {
    footX.push(first.x + first.tx * -length);
    footZ.push(first.z + first.tz * -length);
    footDirX.push(first.tx);
    footDirZ.push(first.tz);
  }

  for (let s = 0; s <= track.approachS + 60; s += FOOT_SAMPLE_STEP) {
    track.sample(s, point);
    footX.push(point.x);
    footZ.push(point.z);
    footDirX.push(point.tx);
    footDirZ.push(point.tz);
  }

  // Distance to the foot of the mountain side, positive on the hill side of it and zero on the
  // valley side.
  function footUphill(x: number, z: number): number {
    let best = Infinity;
    let bestIndex = 0;
    for (let index = 0; index < footX.length; index += 1) {
      const dx = footX[index] - x;
      const dz = footZ[index] - z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        bestIndex = index;
      }
    }

    const left = (x - footX[bestIndex]) * footDirZ[bestIndex] - (z - footZ[bestIndex]) * footDirX[bestIndex];

    return left > 0 ? Math.sqrt(best) : 0;
  }

  // The old hillside rule holds over the ground the scene had before; to the west, where the line
  // bends round the spur, the distance to its foot takes over.
  function uphillAt(x: number, z: number): number {
    const old = Math.max(0, upperTrackZ(x) - z);
    const west = smoothstep(-200, -290, x);
    if (west === 0) {
      return old;
    }

    return old + (footUphill(x, z) - old) * west;
  }

  const bedCount = bedX.length;
  const farEndCount = bedS.filter((along) => along < track.approachS).length;
  const axisCount = axisX.length;
  const waves = mulberry32(11);
  const phases = Array.from({ length: 6 }, () => waves() * Math.PI * 2);

  // Height added on top of the surface that follows the line: the hillside behind the loop, and
  // the lower slopes of the next hill to the east.
  function hillside(x: number, z: number): number {
    const rolling =
      1.8 * Math.sin(x * 0.05 + phases[0]) * Math.sin(z * 0.043 + phases[1]) +
      1.0 * Math.sin(x * 0.11 + phases[2] + z * 0.07) +
      0.5 * Math.sin(z * 0.13 + phases[3] - x * 0.09);

    const up = uphillAt(x, z);
    const steep = Math.max(smoothstep(6, 30, up), smoothstep(100, 130, x));
    // Loose rock and ledges make the steep ground lumpy at a scale the mesh can carry.
    const lumps = (valueNoise(x * 0.3, z * 0.3) - 0.5) * 3 + (valueNoise(x * 0.8 + 9, z * 0.8) - 0.5) * 1.2;

    const outside = distanceOutsideNear(x, z);
    const beyond = smoothstep(0, OUTSIDE_RAMP, outside);

    return 50 * smoothstep(0, 70, up) + 30 * smoothstep(98, 190, x) + rolling + lumps * steep * (1 - 0.7 * beyond) + beyond * mountains(x, z, up);
  }

  // The mountain sides above the old hillside: they keep rising with the distance from the foot,
  // and close the valley in the west and north-west. Gullies run down them.
  function mountains(x: number, z: number, up: number): number {
    const west = WEST_WALL.slope * risePast(WEST_WALL.start - x);
    const northwest = NORTH_WALL.slope * risePast(-z - NORTH_WALL.start) * smoothstep(NORTH_WALL.eastEnd, NORTH_WALL.eastEnd - 100, x);
    const side = MOUNTAIN_SLOPE * risePast(up - MOUNTAIN_FOOT);
    const south = SOUTH_SIDE.rise * smoothstep(SOUTH_SIDE.start, SOUTH_SIDE.end, z);
    const mass = Math.max(side, west, northwest) + south;
    const gullies = (valueNoise(x * 0.028 + 20, z * 0.012) - 0.5) * 30 + (valueNoise(x * 0.07, z * 0.03 + 5) - 0.5) * 10;

    return mass + gullies * smoothstep(10, 100, mass + up * 0.3);
  }

  function viaductAt(x: number, z: number) {
    let best = Infinity;
    let bestIndex = 0;
    for (let index = 0; index < axisCount; index += 1) {
      const dx = axisX[index] - x;
      const dz = axisZ[index] - z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        bestIndex = index;
      }
    }

    return { distance: Math.sqrt(best), s: axisS[bestIndex] };
  }

  function meadowRelief(x: number, z: number): number {
    const dome = Math.hypot((x - MOUND_CENTRE.x) / MOUND_RADII.x, (z - MOUND_CENTRE.z) / MOUND_RADII.z);
    let relief = MOUND_HEIGHT * (1 - smoothstep(0.15, 1.05, dome));
    const terraceDistance = Math.hypot(x - TERRACE_CENTRE.x, z - TERRACE_CENTRE.z);
    for (const edge of TERRACE_EDGES) {
      relief += edge.rise * (1 - smoothstep(edge.radius - TERRACE_SOFTNESS, edge.radius + TERRACE_SOFTNESS, terraceDistance));
    }

    return relief;
  }

  function heightAt(x: number, z: number): number {
    let weightSum = 0;
    let weighted = 0;
    let nearest = Infinity;
    let nearestHeight = 0;
    let nearestIndex = 0;
    // The far end of the line only shapes the ground in the west, so that the ground the scene
    // had before keeps its height.
    const farEndReach = smoothstep(-200, -270, x);
    for (let index = 0; index < bedCount; index += 1) {
      const dx = bedX[index] - x;
      const dz = bedZ[index] - z;
      const squared = dx * dx + dz * dz;
      const weight = (index < farEndCount ? farEndReach : 1) / (squared + DISTANCE_SOFTENING * DISTANCE_SOFTENING);
      weightSum += weight;
      weighted += weight * bedY[index];
      if (squared < nearest) {
        nearest = squared;
        nearestHeight = bedY[index];
        nearestIndex = index;
      }
    }

    const farWeight = 1 / (FAR_DISTANCE * FAR_DISTANCE);
    const valley = valleyFloorAt(x, z);
    // The line's own height shapes the ground near it; far away the valley takes over.
    const natural = (weighted + valley * farWeight) / (weightSum + farWeight) + hillside(x, z);
    const bedWeight = 1 - smoothstep(BED_HALF_WIDTH, BED_HALF_WIDTH + BED_SHOULDER, Math.sqrt(nearest));
    let height = natural + (nearestHeight - natural) * bedWeight;

    const viaduct = viaductAt(x, z);
    const alongEnds = Math.min(viaduct.s - startS, endS - viaduct.s);
    if (alongEnds > VIADUCT_CLEAR_END) {
      const clearWeight =
        (1 - smoothstep(VIADUCT_CLEAR_HALF_WIDTH, VIADUCT_CLEAR_HALF_WIDTH + VIADUCT_CLEAR_FADE, viaduct.distance)) *
        smoothstep(VIADUCT_CLEAR_END, VIADUCT_CLEAR_END + 2.5, alongEnds);
      const under = axisUnder[Math.round(viaduct.s - startS)];
      // The exit track's cutting keeps its own bed under the arch. The embankments that meet the
      // viaduct's ends do not: the arches stand open right up to the abutments.
      const nearEnds = bedS[nearestIndex] > startS - 12 && bedS[nearestIndex] < endS + 12;
      const target = nearEnds ? under : under + (nearestHeight - under) * bedWeight;
      height += (target - height) * clearWeight;
    }

    const reliefWeight =
      smoothstep(RELIEF_BED_CLEARANCE[0], RELIEF_BED_CLEARANCE[1], Math.sqrt(nearest)) *
      smoothstep(RELIEF_VIADUCT_CLEARANCE[0], RELIEF_VIADUCT_CLEARANCE[1], viaduct.distance) *
      (1 - smoothstep(0.9, 1.1, Math.hypot((x - MOUND_CENTRE.x) / MOUND_RADII.x, (z - MOUND_CENTRE.z) / MOUND_RADII.z)));

    return height + meadowRelief(x, z) * reliefWeight;
  }

  return {
    heightAt,
    uphillAt,
    slopeAt(x, z) {
      const step = 1;
      const dx = heightAt(x + step, z) - heightAt(x - step, z);
      const dz = heightAt(x, z + step) - heightAt(x, z - step);

      return Math.hypot(dx, dz) / (2 * step);
    },
    distanceToBed(x, z) {
      let nearest = Infinity;
      for (let index = 0; index < bedCount; index += 1) {
        const dx = bedX[index] - x;
        const dz = bedZ[index] - z;
        nearest = Math.min(nearest, dx * dx + dz * dz);
      }

      return Math.sqrt(nearest);
    },
    viaductAt(x, z) {
      const { distance, s } = viaductAt(x, z);

      return { distance, s };
    },
  };
}

const MEADOW_LIGHT: Rgb = hexToLinear(0x779a3c);
const MEADOW_DARK: Rgb = hexToLinear(0x56822e);
const MEADOW_DRY: Rgb = hexToLinear(0x9aa548);
const HILL_GRASS: Rgb = hexToLinear(0x7d8a45);
const SCREE: Rgb = hexToLinear(0xe0d8c8);
const SCREE_DARK: Rgb = hexToLinear(0xb0a692);
const GRAVEL: Rgb = hexToLinear(0x9a9284);
const SOIL: Rgb = hexToLinear(0x6f6a4a);
const FOREST_DARK: Rgb = hexToLinear(0x2a4524);
const FOREST_LIGHT: Rgb = hexToLinear(0x425f2c);
const FOREST_TURNING: Rgb = hexToLinear(0x8a7a30);

// Mesh texture coordinates are metres divided by this, so one grass texture tile covers 5 m of ground.
export const TERRAIN_UV_METRES = 5;

// Fans of scree that spill down the mountain sides: where each starts (x east, north), how far it
// runs and how wide it gets, and the direction it runs in (degrees clockwise from north).
const SCREE_FANS = [
  { x: -330, north: 318, length: 170, width: 70, heading: 160 },
  { x: -215, north: 305, length: 150, width: 90, heading: 175 },
  { x: -118, north: 330, length: 190, width: 110, heading: 185 },
  { x: -40, north: 322, length: 150, width: 70, heading: 170 },
  { x: 60, north: 330, length: 170, width: 100, heading: 190 },
  { x: -440, north: 250, length: 120, width: 60, heading: 140 },
  { x: -168, north: 232, length: 118, width: 64, heading: 176 },
];

function screeFans(x: number, north: number): number {
  let cover = 0;
  for (const fan of SCREE_FANS) {
    const heading = (fan.heading * Math.PI) / 180;
    const dx = x - fan.x;
    const dn = north - fan.north;
    const along = (dx * Math.sin(heading) + dn * Math.cos(heading)) / fan.length;
    if (along < 0 || along > 1) {
      continue;
    }

    const across = dx * Math.cos(heading) - dn * Math.sin(heading);
    const halfWidth = (fan.width / 2) * (0.12 + 0.88 * along);
    const ragged = (valueNoise(x * 0.06, north * 0.06) - 0.5) * 0.5 * halfWidth;
    const inside = 1 - smoothstep(halfWidth * 0.6, halfWidth, Math.abs(across) + ragged);
    cover = Math.max(cover, inside * smoothstep(0, 0.1, along) * (1 - smoothstep(0.8, 1, along)));
  }

  return cover;
}

// The height of the valley floor with nothing added on: the plane the ground falls back to far from
// the line. How high a point stands above it tells a mountain side from the valley floor.
export function valleyFloorAt(x: number, z: number): number {
  return 6 - 0.06 * z - 0.015 * x;
}

// How far a point is into the ground that was not part of the old default view: beyond the old
// bounds, or far enough west of the loop that the view never reaches it. Its look is the new one.
function farness(x: number, z: number): number {
  return Math.max(smoothstep(0, 45, distanceOutsideNear(x, z)), smoothstep(-110, -200, x));
}

// How much of a point on the far mountain sides is forest and how much is bare scree, from its
// height and steepness. Both are zero on the ground the scene had before, which keeps its own look.
export function mountainCover(x: number, z: number, height: number, slope: number, uphill: number): { forest: number; stony: number } {
  const beyond = farness(x, z);
  const above = height - valleyFloorAt(x, z);
  const ribs = smoothstep(0.7, 0.86, valueNoise(x * 0.045 + 3, z * 0.03 + 9)) * smoothstep(55, 130, above);
  const stony = Math.max(screeFans(x, -z) * 0.95, ribs * 0.8, smoothstep(1.3, 2.3, slope) * 0.7);

  // The wood starts at the foot of the slope, where the line runs along it.
  const forest = Math.max(smoothstep(4, 26, uphill), smoothstep(14, 50, above));

  return { forest: forest * beyond, stony };
}

// Grid lines from one edge to the other: spaced `spacing` apart over the stretch the scene showed
// before, and growing wider beyond it up to `widest`, so that the far ground stays cheap.
function gridLines(min: number, nearMin: number, nearMax: number, max: number, spacing: number, widest: number): number[] {
  const lines: number[] = [];
  const count = Math.ceil((nearMax - nearMin) / spacing);
  for (let index = 0; index <= count; index += 1) {
    lines.push(nearMin + index * spacing);
  }

  const grow = (from: number, direction: 1 | -1, limit: number) => {
    let step = spacing * 2;
    let position = from;
    while (direction * (limit - position) > 0) {
      position += direction * Math.min(step, direction * (limit - position));
      step = Math.min(step * 1.18, widest);
      if (direction === 1) {
        lines.push(position);
      } else {
        lines.unshift(position);
      }
    }
  };

  grow(nearMin, -1, min);
  grow(lines[lines.length - 1], 1, max);

  return lines;
}

export function buildTerrainGrid(ground: Ground, spacing: number): TerrainGrid {
  const xs = gridLines(TERRAIN_BOUNDS.minX, NEAR_BOUNDS.minX, NEAR_BOUNDS.maxX, TERRAIN_BOUNDS.maxX, spacing, spacing * 5);
  const zs = gridLines(TERRAIN_BOUNDS.minZ, NEAR_BOUNDS.minZ, NEAR_BOUNDS.maxZ, TERRAIN_BOUNDS.maxZ, spacing, spacing * 5);
  const columns = xs.length;
  const rows = zs.length;
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const colors = new Float32Array(columns * rows * 3);
  const rock = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const x = xs[column];
      const z = zs[row];
      const height = ground.heightAt(x, z);
      const slope = ground.slopeAt(x, z);
      const bedDistance = ground.distanceToBed(x, z);
      const viaduct = ground.viaductAt(x, z);

      positions[index * 3] = x;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = z;
      uvs[index * 2] = x / TERRAIN_UV_METRES;
      uvs[index * 2 + 1] = z / TERRAIN_UV_METRES;

      const broad = valueNoise(x * 0.045 + 7, z * 0.045 + 3);
      const fine = valueNoise(x * 0.21, z * 0.21);
      const dry = valueNoise(x * 0.02 + 40, z * 0.02 + 11);
      let color = mixColor(MEADOW_DARK, MEADOW_LIGHT, 0.25 + 0.5 * broad + 0.25 * fine);
      color = mixColor(color, MEADOW_DRY, smoothstep(0.55, 0.85, dry) * 0.55);

      // The hillside: grass thins out into scree as the ground steepens and rises. Beyond the old
      // ground the mountain sides are forest, with scree fans and bare rock ribs.
      const beyond = farness(x, z);
      const cover = mountainCover(x, z, height, slope, ground.uphillAt(x, z));
      const hillside = smoothstep(12, 40, ground.uphillAt(x, z)) + smoothstep(104, 150, x) * 0.7;
      const stonyNear = Math.min(1, smoothstep(0.75, 1.3, slope) * 0.8 + hillside * (0.4 + 0.6 * fine));
      const stony = stonyNear + (cover.stony - stonyNear) * beyond;
      color = mixColor(color, HILL_GRASS, Math.min(1, hillside * 0.8));
      let wood = mixColor(FOREST_DARK, FOREST_LIGHT, valueNoise(x * 0.08, z * 0.08) * 0.7 + fine * 0.3);
      wood = mixColor(wood, FOREST_TURNING, smoothstep(0.58, 0.8, valueNoise(x * 0.035 + 50, z * 0.035)) * 0.5);
      color = mixColor(color, wood, cover.forest * (1 - stony));
      color = mixColor(color, mixColor(SCREE_DARK, SCREE, fine), stony * 0.9);
      color = mixColor(color, SOIL, 0.25 * smoothstep(0.4, 0.6, valueNoise(x * 0.09 + 5, z * 0.09 - 8)) * (1 - stony));

      // Gravel along the line, and shaded ground under the viaduct.
      const gravel = 1 - smoothstep(BED_HALF_WIDTH - 0.6, BED_HALF_WIDTH + 1, bedDistance);
      color = mixColor(color, GRAVEL, gravel);
      const shade = 1 - 0.18 * (1 - smoothstep(4, 8, viaduct.distance));
      colors[index * 3] = color[0] * shade;
      colors[index * 3 + 1] = color[1] * shade;
      colors[index * 3 + 2] = color[2] * shade;
      rock[index] = Math.max(stony * 0.95, gravel * 0.5);
    }
  }

  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      // Counter-clockwise from above, with z pointing south.
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return { columns, rows, positions, uvs, colors, rock, indices };
}
