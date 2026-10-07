// The geometry of the Bernina Express vehicles: the RhB ABe 4/4 III locomotive and the Bp
// panorama coach, each as a painted body (textured by its livery, see liveryLayout.ts) and a
// separate mesh of glass. Each vehicle is modelled with its front towards +x, the rail top at
// y = 0 and the right side towards +z. Pure: it returns merged geometry.
//
// Both vehicles are drawn once and read the same side picture on both sides; the left side is the
// right side turned half way round, so the doors and windows of a left side are not in the same
// place as those of the right. `p` is the distance along a side picture, from its left edge.

import { hexToLinear, MeshBuilder, mixColor, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import {
  bodyHalfLength,
  frontUv,
  liveryLayout,
  sideUv,
  solidUv,
  VEHICLE_HALF_WIDTH as HALF_WIDTH,
  type End,
  type LiveryLayout,
  type Side,
} from './liveryLayout.ts';
import { END_OVERHANG, type VehicleSpec } from './train.ts';

const WHITE_TEXEL: Rgb = [1, 1, 1];
const RED = hexToLinear(0xc8141b);
const ROOF_SILVER = hexToLinear(0xb4babd);
const ROOF_WHITE = hexToLinear(0xdcdedd);
const EQUIPMENT = hexToLinear(0x9aa1a4);
const VENT_DARK = hexToLinear(0x30363a);
const UNDERFRAME = hexToLinear(0x2a2c2f);
const WHEEL = hexToLinear(0x232426);
const COUPLER = hexToLinear(0x3b3e41);
const PILOT = hexToLinear(0x62676a);
const BELLOWS = hexToLinear(0x3a3d41);
const END_DOOR = hexToLinear(0x9ea3a6);
const END_WINDOW = hexToLinear(0x1b2024);
const PANTOGRAPH = hexToLinear(0x2f3234);
const GLASS_LOW = hexToLinear(0x36424a);
const GLASS_HIGH = hexToLinear(0x72828e);

const GLASS_PROUD = 0.02;
// The contact wire hangs at 5.5 m; the collector strip touches it.
const COLLECTOR_HEIGHT = 5.46;
const LOCOMOTIVE_ROOF_TOP = 3.6;
const PANORAMA_ROOF_TOP = 3.55;

export interface VehicleMesh {
  body: BuiltMesh;
  glass: BuiltMesh;
}

type ProfilePoint = [number, number];

interface Profile {
  // The right half of the cross-section, from the underside up to the middle of the roof.
  points: ProfilePoint[];
  // For each segment between two points: whether it takes its paint from the livery texture.
  wall: boolean[];
  // The colour of a segment that is not painted, for the quad of that segment at `x` on `side`.
  color: (segment: number, x: number, side: Side) => Rgb;
}

// A cross-section along the vehicle. `shrink` pulls the section in towards the middle line (the
// rounded corners of a cab) and `drop` lowers its roof (the sloping top of a cab front).
interface Section {
  x: number;
  shrink: number;
  drop: number;
}

type Quad4<T> = [T, T, T, T];

function sidePoint(spec: VehicleSpec, side: Side, p: number, y: number, z: number): Vec3 {
  const half = bodyHalfLength(spec);

  return side === 'right' ? [p - half, y, z] : [half - p, y, -z];
}

// Sweeps the profile along the sections on both sides. Normals are smoothed around the profile and
// along the rounded ends only, so flat walls stay flat.
function loft(builder: MeshBuilder, profile: Profile, sections: Section[], layout: LiveryLayout, dropFrom: number | null) {
  const { points } = profile;
  const roofTop = points[points.length - 1][1];
  const rings: Vec3[][] = sections.map((section) =>
    points.map(([z, y]): Vec3 => {
      const lowering = dropFrom === null ? 0 : Math.min(Math.max((y - dropFrom) / (roofTop - dropFrom), 0), 1) * section.drop;

      return [section.x, y - lowering, z * (1 - section.shrink)];
    }),
  );
  const rows = sections.length - 1;
  const segments = points.length - 1;
  const rounded = Array.from({ length: rows }, (_, row) => sections[row].shrink !== 0 || sections[row + 1].shrink !== 0);

  // Unnormalised face normals, so that larger faces count for more.
  const faces: Vec3[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: segments }, (_, segment) => {
      const a = rings[row][segment];
      const c = rings[row + 1][segment + 1];
      const b = rings[row + 1][segment];
      const d = rings[row][segment + 1];
      const [ux, uy, uz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const [vx, vy, vz] = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];

      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    }),
  );

  const normalAt = (ownRow: number, row: number, point: number): Vec3 => {
    let sum: Vec3 = [0, 0, 0];
    for (const faceRow of [row - 1, row]) {
      if (faceRow < 0 || faceRow >= rows || !(faceRow === ownRow || (rounded[faceRow] && rounded[ownRow]))) {
        continue;
      }

      for (const faceSegment of [point - 1, point]) {
        if (faceSegment < 0 || faceSegment >= segments) {
          continue;
        }

        const face = faces[faceRow][faceSegment];
        sum = [sum[0] + face[0], sum[1] + face[1], sum[2] + face[2]];
      }
    }

    // The middle line of the roof is a mirror plane.
    const z = point === points.length - 1 ? 0 : sum[2];
    const length = Math.hypot(sum[0], sum[1], z) || 1;

    return [sum[0] / length, sum[1] / length, z / length];
  };

  for (const side of ['right', 'left'] as const) {
    const sign = side === 'right' ? 1 : -1;
    for (let row = 0; row < rows; row += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const corners: Quad4<[number, number]> = [[row, segment], [row + 1, segment], [row + 1, segment + 1], [row, segment + 1]];
        const xMid = (sections[row].x + sections[row + 1].x) / 2;
        const color = profile.wall[segment] ? WHITE_TEXEL : profile.color(segment, xMid, side);
        const ids = corners.map(([cornerRow, point]) => {
          const [x, y, z] = rings[cornerRow][point];
          const normal = normalAt(row, cornerRow, point);
          const uv = profile.wall[segment] ? sideUv(layout, side, x, y) : solidUv(layout);

          return builder.vertex([x, y, z * sign], [normal[0], normal[1], normal[2] * sign], uv, color);
        });
        if (side === 'right') {
          builder.quad(ids[0], ids[1], ids[2], ids[3]);
        } else {
          builder.quad(ids[0], ids[3], ids[2], ids[1]);
        }
      }
    }
  }
}

