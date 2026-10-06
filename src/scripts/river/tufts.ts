// Where the grass tufts and fern clumps stand on the banks. Pure: no DOM, no GL.

import { mulberry32, type World } from './world.ts';

// Per grass tuft: x, y, size in metres, seed, height of the ground above the water.
export const TUFT_FLOATS = 5;
// Per fern frond: x, y, length, angle, seed, curl, width scale, unused.
export const FROND_FLOATS = 8;

// `scale` is the size of the river's surroundings relative to the original scene (riverScale / 7).
export function scatterTufts(world: World, seed: number, count: number, scale: number): Float32Array {
  const random = mulberry32(seed);
  const tufts = new Float32Array(count * TUFT_FLOATS);
  let placed = 0;

  for (let attempt = 0; attempt < count * 30 && placed < count; attempt += 1) {
    const x = random() * world.width;
    const y = random() * world.height;
    // Not on the pebble shore: tufts take their colour from the ground, and would look like straw there.
    if (-world.depthAt(x, y) < 0.6 || world.rockHeightAt(x, y) > 0.01) {
      continue;
    }

    const offset = placed * TUFT_FLOATS;
    tufts[offset] = x;
    tufts[offset + 1] = y;
    tufts[offset + 2] = (0.07 + random() * 0.07) * scale;
    tufts[offset + 3] = random() * 100;
    tufts[offset + 4] = world.elevationAt(x, y);
    placed += 1;
  }

  return tufts.subarray(0, placed * TUFT_FLOATS);
}

// Ferns grow close to the water; a few stand right at the edge so their fronds hang over it.
export function scatterFerns(world: World, seed: number, clumps: number, scale: number): Float32Array {
  const random = mulberry32(seed);
  const fronds = new Float32Array(clumps * 9 * FROND_FLOATS);
  let placed = 0;

  for (let clump = 0, attempt = 0; clump < clumps && attempt < clumps * 80; attempt += 1) {
    const x = random() * world.width;
    const y = random() * world.height;
    const inland = -world.depthAt(x, y);
    if (inland < 0.0 || inland > 1.0 || world.rockHeightAt(x, y) > 0.01) {
      continue;
    }

    const count = 5 + Math.floor(random() * 5);
    const length = (0.4 + random() * 0.2) * scale;
    const start = random() * Math.PI * 2;
    for (let index = 0; index < count; index += 1) {
      const offset = placed * FROND_FLOATS;
      fronds[offset] = x;
      fronds[offset + 1] = y;
      fronds[offset + 2] = length * (0.8 + random() * 0.4);
      fronds[offset + 3] = start + (index / count) * Math.PI * 2 + (random() - 0.5) * 0.5;
      fronds[offset + 4] = random() * 100;
      fronds[offset + 5] = (random() < 0.5 ? -1 : 1) * (0.1 + random() * 0.25);
      fronds[offset + 6] = 0.8 + random() * 0.4;
      placed += 1;
    }

    clump += 1;
  }

  return fronds.subarray(0, placed * FROND_FLOATS);
}
