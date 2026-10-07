// The viaduct's stones, painted at load time: rock-faced ashlar for the walls and piers, and a
// strip of voussoirs and slabs for the arch rings and the cornice. Each stone is a domed block
// in a light mortar joint. One height field drives both the shading in the colour picture and the
// normal map, so the relief and the light and dark edges agree.

import type { CanvasTexture } from 'three';
import { NoColorSpace } from 'three';
import { mulberry32 } from '../river/world.ts';
import { layCourses, STONE_TILE, TRIM } from './stoneLayout.ts';
import { finish, paintCanvas } from './textures.ts';

type Rgb = [number, number, number];

interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgb;
}

export interface StoneTextures {
  map: CanvasTexture;
  normalMap: CanvasTexture;
}

const MORTAR: Rgb = [206, 200, 184];
const WALL_STONES: [number, Rgb][] = [
  [0.44, [176, 174, 168]],
  [0.14, [164, 167, 170]],
  [0.15, [196, 184, 162]],
  [0.1, [188, 168, 134]],
  [0.05, [186, 160, 112]],
  [0.025, [148, 112, 86]],
  [0.075, [128, 128, 128]],
];
const SLAB_STONES: [number, Rgb][] = [
  [0.6, [204, 200, 192]],
  [0.3, [208, 196, 172]],
  [0.1, [186, 188, 188]],
];
const TRIM_STONES: [number, Rgb][] = [
  [0.46, [196, 192, 182]],
  [0.16, [180, 182, 182]],
  [0.2, [208, 192, 164]],
  [0.12, [198, 174, 134]],
  [0.06, [168, 124, 90]],
];

function pickStone(random: () => number, stones: [number, Rgb][]): Rgb {
  let roll = random();
  let chosen = stones[0][1];
  for (const [weight, color] of stones) {
    chosen = color;
    roll -= weight;
    if (roll <= 0) {
      break;
    }
  }

  const tone = 0.92 + random() * 0.16;

  return [chosen[0] * tone, chosen[1] * tone, chosen[2] * tone];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

// Value noise on a lattice that wraps, so a texture that repeats stays seamless.
function wrappingNoise(width: number, height: number, cell: number, random: () => number): (x: number, y: number) => number {
  const columns = width / cell;
  const rows = height / cell;
  const lattice = Array.from({ length: columns * rows }, () => random());

  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothstep(0, 1, fx - x0);
    const ty = smoothstep(0, 1, fy - y0);
    const at = (column: number, row: number) => lattice[(((row % rows) + rows) % rows) * columns + (((column % columns) + columns) % columns)];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;

    return top + (bottom - top) * ty;
  };
}

interface Relief {
  // Rim height of a stone above the joint, in pixels.
  dome: number;
  rim: number;
  roughness: number;
  joint: number;
  seed: number;
}

