import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_SPEED, createWorld, mulberry32, type Vec2 } from './world.ts';

const landscape = { seed: 7, width: 18.9, height: 9 };

function sampleGrid(world: ReturnType<typeof createWorld>, step: number): Vec2[] {
  const points: Vec2[] = [];
  for (let x = step; x < world.width; x += step) {
    for (let y = step; y < world.height; y += step) {
      points.push({ x, y });
    }
  }

  return points;
}

test('the same seed builds the same world', () => {
  const first = createWorld(landscape);
  const second = createWorld(landscape);

  assert.deepEqual(first.rocks, second.rocks);
  assert.deepEqual(first.terrain.slice(0, 4000), second.terrain.slice(0, 4000));
});

test('different seeds build different worlds', () => {
  const first = createWorld(landscape);
  const second = createWorld({ ...landscape, seed: 8 });

  assert.notDeepEqual(first.rocks, second.rocks);
});

test('depth is not positive on land and on rocks that break the surface', () => {
  const world = createWorld(landscape);

  assert.ok(world.depthAt(0.2, 0.2) < 0);
  const breaking = world.rocks.filter((rock) => rock.inStream && world.depthAt(rock.x, rock.y) <= 0);
  assert.ok(breaking.length >= 1, 'at least one stream rock breaks the surface');
});

test('there is a river with a current that points downstream mid-channel', () => {
  const world = createWorld(landscape);
  const flow: Vec2 = { x: 0, y: 0 };
  let channelSamples = 0;
  let downstream = 0;

  for (const point of sampleGrid(world, 0.5)) {
    if (world.depthAt(point.x, point.y) < 0.6) {
      continue;
    }

    channelSamples += 1;
    world.flowAt(point.x, point.y, 3, flow);
    if (flow.x > 0) {
      downstream += 1;
    }
  }

  assert.ok(channelSamples > 50, 'enough deep water');
  assert.ok(downstream / channelSamples > 0.9, 'deep water flows along +x');
});

test('the current is zero on land and inside rocks', () => {
  const world = createWorld(landscape);
  const flow: Vec2 = { x: 1, y: 1 };

  world.flowAt(0.2, 0.2, 0, flow);
  assert.equal(flow.x, 0);
  assert.equal(flow.y, 0);

  for (const rock of world.rocks) {
    if (world.depthAt(rock.x, rock.y) > 0) {
      continue;
    }

    world.flowAt(rock.x, rock.y, 0, flow);
    assert.ok(Math.hypot(flow.x, flow.y) < 0.02);
  }
});

test('water directly behind a protruding rock is slower than mid-channel', () => {
  const world = createWorld(landscape);
  const flow: Vec2 = { x: 0, y: 0 };
  const rock = world.rocks.find((candidate) => candidate.inStream && world.depthAt(candidate.x, candidate.y) <= 0);
  assert.ok(rock, 'a rock breaks the surface');

  world.flowAt(rock.x + rock.radius * 1.6, rock.y, 0, flow);
  const wakeSpeed = Math.hypot(flow.x, flow.y);

  assert.ok(wakeSpeed < CHANNEL_SPEED * 0.7, `wake speed ${wakeSpeed.toFixed(3)} is below mid-channel`);
});

test('the water edge is wet only where depth is positive', () => {
  const world = createWorld(landscape);

  assert.equal(world.isWater(0.2, 0.2), false);
  const middle = world.randomWaterPoint(mulberry32(1), 0.3, { x: 0, y: 0 });
  assert.equal(world.isWater(middle.x, middle.y), true);
});

test('random water points are always water at the requested depth', () => {
  const world = createWorld(landscape);
  const pick = mulberry32(99);
  const point: Vec2 = { x: 0, y: 0 };

  for (let index = 0; index < 300; index += 1) {
    world.randomWaterPoint(pick, 0.25, point);
    assert.ok(world.depthAt(point.x, point.y) >= 0.25);
  }
});

test('a portrait-sized world also has water and rocks', () => {
  const world = createWorld({ seed: 7, width: 8.1, height: 6.5 });
  const point = world.randomWaterPoint(mulberry32(3), 0.3, { x: 0, y: 0 });

  assert.ok(world.isWater(point.x, point.y));
  assert.ok(world.rocks.length >= 4);
});
