import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDrift, DRIFT_INSTANCE_FLOATS } from './drift.ts';
import { createWorld } from './world.ts';

const worlds = [
  { seed: 7, width: 14.7, height: 13.1, courseAngle: 0.61, riverScale: 7 },
  { seed: 7, width: 20.6, height: 5.2, courseAngle: -0.436, riverScale: 5.2 },
];

for (const options of worlds) {
  test(`drifting leaves in a ${options.width} m wide diagonal world re-enter upstream and stay near the river`, () => {
    const world = createWorld(options);
    const count = 7;
    const drift = createDrift(world, 3, count);
    const packed = new Float32Array(count * DRIFT_INSTANCE_FLOATS);
    const previous = new Float32Array(count);
    let recycled = 0;

    drift.pack(packed);
    for (let index = 0; index < count; index += 1) {
      previous[index] = world.alongAt(packed[index * DRIFT_INSTANCE_FLOATS], packed[index * DRIFT_INSTANCE_FLOATS + 1]);
    }

    for (let step = 0; step < 3000; step += 1) {
      drift.update(0.05, step * 0.05);
      drift.pack(packed);
      for (let index = 0; index < count; index += 1) {
        const along = world.alongAt(packed[index * DRIFT_INSTANCE_FLOATS], packed[index * DRIFT_INSTANCE_FLOATS + 1]);
        if (along < previous[index] - 1) {
          recycled += 1;
          assert.ok(along < world.alongRange[0] + 0.1, 'a recycled leaf starts at the upstream end');
        }

        assert.ok(along < world.alongRange[1] + 0.6, 'no leaf drifts far past the downstream end');
        previous[index] = along;
      }
    }

    // A leaf can rest at the nose of a rock, where the current stands still.
    assert.ok(recycled >= count / 2, `leaves were recycled (${recycled})`);
  });
}
