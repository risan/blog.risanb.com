import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANK_HEIGHT, CHANNEL_SPEED, createWorld, mulberry32, type Vec2, type World } from './world.ts';

const landscape = { seed: 7, width: 18.9, height: 9 };
const diagonal = { seed: 7, width: 14.7, height: 13.1, courseAngle: 0.61, riverScale: 7 };
const portraitDiagonal = { seed: 7, width: 20.6, height: 5.2, courseAngle: -0.436, riverScale: 5.2 };

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
    if (flow.x * world.course.x + flow.y * world.course.y > 0) {
      downstream += 1;
    }
  }

  assert.ok(channelSamples > 50, 'enough deep water');
  assert.ok(downstream / channelSamples > 0.9, 'deep water flows along the course');
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

  world.flowAt(rock.x + world.course.x * rock.radius * 1.6, rock.y + world.course.y * rock.radius * 1.6, 0, flow);
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

// Walks across the river at each position along the course and returns where the bank
// lines (the riverbed crossing zero, rocks left out) lie, by linear interpolation. Only the
// longest stretch where both banks are well inside the world is returned.
function waterlines(world: World): { left: number[]; right: number[] } {
  const normal = { x: -world.course.y, y: world.course.x };
  const middleX = world.width / 2;
  const middleY = world.height / 2;
  const step = 0.01;
  const edge = 0.3;
  let best = { left: [] as number[], right: [] as number[] };
  let run = { left: [] as number[], right: [] as number[] };

  function inside(along: number, across: number): boolean {
    const x = middleX + world.course.x * along + normal.x * across;
    const y = middleY + world.course.y * along + normal.y * across;

    return x > edge && x < world.width - edge && y > edge && y < world.height - edge;
  }

  function bedAt(along: number, across: number): number {
    const x = middleX + world.course.x * along + normal.x * across;
    const y = middleY + world.course.y * along + normal.y * across;

    return world.depthAt(x, y) + world.rockHeightAt(x, y);
  }

  for (let along = world.alongRange[0]; along <= world.alongRange[1]; along += 0.05) {
    let first = NaN;
    let last = NaN;
    let previous = bedAt(along, -4);
    for (let across = -4 + step; across <= 4; across += step) {
      const bed = bedAt(along, across);
      if (previous <= 0 && bed > 0 && Number.isNaN(first)) {
        first = across - step + (step * -previous) / (bed - previous);
      }

      if (previous > 0 && bed <= 0) {
        last = across - step + (step * previous) / (previous - bed);
      }

      previous = bed;
    }

    const found = !Number.isNaN(first) && !Number.isNaN(last);
    if (found && inside(along, first - 0.5) && inside(along, last + 0.5)) {
      run.left.push(first);
      run.right.push(last);
    } else {
      run = { left: [], right: [] };
    }

    if (run.left.length > best.left.length) {
      best = { left: run.left.slice(), right: run.right.slice() };
    }
  }

  return best;
}

function roughness(line: number[], spacing: number) {
  let extrema = 0;
  let lastSign = 0;
  let largestSecondDifference = 0;
  for (let index = 1; index < line.length; index += 1) {
    const sign = Math.sign(line[index] - line[index - 1]);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
      extrema += 1;
    }

    if (sign !== 0) {
      lastSign = sign;
    }

    if (index >= 2) {
      largestSecondDifference = Math.max(
        largestSecondDifference,
        Math.abs(line[index] - 2 * line[index - 1] + line[index - 2]),
      );
    }
  }

  return { extremaPer5m: extrema / ((line.length * spacing) / 5), largestSecondDifference };
}

for (const [name, options] of [
  ['diagonal landscape', diagonal],
  ['diagonal portrait', portraitDiagonal],
] as const) {
  test(`the waterline of ${name} world is a smooth long curve`, () => {
    const world = createWorld(options);
    const { left, right } = waterlines(world);

    for (const [bank, line] of [['left', left], ['right', right]] as const) {
      assert.ok(line.length * 0.05 > 4, `${bank} bank is followed for ${(line.length * 0.05).toFixed(1)} m`);
      const { extremaPer5m, largestSecondDifference } = roughness(line, 0.05);
      assert.ok(extremaPer5m <= 3, `${bank} bank has ${extremaPer5m.toFixed(2)} turns per 5 m`);
      assert.ok(largestSecondDifference < 0.01, `${bank} bank bends by ${largestSecondDifference.toFixed(4)} m per step`);
    }
  });
}

test('ground is above the water on land, below it in the channel, and rises to a plateau', () => {
  const world = createWorld(diagonal);
  let highest = -Infinity;
  let deepest = Infinity;

  for (const point of sampleGrid(world, 0.25)) {
    const elevation = world.elevationAt(point.x, point.y);
    const depth = world.depthAt(point.x, point.y);
    const rockHeight = world.rockHeightAt(point.x, point.y);
    if (depth < -0.05) {
      assert.ok(elevation > 0, 'land is above the water');
    }

    if (depth > 0.1) {
      assert.ok(elevation < 0, 'open water is below the surface');
    }

    if (rockHeight === 0) {
      highest = Math.max(highest, elevation);
    }

    deepest = Math.min(deepest, elevation);
    assert.ok(elevation <= BANK_HEIGHT + rockHeight + 1e-6, 'never above the plateau plus the rock');
  }

  assert.ok(highest > BANK_HEIGHT * 0.9, 'the plateau is reached');
  assert.ok(deepest < -0.5, 'the channel is deep');
});

test('a rock that breaks the surface stands as high above the water as its depth is negative', () => {
  const world = createWorld(diagonal);
  const rock = world.rocks.find((candidate) => candidate.inStream && world.depthAt(candidate.x, candidate.y) < -0.05);
  assert.ok(rock, 'a stream rock breaks the surface');

  assert.ok(Math.abs(world.elevationAt(rock.x, rock.y) + world.depthAt(rock.x, rock.y)) < 1e-6);
});

test('the course points the way the angle says and the along range stays inside the rectangle', () => {
  const world = createWorld(diagonal);

  assert.ok(Math.abs(world.course.x - Math.cos(0.61)) < 1e-9);
  assert.ok(Math.abs(world.course.y - Math.sin(0.61)) < 1e-9);
  for (const along of world.alongRange) {
    const x = world.width / 2 + world.course.x * along;
    const y = world.height / 2 + world.course.y * along;
    assert.ok(x >= -1e-6 && x <= world.width + 1e-6 && y >= -1e-6 && y <= world.height + 1e-6);
  }
});

test('upstream water points are water at the upstream end of a diagonal world', () => {
  for (const options of [diagonal, portraitDiagonal]) {
    const world = createWorld(options);
    const pick = mulberry32(5);
    const point: Vec2 = { x: 0, y: 0 };

    for (let index = 0; index < 50; index += 1) {
      world.upstreamWaterPoint(pick, 0.3, point);
      assert.ok(world.depthAt(point.x, point.y) >= 0.3);
      assert.ok(world.alongAt(point.x, point.y) < world.alongRange[0] + 0.5, 'near the upstream end');
    }
  }
});

test('no rock stands in the strip nearest the viewer', () => {
  const world = createWorld({ ...diagonal, nearEdge: { toward: { x: 0, y: 1 }, margin: 0.9 } });

  for (const rock of world.rocks) {
    assert.ok(rock.y + rock.radius < world.height - 0.9);
  }
});
