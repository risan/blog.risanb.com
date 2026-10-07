// The livery of the Bernina Express, painted on a canvas at load time like the other textures of
// the scene: the side picture of each vehicle, the cab front of a locomotive and the white block
// that plain parts point at. liveryLayout.ts says where each of them sits. Every length below is
// in metres; the painter scales it to pixels.

import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { liveryLayout, VEHICLE_HALF_WIDTH, type LiveryLayout } from './liveryLayout.ts';
import { finish, paintCanvas } from './textures.ts';
import { END_OVERHANG, type VehicleSpec } from './train.ts';
import {
  HEAD_LAMPS,
  LOCOMOTIVE_WINDOW_BOTTOM,
  LOCOMOTIVE_WINDOW_TOP,
  LOCOMOTIVE_WINDOWS,
  PANORAMA_WINDOW_BOTTOM,
  PANORAMA_WINDOWS,
} from './trainMesh.ts';

const RED = '#c8141b';
const DARK_RED = '#8f0f14';
const SKIRT = '#3a3c40';
const SILVER = '#b4babd';
const CHEAT_LINE = '#efece6';
const LIGHT_GREY = '#cfd2d4';
const WINDOW_FRAME = '#1b2024';
const WINDOW_PANE = '#27323a';
const YELLOW = '#f0b90b';
const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

// Everything is placed by the column (along) and row (down) of the atlas, in metres.
interface Brush {
  context: CanvasRenderingContext2D;
  ppm: number;
}

function fill(brush: Brush, color: string, column: number, row: number, width: number, height: number) {
  brush.context.fillStyle = color;
  brush.context.fillRect(column * brush.ppm, row * brush.ppm, width * brush.ppm, height * brush.ppm);
}

// Text whose letters are `size` metres tall; with `width` it is squeezed or stretched to fit.
function write(brush: Brush, text: string, column: number, baseline: number, size: number, color: string, options: { width?: number; weight?: string; align?: CanvasTextAlign } = {}) {
  const { context, ppm } = brush;
  context.save();
  context.translate(column * ppm, baseline * ppm);
  const unit = (size * ppm) / 100;
  context.scale(unit, unit);
  context.font = `${options.weight ?? '700'} 100px ${FONT}`;
  context.textBaseline = 'alphabetic';
  context.textAlign = options.align ?? 'left';
  if (options.width !== undefined) {
    const measured = context.measureText(text).width;
    context.scale((options.width * ppm) / unit / measured, 1);
  }

  context.fillStyle = color;
  context.fillText(text, 0, 0);
  context.restore();
}

function roundedRect(brush: Brush, color: string, column: number, row: number, width: number, height: number, radius: number) {
  const { context, ppm } = brush;
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(column * ppm, row * ppm, width * ppm, height * ppm, radius * ppm);
  context.fill();
}

// The mark of the Rhaetian Railway, simplified: white letters on a red swoosh over a white bar.
function railwayLogo(brush: Brush, column: number, row: number, width: number) {
  const { context, ppm } = brush;
  const height = width * 0.3;
  context.save();
  context.translate(column * ppm, row * ppm);
  context.transform(1, 0, -0.25, 1, 0, 0);
  context.fillStyle = '#f4f1ea';
  context.beginPath();
  context.roundRect(0, 0, width * ppm, height * ppm, height * ppm * 0.3);
  context.fill();
  context.fillStyle = RED;
  context.beginPath();
  context.moveTo(width * ppm * 0.04, height * ppm * 0.78);
  context.quadraticCurveTo(width * ppm * 0.5, height * ppm * 0.45, width * ppm * 0.96, height * ppm * 0.7);
  context.lineTo(width * ppm * 0.96, height * ppm * 0.88);
  context.quadraticCurveTo(width * ppm * 0.5, height * ppm * 0.6, width * ppm * 0.04, height * ppm * 0.92);
  context.fill();
  context.restore();
  write(brush, 'RhB', column + width * 0.14, row + height * 0.62, height * 0.5, RED, { width: width * 0.7 });
}

