// The canopy of the far forest, painted at load time: a grey tile of tree crowns seen from above,
// light on top and dark between. The terrain colour gives the hue, and the shader multiplies the
// two over the forested mountain sides, so the slopes read as treetops from afar.

import type { CanvasTexture } from 'three';
import { mulberry32 } from '../river/world.ts';
import { finish, paintCanvas } from './textures.ts';

export const CANOPY_TILE_METRES = 16;

export function createCanopyTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const [canvas, context] = paintCanvas(size, size);
  const random = mulberry32(61);
  context.fillStyle = '#6a6a6a';
  context.fillRect(0, 0, size, size);
  // Crowns are drawn again at the edges so the tile repeats without a seam.
  const offsets = [-size, 0, size];
  for (let index = 0; index < 34; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 26 + random() * 30;
    const light = 175 + random() * 70;
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const centreX = x + offsetX;
        const centreY = y + offsetY;
        if (centreX < -radius || centreX > size + radius || centreY < -radius || centreY > size + radius) {
          continue;
        }

        const crown = context.createRadialGradient(centreX - radius * 0.3, centreY - radius * 0.35, radius * 0.1, centreX, centreY, radius);
        crown.addColorStop(0, `rgb(${light}, ${light}, ${light})`);
        crown.addColorStop(0.7, `rgb(${light * 0.62}, ${light * 0.62}, ${light * 0.62})`);
        crown.addColorStop(1, 'rgba(60, 60, 60, 0.9)');
        context.fillStyle = crown;
        context.beginPath();
        context.arc(centreX, centreY, radius, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  return finish(canvas, anisotropy);
}
