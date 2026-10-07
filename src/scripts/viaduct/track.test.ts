import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARCH_COUNT,
  ARCH_SPAN,
  CROSSING_DROP,
  CROWN_BELOW_RAIL,
  DECK_WIDTH,
  LOOP_RADIUS,
  offsetFromTrack,
  SPRINGING_BELOW_CROWN,
  track,
} from './track.ts';

function headingDifference(a: number, b: number): number {
  const turn = Math.PI * 2;

  return Math.abs((((a - b) % turn) + turn + Math.PI) % turn - Math.PI);
}

test('the line is continuous in position and direction', () => {
  const previous = track.sample(0);
  const point = track.sample(0);
  const step = 0.25;
  for (let s = step; s <= track.length; s += step) {
    const before = { ...previous };
    track.sample(s, point);
    previous.x = point.x;
    previous.z = point.z;
    previous.heading = point.heading;
    const jump = Math.hypot(point.x - before.x, point.z - before.z);
    assert.ok(Math.abs(jump - step) < 0.002 || s === step, `position jumps at ${s}: ${jump}`);
    // Tightest curve is the 45 m inner arc: 0.25 m of it turns about 0.32 degrees.
    assert.ok(headingDifference(point.heading, before.heading) < 0.0065, `heading jumps at ${s}`);
  }
});

test('the grade is gentle and constant', () => {
  const point = track.sample(0);
  for (let s = 0; s <= track.length; s += 20) {
    track.sample(s, point);
    assert.ok(Math.abs(point.grade) < 0.04);
  }

  assert.ok(Math.abs(track.sample(10).grade - track.sample(700).grade) < 1e-12);
});

test('the viaduct is 110 m long with nine 10 m arches on a 70 m radius curve', () => {
  const { viaduct } = track;
  assert.ok(Math.abs(viaduct.endS - viaduct.startS - 110) < 1e-9);
  assert.equal(viaduct.arches.length, ARCH_COUNT);
  assert.equal(viaduct.piers.length, ARCH_COUNT - 1);
  for (const arch of viaduct.arches) {
    assert.ok(Math.abs(arch.endS - arch.startS - ARCH_SPAN) < 1e-9);
  }

  const point = track.sample(0);
  for (let s = viaduct.startS; s <= viaduct.endS; s += 5) {
    track.sample(s, point);
    assert.ok(Math.abs(Math.hypot(point.x, point.z) - LOOP_RADIUS) < 1e-6);
  }
});

test('the exit track passes under the middle of the fourth arch with room to spare', () => {
  const { viaduct, crossing } = track;
  const arch = viaduct.arches[3];
  assert.ok(Math.abs(crossing.viaductS - arch.centreS) < 1e-9);

  const over = track.sample(crossing.viaductS);
  const under = track.sample(crossing.exitS);
  assert.ok(Math.hypot(over.x - under.x, over.z - under.z) < 1e-6, 'the two lines meet in plan');
  assert.ok(Math.abs(over.y - under.y - CROSSING_DROP) < 1e-6);
  const crownAbove = over.y - CROWN_BELOW_RAIL - under.y;
  assert.ok(over.y - under.y >= 14, 'rail to rail clearance');
  assert.ok(crownAbove > 13, 'the arch is tall over the exit track');

  // Plan distance from the exit line to the nearest pier corner, with the piers at their widest
  // (the masonry battering is 2 cm per metre of height).
  const pierHeight = over.y - CROWN_BELOW_RAIL - SPRINGING_BELOW_CROWN - under.y + 0.9;
  const wide = DECK_WIDTH / 2 + 0.1 + 0.02 * pierHeight;
  let nearest = Infinity;
  for (const pier of [viaduct.piers[2], viaduct.piers[3]]) {
    for (const s of [pier.startS, pier.endS]) {
      for (const lateral of [-wide, wide]) {
        const corner = offsetFromTrack(s, lateral);
        for (let exitS = crossing.exitS - 20; exitS <= crossing.exitS + 20; exitS += 0.05) {
          const line = track.sample(exitS);
          nearest = Math.min(nearest, Math.hypot(corner.x - line.x, corner.z - line.z));
        }
      }
    }
  }

  // A vehicle is 1.3 m from its centre line to its side, so this leaves about 0.9 m to the pier.
  assert.ok(nearest >= 2.1, `the nearest pier corner is ${nearest.toFixed(2)} m from the track`);
});

test('the line crosses itself only at the viaduct', () => {
  const samples: { x: number; z: number; s: number }[] = [];
  const point = track.sample(0);
  for (let s = 0; s <= track.length; s += 2) {
    track.sample(s, point);
    samples.push({ x: point.x, z: point.z, s });
  }

  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 40; j < samples.length; j += 1) {
      const near = Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z) < 6;
      if (near) {
        const atCrossing = Math.abs(samples[i].s - track.crossing.viaductS) < 15 && Math.abs(samples[j].s - track.crossing.exitS) < 15;
        assert.ok(atCrossing, `unexpected near-crossing at ${samples[i].s} and ${samples[j].s}`);
      }
    }
  }
});

test('the far end of the line is continuous in position, heading and grade, with no curve tighter than 100 m', () => {
  const previous = track.sample(0);
  const point = track.sample(0);
  const turnBetween = () => Math.abs(Math.atan2(Math.sin(point.heading - previous.heading), Math.cos(point.heading - previous.heading)));
  for (let s = 0.5; s <= track.circleStartS + 50; s += 0.5) {
    track.sample(s - 0.5, previous);
    track.sample(s, point);
    assert.ok(Math.abs(Math.hypot(point.x - previous.x, point.z - previous.z) - 0.5) < 1e-4, `position jumps at ${s}`);
    assert.ok(Math.abs(point.grade - previous.grade) < 1e-9, `the grade changes at ${s}`);
    // Before the circle nothing is tighter than 100 m; the circle itself is 70 m.
    const limit = s <= track.circleStartS ? 1 / 100 : 1 / 70;
    assert.ok(turnBetween() / 0.5 <= limit + 1e-6, `curve tighter than allowed at ${s}`);
  }
});

test('the line climbs steadily away from the circle up to a far end that lies far up the hillside', () => {
  const start = track.sample(0);
  const approach = track.sample(track.approachS);
  assert.ok(start.y > approach.y + 8);
  assert.ok(track.approachS > 250);
  assert.ok(-start.z > 300);
});
