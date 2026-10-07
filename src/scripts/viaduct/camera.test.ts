import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampView,
  edgeCeilingAt,
  defaultView,
  frameForAspect,
  frameForView,
  groundFloorAt,
  isDefaultView,
  looksOnlyAtTerrain,
  MAX_ELEVATION,
  MAX_TURN,
  MAX_ZOOM,
  MIN_ELEVATION,
  MIN_ZOOM,
  panByScreen,
  projectToScreen,
  zoomAtScreen,
  type ViewState,
} from './camera.ts';
import { createGround, TERRAIN_BOUNDS } from './terrain.ts';
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

const ASPECTS = [0.6, 0.7, 0.8, 0.95, 1.1, 1.33, 1.6, 1.9, 2.1, 2.3];

test('the default view is the plain frame for the aspect', () => {
  for (const aspect of ASPECTS) {
    const view = defaultView(aspect);
    const frame = frameForView(aspect, view);
    const plain = frameForAspect(aspect);
    assert.deepEqual(frame, plain);
    assert.ok(isDefaultView(aspect, view));
    assert.deepEqual(clampView(aspect, view), view);
  }
});

test('the ground floor never rises above the terrain', () => {
  const ground = createGround();
  for (let x = TERRAIN_BOUNDS.minX; x <= TERRAIN_BOUNDS.maxX; x += 5) {
    for (let z = TERRAIN_BOUNDS.minZ; z <= TERRAIN_BOUNDS.maxZ; z += 5) {
      assert.ok(ground.heightAt(x, z) >= groundFloorAt(z), `terrain at ${x}, ${z} is below the floor`);
    }
  }
});

test('the edge ceilings never fall below the terrain at the edges', () => {
  const ground = createGround();
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  for (let along = minZ; along <= maxZ; along += 2.5) {
    assert.ok(ground.heightAt(minX, along) <= edgeCeilingAt('west', along), `west edge at ${along}`);
    assert.ok(ground.heightAt(maxX, along) <= edgeCeilingAt('east', along), `east edge at ${along}`);
  }

  for (let along = minX; along <= maxX; along += 2.5) {
    assert.ok(ground.heightAt(along, minZ) <= edgeCeilingAt('north', along), `north edge at ${along}`);
    assert.ok(ground.heightAt(along, maxZ) <= edgeCeilingAt('south', along), `south edge at ${along}`);
  }
});

test('a view that looks in under the east edge of the world is refused', () => {
  const aspect = 2.1;
  const turned = { ...defaultView(aspect), elevation: MIN_ELEVATION, azimuth: defaultView(aspect).azimuth - MAX_TURN };
  assert.ok(!looksOnlyAtTerrain(frameForView(aspect, turned)));
  assert.ok(looksOnlyAtTerrain(frameForView(aspect, clampView(aspect, turned))));
});

test('every clamped view stays inside the world, whatever is asked for', () => {
  const base = defaultView(1.33);
  const zooms = [0.2, MIN_ZOOM, 2, MAX_ZOOM, 9];
  const elevations = [0, MIN_ELEVATION, 45 * (Math.PI / 180), MAX_ELEVATION, Math.PI / 2];
  const turns = [-2, -MAX_TURN, 0, MAX_TURN, 2];
  const pans = [-400, -90, 0, 90, 400];
  for (const aspect of ASPECTS) {
    const reference = defaultView(aspect);
    for (const zoom of zooms) {
      for (const elevation of elevations) {
        for (const turn of turns) {
          for (const panX of pans) {
            for (const panZ of pans) {
              const view = clampView(aspect, { zoom, elevation, azimuth: reference.azimuth + turn, panX, panZ });
              assert.ok(looksOnlyAtTerrain(frameForView(aspect, view)), `aspect ${aspect}: ${JSON.stringify(view)} shows the edge of the world`);
              assert.ok(view.elevation >= MIN_ELEVATION - 1e-9 && view.elevation <= MAX_ELEVATION + 1e-9);
              assert.ok(Math.abs(view.azimuth - base.azimuth) <= MAX_TURN + 1e-9);
              assert.ok(view.zoom >= MIN_ZOOM);
            }
          }
        }
      }
    }
  }
});

test('clamping is stable: a clamped view clamps to itself', () => {
  const view = clampView(2.1, { zoom: 3, elevation: 0.2, azimuth: 1, panX: 200, panZ: -300 });
  const again = clampView(2.1, view);
  for (const key of Object.keys(view) as (keyof ViewState)[]) {
    assert.ok(Math.abs(view[key] - again[key]) < 1e-9);
  }
});

test('zooming keeps the ground under the cursor where it is', () => {
  const aspect = 2.1;
  const view: ViewState = { ...defaultView(aspect), panX: 12, panZ: -8 };
  const frame = frameForView(aspect, view);
  const [screenX, screenY] = [0.6, -0.3];
  // The ground point under the cursor, on the plane through the target.
  const [lookX, lookZ] = [Math.sin(frame.azimuth), -Math.cos(frame.azimuth)];
  const across = screenX * frame.halfWidth;
  const ahead = (screenY * frame.halfHeight) / Math.sin(frame.elevation);
  const point = [frame.target[0] - lookZ * across + lookX * ahead, frame.target[1], frame.target[2] + lookX * across + lookZ * ahead];
  const zoomed = zoomAtScreen(aspect, view, 3, screenX, screenY);
  const [x, y] = projectToScreen(frameForView(aspect, zoomed), point[0], point[1], point[2]);
  assert.ok(Math.abs(x - screenX) < 1e-9 && Math.abs(y - screenY) < 1e-9);
});

test('dragging pans the ground along with the cursor', () => {
  const aspect = 1.33;
  const view = defaultView(aspect);
  const before = frameForView(aspect, view);
  const point = [before.target[0] + 10, before.target[1], before.target[2] - 6] as const;
  const [x0, y0] = projectToScreen(before, ...point);
  const panned = panByScreen(aspect, view, 0.2, -0.1);
  const [x1, y1] = projectToScreen(frameForView(aspect, panned), ...point);
  assert.ok(Math.abs(x1 - x0 - 0.2) < 1e-9 && Math.abs(y1 - y0 + 0.1) < 1e-9);
});

test('the visitor can zoom out to about half, and the default view zooms out that far', () => {
  assert.ok(MIN_ZOOM <= 0.5);
  const view = clampView(2.1, { ...defaultView(2.1), zoom: MIN_ZOOM });
  assert.ok(view.zoom < 0.65, `zoom ${view.zoom}`);
});

test('the view can pan over the village and out towards the far curve of the line', () => {
  const far = track.sample(150);
  const view = clampView(2.1, { ...defaultView(2.1), elevation: MAX_ELEVATION, zoom: 0.8, panX: far.x - 8, panZ: far.z + 24 });
  assert.ok(view.panX < -250, `pan ${view.panX}`);
});
