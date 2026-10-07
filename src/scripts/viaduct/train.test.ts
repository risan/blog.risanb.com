import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameForAspect, projectToScreen } from './camera.ts';
import { track } from './track.ts';
import { CONSIST, createPoses, CYCLE_SECONDS, PHOTO_TIME, placeConsist, SPEED, TRAIN_LENGTH, trainStateAt } from './train.ts';

const widest = frameForAspect(2.1);

function onScreen(x: number, y: number, z: number): boolean {
  const [screenX, screenY] = projectToScreen(widest, x, y, z);

  return Math.abs(screenX) < 1.05 && Math.abs(screenY) < 1.05;
}

test('vehicles meet at their couplers along the line', () => {
  const poses = createPoses();
  for (const headS of [300, 330, 450, 600]) {
    placeConsist(headS, 1, poses);
    for (let index = 0; index < poses.length - 1; index += 1) {
      const front = poses[index];
      const behind = poses[index + 1];
      const centreDistance = Math.hypot(front.x - behind.x, front.y - behind.y, front.z - behind.z);
      const expected = (CONSIST[index].length + CONSIST[index + 1].length) / 2;
      assert.ok(Math.abs(centreDistance - expected) < 0.9, `gap ${index} at ${headS}: ${centreDistance} vs ${expected}`);
      assert.ok(centreDistance > (CONSIST[index].length + CONSIST[index + 1].length) / 2 - 0.5);
    }
  }
});

test('the locomotive leads in both directions', () => {
  const poses = createPoses();
  placeConsist(400, 1, poses);
  assert.ok(poses[0].x !== poses[poses.length - 1].x);
  const downLeadS = nearestS(poses[0].x, poses[0].z);
  const downTailS = nearestS(poses[poses.length - 1].x, poses[poses.length - 1].z);
  assert.ok(downLeadS > downTailS, 'moving to higher s, the head is further along');

  placeConsist(400, -1, poses);
  assert.ok(nearestS(poses[0].x, poses[0].z) < nearestS(poses[poses.length - 1].x, poses[poses.length - 1].z), 'moving back, the head is at lower s');
});

function nearestS(x: number, z: number): number {
  let best = Infinity;
  let bestS = 0;
  const point = track.sample(0);
  for (let s = 0; s < track.length; s += 1) {
    track.sample(s, point);
    const distance = (point.x - x) ** 2 + (point.z - z) ** 2;
    if (distance < best) {
      best = distance;
      bestS = s;
    }
  }

  return bestS;
}

test('each vehicle faces along the line, level with the grade', () => {
  const poses = createPoses();
  placeConsist(330, 1, poses);
  for (const pose of poses) {
    assert.ok(Math.abs(Math.hypot(pose.forwardX, pose.forwardY, pose.forwardZ) - 1) < 1e-9);
    assert.ok(Math.abs(pose.forwardY) < 0.06);
  }
});

test('the train is wholly off screen at both pauses and at the turn', () => {
  const poses = createPoses();
  const pauseTimes = [CYCLE_SECONDS / 2 - 1, CYCLE_SECONDS - 1];
  for (const time of pauseTimes) {
    const state = trainStateAt(time);
    placeConsist(state.headS, state.direction, poses);
    for (const pose of poses) {
      assert.ok(!onScreen(pose.x, pose.y, pose.z), `a vehicle is visible at the pause at ${time}`);
    }
  }
});

test('the schedule is continuous and loops', () => {
  assert.deepEqual(trainStateAt(0), trainStateAt(CYCLE_SECONDS));
  let previous = trainStateAt(0);
  for (let time = 0.1; time < CYCLE_SECONDS; time += 0.1) {
    const state = trainStateAt(time);
    if (state.direction === previous.direction && state.moving && previous.moving) {
      assert.ok(Math.abs(state.headS - previous.headS) < SPEED * 0.1 + 1e-6);
    }

    previous = state;
  }
});

test('at the photo time the head is on the viaduct and the tail on the approach', () => {
  const state = trainStateAt(PHOTO_TIME);
  assert.equal(state.direction, 1);
  assert.ok(state.headS > track.viaduct.startS && state.headS < track.viaduct.endS);
  assert.ok(state.headS - CONSIST.reduce((sum, vehicle) => sum + vehicle.length, 0) < track.viaduct.startS);
});

test('the consist is two locomotives and six panorama coaches, as in the Bernina Express', () => {
  assert.deepEqual(
    CONSIST.map((vehicle) => vehicle.kind),
    ['locomotive', 'locomotive', ...Array(6).fill('panorama')],
  );
  assert.deepEqual(CONSIST.slice(0, 2).map((vehicle) => vehicle.number), [51, 52]);
});

test('vehicle lengths are the published ones over the couplers', () => {
  assert.equal(CONSIST[0].length, 16.886);
  assert.equal(CONSIST[2].length, 16.45);
  assert.ok(Math.abs(TRAIN_LENGTH - (2 * 16.886 + 6 * 16.45)) < 1e-9);
});

test('every bogie pair sits well inside its vehicle', () => {
  for (const vehicle of CONSIST) {
    assert.ok(vehicle.bogieSpacing > vehicle.length * 0.55 && vehicle.bogieSpacing < vehicle.length * 0.7);
  }
});

test('the train waits for its trip beyond the far end of the line, outside the ground, so it never pops up in view', () => {
  const poses = createPoses();
  const state = trainStateAt(CYCLE_SECONDS - 1);
  placeConsist(state.headS, state.direction, poses);
  for (const pose of poses) {
    assert.ok(pose.z <= -330, `a vehicle waits inside the ground: ${pose.x}, ${pose.z}`);
  }
});
