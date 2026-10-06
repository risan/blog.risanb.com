import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCamera, NEAR_MARGIN, projectToScreen, screenToWater, WORLD_Z_SPAN, type Camera } from './camera.ts';
import type { Vec2 } from './world.ts';

const cameras: [string, Camera][] = [
  ['landscape', createCamera({ portrait: false, viewWidth: 14.7, viewHeight: 7 })],
  ['portrait', createCamera({ portrait: true, viewWidth: 5.2, viewHeight: 11.25 })],
];

function clipOf(camera: Camera, x: number, y: number, z: number): [number, number, number] {
  const m = camera.viewProjection;

  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

for (const [name, camera] of cameras) {
  test(`${name}: screen to water and back is the identity`, () => {
    const water: Vec2 = { x: 0, y: 0 };
    const screen: Vec2 = { x: 0, y: 0 };

    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.23, 0.81]]) {
      screenToWater(camera, u, v, water);
      projectToScreen(camera, water.x, water.y, 0, screen);
      assert.ok(Math.abs(screen.x - u) < 1e-9 && Math.abs(screen.y - v) < 1e-9);
    }
  });

  test(`${name}: the four screen corners land inside the world rectangle`, () => {
    const water: Vec2 = { x: 0, y: 0 };

    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      screenToWater(camera, u, v, water);
      assert.ok(water.x >= 0 && water.x <= camera.worldWidth, `x ${water.x}`);
      assert.ok(water.y >= 0 && water.y <= camera.worldHeight, `y ${water.y}`);
    }
  });

  test(`${name}: ground raised near the bottom edge still fills the frame down to its last row`, () => {
    const water: Vec2 = { x: 0, y: 0 };
    const highestGround = (NEAR_MARGIN * Math.tan(camera.elevation)) * 0.99;

    for (const u of [0, 0.5, 1]) {
      screenToWater(camera, u, 1, water);
      // The last screen row shows ground at this height from a point nearer the viewer than the water point.
      const nearer = {
        x: water.x + camera.toward.x * (highestGround / Math.tan(camera.elevation)),
        y: water.y + camera.toward.y * (highestGround / Math.tan(camera.elevation)),
      };
      assert.ok(nearer.x >= 0 && nearer.x <= camera.worldWidth);
      assert.ok(nearer.y >= 0 && nearer.y <= camera.worldHeight);
    }
  });

  test(`${name}: a point raised in z moves up the screen and sideways not at all`, () => {
    const low: Vec2 = { x: 0, y: 0 };
    const high: Vec2 = { x: 0, y: 0 };
    projectToScreen(camera, camera.centre.x + 1, camera.centre.y + 1, 0, low);
    projectToScreen(camera, camera.centre.x + 1, camera.centre.y + 1, 0.5, high);

    assert.ok(high.y < low.y, 'higher is further up the screen');
    assert.ok(Math.abs(high.x - low.x) < 1e-12);
  });

  test(`${name}: the matrix agrees with projectToScreen`, () => {
    const screen: Vec2 = { x: 0, y: 0 };

    for (const [x, y, z] of [[1, 2, 0], [camera.worldWidth / 2, camera.worldHeight / 3, 0.3], [0.4, camera.worldHeight - 0.2, -1.2]]) {
      projectToScreen(camera, x, y, z, screen);
      const [clipX, clipY] = clipOf(camera, x, y, z);
      assert.ok(Math.abs((clipX + 1) / 2 - screen.x) < 1e-5);
      assert.ok(Math.abs((1 - clipY) / 2 - screen.y) < 1e-5);
    }
  });

  test(`${name}: every point of the world box has a clip depth inside [-1, 1] and nearer means smaller`, () => {
    for (const x of [0, camera.worldWidth]) {
      for (const y of [0, camera.worldHeight]) {
        for (const z of [-WORLD_Z_SPAN, WORLD_Z_SPAN]) {
          const depth = clipOf(camera, x, y, z)[2];
          assert.ok(depth >= -1 && depth <= 1, `depth ${depth}`);
        }
      }
    }

    const farther = clipOf(camera, camera.centre.x - camera.toward.x, camera.centre.y - camera.toward.y, 0)[2];
    const nearer = clipOf(camera, camera.centre.x + camera.toward.x, camera.centre.y + camera.toward.y, 0)[2];
    const higher = clipOf(camera, camera.centre.x, camera.centre.y, 1)[2];
    assert.ok(nearer < farther, 'points nearer the viewer have smaller depth');
    assert.ok(higher < clipOf(camera, camera.centre.x, camera.centre.y, 0)[2], 'raised points are nearer the camera');
  });
}
