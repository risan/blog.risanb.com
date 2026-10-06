// The geometry of the Bernina Express vehicles, one pair of meshes (painted body and glass) per
// kind. Each vehicle is modelled with its front towards +x, the rail top at y = 0 and the right
// side towards +z. Pure: it returns merged geometry.

import { hexToLinear, MeshBuilder, mixColor, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import { mulberry32 } from '../river/world.ts';
import type { VehicleKind } from './train.ts';
import { CONSIST } from './train.ts';

const RED = hexToLinear(0xc4161c);
const DARK_RED = hexToLinear(0x8f1117);
const WHITE = hexToLinear(0xf3f1ec);
const ROOF_GREY = hexToLinear(0xb9bcbd);
const ROOF_WHITE = hexToLinear(0xe3e4e1);
const EQUIPMENT = hexToLinear(0x8f9496);
const UNDERFRAME = hexToLinear(0x2d2f31);
const TEAL = hexToLinear(0x1b6877);
const WRAP_WHITE = hexToLinear(0xdde2e3);
const BUFFER = hexToLinear(0x555a5c);
const PANTOGRAPH = hexToLinear(0x2f3234);

const HALF_WIDTH = 1.325;
const GLASS_PROUD = 0.02;
const BELLOWS_LENGTH = 0.4;
// The contact wire hangs at 5.5 m; the collector strip touches it.
const COLLECTOR_HEIGHT = 5.46;

export interface VehicleMesh {
  body: BuiltMesh;
  glass: BuiltMesh;
}

type ProfilePoint = [number, number];

interface Profile {
  // The right half of the cross-section from the underside up to the middle of the roof.
  points: ProfilePoint[];
  // One colour per segment between consecutive points.
  colors: Rgb[];
}

const PANORAMA_PROFILE: Profile = {
  points: [[1.15, 0.62], [1.3, 0.8], [HALF_WIDTH, 1.5], [HALF_WIDTH, 2.7], [1.0, 3.4], [0, 3.62]],
  colors: [UNDERFRAME, RED, RED, RED, ROOF_WHITE],
};

const STANDARD_PROFILE: Profile = {
  points: [[1.15, 0.62], [1.3, 0.8], [HALF_WIDTH, 1.5], [HALF_WIDTH, 2.7], [1.05, 3.3], [0, 3.62]],
  colors: [UNDERFRAME, RED, RED, RED, ROOF_GREY],
};

const LOCOMOTIVE_PROFILE: Profile = {
  points: [[1.2, 0.55], [HALF_WIDTH, 0.75], [HALF_WIDTH, 3.0], [1.15, 3.5], [0.7, 3.7], [0, 3.72]],
  colors: [UNDERFRAME, RED, RED, ROOF_GREY, ROOF_GREY],
};

const WRAP_PROFILE: Profile = {
  points: [[1.2, 0.55], [HALF_WIDTH, 0.75], [HALF_WIDTH, 1.7], [HALF_WIDTH, 3.0], [1.15, 3.5], [0.7, 3.7], [0, 3.72]],
  colors: [UNDERFRAME, TEAL, WRAP_WHITE, ROOF_GREY, ROOF_GREY, ROOF_GREY],
};

function lerpPoint(from: ProfilePoint, to: ProfilePoint, t: number): ProfilePoint {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

// Sweeps the profile along x, on both sides, and closes both ends with flat caps.
function extrude(builder: MeshBuilder, profile: Profile, x0: number, x1: number, capColor: Rgb) {
  const { points, colors } = profile;
  const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [z0, y0] = points[index];
    const [z1, y1] = points[index + 1];
    builder.flatQuad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], uv, colors[index]);
    builder.flatQuad([x1, y0, -z0], [x0, y0, -z0], [x0, y1, -z1], [x1, y1, -z1], uv, colors[index]);
  }

  const outline: ProfilePoint[] = [...points, ...[...points].reverse().slice(1).map(([z, y]): ProfilePoint => [-z, y])];
  for (const [x, facing] of [[x0, -1], [x1, 1]] as const) {
    builder.polygon(outline.map(([z, y]): Vec3 => [x, y, z]), capColor, [facing, 0, 0]);
  }
}

