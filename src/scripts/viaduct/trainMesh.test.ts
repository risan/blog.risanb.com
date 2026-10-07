import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontUv, liveryLayout, sideUv } from './liveryLayout.ts';
import { CONSIST, END_OVERHANG } from './train.ts';
import { buildHeadLamps, buildTailLamps, buildVehicle, HEAD_LAMPS, type VehicleMesh } from './trainMesh.ts';
import type { BuiltMesh } from './meshBuilder.ts';

const locomotive = CONSIST[0];
const panorama = CONSIST[2];

function bounds(mesh: BuiltMesh) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], mesh.positions[index + axis]);
      high[axis] = Math.max(high[axis], mesh.positions[index + axis]);
    }
  }

  return { low, high };
}

function everyMesh(vehicle: VehicleMesh): BuiltMesh[] {
  return [vehicle.body, vehicle.glass];
}

test('the vehicles have the published width and fit within their length over the couplers', () => {
  for (const spec of [locomotive, panorama]) {
    const { low, high } = bounds(buildVehicle(spec).body);
    assert.ok(Math.abs(high[2] - 1.325) < 0.01 && Math.abs(low[2] + 1.325) < 0.01, `${spec.kind} is 2.65 m wide`);
    assert.ok(high[0] <= spec.length / 2 + 1e-6 && low[0] >= -spec.length / 2 - 1e-6, `${spec.kind} stays within its length`);
    assert.ok(high[0] > spec.length / 2 - 0.05, `${spec.kind} reaches its couplers`);
    assert.ok(low[1] >= 0 && low[1] < 0.05, `${spec.kind} stands on the rails`);
  }
});

test('the coach is 3.54 m high plus its roof box and the locomotive raises a pantograph to the wire', () => {
  const coach = bounds(buildVehicle(panorama).body);
  assert.ok(coach.high[1] > 3.7 && coach.high[1] < 3.8);
  const loco = bounds(buildVehicle(locomotive).body);
  assert.ok(loco.high[1] > 5.4 && loco.high[1] <= 5.5, `pantograph top ${loco.high[1]}`);
});

test('the locomotive has no side buffers and its coupler sits on the middle line', () => {
  const { body } = buildVehicle(locomotive);
  const front = locomotive.length / 2 - 0.2;
  for (let index = 0; index < body.positions.length; index += 3) {
    // Nothing sticks out beyond the body at the ends except the plough and the central coupler.
    if (body.positions[index] > front) {
      assert.ok(Math.abs(body.positions[index + 2]) < 1.3, 'only the front face of the cab and the central parts reach this far');
    }
  }

  const reach = locomotive.length / 2;
  let coupler = 0;
  for (let index = 0; index < body.positions.length; index += 3) {
    if (body.positions[index] > reach - 0.01) {
      coupler += 1;
      assert.ok(Math.abs(body.positions[index + 2]) <= 0.13, `a part at z=${body.positions[index + 2]} reaches the end of the vehicle`);
    }
  }

  assert.ok(coupler > 0);
});

test('every mesh is well formed', () => {
  for (const spec of [locomotive, panorama]) {
    for (const mesh of everyMesh(buildVehicle(spec))) {
      const vertexCount = mesh.positions.length / 3;
      assert.equal(mesh.normals.length, mesh.positions.length);
      assert.equal(mesh.uvs.length / 2, vertexCount);
      assert.equal(mesh.colors.length, mesh.positions.length);
      assert.ok(mesh.indices.length % 3 === 0 && mesh.indices.length > 0);
      assert.ok(mesh.indices.every((index) => index < vertexCount));
      for (let index = 0; index < mesh.normals.length; index += 3) {
        const length = Math.hypot(mesh.normals[index], mesh.normals[index + 1], mesh.normals[index + 2]);
        assert.ok(Math.abs(length - 1) < 1e-3, `normal of length ${length}`);
      }
    }
  }
});

test('a vehicle is the same on both sides of its middle line', () => {
  for (const spec of [locomotive, panorama]) {
    const { low, high } = bounds(buildVehicle(spec).body);
    assert.ok(Math.abs(low[2] + high[2]) < 1e-6);
  }
});

