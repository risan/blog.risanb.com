// The textures of the village houses, painted at load time like the masonry: an atlas of wall bays
// (a window with shutters, a plain window, a door, and bare wall, each in plaster and in stone)
// and a tile of grey slate for the roofs.

import { CanvasTexture } from 'three';
import { mulberry32 } from '../river/world.ts';
import { finish, paintCanvas } from './textures.ts';

export const BAY_COLUMNS = 4;
export const BAY_ROWS = 3;
// The kinds of bay, as columns of the atlas.
export const BAY_SHUTTERED = 0;
export const BAY_SHUTTERED_BROWN = 1;
export const BAY_PLAIN = 2;
export const BAY_DOOR = 3;
// The last row holds bare wall: plaster first, then stone.
export const BAY_BARE_ROW = 2;
// Rows by wall material.
export const BAY_ROW_PLASTER = 0;
export const BAY_ROW_STONE = 1;

const CELL = 256;
// A bay is this wide and high in metres.
export const BAY_METRES = 3;

type Context = CanvasRenderingContext2D;

function paintPlaster(context: Context, random: () => number, x: number, y: number) {
  context.fillStyle = '#f1ede3';
  context.fillRect(x, y, CELL, CELL);
  for (let index = 0; index < 90; index += 1) {
    const tone = random() < 0.5 ? '255, 255, 250' : '120, 110, 90';
    context.fillStyle = `rgba(${tone}, ${0.04 + random() * 0.06})`;
    context.fillRect(x + random() * CELL, y + random() * CELL, 10 + random() * 44, 6 + random() * 30);
  }
}

function paintStone(context: Context, random: () => number, x: number, y: number) {
  context.fillStyle = '#7e786e';
  context.fillRect(x, y, CELL, CELL);
  const courses = 6;
  const height = CELL / courses;
  for (let course = 0; course < courses; course += 1) {
    let cursor = 0;
    while (cursor < CELL) {
      const width = Math.min(34 + random() * 46, CELL - cursor);
      const light = 150 + random() * 55;
      context.fillStyle = `rgb(${light + 8}, ${light + 3}, ${light - 8})`;
      context.fillRect(x + cursor + 1.5, y + course * height + 1.5, width - 3, height - 3);
      cursor += width;
    }
  }
}

function paintWindow(context: Context, x: number, y: number, shutters: string | undefined) {
  // 85 px to the metre: a window 0.95 m wide and 1.4 m high, with its sill, in the middle of the bay.
  const left = x + 88;
  const top = y + 50;
  const width = 80;
  const height = 120;
  if (shutters) {
    for (const side of [-1, 1]) {
      const shutterX = side < 0 ? left - 38 : left + width + 3;
      context.fillStyle = shutters;
      context.fillRect(shutterX, top - 2, 35, height + 4);
      context.fillStyle = 'rgba(0, 0, 0, 0.22)';
      for (let slat = 0; slat < height; slat += 9) {
        context.fillRect(shutterX + 2, top + slat + 4, 31, 2);
      }
    }
  }

  context.fillStyle = '#ffffff';
  context.fillRect(left - 5, top - 5, width + 10, height + 10);
  const glass = context.createLinearGradient(left, top, left + width, top + height);
  glass.addColorStop(0, '#46576a');
  glass.addColorStop(1, '#1f2833');
  context.fillStyle = glass;
  context.fillRect(left, top, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(left + width / 2 - 2, top, 4, height);
  context.fillRect(left, top + height * 0.42, width, 4);
  context.fillStyle = '#cfcac0';
  context.fillRect(left - 10, top + height + 5, width + 20, 9);
}

function paintDoor(context: Context, x: number, y: number) {
  const left = x + 94;
  const top = y + 82;
  const width = 68;
  const height = CELL - 82;
  context.fillStyle = '#f4f1ea';
  context.fillRect(left - 7, top - 7, width + 14, height + 7);
  context.fillStyle = '#5b3d29';
  context.fillRect(left, top, width, height);
  context.fillStyle = 'rgba(0, 0, 0, 0.25)';
  context.fillRect(left + width / 2 - 1, top, 2, height);
  context.fillStyle = '#2a323c';
  context.fillRect(left + 10, top + 12, width - 20, 28);
  context.fillStyle = '#b9b3a6';
  context.fillRect(left - 12, y + CELL - 8, width + 24, 8);
}

export function createFacadeAtlas(anisotropy: number): CanvasTexture {
  const [canvas, context] = paintCanvas(CELL * BAY_COLUMNS, CELL * BAY_ROWS);
  const random = mulberry32(31);
  const paintBase = [paintPlaster, paintStone];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < BAY_COLUMNS; column += 1) {
      const x = column * CELL;
      const y = row * CELL;
      paintBase[row](context, random, x, y);
      if (column === BAY_SHUTTERED) {
        paintWindow(context, x, y, '#4e6e47');
      } else if (column === BAY_SHUTTERED_BROWN) {
        paintWindow(context, x, y, '#7c4b2f');
      } else if (column === BAY_PLAIN) {
        paintWindow(context, x, y, undefined);
      } else {
        paintDoor(context, x, y);
      }
    }
  }

  paintPlaster(context, random, 0, BAY_BARE_ROW * CELL);
  paintStone(context, random, CELL, BAY_BARE_ROW * CELL);

  return finish(canvas, anisotropy, false);
}

// The centre of a cell of the atlas, as texture coordinates (v counts up from the bottom of the
// image, rows from the top), and the half-extent to stay inside so neighbours never show.
export function bayUv(column: number, row: number): { u0: number; u1: number; v0: number; v1: number } {
  const inset = 0.012;

  return {
    u0: column / BAY_COLUMNS + inset / BAY_COLUMNS,
    u1: (column + 1) / BAY_COLUMNS - inset / BAY_COLUMNS,
    v0: 1 - (row + 1) / BAY_ROWS + inset / BAY_ROWS,
    v1: 1 - row / BAY_ROWS - inset / BAY_ROWS,
  };
}

export const SLATE_METRES = 2.5;

// Courses of grey slabs; the roof's vertex colour tones it.
export function createSlateTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const [canvas, context] = paintCanvas(size, size);
  const random = mulberry32(37);
  context.fillStyle = '#4a4c50';
  context.fillRect(0, 0, size, size);
  const courses = 9;
  const height = size / courses;
  for (let course = 0; course < courses; course += 1) {
    const widths: number[] = [];
    let total = 0;
    while (total < size - 30) {
      const width = 30 + random() * 40;
      widths.push(width);
      total += width;
    }

    const stretch = size / total;
    let cursor = 0;
    for (const raw of widths) {
      const width = raw * stretch;
      const tone = 112 + random() * 52;
      context.fillStyle = `rgb(${tone}, ${tone + 2}, ${tone + 6})`;
      context.fillRect(cursor + 1, course * height + 1, width - 2, height - 3);
      context.fillStyle = 'rgba(0, 0, 0, 0.28)';
      context.fillRect(cursor + 1, course * height + height - 4, width - 2, 3);
      cursor += width;
    }
  }

  return finish(canvas, anisotropy);
}
