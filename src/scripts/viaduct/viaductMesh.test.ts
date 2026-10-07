import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layCourses, MIN_STAGGER, STONE_TILE } from './stoneLayout.ts';
import { createGround } from './terrain.ts';
import { buildViaduct } from './viaductMesh.ts';

const courses = layCourses(7);

test('the courses fill the tile exactly, each about as high as a real course', () => {
  const total = courses.reduce((sum, course) => sum + course.height, 0);
  assert.ok(Math.abs(total - STONE_TILE) < 1e-9, `courses add up to ${total}`);
  courses.forEach((course, index) => {
    assert.ok(course.height > 0.3 && course.height < 0.5, `course ${index} is ${course.height} m high`);
    if (index > 0) {
      assert.ok(Math.abs(course.y - (courses[index - 1].y + courses[index - 1].height)) < 1e-9, 'a gap between courses');
    }
  });
});

test('the blocks of a course add up to the tile, and their joints are staggered from the course below', () => {
  courses.forEach((course, index) => {
    const total = course.blocks.reduce((sum, block) => sum + block.width, 0);
    assert.ok(Math.abs(total - STONE_TILE) < 1e-9, `course ${index} is ${total} m long`);
    for (const block of course.blocks) {
      assert.ok(block.width > 0.35 && block.width < 1.2, `a block ${block.width} m long`);
    }

    const below = courses[(index + courses.length - 1) % courses.length];
    for (const block of course.blocks) {
      for (const other of below.blocks) {
        const gap = Math.abs(((block.x - other.x) % STONE_TILE + STONE_TILE) % STONE_TILE);
        assert.ok(Math.min(gap, STONE_TILE - gap) >= MIN_STAGGER - 1e-9, `joints line up in course ${index}`);
      }
    }
  });
});

test('the walls map to the stone at one real size, with level courses', () => {
  const { masonry } = buildViaduct(createGround());
  let walls = 0;
  for (let index = 0; index < masonry.indices.length; index += 3) {
    const corners = [0, 1, 2].map((corner) => masonry.indices[index + corner]);
    const normals = corners.map((vertex) => [masonry.normals[vertex * 3], masonry.normals[vertex * 3 + 1], masonry.normals[vertex * 3 + 2]]);
    const upright = normals.every((normal) => Math.abs(normal[1]) < 1e-3 && normal.every((value, axis) => Math.abs(value - normals[0][axis]) < 1e-6));
    if (!upright) {
      continue;
    }

    walls += 1;
    for (const vertex of corners) {
      const y = masonry.positions[vertex * 3 + 1];
      assert.ok(Math.abs(masonry.uvs[vertex * 2 + 1] * STONE_TILE - y) < 1e-3, 'a course is not level');
    }

    // Across the triangle, the horizontal run on the wall matches the run in the texture.
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
      const a = corners[from];
      const b = corners[to];
      const run = Math.hypot(masonry.positions[a * 3] - masonry.positions[b * 3], masonry.positions[a * 3 + 2] - masonry.positions[b * 3 + 2]);
      const mapped = Math.abs(masonry.uvs[a * 2] - masonry.uvs[b * 2]) * STONE_TILE;
      assert.ok(Math.abs(run - mapped) < 0.06 * run + 1e-3, `stones stretch: ${run} m of wall over ${mapped} m of texture`);
    }
  }

  assert.ok(walls > 1000, `only ${walls} wall triangles were checked`);
});

test('the viaduct stays within its triangle budget', () => {
  const meshes = buildViaduct(createGround());
  const triangles = [meshes.masonry, meshes.trim, meshes.metal].reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  assert.ok(triangles < 60000, `${triangles} triangles`);
});
