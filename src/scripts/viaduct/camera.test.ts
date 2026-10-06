import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameForAspect, projectToScreen } from './camera.ts';
import { offsetFromTrack, track } from './track.ts';

const SHAPES: [string, number][] = [['wide', 2.1], ['tablet', 1.33], ['phone', 0.8]];

test('the frame is continuous between the shapes', () => {
  let previous = frameForAspect(2.3);
  for (let aspect = 2.3; aspect >= 0.6; aspect -= 0.01) {
    const frame = frameForAspect(aspect);
    assert.ok(Math.abs(frame.halfWidth - previous.halfWidth) < 2);
    assert.ok(Math.abs(frame.target[0] - previous.target[0]) < 2);
    previous = frame;
  }
});

test('the frame has the asked aspect ratio', () => {
  for (const [, aspect] of SHAPES) {
    const frame = frameForAspect(aspect);
    assert.ok(Math.abs(frame.halfWidth / frame.halfHeight - aspect) < 1e-9);
  }
});

test('every frame shape shows the whole viaduct, all nine arches', () => {
  const point = track.sample(0);
  for (const [name, aspect] of SHAPES) {
    const frame = frameForAspect(aspect);
    for (let s = track.viaduct.startS; s <= track.viaduct.endS; s += 2) {
      track.sample(s, point);
      for (const lateral of [-2.6, 2.6]) {
        const spot = offsetFromTrack(s, lateral);
        const [x, y] = projectToScreen(frame, spot.x, point.y, spot.z);
        assert.ok(Math.abs(x) < 0.97 && Math.abs(y) < 0.97, `${name}: viaduct at ${s} is outside the frame (${x.toFixed(2)}, ${y.toFixed(2)})`);
      }
    }
  }
});

test('the wide frame shows the whole loop', () => {
  const frame = frameForAspect(2.1);
  const point = track.sample(0);
  for (let s = track.circleStartS; s < track.crossing.exitS; s += 3) {
    track.sample(s, point);
    const [x, y] = projectToScreen(frame, point.x, point.y, point.z);
    if (Math.hypot(point.x, point.z) < 71) {
      assert.ok(Math.abs(x) < 0.98 && Math.abs(y) < 0.98, `loop at ${s} is outside the wide frame`);
    }
  }
});