// Closes one end of a loft with a flat face made of the outline of its last section.
function cap(builder: MeshBuilder, profile: Profile, section: Section, outward: 1 | -1, layout: LiveryLayout, front: End | null, dropFrom: number | null) {
  const roofTop = profile.points[profile.points.length - 1][1];
  const right = profile.points.map(([z, y]): [number, number] => {
    const lowering = dropFrom === null ? 0 : Math.min(Math.max((y - dropFrom) / (roofTop - dropFrom), 0), 1) * section.drop;

    return [z * (1 - section.shrink), y - lowering];
  });
  const outline = [...right, ...[...right].reverse().slice(1).map(([z, y]): [number, number] => [-z, y])];
  const uv = front === null ? () => solidUv(layout) : (point: Vec3) => frontUv(layout, front, point[2], point[1]);
  builder.polygon(
    outline.map(([z, y]): Vec3 => [section.x, y, z]),
    front === null ? RED : WHITE_TEXEL,
    [outward, 0, 0],
    uv,
  );
}

// A rectangle of glass on a side wall, a hair outside it, in the order the viewer sees it.
function wallGlass(glass: MeshBuilder, spec: VehicleSpec, side: Side, p0: number, p1: number, y0: number, y1: number) {
  const z = HALF_WIDTH + GLASS_PROUD;
  const low = glassColor(y0);
  const high = glassColor(y1);
  const corners: Quad4<[number, number, Rgb]> = [[p0, y0, low], [p1, y0, low], [p1, y1, high], [p0, y1, high]];
  const ids = corners.map(([p, y, color]) =>
    glass.vertex(sidePoint(spec, side, p, y, z), [0, 0, side === 'right' ? 1 : -1], [0, 0], color),
  );
  glass.quad(ids[0], ids[1], ids[2], ids[3]);
}

function glassColor(y: number): Rgb {
  return mixColor(GLASS_LOW, GLASS_HIGH, Math.min(Math.max((y - 1.6) / 2, 0), 1));
}

