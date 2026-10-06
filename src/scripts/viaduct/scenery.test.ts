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
