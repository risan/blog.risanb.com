// The ground of the Brusio valley: a smooth heightfield that follows the railway where it lies on
// the ground, falls away under the viaduct so the arches stand open, and climbs into the steep
// hillside to the north. Pure: no DOM, no GL.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, mixColor, type Rgb } from './meshBuilder.ts';
import { ARCH_SPAN, CROSSING_DROP, CROWN_BELOW_RAIL, PIER_THICKNESS, track } from './track.ts';

// The ground the camera can see, in metres: x east, z south (so the hillside has negative z).
export const TERRAIN_BOUNDS = { minX: -200, maxX: 200, minZ: -205, maxZ: 150 };

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

export function createGround(): Ground {
  const bedX: number[] = [];
  const bedZ: number[] = [];
  const bedY: number[] = [];
  const bedS: number[] = [];
  const point = track.sample(0);
  const { startS, endS } = track.viaduct;

  for (let s = 0; s <= track.length; s += TRACK_SAMPLE_STEP) {
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

  // The upper track as a curve over x, to tell how far a point lies up the hill above it.
  const upperX: number[] = [];
  const upperZ: number[] = [];
  for (let s = 0; s <= track.circleStartS; s += 4) {
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

  function uphillAt(x: number, z: number): number {
    return Math.max(0, upperTrackZ(x) - z);
  }

  const bedCount = bedX.length;
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

    return 50 * smoothstep(0, 70, up) + 30 * smoothstep(98, 190, x) + rolling + lumps * steep;
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
    for (let index = 0; index < bedCount; index += 1) {
      const dx = bedX[index] - x;
      const dz = bedZ[index] - z;
      const squared = dx * dx + dz * dz;
      const weight = 1 / (squared + DISTANCE_SOFTENING * DISTANCE_SOFTENING);
      weightSum += weight;
      weighted += weight * bedY[index];
      if (squared < nearest) {
        nearest = squared;
        nearestHeight = bedY[index];
        nearestIndex = index;
      }
    }

    const farWeight = 1 / (FAR_DISTANCE * FAR_DISTANCE);
    const valley = 6 - 0.06 * z - 0.015 * x;
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

// Mesh texture coordinates are metres divided by this, so one grass texture tile covers 5 m of ground.
export const TERRAIN_UV_METRES = 5;

export function buildTerrainGrid(ground: Ground, spacing: number): TerrainGrid {
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  const columns = Math.ceil((maxX - minX) / spacing) + 1;
  const rows = Math.ceil((maxZ - minZ) / spacing) + 1;
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const colors = new Float32Array(columns * rows * 3);
  const rock = new Float32Array(columns * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const x = minX + column * spacing;
      const z = minZ + row * spacing;
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

      // The hillside: grass thins out into scree as the ground steepens and rises.
      const hillside = smoothstep(12, 40, ground.uphillAt(x, z)) + smoothstep(104, 150, x) * 0.7;
      const stony = Math.min(1, smoothstep(0.75, 1.3, slope) * 0.8 + hillside * (0.4 + 0.6 * fine));
      color = mixColor(color, HILL_GRASS, Math.min(1, hillside * 0.8));
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