test('the textured paint reads the side picture the same way on both sides', () => {
  for (const spec of [locomotive, panorama]) {
    const layout = liveryLayout(spec);
    const { body } = buildVehicle(spec);
    let checked = 0;
    for (let index = 0; index < body.positions.length / 3; index += 1) {
      const [x, y, z] = [body.positions[index * 3], body.positions[index * 3 + 1], body.positions[index * 3 + 2]];
      const white = body.colors[index * 3] === 1 && body.colors[index * 3 + 1] === 1;
      const flatWall = Math.abs(Math.abs(z) - 1.325) < 1e-6;
      if (!white || !flatWall || y < layout.wallBottom + 0.1 || y > layout.wallTop - 0.2) {
        continue;
      }

      const [u, v] = [body.uvs[index * 2], body.uvs[index * 2 + 1]];
      const [expectedU, expectedV] = sideUv(layout, z > 0 ? 'right' : 'left', x, y);
      assert.ok(Math.abs(u - expectedU) < 1e-5 && Math.abs(v - expectedV) < 1e-5, `uv of a wall point at ${x}, ${y}, ${z}`);
      checked += 1;
    }

    assert.ok(checked > 8, `${spec.kind} has textured wall points`);
  }
});

test('the cab fronts use the front picture at both ends', () => {
  const layout = liveryLayout(locomotive);
  const { body } = buildVehicle(locomotive);
  let front = 0;
  let rear = 0;
  for (let index = 0; index < body.positions.length / 3; index += 1) {
    const [x, y, z] = [body.positions[index * 3], body.positions[index * 3 + 1], body.positions[index * 3 + 2]];
    const faceX = body.normals[index * 3];
    if (Math.abs(faceX) < 0.999 || Math.abs(Math.abs(x) - (locomotive.length / 2 - END_OVERHANG)) > 1e-6 || body.colors[index * 3] !== 1) {
      continue;
    }

    const end = faceX > 0 ? 'front' : 'rear';
    const [expectedU, expectedV] = frontUv(layout, end, z, y);
    assert.ok(Math.abs(body.uvs[index * 2] - expectedU) < 1e-5 && Math.abs(body.uvs[index * 2 + 1] - expectedV) < 1e-5);
    if (end === 'front') {
      front += 1;
    } else {
      rear += 1;
    }
  }

  assert.ok(front >= 8 && rear >= 8);
});

test('a coach has seven windows on each side and the door end has no window row', () => {
  const { glass } = buildVehicle(panorama);
  const sideX = new Set<number>();
  for (let index = 0; index < glass.positions.length; index += 3) {
    const [x, y, z] = [glass.positions[index], glass.positions[index + 1], glass.positions[index + 2]];
    if (z > 1.3 && y > 1.6 && y < 3.0 && Math.abs(glass.normals[index + 2]) > 0.99) {
      sideX.add(Number(x.toFixed(3)));
    }
  }

  // Two edges per large window and per small window (the gangway end and the door).
  assert.equal(sideX.size, (7 + 2) * 2);
});

test('the panorama roof glass bends in a few straight steps rather than a round tube', () => {
  const { glass } = buildVehicle(panorama);
  const slopes = new Set<number>();
  for (let index = 0; index < glass.normals.length; index += 3) {
    if (glass.positions[index + 2] > 0 && glass.normals[index + 1] > 0.05) {
      slopes.add(Number(glass.normals[index + 1].toFixed(2)));
    }
  }

  assert.ok(slopes.size >= 3 && slopes.size <= 6, `${slopes.size} distinct roof glass slopes`);
});

test('the leading lamps are three and the tail lamps are two, at the ends of the right vehicles', () => {
  const head = buildHeadLamps(locomotive);
  assert.equal(head.positions.length / 3, HEAD_LAMPS.length * 4);
  const headBounds = bounds(head);
  assert.ok(headBounds.low[0] > locomotive.length / 2 - END_OVERHANG);

  const tail = buildTailLamps(panorama);
  assert.equal(tail.positions.length / 3, 2 * 4);
  assert.ok(bounds(tail).high[0] < -panorama.length / 2);
});

test('the train stays within the triangle budget', () => {
  let triangles = 0;
  for (const spec of CONSIST) {
    const vehicle = buildVehicle(spec);
    triangles += (vehicle.body.indices.length + vehicle.glass.indices.length) / 3;
  }

  assert.ok(triangles < 30000, `${triangles} triangles in the consist`);
});
