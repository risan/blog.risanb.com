import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQualityGovernor, type QualityAction } from './quality.ts';

// Feeds `seconds` of frames, each `interval` ms apart (optionally with a jitter function),
// and returns every action the governor produced. Like the scene, it restarts the governor
// after each action.
function run(
  governor: ReturnType<typeof createQualityGovernor>,
  clock: { now: number },
  seconds: number,
  interval: number,
  canImprove = false,
  jitter: (index: number) => number = () => 0,
): QualityAction[] {
  const actions: QualityAction[] = [];
  const end = clock.now + seconds * 1000;
  for (let index = 0; clock.now < end; index += 1) {
    const frame = interval + jitter(index);
    clock.now += frame;
    const action = governor.record(frame, clock.now, canImprove);
    if (action !== 'hold') {
      governor.restart(clock.now);
    }

    actions.push(action);
  }

  return actions;
}

function started() {
  const governor = createQualityGovernor();
  const clock = { now: 1000 };
  governor.restart(clock.now);

  return { governor, clock };
}

test('a steady 60 Hz, 90 Hz or 120 Hz screen never degrades', () => {
  for (const interval of [16.7, 11.1, 8.3]) {
    const { governor, clock } = started();
    const actions = run(governor, clock, 20, interval);

    assert.ok(!actions.includes('degrade'), `${interval} ms frames degraded`);
  }
});

test('a short hiccup on a 60 Hz screen does not degrade', () => {
  const { governor, clock } = started();
  const actions = run(governor, clock, 20, 16.7, false, (index) => (index % 120 === 60 ? 45 : 0));

  assert.ok(!actions.includes('degrade'));
});

test('a long gap such as a tab switch is ignored', () => {
  const { governor, clock } = started();
  run(governor, clock, 6, 16.7);
  clock.now += 20000;
  const actions = [governor.record(20000, clock.now, false), ...run(governor, clock, 6, 16.7)];

  assert.ok(!actions.includes('degrade'));
});

test('a device that is slow from the very first frame degrades', () => {
  for (const interval of [40, 50]) {
    const { governor, clock } = started();
    const actions = run(governor, clock, 10, interval);

    assert.ok(actions.includes('degrade'), `${interval} ms frames never degraded`);
  }
});

test('a steady 30 fps cap keeps degrading, never tries to improve, and so does not flap', () => {
  const { governor, clock } = started();
  const actions = run(governor, clock, 60, 33.3, true);

  assert.ok(actions.filter((action) => action === 'degrade').length >= 3, 'degrades repeatedly');
  assert.ok(!actions.includes('improve'), 'never tries a higher quality while capped');
});

test('sustained slowness after good frames degrades', () => {
  const { governor, clock } = started();
  run(governor, clock, 6, 16.7);
  const actions = run(governor, clock, 6, 40);

  assert.ok(actions.includes('degrade'));
});

test('recovery on a 60 Hz screen improves, but not more than once every 5 seconds', () => {
  const { governor, clock } = started();
  run(governor, clock, 6, 16.7);
  run(governor, clock, 4, 40);
  const actions = run(governor, clock, 40, 16.7, true);
  const improvements = actions.filter((action) => action === 'improve').length;

  assert.ok(improvements >= 1, 'recovers at least once');
  assert.ok(improvements <= 8, `at most one improvement per 5 s (got ${improvements})`);
});
