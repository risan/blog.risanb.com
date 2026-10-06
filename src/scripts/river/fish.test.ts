import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFishSim, FISH_INSTANCE_FLOATS, MINNOW, TROUT, GRAYLING } from './fish.ts';
import { createWorld, type Vec2 } from './world.ts';

const counts = { trout: 3, grayling: 2, minnows: 12 };

function runFor(seconds: number, onFrame: (time: number) => void, sim: ReturnType<typeof createFishSim>) {
  const frame = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += frame) {
    sim.update(frame);
    onFrame(elapsed);
  }
}

test('fish never leave the water over 60 simulated seconds, for several worlds', () => {
  for (const seed of [1, 7, 21]) {
    const world = createWorld({ seed, width: 14.7, height: 7 });
    const sim = createFishSim(world, seed, counts);

    runFor(60, () => {
      for (const fish of sim.fish) {
        assert.ok(world.depthAt(fish.x, fish.y) > 0, `seed ${seed}: a fish is out of the water`);
      }
    }, sim);
  }
});

test('the simulation is deterministic for a seed', () => {
  const world = createWorld({ seed: 3, width: 14.7, height: 7 });
  const first = createFishSim(world, 5, counts);
  const second = createFishSim(world, 5, counts);
  const bufferA = new Float32Array(FISH_INSTANCE_FLOATS * 17);
  const bufferB = new Float32Array(FISH_INSTANCE_FLOATS * 17);

  runFor(10, () => {}, first);
  runFor(10, () => {}, second);
  first.pack(bufferA);
  second.pack(bufferB);

  assert.deepEqual(bufferA, bufferB);
});

test('trout and grayling mostly face upstream while holding station', () => {
  const world = createWorld({ seed: 7, width: 14.7, height: 7 });
  const sim = createFishSim(world, 11, counts);
  const flow: Vec2 = { x: 0, y: 0 };
  let facing = 0;
  let samples = 0;

  runFor(60, (elapsed) => {
    if (elapsed < 10) {
      return;
    }

    for (const fish of sim.fish) {
      if (fish.species === MINNOW || fish.darting) {
        continue;
      }

      world.flowAt(fish.x, fish.y, sim.time, flow);
      const speed = Math.hypot(flow.x, flow.y);
      if (speed < 0.2) {
        continue;
      }

      facing += (-flow.x * Math.cos(fish.heading) - flow.y * Math.sin(fish.heading)) / speed;
      samples += 1;
    }
  }, sim);

  assert.ok(samples > 100, 'fish spend time holding in a current');
  assert.ok(facing / samples > 0.6, `mean upstream alignment ${(facing / samples).toFixed(2)} is above 0.6`);
});

test('a splash makes nearby fish bolt away', () => {
  const world = createWorld({ seed: 7, width: 14.7, height: 7 });
  const sim = createFishSim(world, 11, counts);
  const trout = sim.fish.find((fish) => fish.species === TROUT || fish.species === GRAYLING);
  assert.ok(trout);

  runFor(3, () => {}, sim);
  const startX = trout.x;
  const startY = trout.y;
  sim.startle(startX - 0.5, startY);
  runFor(1, () => {}, sim);

  assert.ok(Math.hypot(trout.x - startX, trout.y - startY) > 0.5, 'the fish moved away');
});

test('packing writes one record per fish', () => {
  const world = createWorld({ seed: 7, width: 14.7, height: 7 });
  const sim = createFishSim(world, 11, counts);
  const buffer = new Float32Array(FISH_INSTANCE_FLOATS * 20);

  assert.equal(sim.pack(buffer), 17);
});