// A window that starts on the wall and carries on over the shoulder of the roof along the profile.
function wrapAroundGlass(glass: MeshBuilder, spec: VehicleSpec, profile: Profile, side: Side, p0: number, p1: number, wallY: number, lastPoint: number) {
  const path: ProfilePoint[] = [[HALF_WIDTH, wallY], ...profile.points.slice(profile.points.findIndex(([, y]) => y > wallY), lastPoint + 1)];
  const outward = (from: ProfilePoint, to: ProfilePoint): ProfilePoint => {
    const dz = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dz, dy);

    return [dy / length, -dz / length];
  };
  const normals = path.map((point, index): ProfilePoint => {
    const before = index > 0 ? outward(path[index - 1], point) : outward(point, path[index + 1]);
    const after = index < path.length - 1 ? outward(point, path[index + 1]) : before;
    const length = Math.hypot(before[0] + after[0], before[1] + after[1]);

    return [(before[0] + after[0]) / length, (before[1] + after[1]) / length];
  });
  const sign = side === 'right' ? 1 : -1;
  const ids = (p: number) =>
    path.map(([z, y], index) => {
      const [nz, ny] = normals[index];

      return glass.vertex(
        sidePoint(spec, side, p, y + ny * GLASS_PROUD, z + nz * GLASS_PROUD),
        [0, ny, nz * sign],
        [0, 0],
        glassColor(y),
      );
    });
  const start = ids(p0);
  const end = ids(p1);
  for (let index = 0; index < path.length - 1; index += 1) {
    glass.quad(start[index], end[index], end[index + 1], start[index + 1]);
  }
}

// The step under a door, at `p` along the side picture.
function doorStep(body: MeshBuilder, spec: VehicleSpec, side: Side, p: number, uv: [number, number]) {
  const [x, , z] = sidePoint(spec, side, p, 0, HALF_WIDTH - 0.2);
  body.box([x, 0.32, z], [0.85, 0.05, 0.3], 0, UNDERFRAME, { uv });
}

// An upright cylinder-like wheel with its axis along z.
function wheel(body: MeshBuilder, x: number, y: number, z: number, radius: number, width: number, uv: [number, number]) {
  const segments = 14;
  const z0 = z - width / 2;
  const z1 = z + width / 2;
  const around = (index: number): [number, number] => [Math.cos((index / segments) * Math.PI * 2), Math.sin((index / segments) * Math.PI * 2)];
  for (let index = 0; index < segments; index += 1) {
    const [c0, s0] = around(index);
    const [c1, s1] = around(index + 1);
    const corners: Quad4<Vec3> = [
      [x + radius * c0, y + radius * s0, z0],
      [x + radius * c1, y + radius * s1, z0],
      [x + radius * c1, y + radius * s1, z1],
      [x + radius * c0, y + radius * s0, z1],
    ];
    body.flatQuad(...corners, [uv, uv, uv, uv], WHEEL);
  }

  for (const [faceZ, outward] of [[z0, -1], [z1, 1]] as const) {
    const ring = Array.from({ length: segments }, (_, index): Vec3 => {
      const [c, s] = around(index);

      return [x + radius * c, y + radius * s, faceZ];
    });
    body.polygon(ring, WHEEL, [0, 0, outward], () => uv);
  }
}

// Two axles with their wheels, the side frames and the cross beam of one bogie.
function bogie(body: MeshBuilder, x: number, wheelRadius: number, wheelbase: number, motors: boolean, uv: [number, number]) {
  for (const axle of [-wheelbase / 2, wheelbase / 2]) {
    for (const side of [-1, 1]) {
      wheel(body, x + axle, wheelRadius, side * 0.53, wheelRadius, 0.14, uv);
    }

    body.box([x + axle, wheelRadius - 0.05, 0], [0.1, 0.1, 1.1], 0, UNDERFRAME, { uv });
    if (motors) {
      body.box([x + axle * 0.55, wheelRadius - 0.1, 0], [0.55, 0.42, 0.7], 0, UNDERFRAME, { uv });
    }
  }

  for (const side of [-1, 1]) {
    body.box([x, wheelRadius + 0.02, side * 0.84], [wheelbase + 0.9, 0.24, 0.14], 0, UNDERFRAME, { uv });
  }

  body.box([x, wheelRadius + 0.04, 0], [0.35, 0.2, 1.7], 0, UNDERFRAME, { uv });
}

// A thin bar between two points in the side view, `across` metres to the side of the middle.
function bar(body: MeshBuilder, from: [number, number], to: [number, number], across: number, uv: [number, number]) {
  const [left, right] = from[0] <= to[0] ? [from, to] : [to, from];
  const run = Math.max(right[0] - left[0], 0.05);
  body.box(
    [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2 - 0.035, across],
    [run, 0.07, 0.07],
    0,
    PANTOGRAPH,
    { pitch: Math.atan2(right[1] - left[1], run), uv },
  );
}

