import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BED_DEPTH, createGround } from './terrain.ts';
import { CROWN_BELOW_RAIL, offsetFromTrack, SPRINGING_BELOW_CROWN, track } from './track.ts';

const ground = createGround();

test('the ground meets the rail bed wherever the line is on the ground', () => {
  const point = track.sample(0);
  const { startS, endS } = track.viaduct;
  for (let s = 0; s < track.length; s += 7) {
    if (s > startS - 1 && s < endS + 1) {
      continue;
    }

    track.sample(s, point);
    for (const lateral of [-1.5, 0, 1.5]) {
      const spot = offsetFromTrack(s, lateral);
      const height = ground.heightAt(spot.x, spot.z);
      assert.ok(Math.abs(height - (point.y - BED_DEPTH)) < 0.35, `bed at ${s}, ${lateral}: ${height} vs ${point.y - BED_DEPTH}`);
    }
  }
});

test('the ground stays below the arch openings except under the piers', () => {
  const point = track.sample(0);
  for (const arch of track.viaduct.arches) {
    for (const offset of [-3.5, -2, 0, 2, 3.5]) {
      for (const lateral of [-2, 0, 2]) {
        const s = arch.centreS + offset;
        track.sample(s, point);
        const spot = offsetFromTrack(s, lateral);
        const springing = point.y - CROWN_BELOW_RAIL - SPRINGING_BELOW_CROWN;
        assert.ok(ground.heightAt(spot.x, spot.z) < springing, `ground reaches the springing in the arch at ${s}`);
      }
    }
  }
});

test('the exit track runs in a cutting under the fourth arch with a tall opening', () => {
  const over = track.sample(track.crossing.viaductS);
  const spot = offsetFromTrack(track.crossing.viaductS, 0);
  const opening = over.y - CROWN_BELOW_RAIL - ground.heightAt(spot.x, spot.z);
  assert.ok(opening >= 13, `opening ${opening}`);
});

test('the openings are tall: a pier is 1.5 to 2 spans high over the valley side', () => {
  const point = track.sample(0);
  for (const arch of track.viaduct.arches.slice(0, 6)) {
    track.sample(arch.centreS, point);
    const spot = offsetFromTrack(arch.centreS, 0);
    const opening = point.y - CROWN_BELOW_RAIL - ground.heightAt(spot.x, spot.z);
    assert.ok(opening >= 11.5, `arch at ${arch.centreS}: opening ${opening}`);
  }
});

test('the hillside rises above the upper track', () => {
  const upper = track.sample(track.circleStartS - 100);
  assert.ok(ground.heightAt(upper.x, upper.z - 60) > ground.heightAt(upper.x, upper.z) + 20);
});

test('the meadow inside the loop is a low mound, a few metres above its edges', () => {
  const edge = ground.heightAt(0, -55);
  const middle = ground.heightAt(-6, 12);
  assert.ok(middle - edge > 3, `mound ${middle - edge} m`);
});

test('the low curved wall stands on a terrace edge: the ground steps up by half a metre or more', () => {
  const [wallX, wallZ] = [-36, -1];
  const [acrossX, acrossZ] = [0.81, 0.58];
  const lower = ground.heightAt(wallX + acrossX * 6, wallZ + acrossZ * 6);
  const upper = ground.heightAt(wallX - acrossX * 6, wallZ - acrossZ * 6);
  assert.ok(Math.abs(upper - lower) > 0.5, `step ${upper - lower}`);
});