// Paints the cells and returns the colour picture and the normal map, both `width` by `height`.
function paintStones(width: number, height: number, cells: Cell[], relief: Relief, anisotropy: number): StoneTextures {
  const random = mulberry32(relief.seed);
  const heights = new Float32Array(width * height);
  const colors = new Float32Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    colors[index * 3] = MORTAR[0];
    colors[index * 3 + 1] = MORTAR[1];
    colors[index * 3 + 2] = MORTAR[2];
  }

  const coarse = wrappingNoise(width, height, 32, random);
  const medium = wrappingNoise(width, height, 8, random);
  const fine = wrappingNoise(width, height, 2, random);
  const halfJoint = relief.joint / 2;
  for (const cell of cells) {
    const left = cell.x + halfJoint;
    const right = cell.x + cell.width - halfJoint;
    const top = cell.y + halfJoint;
    const bottom = cell.y + cell.height - halfJoint;
    const tilt = (random() - 0.5) * 0.5;
    for (let y = Math.max(0, Math.ceil(top)); y < Math.min(height, bottom); y += 1) {
      for (let x = Math.max(0, Math.ceil(left)); x < Math.min(width, right); x += 1) {
        const edge = Math.min(x + 0.5 - left, right - x - 0.5, y + 0.5 - top, bottom - y - 0.5);
        const rise = smoothstep(0, relief.rim, edge);
        const face = rise * relief.dome + (coarse(x, y) - 0.5) * relief.roughness * 2 + (medium(x, y) - 0.5) * relief.roughness + (fine(x, y) - 0.5) * relief.roughness * 0.4;
        const index = y * width + x;
        heights[index] = face + tilt * ((x - left) / (right - left) - 0.5) * relief.dome;
        const grain = 0.94 + coarse(x + 17, y + 5) * 0.12 + (fine(x, y) - 0.5) * 0.1;
        colors[index * 3] = cell.color[0] * grain;
        colors[index * 3 + 1] = cell.color[1] * grain;
        colors[index * 3 + 2] = cell.color[2] * grain;
      }
    }
  }

  const colorData = new Uint8ClampedArray(width * height * 4);
  const normalData = new Uint8ClampedArray(width * height * 4);
  const heightAt = (x: number, y: number) => heights[((y + height) % height) * width + ((x + width) % width)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slopeX = (heightAt(x + 1, y) - heightAt(x - 1, y)) / 2;
      const slopeY = (heightAt(x, y + 1) - heightAt(x, y - 1)) / 2;
      // The light comes from above and a little to the left, so an upward-facing slope is bright.
      const light = 1 + 0.55 * (0.9 * slopeY + 0.4 * slopeX);
      const index = y * width + x;
      const pixel = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        colorData[pixel + channel] = colors[index * 3 + channel] * light;
      }

      colorData[pixel + 3] = 255;
      const nx = -slopeX * 0.9;
      const ny = slopeY * 0.9;
      const length = Math.hypot(nx, ny, 1);
      normalData[pixel] = (nx / length) * 127.5 + 127.5;
      normalData[pixel + 1] = (ny / length) * 127.5 + 127.5;
      normalData[pixel + 2] = (1 / length) * 127.5 + 127.5;
      normalData[pixel + 3] = 255;
    }
  }

  const [colorCanvas, colorContext] = paintCanvas(width, height);
  colorContext.putImageData(new ImageData(colorData, width, height), 0, 0);
  const [normalCanvas, normalContext] = paintCanvas(width, height);
  normalContext.putImageData(new ImageData(normalData, width, height), 0, 0);
  const normalMap = finish(normalCanvas, anisotropy);
  normalMap.colorSpace = NoColorSpace;

  return { map: finish(colorCanvas, anisotropy), normalMap };
}

// Ashlar courses for walls and piers. `size` is the canvas edge in pixels and covers STONE_TILE.
export function createStoneTextures(size: number, anisotropy: number): StoneTextures {
  const random = mulberry32(31);
  const pixelsPerMetre = size / STONE_TILE;
  const cells: Cell[] = [];
  for (const course of layCourses(7)) {
    for (const block of course.blocks) {
      const color = pickStone(random, WALL_STONES);
      for (const wrap of [-1, 0, 1]) {
        const x = (block.x + wrap * STONE_TILE) * pixelsPerMetre;
        const width = block.width * pixelsPerMetre;
        if (x + width > 0 && x < size) {
          cells.push({ x, y: course.y * pixelsPerMetre, width, height: course.height * pixelsPerMetre, color });
        }
      }
    }
  }

  const scale = size / 1024;

  return paintStones(size, size, cells, { dome: 3.4 * scale, rim: 7 * scale, roughness: 0.9 * scale, joint: Math.max(2.5, 4.5 * scale), seed: 11 }, anisotropy);
}

// Radial voussoirs above a row of slabs for the cornice and the coping.
export function createTrimTextures(anisotropy: number): StoneTextures {
  const random = mulberry32(53);
  const cells: Cell[] = [];
  const voussoirWidth = TRIM.width / TRIM.voussoirCells;
  for (let index = 0; index < TRIM.voussoirCells; index += 1) {
    cells.push({ x: index * voussoirWidth, y: 0, width: voussoirWidth, height: TRIM.voussoirHeight, color: pickStone(random, TRIM_STONES) });
  }

  const slabWidth = TRIM.width / TRIM.slabCount;
  for (let index = 0; index < TRIM.slabCount; index += 1) {
    cells.push({ x: index * slabWidth, y: TRIM.voussoirHeight, width: slabWidth, height: TRIM.slabHeight, color: pickStone(random, SLAB_STONES) });
  }

  return paintStones(TRIM.width, TRIM.height, cells, { dome: 3, rim: 6, roughness: 0.7, joint: 3.5, seed: 17 }, anisotropy);
}
