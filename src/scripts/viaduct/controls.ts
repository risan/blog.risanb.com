// Mouse, touch, keyboard and button input for the scene's camera. It only asks the scene for a new
// view through `change`; the scene clamps it, eases toward it and draws.
//
// The page must keep scrolling: a plain wheel and a one-finger vertical swipe pass through, and a
// short hint tells the visitor that zooming takes Ctrl (or Command). A pinch on a trackpad
// arrives as Ctrl + wheel, so it needs no special case.

import { defaultView, isDefaultView, MAX_ZOOM, MIN_ZOOM, panByScreen, zoomAtScreen, type ViewState } from './camera.ts';

export interface ViewHost {
  aspect(): number;
  view(): ViewState;
  change(next: ViewState): void;
}

const DEGREE = Math.PI / 180;
const DRAG_RADIANS_PER_PIXEL = 0.006;
const ZOOM_STEP = 1.4;
const TILT_STEP = 8 * DEGREE;
const TURN_STEP = 5 * DEGREE;
const WHEEL_ZOOM_PER_UNIT = 0.008;
const WHEEL_LIMIT = 40;
const LINE_HEIGHT = 16;
const HINT_MILLISECONDS = 1500;

interface Point {
  x: number;
  y: number;
}

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

export function attachViewControls(canvas: HTMLCanvasElement, host: ViewHost): void {
  const frame = canvas.closest<HTMLElement>('[data-viaduct-frame]') ?? canvas;
  const hint = frame.querySelector<HTMLElement>('[data-view-hint]');
  const resetButton = frame.querySelector<HTMLButtonElement>('[data-view-action="reset"]');
  const pointers = new Map<number, Point>();
  let dragMode: 'orbit' | 'pan' = 'orbit';
  let hintTimer = 0;

  function apply(next: ViewState) {
    host.change(next);
    if (resetButton) {
      resetButton.disabled = isDefaultView(host.aspect(), host.view());
    }
  }

  // A position on the canvas as x and y in -1..1, y up.
  function screenPosition(clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();

    return { x: ((clientX - rect.left) / rect.width) * 2 - 1, y: 1 - ((clientY - rect.top) / rect.height) * 2 };
  }

  function orbit(deltaX: number, deltaY: number) {
    const view = host.view();
    apply({ ...view, azimuth: view.azimuth + deltaX * DRAG_RADIANS_PER_PIXEL, elevation: view.elevation + deltaY * DRAG_RADIANS_PER_PIXEL });
  }

  function pan(deltaX: number, deltaY: number) {
    const rect = canvas.getBoundingClientRect();
    apply(panByScreen(host.aspect(), host.view(), (2 * deltaX) / rect.width, (-2 * deltaY) / rect.height));
  }

  function zoomBy(factor: number, at: Point) {
    const view = host.view();
    apply(zoomAtScreen(host.aspect(), view, clampZoom(view.zoom * factor), at.x, at.y));
  }

  function showHint() {
    if (!hint) {
      return;
    }

    hint.textContent = /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Tahan ⌘ untuk zoom' : 'Tahan Ctrl untuk zoom';
    hint.classList.add('is-visible');
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.remove('is-visible'), HINT_MILLISECONDS);
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button > 2) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === 'mouse') {
      dragMode = event.button === 0 && !event.shiftKey ? 'orbit' : 'pan';
      event.preventDefault();
    }

    canvas.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId);
    if (!before) {
      return;
    }

    const after = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, after);
    if (event.pointerType === 'mouse') {
      if (dragMode === 'orbit') {
        orbit(after.x - before.x, after.y - before.y);
      } else {
        pan(after.x - before.x, after.y - before.y);
      }

      return;
    }

    if (pointers.size === 1) {
      // One finger turns the view sideways; its vertical travel belongs to the page scroll.
      orbit(after.x - before.x, 0);

      return;
    }

    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) {
      return;
    }

    const midBefore = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
    const midAfter = { x: (after.x + other.x) / 2, y: (after.y + other.y) / 2 };
    const spread = Math.hypot(before.x - other.x, before.y - other.y);
    if (spread > 0) {
      zoomBy(Math.hypot(after.x - other.x, after.y - other.y) / spread, screenPosition(midAfter.x, midAfter.y));
    }

    pan(midAfter.x - midBefore.x, midAfter.y - midBefore.y);
  });

  function release(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      canvas.classList.remove('is-dragging');
    }
  }

  // `touch-action: pan-y` still lets a browser scroll the page with two fingers, which would
  // cancel the pinch; a two-finger gesture on the canvas belongs to the camera.
  canvas.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1 && event.cancelable) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        showHint();

        return;
      }

      event.preventDefault();
      const delta = (event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY) * -1;
      const limited = Math.min(Math.max(delta, -WHEEL_LIMIT), WHEEL_LIMIT);
      zoomBy(Math.exp(limited * WHEEL_ZOOM_PER_UNIT), screenPosition(event.clientX, event.clientY));
    },
    { passive: false },
  );

  const centre = { x: 0, y: 0 };
  const actions: Record<string, () => void> = {
    'zoom-in': () => zoomBy(ZOOM_STEP, centre),
    'zoom-out': () => zoomBy(1 / ZOOM_STEP, centre),
    'tilt-up': () => apply({ ...host.view(), elevation: host.view().elevation + TILT_STEP }),
    'tilt-down': () => apply({ ...host.view(), elevation: host.view().elevation - TILT_STEP }),
    reset: () => apply(defaultView(host.aspect())),
  };
  for (const button of frame.querySelectorAll<HTMLButtonElement>('[data-view-action]')) {
    const action = actions[button.dataset.viewAction ?? ''];
    button.addEventListener('click', () => action?.());
  }

  const keys: Record<string, () => void> = {
    '+': actions['zoom-in'],
    '=': actions['zoom-in'],
    '-': actions['zoom-out'],
    _: actions['zoom-out'],
    ArrowUp: actions['tilt-up'],
    ArrowDown: actions['tilt-down'],
    ArrowLeft: () => apply({ ...host.view(), azimuth: host.view().azimuth - TURN_STEP }),
    ArrowRight: () => apply({ ...host.view(), azimuth: host.view().azimuth + TURN_STEP }),
  };
  frame.addEventListener('keydown', (event) => {
    const onControl = event.target === frame || event.target instanceof HTMLButtonElement;
    const key = keys[event.key];
    if (!onControl || !key || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    key();
  });

  if (resetButton) {
    resetButton.disabled = isDefaultView(host.aspect(), host.view());
  }
}
