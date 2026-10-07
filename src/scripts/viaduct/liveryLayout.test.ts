import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontUv, liveryLayout, sideUv, solidUv, VEHICLE_HALF_WIDTH } from './liveryLayout.ts';
import { CONSIST } from './train.ts';

const locomotive = CONSIST[0];
const panorama = CONSIST[2];

test('the lettering runs left to right when the picture is seen from either side', () => {
  for (const spec of [locomotive, panorama]) {
    const layout = liveryLayout(spec);
    // Seen from the right side the viewer's right is towards the front (+x); from the left side, towards the rear.
    assert.ok(sideUv(layout, 'right', 2, 2)[0] > sideUv(layout, 'right', 1, 2)[0]);
    assert.ok(sideUv(layout, 'left', -1, 2)[0] > sideUv(layout, 'left', 0, 2)[0]);
  }
});

test('both sides read the same picture from the same end of the body', () => {
  const layout = liveryLayout(locomotive);
  const half = locomotive.length / 2 - 1;
  assert.ok(Math.abs(sideUv(layout, 'right', -half, 2)[0] - sideUv(layout, 'left', half, 2)[0]) < 1e-9);
  assert.equal(sideUv(layout, 'right', 0, 1)[1], sideUv(layout, 'left', 0, 1)[1]);
});

test('up on the vehicle is up on the picture', () => {
  const layout = liveryLayout(panorama);
  assert.ok(sideUv(layout, 'right', 0, 3)[1] > sideUv(layout, 'right', 0, 1)[1]);
});

test('a cab front reads left to right as seen from outside at both ends', () => {
  const layout = liveryLayout(locomotive);
  assert.ok(frontUv(layout, 'front', -0.5, 2)[0] > frontUv(layout, 'front', 0.5, 2)[0]);
  assert.ok(frontUv(layout, 'rear', 0.5, 2)[0] > frontUv(layout, 'rear', -0.5, 2)[0]);
  assert.ok(frontUv(layout, 'front', 0, 3)[1] > frontUv(layout, 'front', 0, 1)[1]);
});

test('the wall, the cab front and the white block stay inside the texture without overlapping', () => {
  const layout = liveryLayout(locomotive);
  const corners = [
    sideUv(layout, 'right', -locomotive.length / 2, layout.wallBottom),
    sideUv(layout, 'right', locomotive.length / 2, layout.wallTop),
    frontUv(layout, 'front', VEHICLE_HALF_WIDTH, layout.frontBottom),
    frontUv(layout, 'front', -VEHICLE_HALF_WIDTH, layout.frontTop),
    solidUv(layout),
  ];
  for (const [u, v] of corners) {
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${u}, ${v}`);
  }

  const wallBottomV = sideUv(layout, 'right', 0, layout.wallBottom)[1];
  const frontTopV = frontUv(layout, 'front', 0, layout.frontTop)[1];
  const frontBottomV = frontUv(layout, 'front', 0, layout.frontBottom)[1];
  assert.ok(frontTopV < wallBottomV);
  assert.ok(solidUv(layout)[1] < frontBottomV);
});

test('a coach has no cab front', () => {
  assert.equal(liveryLayout(panorama).frontRow, null);
  assert.throws(() => frontUv(liveryLayout(panorama), 'front', 0, 2));
});
