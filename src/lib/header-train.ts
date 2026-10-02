/**
 * Drives the header logo's train down its painted track in 3D on hover.
 *
 * header-train.json holds a camera fitted to the painting, the track as 3D
 * points, and box cars whose faces are textures flattened out of the
 * painting. Each car body is split into short sections that each ride the
 * rails, so long cars bend round the curves instead of cutting across them.
 * Every visible face is a slice of the atlas warped onto its projected quad
 * with a CSS matrix3d. At rest the painted train shows instead; the boxes are
 * fitted to it, and the two crossfade as the train pulls away.
 */
import data from './header-train.json';

type Vec = [number, number, number];
type FaceName = 'front' | 'rear' | 'A' | 'B' | 'top';

const OUT_MS = 2600;
const BACK_MS = 1800;
const FADE_FROM = 0.86;
const SETTLE_METRES = 6;
const HANDOVER = 0.12;
const SEAM_OVERLAP = 0.015;

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

const track = data.track as Vec[];
const up = data.up as Vec;
const travel = data.end - data.rest;

function trackAt(s: number): Vec {
  const i = Math.min(Math.max(Math.floor(s / data.step), 0), track.length - 2);
  const t = s / data.step - i;
  return add(scale(track[i], 1 - t), scale(track[i + 1], t));
}

function project(p: Vec): [number, number] {
  return [data.cx + (data.f * p[0]) / p[2], data.cy - (data.f * p[1]) / p[2]];
}

