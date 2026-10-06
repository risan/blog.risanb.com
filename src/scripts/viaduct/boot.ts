// Lazy entry for the viaduct section. Nothing heavy (three.js, scene code, textures, GL context)
// is requested until the section is near the viewport. The loop runs only while the section is on
// screen and the tab is visible, and reduced-motion visitors get a single still frame.
//
// This mirrors river/boot.ts on purpose: the two sections stay independent, so a change to one
// cannot alter the other.

import type { ViaductScene } from './scene.ts';

const LOAD_MARGIN = '400px 0px';

export function bootViaduct(section: HTMLElement): void {
  const frame = section.querySelector<HTMLElement>('[data-viaduct-frame]');
  const canvas = section.querySelector<HTMLCanvasElement>('[data-viaduct-canvas]');
  if (!frame || !canvas) {
    return;
  }

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let scene: ViaductScene | undefined;
  let loading = false;
  let onScreen = false;

  function sync() {
    if (!scene) {
      return;
    }

    if (onScreen && document.visibilityState === 'visible' && !calm.matches) {
      scene.start();
    } else {
      scene.stop();
    }
  }

  async function load() {
    if (loading || !canvas) {
      return;
    }

    loading = true;
    try {
      const { createViaductScene } = await import('./scene.ts');
      scene = await createViaductScene(canvas);
      scene.renderStill();
      frame?.classList.add('is-ready');
      sync();
    } catch (error) {
      frame?.classList.add('is-fallback');
      console.warn('viaduct: scene unavailable, showing the plain frame', error);
    }
  }

  const nearby = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        nearby.disconnect();
        load();
      }
    },
    { rootMargin: LOAD_MARGIN },
  );
  nearby.observe(frame);

  new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    sync();
  }).observe(frame);

  document.addEventListener('visibilitychange', sync);
  calm.addEventListener('change', () => {
    sync();
    if (calm.matches) {
      scene?.renderStill();
    }
  });
}
