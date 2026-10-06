// Textures painted at load time, so the section ships no image for the masonry. The grass and
// scree detail comes from the CC0 photographs in static/river/, flattened to a neutral tone so the
// vertex colours decide the hue.

import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { mulberry32 } from '../river/world.ts';

function paintCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('viaduct: 2D canvas is not available');
  }

  return [canvas, context];
}

function finish(canvas: HTMLCanvasElement, anisotropy: number, repeat = true): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;

  return texture;
}

function stoneColor(random: () => number, base: number, warmth: number): string {
  const lightness = base + (random() - 0.5) * 34;
  const red = lightness + warmth * (random() * 14 + 2);
  const green = lightness + warmth * (random() * 8);
  const blue = lightness - warmth * (random() * 8 + 2) + (1 - warmth) * 6;

  return `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
}

// Irregular courses of grey granite with mortar joints. It tiles on both axes.
export function createMasonryTexture(anisotropy: number): CanvasTexture {
  const size = 512;
  const [canvas, context] = paintCanvas(size, size);
  const random = mulberry32(5);
  const courseHeights = [48, 56, 44, 60, 52, 48, 58, 50, 46, 50];
  context.fillStyle = '#7c776e';
  context.fillRect(0, 0, size, size);

  let y = 0;
  for (const height of courseHeights) {
    // The blocks of a course add up to exactly the tile's width, so the tile repeats seamlessly.
    const widths: number[] = [];
    let total = 0;
    while (total < size - 54) {
      const width = 54 + Math.floor(random() * 78);
      widths.push(width);
      total += width;
    }

    const stretch = size / total;
    let x = 0;
    for (const rawWidth of widths) {
      const width = rawWidth * stretch;
      context.fillStyle = stoneColor(random, 168, 0.6 + random() * 0.4);
      context.fillRect(x + 1.5, y + 1.5, width - 3, height - 3);
      context.fillStyle = 'rgba(255, 252, 244, 0.22)';
      context.fillRect(x + 1.5, y + 1.5, width - 3, 3);
      context.fillStyle = 'rgba(40, 34, 28, 0.2)';
      context.fillRect(x + 1.5, y + height - 5.5, width - 3, 4);
      x += width;
    }

    y += height;
  }

  const image = context.getImageData(0, 0, size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = (random() - 0.5) * 22;
    image.data[index] += grain;
    image.data[index + 1] += grain;
    image.data[index + 2] += grain;
  }

  context.putImageData(image, 0, 0);

  return finish(canvas, anisotropy);
}

// Eight radial stones side by side, lighter than the walls; the coordinate wraps every eight.
export function createVoussoirTexture(anisotropy: number): CanvasTexture {
  const width = 512;
  const height = 64;
  const [canvas, context] = paintCanvas(width, height);
  const random = mulberry32(9);
  context.fillStyle = '#8b867c';
  context.fillRect(0, 0, width, height);
  const blocks = 8;
  for (let index = 0; index < blocks; index += 1) {
    context.fillStyle = stoneColor(random, 198, 0.7);
    context.fillRect((index * width) / blocks + 2, 3, width / blocks - 4, height - 6);
    context.fillStyle = 'rgba(255, 252, 244, 0.2)';
    context.fillRect((index * width) / blocks + 2, 3, width / blocks - 4, 4);
  }

  return finish(canvas, anisotropy);
}

export function createGravelTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const [canvas, context] = paintCanvas(size, size);
  const random = mulberry32(21);
  context.fillStyle = '#c9c3b6';
  context.fillRect(0, 0, size, size);
  for (let index = 0; index < 5200; index += 1) {
    const tone = 150 + random() * 100;
    context.fillStyle = `rgb(${tone + 8}, ${tone + 2}, ${tone - 8})`;
    const radius = 0.7 + random() * 1.8;
    context.fillRect(random() * size, random() * size, radius, radius * (0.6 + random() * 0.6));
  }

  return finish(canvas, anisotropy);
}

// Loads a photograph, strips its colour and scales it so its average brightness is `mean`, which
// leaves only the detail: it multiplies the vertex colours without shifting their hue or value.
export async function loadDetailTexture(url: string, mean: number, contrast: number, anisotropy: number): Promise<Texture> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`viaduct: could not load ${url}`));
    element.src = url;
  });
  const size = 512;
  const [canvas, context] = paintCanvas(size, size);
  context.drawImage(image, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size);
  let total = 0;
  for (let index = 0; index < data.data.length; index += 4) {
    total += 0.299 * data.data[index] + 0.587 * data.data[index + 1] + 0.114 * data.data[index + 2];
  }

  const gain = (mean * 255 * size * size) / total;
  for (let index = 0; index < data.data.length; index += 4) {
    const grey = (0.299 * data.data[index] + 0.587 * data.data[index + 1] + 0.114 * data.data[index + 2]) * gain;
    const value = Math.min(255, Math.max(0, mean * 255 + (grey - mean * 255) * contrast));
    data.data[index] = value;
    data.data[index + 1] = value;
    data.data[index + 2] = value;
  }

  context.putImageData(data, 0, 0);

  return finish(canvas, anisotropy);
}

// Angular loose stones of many greys and beiges, each with a light upper edge and a dark lower
// one, drawn over a dark base so the gaps read as shadow. It tiles on both axes.
export function createScreeTexture(anisotropy: number): CanvasTexture {
  const size = 512;
  const [canvas, context] = paintCanvas(size, size);
  const random = mulberry32(44);
  context.fillStyle = '#6f685c';
  context.fillRect(0, 0, size, size);

  for (let index = 0; index < 1500; index += 1) {
    const cx = random() * size;
    const cy = random() * size;
    const radius = 5 + random() * random() * 26;
    const sides = 5 + Math.floor(random() * 3);
    const tilt = random() * Math.PI;
    const points: [number, number][] = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = tilt + (side / sides) * Math.PI * 2 + (random() - 0.5) * 0.7;
      const reach = radius * (0.65 + random() * 0.45);
      points.push([Math.cos(angle) * reach, Math.sin(angle) * reach * 0.75]);
    }

    const tone = 120 + random() * 120;
    const warm = random();
    for (const [dx, dy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < -radius * 2 || x > size + radius * 2 || y < -radius * 2 || y > size + radius * 2) {
        continue;
      }

      const trace = () => {
        context.beginPath();
        points.forEach(([px, py], pointIndex) => {
          if (pointIndex === 0) {
            context.moveTo(x + px, y + py);
          } else {
            context.lineTo(x + px, y + py);
          }
        });
        context.closePath();
      };
      trace();
      context.fillStyle = `rgb(${tone + warm * 14}, ${tone + warm * 7}, ${tone - warm * 12})`;
      context.fill();
      context.strokeStyle = 'rgba(30, 26, 20, 0.5)';
      context.lineWidth = 1.4;
      context.stroke();
      context.save();
      context.translate(x, y);
      context.fillStyle = 'rgba(255, 250, 240, 0.28)';
      context.beginPath();
      context.moveTo(points[0][0] * 0.9, points[0][1] * 0.9);
      context.lineTo(points[1][0] * 0.9, points[1][1] * 0.9);
      context.lineTo(0, 0);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  return finish(canvas, anisotropy);
}