// A single-arm pantograph: a base frame, a lower arm up to the knee and an upper arm back to the
// collector strip. Raised, the strip touches the contact wire.
function pantograph(body: MeshBuilder, x: number, top: number, raised: boolean, uv: [number, number]) {
  body.box([x, top, 0], [1.4, 0.12, 1.2], 0, PANTOGRAPH, { uv });
  const baseY = top + 0.12;
  const kneeY = baseY + (raised ? 0.95 : 0.28);
  const collectorY = raised ? COLLECTOR_HEIGHT : baseY + 0.5;
  for (const across of [-0.4, 0.4]) {
    bar(body, [x + 0.5, baseY], [x - 0.35, kneeY], across, uv);
    bar(body, [x - 0.35, kneeY], [x + 0.4, collectorY - 0.04], across, uv);
  }

  body.box([x + 0.4, collectorY - 0.06, 0], [0.14, 0.08, 1.8], 0, PANTOGRAPH, { uv });
}

const LOCOMOTIVE_PROFILE: Profile = {
  points: [[1.17, 0.55], [1.3, 0.95], [HALF_WIDTH, 1.25], [HALF_WIDTH, 3.1], [1.27, 3.22], [1.1, 3.4], [0.8, 3.52], [0.4, 3.58], [0, LOCOMOTIVE_ROOF_TOP]],
  wall: [true, true, true, false, false, false, false, false],
  color: () => ROOF_SILVER,
};

const CAB_RADIUS = 0.32;
const CAB_ROOF_DROP = 0.22;
const CAB_ROOF_FROM = 3.1;

// The rounded corners of the cab at each end, quarter by quarter, and nothing in between.
function locomotiveSections(half: number): Section[] {
  const quarters = [0, 30, 60, 90].map((degrees) => {
    const angle = (degrees * Math.PI) / 180;

    return {
      x: half - CAB_RADIUS + CAB_RADIUS * Math.sin(angle),
      shrink: (CAB_RADIUS * (1 - Math.cos(angle))) / HALF_WIDTH,
      drop: CAB_ROOF_DROP * (1 - Math.cos(angle)),
    };
  });
  const rear = quarters.map((section) => ({ ...section, x: -section.x })).reverse();

  return [...rear, ...quarters];
}

// Windows in the side picture of the locomotive: from the front end towards the rear.
export const LOCOMOTIVE_WINDOWS: [number, number][] = [[0.8, 1.4], [3.2, 4.7], [5.1, 6.5], [7.1, 7.7], [10.56, 11.97], [12.6, 13.9], [15.0, 15.65]];
export const LOCOMOTIVE_WINDOW_BOTTOM = 1.9;
export const LOCOMOTIVE_WINDOW_TOP = 2.95;

export const HEAD_LAMPS: { z: number; y: number; width: number; height: number }[] = [
  { z: -0.775, y: 1.65, width: 0.26, height: 0.13 },
  { z: 0.775, y: 1.65, width: 0.26, height: 0.13 },
  { z: 0, y: 3.22, width: 0.3, height: 0.14 },
];