// A rectangle of glass or paint on the side of the vehicle, a hair outside the wall.
function sideRectangle(builder: MeshBuilder, x0: number, x1: number, y0: number, y1: number, color: Rgb, z = HALF_WIDTH + GLASS_PROUD) {
  const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  builder.flatQuad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], uv, color);
  builder.flatQuad([x1, y0, -z], [x0, y0, -z], [x0, y1, -z], [x1, y1, -z], uv, color);
}

// A strip of glass on the sloping shoulder of the roof, between two points of the profile.
function roofRectangle(builder: MeshBuilder, profile: Profile, segment: number, x0: number, x1: number, from: number, to: number, color: Rgb) {
  const start = lerpPoint(profile.points[segment], profile.points[segment + 1], from);
  const end = lerpPoint(profile.points[segment], profile.points[segment + 1], to);
  const dz = profile.points[segment + 1][0] - profile.points[segment][0];
  const dy = profile.points[segment + 1][1] - profile.points[segment][1];
  const length = Math.hypot(dz, dy);
  // Outward normal of the right-hand slope.
  const nz = (dy / length) * GLASS_PROUD;
  const ny = (-dz / length) * GLASS_PROUD;
  const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  builder.flatQuad([x0, start[1] + ny, start[0] + nz], [x1, start[1] + ny, start[0] + nz], [x1, end[1] + ny, end[0] + nz], [x0, end[1] + ny, end[0] + nz], uv, color);
  builder.flatQuad([x1, start[1] + ny, -(start[0] + nz)], [x0, start[1] + ny, -(start[0] + nz)], [x0, end[1] + ny, -(end[0] + nz)], [x1, end[1] + ny, -(end[0] + nz)], uv, color);
}

function bogies(body: MeshBuilder, bogieSpacing: number) {
  for (const x of [-bogieSpacing / 2, bogieSpacing / 2]) {
    body.box([x, 0.12, 0], [2.7, 0.62, 2.05], 0, UNDERFRAME);
    for (const axle of [-0.9, 0.9]) {
      body.box([x + axle, 0.02, 0], [0.9, 0.9, 1.55], 0, hexToLinear(0x1f2123));
    }
  }
}

// A thin bar between two points in the side view, `across` metres to the side of the middle.
function bar(body: MeshBuilder, from: [number, number], to: [number, number], across: number) {
  const [left, right] = from[0] <= to[0] ? [from, to] : [to, from];
  const run = Math.max(right[0] - left[0], 0.05);
  body.box(
    [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2 - 0.035, across],
    [run, 0.07, 0.07],
    0,
    PANTOGRAPH,
    { pitch: Math.atan2(right[1] - left[1], run) },
  );
}

// A single-arm pantograph: a base frame, a lower arm up to the knee and an upper arm back to the
// collector strip that touches the contact wire.
function pantograph(body: MeshBuilder, x: number, top: number) {
  body.box([x, top, 0], [1.4, 0.12, 1.2], 0, PANTOGRAPH);
  const baseY = top + 0.12;
  for (const across of [-0.4, 0.4]) {
    bar(body, [x + 0.5, baseY], [x - 0.35, baseY + 0.95], across);
    bar(body, [x - 0.35, baseY + 0.95], [x + 0.4, COLLECTOR_HEIGHT - 0.04], across);
  }

  body.box([x + 0.4, COLLECTOR_HEIGHT - 0.06, 0], [0.14, 0.08, 1.8], 0, PANTOGRAPH);
}

