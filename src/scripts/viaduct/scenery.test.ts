import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScenery, MAX_BUSHES, MIN_TREE_DISTANCE_TO_BED, MIN_TREE_DISTANCE_TO_VIADUCT } from './scenery.ts';
import { createGround } from './terrain.ts';

const ground = createGround();
const scenery = createScenery(ground);

test('the same seed gives the same valley', () => {
  assert.deepEqual(createScenery(ground).trees.slice(0, 5), scenery.trees.slice(0, 5));
});

test('there are enough trees for a grove and they stand on the ground', () => {
  assert.ok(scenery.trees.length >= 60);
  for (const tree of scenery.trees) {
    assert.ok(Math.abs(tree.y - ground.heightAt(tree.x, tree.z)) < 1e-9);
  }
});

test('no tree stands close to the line, on the viaduct or in its arch openings', () => {
  for (const tree of scenery.trees) {
    assert.ok(ground.distanceToBed(tree.x, tree.z) > MIN_TREE_DISTANCE_TO_BED, 'tree beside the track');
    assert.ok(ground.viaductAt(tree.x, tree.z).distance > MIN_TREE_DISTANCE_TO_VIADUCT, 'tree under the viaduct');
  }
});

test('bushes and rocks also keep clear of the line and the viaduct', () => {
  for (const item of [...scenery.bushes, ...scenery.rocks]) {
    assert.ok(ground.distanceToBed(item.x, item.z) > 4);
    assert.ok(ground.viaductAt(item.x, item.z).distance > 7);
  }
});

test('the meadows are not littered: bushes are few and rocks stay on the hillside', () => {
  assert.ok(scenery.bushes.length <= MAX_BUSHES);
  for (const rock of scenery.rocks) {
    assert.ok(ground.uphillAt(rock.x, rock.z) > 24 || (rock.x > 104 && rock.z < 45), 'rock in the meadow');
  }
});

test('the woods are dense on the east side between the inner track and the viaduct', () => {
  const inWood = scenery.trees.filter((tree) => tree.x > 25 && tree.x < 75 && -tree.z > 0 && -tree.z < 60);
  assert.ok(inWood.length >= 15, `only ${inWood.length} trees in the east wood`);
});

test('the three standing stones stand just beyond the upper end of the low curved wall', () => {
  const lowWall = scenery.walls.find((wall) => wall.height < 0.6);
  assert.ok(lowWall);
  const [endX, endZ] = lowWall.points[lowWall.points.length - 1];
  assert.equal(scenery.standingStones.length, 3);
  for (const stone of scenery.standingStones) {
    assert.ok(stone.z < endZ, 'a stone is not behind the wall end');
    assert.ok(Math.hypot(stone.x - endX, stone.z - endZ) < 30, 'a stone is far from the wall');
  }
});

test('two single trees stand in the meadow on the viaduct side', () => {
  const loners = scenery.trees.filter((tree) => Math.hypot(tree.x, tree.z) < 55 && tree.x > 0 && tree.z > 0);
  assert.equal(loners.length, 2);
});

test('the far forest stands on the mountain sides, clear of the line, the streets and the houses', () => {
  assert.ok(scenery.farTrees.length > 1000);
  for (const tree of scenery.farTrees) {
    assert.ok(ground.distanceToBed(tree.x, tree.z) >= 9, 'far tree on the line');
    assert.ok(Math.abs(tree.y - ground.heightAt(tree.x, tree.z)) < 1e-9);
    assert.ok(tree.x < -110 || tree.z < -205 || tree.z > 150 || tree.x > 200, 'far tree in the old default view');
  }
});

test('the orchard is rows of small trees on the slope between the main road and the loop', () => {
  assert.ok(scenery.orchard.length >= 40 && scenery.orchard.length <= 120);
  for (const tree of scenery.orchard) {
    assert.ok(tree.x < -85 && tree.x > -125);
  }
});
