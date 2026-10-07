import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BROADLEAF_RADIUS,
  buildBroadleafCrown,
  buildBroadleafWood,
  buildBushCrown,
  buildConiferCrown,
  CONIFER_HEIGHT,
  CONIFER_RADIUS,
} from './treeMesh.ts';

test('a broadleaf crown is the asked number of cards, within a flattened ball', () => {
  const crown = buildBroadleafCrown(200);
  assert.equal(crown.indices.length / 6, 200);
  for (let index = 0; index < crown.positions.length; index += 3) {
    const x = crown.positions[index];
    const y = crown.positions[index + 1];
    const z = crown.positions[index + 2];
    assert.ok(Math.hypot(x, z) < BROADLEAF_RADIUS * 1.5, 'a card strays far out of the crown');
    assert.ok(y > 1.5 && y < 13.5, `a card is at height ${y}`);
  }
});

test('lighting normals are unit length and point out of the crown', () => {
  const crown = buildBroadleafCrown(120);
  let outward = 0;
  for (let index = 0; index < crown.normals.length; index += 3) {
    assert.ok(Math.abs(Math.hypot(crown.normals[index], crown.normals[index + 1], crown.normals[index + 2]) - 1) < 1e-5);
    const toVertex = [crown.positions[index], crown.positions[index + 1] - 7.4, crown.positions[index + 2]];
    if (toVertex[0] * crown.normals[index] + toVertex[1] * crown.normals[index + 1] + toVertex[2] * crown.normals[index + 2] > 0) {
      outward += 1;
    }
  }

  assert.ok(outward / (crown.normals.length / 3) > 0.9);
});

test('the crown is darker inside than on its skin', () => {
  const crown = buildBroadleafCrown(200);
  let inner = Infinity;
  let outer = 0;
  for (let index = 0; index < crown.colors.length; index += 3) {
    inner = Math.min(inner, crown.colors[index]);
    outer = Math.max(outer, crown.colors[index]);
  }

  assert.ok(outer > inner * 1.8);
});

test('a spruce narrows toward the top and stays within its reference size', () => {
  const spruce = buildConiferCrown(12, 6, 10);
  const widest = [0, 0, 0];
  for (let index = 0; index < spruce.positions.length; index += 3) {
    const y = spruce.positions[index + 1];
    assert.ok(y >= 0 && y <= CONIFER_HEIGHT * 1.02, `spruce vertex at height ${y}`);
    const band = Math.min(2, Math.floor((y / CONIFER_HEIGHT) * 3));
    widest[band] = Math.max(widest[band], Math.hypot(spruce.positions[index], spruce.positions[index + 2]));
  }

  assert.ok(widest[0] > widest[1] && widest[1] > widest[2]);
  assert.ok(widest[0] < CONIFER_RADIUS * 1.8);
});

test('the tree meshes stay inside the triangle budget', () => {
  assert.ok(buildBroadleafCrown(200).indices.length / 3 <= 450);
  assert.ok(buildConiferCrown(16, 7, 11).indices.length / 3 <= 1200);
  assert.ok(buildBushCrown(36).indices.length / 3 <= 80);
  assert.ok(buildBroadleafWood().indices.length / 3 <= 300);
});