function buildLocomotive(spec: { length: number; bogieSpacing: number }, wrapped: boolean): VehicleMesh {
  const body = new MeshBuilder();
  const glass = new MeshBuilder();
  const half = spec.length / 2;
  const profile = wrapped ? WRAP_PROFILE : LOCOMOTIVE_PROFILE;
  const capColor = wrapped ? WRAP_WHITE : RED;
  extrude(body, profile, -half, half, capColor);
  bogies(body, spec.bogieSpacing);
  body.box([0, 0.55, 0], [spec.length - 1.2, 0.3, 2.0], 0, UNDERFRAME);

  const window = hexToLinear(0x172228);
  // Cab side windows near both ends, and louvres along the middle.
  for (const end of [-1, 1]) {
    const nearEnd = end * (half - 0.35);
    const farEnd = end * (half - 1.55);
    sideRectangle(glass, Math.min(nearEnd, farEnd), Math.max(nearEnd, farEnd), 2.05, 2.95, window);
    // The two end windows and the headlamps on the cab front.
    const x = end * (half + 0.012);
    const front = (z0: number, z1: number, y0: number, y1: number, color: Rgb) => {
      const points: Vec3[] = [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]];
      (color === window ? glass : body).polygon(points, color, [end, 0, 0]);
    };
    front(-1.08, -0.1, 2.05, 3.0, window);
    front(0.1, 1.08, 2.05, 3.0, window);
    front(-1.05, -0.8, 0.95, 1.15, WHITE);
    front(0.8, 1.05, 0.95, 1.15, WHITE);
    for (const z of [-0.9, 0.9]) {
      body.box([end * (half + 0.15), 0.9, z], [0.3, 0.3, 0.3], 0, BUFFER);
    }
  }

  const louvre = mixColor(wrapped ? TEAL : DARK_RED, UNDERFRAME, 0.35);
  for (let group = 0; group < 4; group += 1) {
    const x0 = -half + 3.4 + group * 2.4;
    sideRectangle(body, x0, x0 + 1.5, 1.35, 2.7, louvre, HALF_WIDTH + 0.012);
  }

  // Roof equipment: grey boxes, and one raised pantograph on each locomotive.
  body.box([-3.4, 3.7, 0], [2.4, 0.35, 1.1], 0, EQUIPMENT);
  body.box([3.2, 3.7, 0], [1.6, 0.3, 1.0], 0, EQUIPMENT);
  pantograph(body, 0.3, 3.7);

  return { body: body.build(), glass: glass.build() };
}

function buildCoach(spec: { length: number; bogieSpacing: number }, panorama: boolean): VehicleMesh {
  const body = new MeshBuilder();
  const glass = new MeshBuilder();
  const half = spec.length / 2;
  const profile = panorama ? PANORAMA_PROFILE : STANDARD_PROFILE;
  extrude(body, profile, -half, half, RED);
  bogies(body, spec.bogieSpacing);
  body.box([0, 0.55, 0], [spec.length - 1.4, 0.3, 2.0], 0, UNDERFRAME);

  const window = hexToLinear(panorama ? 0x1a2a31 : 0x20323a);
  const windowCount = panorama ? 9 : 10;
  const usable = spec.length - 2.8;
  const pitch = usable / windowCount;
  const width = pitch * (panorama ? 0.8 : 0.62);
  for (let index = 0; index < windowCount; index += 1) {
    const x0 = -half + 1.4 + index * pitch + (pitch - width) / 2;
    if (panorama) {
      sideRectangle(glass, x0, x0 + width, 1.62, 2.62, window);
      roofRectangle(glass, profile, 3, x0, x0 + width, 0.12, 0.88, window);
    } else {
      sideRectangle(glass, x0, x0 + width, 1.75, 2.5, window);
    }
  }

  // The white band with the lettering, drawn as short dashes.
  const random = mulberry32(spec.length === 18.5 ? 31 : 33);
  let x = -half + 2.2;
  while (x < half - 2.6) {
    const dash = 0.18 + random() * 0.3;
    sideRectangle(body, x, x + dash, 1.16, 1.34, WHITE, HALF_WIDTH + 0.012);
    x += dash + 0.07 + random() * 0.07;
  }

  if (panorama) {
    // A broad white stripe under the windows, as on the real coaches.
    sideRectangle(body, -half + 0.9, half - 0.9, 1.44, 1.5, WHITE, HALF_WIDTH + 0.01);
  }

  // Gangway bellows close the gap to the next vehicle.
  for (const end of [-1, 1]) {
    body.box([end * (half + BELLOWS_LENGTH / 2), 0.8, 0], [BELLOWS_LENGTH, 2.75, 2.2], 0, UNDERFRAME);
  }

  return { body: body.build(), glass: glass.build() };
}

export function buildVehicle(kind: VehicleKind): VehicleMesh {
  const spec = CONSIST.find((vehicle) => vehicle.kind === kind);
  if (!spec) {
    throw new Error(`viaduct: no vehicle of kind ${kind}`);
  }

  switch (kind) {
    case 'locomotive':
      return buildLocomotive(spec, false);
    case 'locomotiveWrap':
      return buildLocomotive(spec, true);
    case 'standard':
      return buildCoach(spec, false);
    case 'panorama':
      return buildCoach(spec, true);
  }
}