/** matrix3d taking a w×h element onto the screen quad p0 (top-left), p1, p2, p3 (clockwise). */
function quadMatrix(w: number, h: number, p0: number[], p1: number[], p2: number[], p3: number[]) {
  const dx1 = p1[0] - p2[0];
  const dx2 = p3[0] - p2[0];
  const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1];
  const dy2 = p3[1] - p2[1];
  const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const k = (dx1 * dy3 - dx3 * dy1) / den;
  const a = p1[0] - p0[0] + g * p1[0];
  const b = p3[0] - p0[0] + k * p3[0];
  const d = p1[1] - p0[1] + g * p1[1];
  const e = p3[1] - p0[1] + k * p3[1];
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${p0[0]},${p0[1]},0,1)`;
}

/** A section's span along its car, 0 = front, 1 = rear, overlapping its neighbours so no seam opens on curves. */
function sectionSpan(sections: number, section: number): [number, number] {
  return [Math.max(0, section / sections - SEAM_OVERLAP), Math.min(1, (section + 1) / sections + SEAM_OVERLAP)];
}

interface Face {
  el: HTMLElement;
  w: number;
  h: number;
}

/**
 * The atlas slice for one section of a face. Sections run from the front of
 * the car (0) to the rear (1); each face's texture runs along the car in its
 * own direction (see bake.py).
 */
function slice(rect: number[], name: FaceName, from: number, to: number) {
  const [x, y, w, h] = rect;
  if (name === 'B') {
    return [x + from * w, y, (to - from) * w, h];
  }

  if (name === 'A') {
    return [x + (1 - to) * w, y, (to - from) * w, h];
  }

  if (name === 'top') {
    return [x, y + (1 - to) * h, w, (to - from) * h];
  }

  return rect;
}

export function mountHeaderTrain(link: HTMLElement) {
  const mark = link.querySelector<HTMLElement>('.brand-mark');
  const sprite = link.querySelector<HTMLElement>('.brand-train');
  const stage = link.querySelector<HTMLElement>('.brand-train-3d');
  if (!mark || !sprite || !stage) {
    return;
  }

  const motion = matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)');
  const faces = new Map<string, Face>();
  let ready = false;
  let hovering = false;

  function faceKeys(car: (typeof data.cars)[number], section: number): FaceName[] {
    const names: FaceName[] = ['A', 'B', 'top'];
    if (section === 0) {
      names.push('front');
    }

    if (section === car.sections - 1) {
      names.push('rear');
    }

    return names;
  }

  // Touch and reduced-motion visitors never get the textures: they load on
  // the first mouse movement, well before the pointer reaches the logo. The
  // painted train stays until both images decode, and for good if one fails.
  function prepare(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !motion.matches) {
      return;
    }

    document.removeEventListener('pointermove', prepare);
    const atlasUrl = stage!.dataset.atlas ?? '';
    const maskUrl = stage!.dataset.mask ?? '';
    stage!.style.setProperty('--train-mask', `url(${maskUrl})`);
    for (const car of data.cars) {
      for (let section = 0; section < car.sections; section++) {
        for (const name of faceKeys(car, section)) {
          const rect = data.faces[`${car.name}.${name}` as keyof typeof data.faces];
          const [x, y, w, h] = slice(rect, name, ...sectionSpan(car.sections, section));
          const el = document.createElement('i');
          el.style.cssText = `width:${w}px;height:${h}px;background:url(${atlasUrl}) ${-x}px ${-y}px / ${data.atlas[0]}px ${data.atlas[1]}px`;
          stage!.append(el);
          faces.set(`${car.name}.${section}.${name}`, { el, w, h });
        }
      }
    }

    Promise.all([atlasUrl, maskUrl].map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode();
    })).then(
      () => {
        ready = true;
        // The first mouse move may have landed on the logo itself.
        if (hovering && motion.matches) {
          go(1);
        }
      },
      () => {},
    );
  }

  document.addEventListener('pointermove', prepare);

  let progress = 0;
  let direction = 0;
  let last = 0;
  let frame = 0;

  function draw() {
    const eased = progress ** 1.8;
    const offset = travel * eased;
    stage!.style.setProperty('--fit', String(mark!.clientWidth / 1532));
    // The painted train and the boxes differ by a few pixels, so they
    // crossfade while the train is still pulling away.
    const handover = Math.min(1, progress / HANDOVER);
    sprite!.style.opacity = String(1 - handover);
    stage!.style.opacity = String(Math.min(handover, (1 - eased) / (1 - FADE_FROM)));

    const depthOrder: [number, HTMLElement][] = [];
    const settled = Math.min(1, offset / SETTLE_METRES);
    for (const car of data.cars) {
      const carFront = data.rest + offset + car.front;
      const height = car.height + (car.movingHeight - car.height) * settled;
      for (let section = 0; section < car.sections; section++) {
        const [from, to] = sectionSpan(car.sections, section);
        const pf = trackAt(carFront - from * car.length);
        const pr = trackAt(carFront - to * car.length);
        const forward = unit(sub(pf, pr));
        const lateral = unit(cross(up, forward));
        const carUp = cross(forward, lateral);
        const half = scale(lateral, data.width / 2);
        const lift = scale(carUp, height);
        const fA = add(pf, half);
        const fB = sub(pf, half);
        const rA = add(pr, half);
        const rB = sub(pr, half);
        const top = (p: Vec) => add(p, lift);
        // Bottom-left, bottom-right, top-right, top-left as seen from outside, then the outward normal.
        const quads: Record<FaceName, [Vec, Vec, Vec, Vec, Vec]> = {
          front: [fA, fB, top(fB), top(fA), forward],
          rear: [rB, rA, top(rA), top(rB), scale(forward, -1)],
          B: [fB, rB, top(rB), top(fB), scale(lateral, -1)],
          A: [rA, fA, top(fA), top(rA), lateral],
          top: [top(fA), top(fB), top(rB), top(rA), carUp],
        };
        for (const name of faceKeys(car, section)) {
          const face = faces.get(`${car.name}.${section}.${name}`)!;
          const [b0, b1, t1, t0, normal] = quads[name];
          const centre = scale(add(add(b0, b1), add(t1, t0)), 0.25);
          if (dot(normal, centre) >= 0) {
            face.el.style.display = 'none';
            continue;
          }

          face.el.style.display = '';
          face.el.style.transform = quadMatrix(face.w, face.h, project(t0), project(t1), project(b1), project(b0));
          depthOrder.push([Math.hypot(...centre), face.el]);
        }
      }
    }

    depthOrder.sort((a, b) => b[0] - a[0]);
    depthOrder.forEach(([, el], i) => {
      el.style.zIndex = String(i);
    });
  }

  function tick(now: number) {
    const duration = direction > 0 ? OUT_MS : BACK_MS;
    progress = Math.min(1, Math.max(0, progress + (direction * (now - last)) / duration));
    last = now;
    draw();

    const parked = progress === 0 && direction < 0;
    stage!.style.visibility = parked ? 'hidden' : 'visible';
    if (parked || (progress === 1 && direction > 0)) {
      frame = 0;
      return;
    }

    frame = requestAnimationFrame(tick);
  }

  function go(to: number) {
    direction = to;
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function park() {
    cancelAnimationFrame(frame);
    frame = 0;
    progress = 0;
    direction = 0;
    sprite!.style.opacity = '';
    stage!.style.visibility = 'hidden';
  }

  link.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') {
      return;
    }

    hovering = true;
    if (ready && motion.matches) {
      go(1);
    }
  });
  link.addEventListener('pointerleave', () => {
    hovering = false;
    // A frame may be queued with progress still at 0; it must turn back too.
    if (frame || progress > 0) {
      go(-1);
    }
  });
  motion.addEventListener('change', () => {
    if (!motion.matches) {
      park();
    }
  });
}
