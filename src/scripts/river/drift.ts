// Leaves and petals carried by the current. Pure: no DOM, no GL.

import { mulberry32, type Vec2, type World } from './world.ts';

// Per item: x, y, angle, size, kind (0 yellow-green leaf, 1 pale yellow, 2 olive, 3 petal, 4 autumn orange).
export const DRIFT_INSTANCE_FLOATS = 5;

// How far past either end of the river an item is spawned and recycled, so it never pops in view.
const OFF_WORLD_MARGIN = 0.4;

export interface Drift {
  count: number;
  update(dt: number, time: number): void;
  pack(out: Float32Array): number;
}

export function createDrift(world: World, seed: number, count: number): Drift {
  const random = mulberry32(seed);
  const flow: Vec2 = { x: 0, y: 0 };
  const point: Vec2 = { x: 0, y: 0 };
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const angle = new Float32Array(count);
  const spin = new Float32Array(count);
  const size = new Float32Array(count);
  const kind = new Float32Array(count);
  const sideways = new Float32Array(count);

  function pickKind(roll: number): number {
    if (roll < 0.45) {
      return 0;
    }

    if (roll < 0.7) {
      return 1;
    }

    if (roll < 0.85) {
      return 2;
    }

    return roll < 0.93 ? 3 : 4;
  }

  function place(index: number, atUpstreamEdge: boolean) {
    if (atUpstreamEdge) {
      world.upstreamWaterPoint(random, 0.3, point);
      point.x -= world.course.x * OFF_WORLD_MARGIN;
      point.y -= world.course.y * OFF_WORLD_MARGIN;
    } else {
      world.randomWaterPoint(random, 0.3, point);
    }

    x[index] = point.x;
    y[index] = point.y;

    angle[index] = random() * Math.PI * 2;
    spin[index] = (random() - 0.5) * 0.9;
    kind[index] = pickKind(random());
    size[index] = kind[index] === 3 ? 0.04 + random() * 0.016 : 0.1 + random() * 0.05;
    sideways[index] = (random() - 0.5) * 0.08;
  }

  for (let index = 0; index < count; index += 1) {
    place(index, false);
  }

  return {
    count,
    update(dt, time) {
      for (let index = 0; index < count; index += 1) {
        world.flowAt(x[index], y[index], time, flow);
        const drag = 0.88;
        const speed = Math.hypot(flow.x, flow.y);
        let nextX = x[index] + flow.x * drag * dt;
        let nextY = y[index] + (flow.y * drag + sideways[index] * (0.4 + speed)) * dt;
        if (!world.isWater(nextX, nextY) && world.alongAt(nextX, nextY) > world.alongRange[0] + 0.5) {
          // Stranded on the bank or a rock: nudge towards deeper water.
          const gx = world.depthAt(x[index] + 0.15, y[index]) - world.depthAt(x[index] - 0.15, y[index]);
          const gy = world.depthAt(x[index], y[index] + 0.15) - world.depthAt(x[index], y[index] - 0.15);
          const norm = Math.max(Math.hypot(gx, gy), 1e-4);
          nextX = x[index] + (gx / norm) * 0.2 * dt;
          nextY = y[index] + (gy / norm) * 0.2 * dt;
        }

        x[index] = nextX;
        y[index] = nextY;
        angle[index] += spin[index] * dt * (0.4 + speed * 1.4);
        if (world.alongAt(x[index], y[index]) > world.alongRange[1] + OFF_WORLD_MARGIN) {
          place(index, true);
        }
      }
    },
    pack(out) {
      for (let index = 0; index < count; index += 1) {
        const offset = index * DRIFT_INSTANCE_FLOATS;
        out[offset] = x[index];
        out[offset + 1] = y[index];
        out[offset + 2] = angle[index];
        out[offset + 3] = size[index];
        out[offset + 4] = kind[index];
      }

      return count;
    },
  };
}
