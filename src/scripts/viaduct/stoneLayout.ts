// How the viaduct's stones are laid out in its two textures. Pure: the painter in stonework.ts
// draws this layout and viaductMesh.ts maps the walls onto it, so the stones keep their real size.

import { mulberry32 } from '../river/world.ts';

// The wall texture repeats every STONE_TILE metres, both ways. The walls map to it by world
// height and distance along the line, so courses stay level and a pier and the spandrel above it
// share their courses.
export const STONE_TILE = 6.4;
const COURSES = 17;
const COURSE_SPREAD = 0.3;
const BLOCK_MIN = 0.4;
const BLOCK_MAX = 1;
const BLOCK_ATTEMPTS = 200;
export const MIN_STAGGER = 0.2;

export interface StoneBlock {
  x: number;
  width: number;
}

export interface StoneCourse {
  y: number;
  height: number;
  // A block may run past STONE_TILE: it wraps round to the start of the course.
  blocks: StoneBlock[];
}

export function layCourses(seed: number): StoneCourse[] {
  const random = mulberry32(seed);
  const raw = Array.from({ length: COURSES }, () => 1 - COURSE_SPREAD / 2 + random() * COURSE_SPREAD);
  const total = raw.reduce((sum, value) => sum + value, 0);
  const courses: StoneCourse[] = [];
  let y = 0;
  for (const [index, value] of raw.entries()) {
    const height = (value / total) * STONE_TILE;
    const below = index > 0 ? courses[index - 1].blocks : [];
    // The tile repeats upwards, so the last course also sits under the first.
    const avoid = (index === raw.length - 1 ? [...below, ...courses[0].blocks] : below).map((block) => block.x);
    courses.push({ y, height, blocks: cutCourse(random, avoid) });
    y += height;
  }

  return courses;
}

// The signed distance from `joint` to `x` going round the tile, between -half and +half a tile.
function gapAround(x: number, joint: number): number {
  const gap = (((x - joint) % STONE_TILE) + STONE_TILE) % STONE_TILE;

  return gap > STONE_TILE / 2 ? gap - STONE_TILE : gap;
}

// Moves a joint up, just clear of the joints below it, if it is too close to one.
function clearOf(x: number, avoid: number[]): number {
  let moved = x;
  for (let pass = 0; pass < avoid.length; pass += 1) {
    const close = avoid.find((joint) => Math.abs(gapAround(moved, joint)) < MIN_STAGGER);
    if (close === undefined) {
      break;
    }

    moved += MIN_STAGGER - gapAround(moved, close);
  }

  return moved;
}

// One course of blocks that wraps round the tile, its joints away from `avoid`. Tries again with
// new blocks if the last joint cannot be placed clear.
function cutCourse(random: () => number, avoid: number[]): StoneBlock[] {
  let blocks: StoneBlock[] = [];
  for (let attempt = 0; attempt < BLOCK_ATTEMPTS; attempt += 1) {
    const start = clearOf(random() * BLOCK_MAX, avoid);
    blocks = [];
    let x = start;
    while (start + STONE_TILE - x > BLOCK_MAX) {
      const room = start + STONE_TILE - x - BLOCK_MIN;
      const next = clearOf(x + Math.min(room, BLOCK_MIN + random() * (BLOCK_MAX - BLOCK_MIN)), avoid);
      blocks.push({ x, width: next - x });
      x = next;
    }

    blocks.push({ x, width: start + STONE_TILE - x });
    const fits = blocks.every((block) => block.width >= BLOCK_MIN * 0.9 && block.width <= BLOCK_MAX * 1.2);
    const staggered = blocks.every((block) => block.x === start || avoid.every((joint) => Math.abs(gapAround(block.x, joint)) >= MIN_STAGGER));
    if (fits && staggered) {
      break;
    }
  }

  return blocks;
}

// The trim texture: radial voussoirs side by side above a row of slabs for the cornice and the
// coping. Cells are laid out left to right; the slab row wraps every SLAB_COUNT slabs.
export const TRIM = {
  width: 768,
  height: 128,
  voussoirCells: 16,
  voussoirHeight: 96,
  slabCount: 4,
  slabHeight: 32,
} as const;
// A slab is this long on the wall, and a voussoir this wide, in metres.
export const SLAB_LENGTH = 1.2;
export const SLAB_THICKNESS = 0.2;
export const TRIM_REPEAT = TRIM.slabCount * SLAB_LENGTH;
// The texture rows (0 at the bottom edge) the slabs and the voussoirs occupy.
export const SLAB_V: [number, number] = [0.01, TRIM.slabHeight / TRIM.height - 0.01];
export const VOUSSOIR_V: [number, number] = [TRIM.slabHeight / TRIM.height + 0.01, 0.99];