// The Bernina Express mark, simplified: a yellow edelweiss with a pale heart.
function flower(brush: Brush, column: number, row: number, radius: number) {
  const { context, ppm } = brush;
  context.save();
  context.translate(column * ppm, row * ppm);
  context.fillStyle = '#f6c21a';
  for (let petal = 0; petal < 8; petal += 1) {
    context.save();
    context.rotate((petal / 8) * Math.PI * 2);
    context.beginPath();
    context.ellipse(0, -radius * 0.62 * ppm, radius * 0.24 * ppm, radius * 0.45 * ppm, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  context.fillStyle = '#e48a12';
  context.beginPath();
  context.arc(0, 0, radius * 0.3 * ppm, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// The coat of arms of Graubünden, simplified: a shield in three fields.
function coatOfArms(brush: Brush, column: number, row: number, width: number, height: number) {
  const { context, ppm } = brush;
  context.save();
  context.translate(column * ppm, row * ppm);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width * ppm, 0);
  context.lineTo(width * ppm, height * ppm * 0.55);
  context.quadraticCurveTo(width * ppm, height * ppm * 0.9, (width * ppm) / 2, height * ppm);
  context.quadraticCurveTo(0, height * ppm * 0.9, 0, height * ppm * 0.55);
  context.closePath();
  context.fillStyle = '#f4f1ea';
  context.fill();
  context.clip();
  context.fillStyle = '#e9b930';
  context.fillRect(0, 0, (width * ppm) / 2, height * ppm * 0.5);
  context.fillStyle = '#3d6a98';
  context.fillRect((width * ppm) / 2, 0, (width * ppm) / 2, height * ppm * 0.5);
  context.fillStyle = '#1d1d1f';
  context.beginPath();
  context.ellipse(width * ppm * 0.5, height * ppm * 0.75, width * ppm * 0.2, height * ppm * 0.17, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.ellipse(width * ppm * 0.25, height * ppm * 0.25, width * ppm * 0.11, height * ppm * 0.15, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function verticalLine(brush: Brush, color: string, column: number, row: number, height: number, thickness = 0.025) {
  fill(brush, color, column - thickness / 2, row, thickness, height);
}

function windowRecess(brush: Brush, column: number, row: number, width: number, height: number) {
  fill(brush, WINDOW_FRAME, column - 0.04, row - 0.04, width + 0.08, height + 0.08);
  fill(brush, WINDOW_PANE, column, row, width, height);
}

function paintLocomotiveSide(brush: Brush, layout: LiveryLayout) {
  const column = (p: number) => END_OVERHANG + p;
  const row = (y: number) => layout.wallTop - y;
  fill(brush, RED, 0, 0, layout.width, layout.wallTop - layout.wallBottom);
  fill(brush, SKIRT, 0, row(1.25), layout.width, 1.25 - layout.wallBottom);
  fill(brush, CHEAT_LINE, 0, row(1.34), layout.width, 0.09);
  fill(brush, '#2d2f33', 0, row(0.95), layout.width, 0.025);
  for (const p of [2.0, 8.0, 8.5, 10.1, 10.6, 15.0]) {
    verticalLine(brush, '#2d2f33', column(p), row(1.25), 0.65);
  }

  for (const [p0, p1] of LOCOMOTIVE_WINDOWS) {
    windowRecess(brush, column(p0), row(LOCOMOTIVE_WINDOW_TOP), p1 - p0, LOCOMOTIVE_WINDOW_TOP - LOCOMOTIVE_WINDOW_BOTTOM);
  }

  // The sliding door between the two halves of the car body.
  fill(brush, '#a9aeb1', column(9.05), row(3.1), 0.9, 3.1 - 1.25);
  verticalLine(brush, '#3b3e41', column(9.5), row(3.1), 3.1 - 1.25, 0.03);
  verticalLine(brush, '#6c7073', column(9.05), row(3.1), 3.1 - 1.25, 0.02);
  verticalLine(brush, '#6c7073', column(9.95), row(3.1), 3.1 - 1.25, 0.02);
  verticalLine(brush, '#dfe2e3', column(9.13), row(2.85), 1.2, 0.03);
  verticalLine(brush, '#dfe2e3', column(9.87), row(2.85), 1.2, 0.03);

  // Equipment doors, with the yellow stripe over the first class windows.
  for (const [p, width] of [[2.2, 1.7], [11.0, 1.4], [13.0, 1.5]] as const) {
    fill(brush, DARK_RED, column(p), row(1.3), width, 0.02);
  }

  fill(brush, YELLOW, column(10.4), row(3.05), 3.6, 0.07);
  write(brush, '2', column(8.75), row(2.4), 0.22, '#f4f1ea', { align: 'center' });
  write(brush, '1', column(10.35), row(2.4), 0.22, '#f4f1ea', { align: 'center' });
  fill(brush, YELLOW, column(11.0), row(1.8), 0.34, 0.16);

  railwayLogo(brush, column(1.75), row(1.85), 0.95);
  write(brush, 'Rhätische Bahn', column(2.9), row(1.6), 0.2, '#f4f1ea', { width: 2.15 });
  write(brush, 'ABe 4/4 III', column(12.7), row(1.5), 0.09, '#f4f1ea', { weight: '500', width: 0.7 });
}

function paintLocomotiveFront(brush: Brush, layout: LiveryLayout, number: number) {
  if (layout.frontRow === null) {
    return;
  }

  const row = (y: number) => (layout.frontRow ?? 0) + (layout.frontTop - y);
  const width = 2 * VEHICLE_HALF_WIDTH;
  fill(brush, RED, 0, row(layout.frontTop), width, layout.frontTop - layout.frontBottom);
  fill(brush, SILVER, 0, row(layout.frontTop), width, layout.frontTop - 3.4);
  fill(brush, SKIRT, 0, row(1.25), width, 1.25 - layout.frontBottom);
  fill(brush, '#a3a8ab', 0, row(0.72), width, 0.72 - layout.frontBottom);
  fill(brush, CHEAT_LINE, 0, row(1.34), width, 0.09);

  // The two windscreens, with their wipers and the glint of the sky.
  for (const [left, wiperFrom, wiperTo] of [[0.38, 0.5, 1.1], [1.45, 2.15, 1.55]] as const) {
    const top = 3.0;
    const bottom = 2.2;
    const windscreen = 0.82;
    fill(brush, '#101316', left - 0.05, row(top + 0.05), windscreen + 0.1, top - bottom + 0.1);
    const { context, ppm } = brush;
    const gradient = context.createLinearGradient(0, row(top) * ppm, 0, row(bottom) * ppm);
    gradient.addColorStop(0, '#5f7a90');
    gradient.addColorStop(0.55, '#2c3b47');
    gradient.addColorStop(1, '#161d23');
    context.fillStyle = gradient;
    context.fillRect(left * ppm, row(top) * ppm, windscreen * ppm, (top - bottom) * ppm);
    context.fillStyle = 'rgba(190, 210, 228, 0.28)';
    context.beginPath();
    context.moveTo((left + 0.1) * ppm, row(top) * ppm);
    context.lineTo((left + 0.38) * ppm, row(top) * ppm);
    context.lineTo((left + 0.12) * ppm, row(bottom) * ppm);
    context.lineTo(left * ppm, row(bottom) * ppm);
    context.fill();
    context.strokeStyle = '#0c0e10';
    context.lineWidth = 0.025 * ppm;
    context.beginPath();
    context.moveTo(wiperFrom * ppm, row(bottom + 0.02) * ppm);
    context.lineTo(wiperTo * ppm, row(top - 0.1) * ppm);
    context.stroke();
  }

  // Head lamps: the housings and their unlit lenses (the lit ones are drawn over them).
  for (const lamp of HEAD_LAMPS) {
    const centre = VEHICLE_HALF_WIDTH - lamp.z;
    roundedRect(brush, '#2a2c2f', centre - lamp.width * 0.65, row(lamp.y + lamp.height * 0.85), lamp.width * 1.3, lamp.height * 1.7, 0.03);
    roundedRect(brush, '#d4d8da', centre - lamp.width / 2, row(lamp.y + lamp.height / 2), lamp.width, lamp.height, 0.02);
  }

  for (const centre of [0.5, 2.15]) {
    roundedRect(brush, '#e7a21c', centre - 0.07, row(3.29), 0.14, 0.1, 0.02);
  }

  roundedRect(brush, '#e7a21c', 0.45, row(1.45), 0.1, 0.07, 0.02);
  coatOfArms(brush, 0.62, row(2.2), 0.4, 0.5);
  write(brush, String(number), 1.55, row(1.85), 0.38, '#f4f1ea', { width: 0.58 });

  // The snowplough plate and the coupler between the lamps.
  fill(brush, '#93989b', 0.95, row(1.2), 0.75, 0.48);
  fill(brush, '#2a2c2f', 1.25, row(0.95), 0.15, 0.2);
  for (const handrail of [0.42, 2.23]) {
    verticalLine(brush, '#8f9396', handrail, row(2.2), 0.8, 0.03);
  }
}

function paintPanoramaSide(brush: Brush, layout: LiveryLayout) {
  const column = (p: number) => END_OVERHANG + p;
  const row = (y: number) => layout.wallTop - y;
  fill(brush, RED, 0, 0, layout.width, layout.wallTop - layout.wallBottom);
  fill(brush, SKIRT, 0, row(0.62), layout.width, 0.62 - layout.wallBottom);
  fill(brush, LIGHT_GREY, column(0.15), row(1.46), 14.65, 0.08);

  for (const p of [3.9, 5.9, 7.6, 9.3, 11.5]) {
    verticalLine(brush, DARK_RED, column(p), row(1.2), 0.58);
  }

  fill(brush, DARK_RED, column(3.9), row(1.2), 7.6, 0.02);

  for (const [p0, p1] of PANORAMA_WINDOWS) {
    windowRecess(brush, column(p0), row(3.02), p1 - p0, 3.02 - PANORAMA_WINDOW_BOTTOM);
  }

  windowRecess(brush, column(0.68), row(2.55), 0.54, 0.8);

  // The door at the far end: a light leaf with its small window and handle.
  fill(brush, '#d3d6d8', column(14.85), row(2.95), 0.8, 2.95 - 0.55);
  verticalLine(brush, '#8a9094', column(14.85), row(2.95), 2.4, 0.02);
  verticalLine(brush, '#8a9094', column(15.65), row(2.95), 2.4, 0.02);
  windowRecess(brush, column(14.97), row(2.6), 0.56, 0.85);
  fill(brush, '#4a4d50', column(15.5), row(1.2), 0.04, 0.3);
  write(brush, 'Rhätische Bahn', column(14.9), row(1.2), 0.06, DARK_RED, { weight: '500', width: 0.55 });

  write(brush, '2', column(13.24), row(2.2), 0.3, '#f4f1ea', { align: 'center' });
  write(brush, 'graubünden', column(0.55), row(1.52), 0.1, '#f4f1ea', { weight: '500', width: 0.75 });
  flower(brush, column(4.3), row(1.0), 0.2);
  verticalLine(brush, '#f8f6f0', column(4.62), row(1.15), 0.3, 0.02);
  write(brush, 'Bernina Express', column(4.78), row(0.88), 0.46, '#f8f6f0', { width: 3.8, weight: '600' });
}

function paintSolid(brush: Brush, layout: LiveryLayout) {
  fill(brush, '#ffffff', layout.solidColumn - 0.05, layout.solidRow - 0.05, layout.solidSize + 0.1, layout.solidSize + 0.1);
}

// The livery of one vehicle, as a texture. `pixelWidth` is the width of the whole atlas.
export function createLiveryTexture(spec: VehicleSpec, pixelWidth: number, anisotropy: number): CanvasTexture {
  const layout = liveryLayout(spec);
  const ppm = pixelWidth / layout.width;
  const [canvas, context] = paintCanvas(pixelWidth, Math.ceil(layout.height * ppm));
  const brush: Brush = { context, ppm };
  context.fillStyle = SKIRT;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (spec.kind === 'locomotive') {
    paintLocomotiveSide(brush, layout);
    paintLocomotiveFront(brush, layout, spec.number ?? 0);
  } else {
    paintPanoramaSide(brush, layout);
  }

  paintSolid(brush, layout);

  return finish(canvas, anisotropy, false);
}

// A soft sky for the glass to reflect: pale blue overhead, hazy at the horizon, dull ground below.
export function createSkyReflection(): CanvasTexture {
  const [canvas, context] = paintCanvas(256, 128);
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#6f9bd0');
  gradient.addColorStop(0.4, '#b8cde0');
  gradient.addColorStop(0.5, '#e4edf3');
  gradient.addColorStop(0.52, '#7d8a72');
  gradient.addColorStop(1, '#3c4634');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;

  return texture;
}