function buildLocomotive(spec: VehicleSpec): VehicleMesh {
  const body = new MeshBuilder();
  const glass = new MeshBuilder();
  const layout = liveryLayout(spec);
  const half = bodyHalfLength(spec);
  const solid = solidUv(layout);
  const sections = locomotiveSections(half);
  loft(body, LOCOMOTIVE_PROFILE, sections, layout, CAB_ROOF_FROM);
  cap(body, LOCOMOTIVE_PROFILE, sections[sections.length - 1], 1, layout, 'front', CAB_ROOF_FROM);
  cap(body, LOCOMOTIVE_PROFILE, sections[0], -1, layout, 'rear', CAB_ROOF_FROM);

  for (const side of ['right', 'left'] as const) {
    for (const [p0, p1] of LOCOMOTIVE_WINDOWS) {
      wallGlass(glass, spec, side, p0, p1, LOCOMOTIVE_WINDOW_BOTTOM, LOCOMOTIVE_WINDOW_TOP);
    }
  }

  for (const x of [-spec.bogieSpacing / 2, spec.bogieSpacing / 2]) {
    bogie(body, x, 0.39, 2.2, true, solid);
  }

  for (const side of ['right', 'left'] as const) {
    doorStep(body, spec, side, 9.5, solid);
  }

  // Equipment hung under the floor between the bogies.
  for (const x of [-1.9, 1.9]) {
    body.box([x, 0.34, 0], [1.9, 0.24, 1.8], 0, UNDERFRAME, { uv: solid });
  }

  for (const end of [-1, 1]) {
    // The snowplough under the cab and the central coupler.
    body.box([end * (half + 0.02), 0.26, 0], [0.34, 0.34, 1.8], 0, PILOT, { uv: solid });
    body.box([end * (half + 0.17), 0.62, 0], [0.36, 0.2, 0.24], 0, COUPLER, { uv: solid });
    for (const z of [-0.45, 0.45]) {
      body.box([end * (half - 0.05), 0.5, z], [0.16, 0.1, 0.12], 0, COUPLER, { uv: solid });
    }
  }

  // Roof equipment, from the front end: the cab hood, the folded pantograph, a resistor tray, the
  // fan housing, another tray and the raised pantograph. The grilles are dark patches on top.
  const alongRoof = (p: number) => half - p;
  const housing = (p0: number, p1: number, width: number, height: number) => {
    const centre = alongRoof((p0 + p1) / 2);
    body.box([centre, LOCOMOTIVE_ROOF_TOP - 0.06, 0], [p1 - p0, height + 0.06, width], 0, EQUIPMENT, { uv: solid });
    body.box([centre, LOCOMOTIVE_ROOF_TOP + height + 0.002, 0], [(p1 - p0) * 0.78, 0.02, width * 0.7], 0, VENT_DARK, { uv: solid });
  };
  housing(0.5, 2.5, 1.7, 0.26);
  housing(4.9, 7.7, 1.75, 0.2);
  housing(8.3, 10.4, 1.55, 0.34);
  housing(11.0, 13.4, 1.75, 0.2);
  pantograph(body, alongRoof(3.7), LOCOMOTIVE_ROOF_TOP - 0.02, false, solid);
  pantograph(body, alongRoof(14.4), LOCOMOTIVE_ROOF_TOP - 0.02, true, solid);

  return { body: body.build(), glass: glass.build() };
}

// Lenses of the head lamps on the front end, lit while this locomotive leads the train.
export function buildHeadLamps(spec: VehicleSpec): BuiltMesh {
  const lamps = new MeshBuilder();
  const x = bodyHalfLength(spec) + 0.012;
  const color: Rgb = [1, 0.96, 0.82];
  const uv: [number, number] = [0, 0];
  for (const lamp of HEAD_LAMPS) {
    lamps.polygon(
      [
        [x, lamp.y - lamp.height / 2, lamp.z - lamp.width / 2],
        [x, lamp.y - lamp.height / 2, lamp.z + lamp.width / 2],
        [x, lamp.y + lamp.height / 2, lamp.z + lamp.width / 2],
        [x, lamp.y + lamp.height / 2, lamp.z - lamp.width / 2],
      ],
      color,
      [1, 0, 0],
      () => uv,
    );
  }

  return lamps.build();
}

// The two red lamps on the rear end of the last coach.
export function buildTailLamps(spec: VehicleSpec): BuiltMesh {
  const lamps = new MeshBuilder();
  const x = -spec.length / 2 - 0.012;
  const color: Rgb = [1, 0.04, 0.03];
  for (const z of [-0.85, 0.85]) {
    lamps.polygon(
      [[x, 0.95, z - 0.1], [x, 0.95, z + 0.1], [x, 1.13, z + 0.1], [x, 1.13, z - 0.1]],
      color,
      [-1, 0, 0],
      () => [0, 0],
    );
  }

  return lamps.build();
}

// Windows of the panorama coach in the side picture, from the gangway end towards the door end.
export const PANORAMA_WINDOWS: [number, number][] = [[1.9, 3.48], [3.83, 5.41], [5.76, 7.34], [7.69, 9.27], [9.62, 11.2], [11.55, 13.13], [13.35, 14.7]];
export const PANORAMA_WINDOW_BOTTOM = 1.65;
// The glass runs over the shoulder of the roof up to this point of the profile.
const PANORAMA_GLASS_LAST_POINT = 6;
const PANORAMA_END_CAP = 0.5;

const PANORAMA_POINTS: ProfilePoint[] = [[1.15, 0.45], [1.3, 0.6], [HALF_WIDTH, 0.78], [HALF_WIDTH, 3.02], [1.24, 3.25], [1.07, 3.42], [0.85, 3.5], [0.45, 3.54], [0, PANORAMA_ROOF_TOP]];

