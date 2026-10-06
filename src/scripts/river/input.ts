// Pointer input: a tap drops a ripple, dragging stirs the water along the path. Positions are
// turned into the point of the water surface under the pointer.

import { screenToWater, type Camera } from './camera.ts';

export type Stir = (x: number, y: number, strength: number) => void;

const SPACING = 0.14;
const MAX_POINTS_PER_EVENT = 8;

export function attachInput(canvas: HTMLCanvasElement, camera: () => Camera, stir: Stir): void {
  let activePointer = -1;
  let lastX = 0;
  let lastY = 0;
  const world = { x: 0, y: 0 };

  function toWorld(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    screenToWater(camera(), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, world);
  }

  function onDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    activePointer = event.pointerId;
    toWorld(event);
    lastX = world.x;
    lastY = world.y;
    stir(world.x, world.y, 1);
    if (event.pointerType === 'mouse') {
      canvas.setPointerCapture(event.pointerId);
    }
  }

  function onMove(event: PointerEvent) {
    if (event.pointerId !== activePointer) {
      return;
    }

    toWorld(event);
    const distance = Math.hypot(world.x - lastX, world.y - lastY);
    const points = Math.min(MAX_POINTS_PER_EVENT, Math.floor(distance / SPACING));
    for (let index = 1; index <= points; index += 1) {
      const share = index / points;
      stir(lastX + (world.x - lastX) * share, lastY + (world.y - lastY) * share, 0.45);
    }

    if (points > 0) {
      lastX = world.x;
      lastY = world.y;
    }
  }

  function onEnd(event: PointerEvent) {
    if (event.pointerId === activePointer) {
      activePointer = -1;
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
}
