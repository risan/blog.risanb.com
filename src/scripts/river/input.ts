// Pointer input: a tap drops a ripple, dragging stirs the water along the path. Positions are
// turned into world coordinates, undoing the quarter turn used for portrait canvases.

export interface ViewShape {
  worldWidth: number;
  worldHeight: number;
  portrait: boolean;
}

export type Stir = (x: number, y: number, strength: number) => void;

const SPACING = 0.14;
const MAX_POINTS_PER_EVENT = 8;

export function attachInput(canvas: HTMLCanvasElement, view: () => ViewShape, stir: Stir): void {
  let activePointer = -1;
  let lastX = 0;
  let lastY = 0;
  const world = { x: 0, y: 0 };

  function toWorld(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const screenX = (event.clientX - rect.left) / rect.width;
    const screenY = (event.clientY - rect.top) / rect.height;
    const shape = view();
    if (shape.portrait) {
      world.x = screenY * shape.worldWidth;
      world.y = screenX * shape.worldHeight;
    } else {
      world.x = screenX * shape.worldWidth;
      world.y = screenY * shape.worldHeight;
    }
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
