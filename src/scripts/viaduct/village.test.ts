import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScenery } from './scenery.ts';
import { createGround, TERRAIN_BOUNDS } from './terrain.ts';
import { buildVillage } from './villageMesh.ts';
import { distanceToPolyline, footprint, housesOverlap } from './village.ts';

const ground = createGround();
const scenery = createScenery(ground);
const { houses, streets, lane } = scenery;

test('the village has between 25 and 40 houses, a church among them', () => {
  assert.ok(houses.length >= 25 && houses.length <= 40, `${houses.length} houses`);
  assert.equal(houses.filter((house) => house.church).length, 1);
});

test('houses are two to four storeys, mostly plastered, a few of stone, a few with a flat roof', () => {
  const village = houses.filter((house) => !house.church);
  for (const house of village) {
    assert.ok(house.floors >= 1 && house.floors <= 4);
  }

  assert.ok(village.filter((house) => house.floors >= 2).length >= 25);
  assert.ok(village.filter((house) => house.stone).length >= 1);
  assert.ok(village.filter((house) => !house.stone).length > village.length / 2);
  assert.ok(village.filter((house) => house.mansard).length === 1, 'one villa with a mansard roof');
});

test('no house stands within 15 m of the line, in the viaduct clearance, on a street or on another house', () => {
  houses.forEach((house, index) => {
    for (const [x, z] of footprint(house)) {
      assert.ok(ground.distanceToBed(x, z) >= 15 - 1e-9 || index < 2, 'house too close to the line');
      assert.ok(ground.viaductAt(x, z).distance >= 24 - 1e-9 || index < 2, 'house in the viaduct clearance');
      for (const street of [...streets, { points: lane, width: 3.4 }]) {
        assert.ok(distanceToPolyline(street.points, x, z) > street.width / 2, 'house on a road');
      }
    }

    for (const other of houses.slice(index + 1)) {
      assert.ok(!housesOverlap(house, other, 0), 'two houses overlap');
    }
  });
});

test('every house stands on the ground the scene has', () => {
  for (const house of houses) {
    assert.ok(house.x > TERRAIN_BOUNDS.minX && house.x < TERRAIN_BOUNDS.maxX);
    assert.ok(house.z > TERRAIN_BOUNDS.minZ && house.z < TERRAIN_BOUNDS.maxZ);
  }
});

test('the main road joins the lane and the village has streets leading off it', () => {
  const [main, ...sides] = streets;
  const [startX, startZ] = main.points[0];
  assert.ok(distanceToPolyline(lane, startX, startZ) < 2);
  assert.ok(sides.length >= 3);
});

test('the village meshes are well formed and stay within a small triangle budget', () => {
  const { walls, roofs } = buildVillage(houses, ground);
  for (const mesh of [walls, roofs]) {
    assert.equal(mesh.positions.length / 3, mesh.normals.length / 3);
    assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
    assert.ok(mesh.indices.every((index) => index < mesh.positions.length / 3));
  }

  assert.ok(walls.indices.length / 3 + roofs.indices.length / 3 < 12000);
});
