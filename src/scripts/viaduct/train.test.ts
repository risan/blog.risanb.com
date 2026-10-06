import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameForAspect, projectToScreen } from './camera.ts';
import { track } from './track.ts';
import { CONSIST, COUPLING_GAP, createPoses, CYCLE_SECONDS, PHOTO_TIME, placeConsist, SPEED, trainStateAt } from './train.ts';

const widest = frameForAspect(2.1);

function onScreen(x: number, y: number, z: number): boolean {
  const [screenX, screenY] = projectToScreen(widest, x, y, z);

  return Math.abs(screenX) < 1.05 && Math.abs(screenY) < 1.05;
}

test('vehicles keep their coupling gaps along the line', () => {
  const poses = createPoses();
  for (const headS of [300, 330, 450, 600]) {
    placeConsist(headS, 1, poses);
    for (let index = 0; index < poses.length - 1; index += 1) {
      const front = poses[index];
      const behind = poses[index + 1];
      const centreDistance = Math.hypot(front.x - behind.x, front.y - behind.y, front.z - behind.z);
      const expected = (CONSIST[index].length + CONSIST[index + 1].length) / 2 + COUPLING_GAP;
      assert.ok(Math.abs(centreDistance - expected) < 0.9, `gap ${index} at ${headS}: ${centreDistance} vs ${expected}`);
      assert.ok(centreDistance > (CONSIST[index].length + CONSIST[index + 1].length) / 2 - 0.5);
    }
  }
});

test('the locomotive leads in both directions', () => {
  const poses = createPoses();
  placeConsist(400, 1, poses);
  assert.ok(poses[0].x !== poses[6].x);
  const downLeadS = nearestS(poses[0].x, poses[0].z);
  const downTailS = nearestS(poses[6].x, poses[6].z);
  assert.ok(downLeadS > downTailS, 'moving to higher s, the head is further along');

  placeConsist(400, -1, poses);
  assert.ok(nearestS(poses[0].x, poses[0].z) < nearestS(poses[6].x, poses[6].z), 'moving back, the head is at lower s');
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
  assert.ok(state.headS - CONSIST.reduce((sum, vehicle) => sum + vehicle.length + COUPLING_GAP, 0) < track.viaduct.startS);
});