function panoramaProfile(spec: VehicleSpec): Profile {
  const half = bodyHalfLength(spec);
  const pictureP = (x: number, side: Side) => (side === 'right' ? x + half : half - x);
  const inWindow = (x: number, side: Side) => {
    const p = pictureP(x, side);

    return PANORAMA_WINDOWS.some(([p0, p1]) => p > p0 && p < p1);
  };
  const betweenWindows = (x: number, side: Side) => {
    const p = pictureP(x, side);

    return p > PANORAMA_WINDOWS[0][0] && p < PANORAMA_WINDOWS[PANORAMA_WINDOWS.length - 1][1];
  };

  return {
    points: PANORAMA_POINTS,
    wall: [true, true, true, false, false, false, false, false],
    color: (segment, x, side) => {
      if (Math.abs(x) > half - PANORAMA_END_CAP) {
        return RED;
      }

      if (segment <= 5 && betweenWindows(x, side)) {
        return inWindow(x, side) ? GLASS_LOW : RED;
      }

      return ROOF_WHITE;
    },
  };
}

// A section wherever the roof colour can change: the edges of the windows on either side, and the
// red caps at the ends.
function panoramaSections(spec: VehicleSpec): Section[] {
  const half = bodyHalfLength(spec);
  const xs = new Set<number>([-half, half, -half + PANORAMA_END_CAP, half - PANORAMA_END_CAP]);
  for (const [p0, p1] of PANORAMA_WINDOWS) {
    for (const p of [p0, p1]) {
      xs.add(Number((p - half).toFixed(6)));
      xs.add(Number((half - p).toFixed(6)));
    }
  }

  return [...xs].sort((a, b) => a - b).map((x) => ({ x, shrink: 0, drop: 0 }));
}

function buildPanorama(spec: VehicleSpec): VehicleMesh {
  const body = new MeshBuilder();
  const glass = new MeshBuilder();
  const layout = liveryLayout(spec);
  const half = bodyHalfLength(spec);
  const solid = solidUv(layout);
  const profile = panoramaProfile(spec);
  const sections = panoramaSections(spec);
  loft(body, profile, sections, layout, null);
  cap(body, profile, sections[sections.length - 1], 1, layout, null, null);
  cap(body, profile, sections[0], -1, layout, null, null);

  for (const side of ['right', 'left'] as const) {
    for (const [p0, p1] of PANORAMA_WINDOWS) {
      wrapAroundGlass(glass, spec, profile, side, p0, p1, PANORAMA_WINDOW_BOTTOM, PANORAMA_GLASS_LAST_POINT);
    }

    // The small window of the gangway end and the window of the door.
    wallGlass(glass, spec, side, 0.68, 1.22, 1.75, 2.55);
    wallGlass(glass, spec, side, 14.97, 15.53, 1.75, 2.6);
  }

  for (const x of [-spec.bogieSpacing / 2, spec.bogieSpacing / 2]) {
    bogie(body, x, 0.343, 1.8, false, solid);
  }

  body.box([0, 0.27, 0], [spec.bogieSpacing - 3.4, 0.2, 1.8], 0, UNDERFRAME, { uv: solid });
  for (const side of ['right', 'left'] as const) {
    doorStep(body, spec, side, 15.25, solid);
  }

  // Gangway bellows close the gap to the next vehicle.
  for (const end of [-1, 1]) {
    body.box([end * (half + (END_OVERHANG - 0.01) / 2), 0.55, 0], [END_OVERHANG - 0.01, 2.65, 2.1], 0, BELLOWS, { uv: solid });
    body.box([end * (half + END_OVERHANG - 0.006), 0.6, 0], [0.008, 2.1, 1.1], 0, END_DOOR, { uv: solid });
    body.box([end * (half + END_OVERHANG - 0.001), 1.55, 0], [0.002, 0.75, 0.62], 0, END_WINDOW, { uv: solid });
  }

  // Air conditioning on the roof, between the glass strips.
  body.box([half - 7.3, PANORAMA_ROOF_TOP - 0.03, 0], [2.6, 0.2, 0.95], 0, EQUIPMENT, { uv: solid });
  body.box([half - 7.3, PANORAMA_ROOF_TOP + 0.172, 0], [2.0, 0.02, 0.7], 0, VENT_DARK, { uv: solid });

  return { body: body.build(), glass: glass.build() };
}

export function buildVehicle(spec: VehicleSpec): VehicleMesh {
  return spec.kind === 'locomotive' ? buildLocomotive(spec) : buildPanorama(spec);
}
