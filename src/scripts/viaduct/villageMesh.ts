// The houses of the village as two merged meshes: walls built from bays of the facade atlas (so
// every house has its own pattern of windows, shutters and a door), and roofs of grey slate. The
// church has its tall bell tower. Pure: it returns plain meshes.

import { mulberry32 } from '../river/world.ts';
import { MeshBuilder, mixColor, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import type { Ground } from './terrain.ts';
import type { House } from './village.ts';
import { footprint } from './village.ts';
import {
  BAY_BARE_ROW,
  BAY_DOOR,
  BAY_METRES,
  BAY_PLAIN,
  BAY_ROW_PLASTER,
  BAY_ROW_STONE,
  BAY_SHUTTERED,
  BAY_SHUTTERED_BROWN,
  bayUv,
  SLATE_METRES,
} from './villageTextures.ts';

export interface VillageMeshes {
  // Textured with the facade atlas.
  walls: BuiltMesh;
  // Textured with slate.
  roofs: BuiltMesh;
}

const FOUNDATION_DEPTH = 0.8;
const GROUND_FLOOR_RISE = 0.5;
const TOWER_WIDTH = 5.6;
const TOWER_FLOORS = 7;
const TOWER_FLOOR_HEIGHT = 3.4;
const TOWER_ROOF = 9;
const WHITE: Rgb = [1, 1, 1];
// The boards under the eaves: the slate texture is dark, so the colour is bright.
const UNDERSIDE: Rgb = [1.4, 0.95, 0.62];

type Uv = [[number, number], [number, number], [number, number], [number, number]];

interface Frame {
  x: number;
  z: number;
  cos: number;
  sin: number;
}

// A point in the house's own frame: `along` its width, `across` its depth, at height `up`.
function pointAt(frame: Frame, along: number, up: number, across: number): Vec3 {
  return [frame.x + along * frame.cos + across * frame.sin, up, frame.z - along * frame.sin + across * frame.cos];
}

// The horizontal unit vector along the width of the house (`along` 1) or across its depth.
function direction(frame: Frame, along: number, across: number): Vec3 {
  return [along * frame.cos + across * frame.sin, 0, -along * frame.sin + across * frame.cos];
}

function bayCell(wall: 'plaster' | 'stone', kind: number | 'bare'): { column: number; row: number } {
  if (kind === 'bare') {
    return { column: wall === 'stone' ? 1 : 0, row: BAY_BARE_ROW };
  }

  return { column: kind, row: wall === 'stone' ? BAY_ROW_STONE : BAY_ROW_PLASTER };
}

function bayCorners(cell: { column: number; row: number }): Uv {
  const { u0, u1, v0, v1 } = bayUv(cell.column, cell.row);

  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

interface WallStyle {
  wall: 'plaster' | 'stone';
  color: Rgb;
  shutters: number;
}

// One wall face seen from outside: `bays` columns of `floors` rows, each a bay of the atlas.
function buildFace(
  builder: MeshBuilder,
  from: Vec3,
  right: Vec3,
  normal: Vec3,
  length: number,
  baseY: number,
  floorHeights: number[],
  style: WallStyle,
  pickKind: (floor: number, bay: number, bays: number) => number | 'bare',
) {
  const bays = Math.max(1, Math.round(length / BAY_METRES));
  const bayWidth = length / bays;
  let bottom = baseY;
  floorHeights.forEach((floorHeight, floor) => {
    for (let bay = 0; bay < bays; bay += 1) {
      const left = bay * bayWidth;
      const rightEdge = left + bayWidth;
      const corner = (along: number, up: number): Vec3 => [from[0] + right[0] * along, up, from[2] + right[2] * along];
      const uv = bayCorners(bayCell(style.wall, pickKind(floor, bay, bays)));
      const a = builder.vertex(corner(left, bottom), normal, uv[0], style.color);
      const b = builder.vertex(corner(rightEdge, bottom), normal, uv[1], style.color);
      const c = builder.vertex(corner(rightEdge, bottom + floorHeight), normal, uv[2], style.color);
      const d = builder.vertex(corner(left, bottom + floorHeight), normal, uv[3], style.color);
      builder.quad(a, b, c, d);
    }

    bottom += floorHeight;
  });
}

function groundBase(ground: Ground, house: Pick<House, 'x' | 'z' | 'width' | 'depth' | 'yaw'>): number {
  const corners = footprint(house);
  const middles = corners.map(([x, z], index) => {
    const [nextX, nextZ] = corners[(index + 1) % corners.length];

    return [(x + nextX) / 2, (z + nextZ) / 2];
  });
  let low = Infinity;
  for (const [x, z] of [...corners, ...middles]) {
    low = Math.min(low, ground.heightAt(x, z));
  }

  return low;
}

function slateRoof(roofs: MeshBuilder, points: Vec3[], color: Rgb, outward: Vec3, scale: number) {
  roofs.polygon(points, color, outward, (point) => [(point[0] + point[2]) * scale, point[1] * scale * 1.4]);
}

// A gabled roof with the ridge along the width, or a flat one, over the walls of a house.
function buildRoof(roofs: MeshBuilder, walls: MeshBuilder, frame: Frame, house: House, eaves: number, random: () => number) {
  const gableColor = mixColor(house.wall, [0.5, 0.5, 0.5], 0.1);
  const hw = house.width / 2;
  const hd = house.depth / 2;
  if (house.flatRoof) {
    const top = eaves + 0.25;
    const corners = [pointAt(frame, -hw - 0.2, top, -hd - 0.2), pointAt(frame, hw + 0.2, top, -hd - 0.2), pointAt(frame, hw + 0.2, top, hd + 0.2), pointAt(frame, -hw - 0.2, top, hd + 0.2)];
    roofs.polygon(corners, mixColor(house.roof, [0, 0, 0], 0.25), [0, 1, 0], (point) => [point[0] / SLATE_METRES, point[2] / SLATE_METRES]);

    return;
  }

  if (house.mansard) {
    buildMansard(roofs, frame, house, eaves);

    return;
  }

  if (house.hipped) {
    buildHipped(roofs, frame, house, eaves, random);

    return;
  }

  const overhangAcross = 0.9;
  const overhangAlong = 0.6;
  const rise = hd * 0.8;
  const ridge = eaves + rise;
  const run = hd + overhangAcross;
  const slopeLength = Math.hypot(rise, hd);
  const slopeNormal = (side: 1 | -1): Vec3 => {
    const outward = direction(frame, 0, side);

    return [(outward[0] * rise) / slopeLength, hd / slopeLength, (outward[2] * rise) / slopeLength];
  };
  const eaveY = eaves - overhangAcross * (rise / hd);
  for (const side of [1, -1] as const) {
    roofs.polygon(
      [
        pointAt(frame, -hw - overhangAlong, eaveY, side * run),
        pointAt(frame, hw + overhangAlong, eaveY, side * run),
        pointAt(frame, hw + overhangAlong, ridge, 0),
        pointAt(frame, -hw - overhangAlong, ridge, 0),
      ],
      side === 1 ? house.roof : mixColor(house.roof, [0, 0, 0], 0.16),
      slopeNormal(side),
      (point) => {
        const along = (point[0] - frame.x) * frame.cos - (point[2] - frame.z) * frame.sin;

        return [along / SLATE_METRES, ((ridge - point[1]) * (slopeLength / rise)) / SLATE_METRES];
      },
    );
  }

  for (const side of [1, -1] as const) {
    eaveUnderside(roofs, frame, hw + overhangAlong, hd, overhangAcross, eaves, eaveY, side);
  }

  const bare = bayUv(house.stone ? 1 : 0, BAY_BARE_ROW);
  const centreUv: [number, number] = [(bare.u0 + bare.u1) / 2, (bare.v0 + bare.v1) / 2];
  for (const end of [-1, 1]) {
    walls.polygon(
      [pointAt(frame, end * hw, eaves, -hd), pointAt(frame, end * hw, eaves, hd), pointAt(frame, end * hw, ridge, 0)],
      house.stone ? WHITE : gableColor,
      direction(frame, end, 0),
      () => centreUv,
    );
  }

  if (random() < 0.7) {
    const along = (random() - 0.5) * house.width * 0.5;
    const base = pointAt(frame, along, ridge - rise * 0.5, 0);
    roofs.box([base[0], base[1], base[2]], [0.8, rise * 0.5 + 1.4, 0.8], Math.atan2(frame.sin, frame.cos), mixColor(house.roof, [0.2, 0.18, 0.16], 0.4), { uv: [0.5, 0.5] });
  }
}

// The dark brown boards under a wide eave, seen from the street at a low angle.
function eaveUnderside(roofs: MeshBuilder, frame: Frame, halfLength: number, wallAcross: number, overhang: number, eaves: number, eaveY: number, side: 1 | -1) {
  roofs.polygon(
    [
      pointAt(frame, -halfLength, eaves, side * wallAcross),
      pointAt(frame, halfLength, eaves, side * wallAcross),
      pointAt(frame, halfLength, eaveY, side * (wallAcross + overhang)),
      pointAt(frame, -halfLength, eaveY, side * (wallAcross + overhang)),
    ],
    UNDERSIDE,
    [0, -1, 0],
    () => [0.5, 0.5],
  );
}

// A roof that slopes on all four sides, the ridge shorter than the house is long.
function buildHipped(roofs: MeshBuilder, frame: Frame, house: House, eaves: number, random: () => number) {
  const hw = house.width / 2;
  const hd = house.depth / 2;
  const overhang = 0.9;
  const rise = hd * 0.75;
  const ridge = eaves + rise;
  const half = Math.max(hw - hd, 0.8);
  const slopeLength = Math.hypot(rise, hd);
  const eaveY = eaves - overhang * (rise / hd);
  const reach = hd + overhang;
  const reachAlong = hw + overhang;
  const outward = (along: number, across: number): Vec3 => {
    const flat = direction(frame, along, across);

    return [(flat[0] * rise) / slopeLength, hd / slopeLength, (flat[2] * rise) / slopeLength];
  };
  for (const side of [1, -1] as const) {
    roofs.polygon(
      [
        pointAt(frame, -reachAlong, eaveY, side * reach),
        pointAt(frame, reachAlong, eaveY, side * reach),
        pointAt(frame, half, ridge, 0),
        pointAt(frame, -half, ridge, 0),
      ],
      side === 1 ? house.roof : mixColor(house.roof, [0, 0, 0], 0.16),
      outward(0, side),
      (point) => {
        const along = (point[0] - frame.x) * frame.cos - (point[2] - frame.z) * frame.sin;

        return [along / SLATE_METRES, ((ridge - point[1]) * (slopeLength / rise)) / SLATE_METRES];
      },
    );
  }

  for (const end of [1, -1] as const) {
    roofs.polygon(
      [pointAt(frame, end * reachAlong, eaveY, -reach), pointAt(frame, end * reachAlong, eaveY, reach), pointAt(frame, end * half, ridge, 0)],
      mixColor(house.roof, [0, 0, 0], 0.08),
      outward(end, 0),
      (point) => {
        const across = (point[0] - frame.x) * frame.sin + (point[2] - frame.z) * frame.cos;

        return [across / SLATE_METRES, ((ridge - point[1]) * (slopeLength / rise)) / SLATE_METRES];
      },
    );
  }

  for (const side of [1, -1] as const) {
    eaveUnderside(roofs, frame, reachAlong, hd, overhang, eaves, eaveY, side);
  }

  if (random() < 0.7) {
    const base = pointAt(frame, (random() - 0.5) * half, ridge - rise * 0.5, 0);
    roofs.box([base[0], base[1], base[2]], [0.8, rise * 0.5 + 1.4, 0.8], Math.atan2(frame.sin, frame.cos), mixColor(house.roof, [0.2, 0.18, 0.16], 0.4), { uv: [0.5, 0.5] });
  }
}

// A hipped roof in two pitches: steep round the edge, nearly flat on top.
function buildMansard(roofs: MeshBuilder, frame: Frame, house: House, eaves: number) {
  const hw = house.width / 2 + 0.4;
  const hd = house.depth / 2 + 0.4;
  const inset = 1.6;
  const rise = 2.6;
  const top = eaves + rise;
  const outer = [pointAt(frame, -hw, eaves, -hd), pointAt(frame, hw, eaves, -hd), pointAt(frame, hw, eaves, hd), pointAt(frame, -hw, eaves, hd)];
  const inner = [
    pointAt(frame, -hw + inset, top, -hd + inset),
    pointAt(frame, hw - inset, top, -hd + inset),
    pointAt(frame, hw - inset, top, hd - inset),
    pointAt(frame, -hw + inset, top, hd - inset),
  ];
  const uv = (point: Vec3): [number, number] => [(point[0] + point[2]) / SLATE_METRES, point[1] / SLATE_METRES];
  outer.forEach((corner, index) => {
    const next = (index + 1) % 4;
    const middle: Vec3 = [(corner[0] + outer[next][0]) / 2 - frame.x, 0, (corner[2] + outer[next][2]) / 2 - frame.z];
    roofs.polygon([corner, outer[next], inner[next], inner[index]], house.roof, [middle[0], 0.8, middle[2]], uv);
  });

  roofs.polygon(
    [inner[0], inner[1], inner[2], inner[3]],
    mixColor(house.roof, [0, 0, 0], 0.2),
    [0, 1, 0],
    uv,
  );
}

// A balcony with a dark railing across the middle of the front, at the height of an upper floor.
function buildBalcony(walls: MeshBuilder, frame: Frame, house: House, floorY: number) {
  const centre = pointAt(frame, 0, floorY, house.depth / 2 + 0.65);
  const yaw = Math.atan2(frame.sin, frame.cos);
  const bare = bayUv(0, BAY_BARE_ROW);
  const uv: [number, number] = [(bare.u0 + bare.u1) / 2, (bare.v0 + bare.v1) / 2];
  const length = Math.min(house.width * 0.55, 8);
  walls.box([centre[0], floorY, centre[2]], [length, 0.2, 1.3], yaw, [0.85, 0.85, 0.82], { uv });
  const railing = pointAt(frame, 0, floorY + 0.2, house.depth / 2 + 1.25);
  walls.box([railing[0], floorY + 0.2, railing[2]], [length, 0.9, 0.08], yaw, [0.08, 0.08, 0.09], { uv });
}

function buildHouse(walls: MeshBuilder, roofs: MeshBuilder, house: House, ground: Ground, random: () => number) {
  const frame: Frame = { x: house.x, z: house.z, cos: Math.cos(house.yaw), sin: Math.sin(house.yaw) };
  const base = groundBase(ground, house);
  const eaves = base + house.height;
  const floorHeight = (house.height - GROUND_FLOOR_RISE) / house.floors;
  const style: WallStyle = {
    wall: house.stone ? 'stone' : 'plaster',
    color: house.stone ? [1, 1, 1] : house.wall,
    shutters: house.church ? BAY_PLAIN : random() < 0.85 ? (random() < 0.7 ? BAY_SHUTTERED_BROWN : BAY_SHUTTERED) : BAY_PLAIN,
  };
  const doorBay = Math.floor(random() * 4);
  const hw = house.width / 2;
  const hd = house.depth / 2;
  const faces: { normal: [number, number]; length: number; half: number; front: boolean }[] = [
    { normal: [frame.sin, frame.cos], length: house.width, half: hd, front: true },
    { normal: [-frame.sin, -frame.cos], length: house.width, half: hd, front: false },
    { normal: [frame.cos, -frame.sin], length: house.depth, half: hw, front: false },
    { normal: [-frame.cos, frame.sin], length: house.depth, half: hw, front: false },
  ];
  for (const face of faces) {
    const normal: Vec3 = [face.normal[0], 0, face.normal[1]];
    // Right of the face seen from outside: up crossed with the normal.
    const right: Vec3 = [normal[2], 0, -normal[0]];
    const centre: Vec3 = [frame.x + normal[0] * face.half, 0, frame.z + normal[2] * face.half];
    const from: Vec3 = [centre[0] - (right[0] * face.length) / 2, 0, centre[2] - (right[2] * face.length) / 2];
    const heights = [FOUNDATION_DEPTH + GROUND_FLOOR_RISE, ...Array.from({ length: house.floors }, () => floorHeight)];
    buildFace(walls, from, right, normal, face.length, base - FOUNDATION_DEPTH, heights, style, (floor, bay, bays) => {
      if (floor === 0) {
        return 'bare';
      }

      if (floor === 1 && face.front && bay === doorBay % bays) {
        return BAY_DOOR;
      }

      return random() < 0.1 ? 'bare' : style.shutters;
    });
  }

  buildRoof(roofs, walls, frame, house, eaves, random);
  if (!house.church && house.floors >= 3 && random() < 0.55) {
    buildBalcony(walls, frame, house, base + GROUND_FLOOR_RISE + floorHeight * (house.floors - 1));
  }

  if (house.church) {
    buildTower(walls, roofs, frame, house, base);
  }
}

// The bell tower stands against the west end of the nave: a square white shaft, then an octagonal
// belfry with a window on every side, a pointed roof and a small lantern on top.
function buildTower(walls: MeshBuilder, roofs: MeshBuilder, frame: Frame, house: House, base: number) {
  const centreAlong = -(house.width / 2 + TOWER_WIDTH / 2 - 0.4);
  const centre = pointAt(frame, centreAlong, 0, 0);
  const towerFrame: Frame = { ...frame, x: centre[0], z: centre[2] };
  const style: WallStyle = { wall: 'plaster', color: house.wall, shutters: BAY_PLAIN };
  const half = TOWER_WIDTH / 2;
  const shaftFloors = TOWER_FLOORS - 1;
  const heights = [FOUNDATION_DEPTH + GROUND_FLOOR_RISE, ...Array.from({ length: shaftFloors }, () => TOWER_FLOOR_HEIGHT)];
  const normals: [number, number][] = [[frame.sin, frame.cos], [-frame.sin, -frame.cos], [frame.cos, -frame.sin], [-frame.cos, frame.sin]];
  for (const normal of normals) {
    const outward: Vec3 = [normal[0], 0, normal[1]];
    const right: Vec3 = [outward[2], 0, -outward[0]];
    const from: Vec3 = [towerFrame.x + outward[0] * half - (right[0] * TOWER_WIDTH) / 2, 0, towerFrame.z + outward[2] * half - (right[2] * TOWER_WIDTH) / 2];
    buildFace(walls, from, right, outward, TOWER_WIDTH, base - FOUNDATION_DEPTH, heights, style, (floor) => (floor === shaftFloors - 1 ? BAY_PLAIN : 'bare'));
  }

  const shaftTop = base - FOUNDATION_DEPTH + heights.reduce((total, value) => total + value, 0);
  const circumradius = half * 0.92;
  const sides = 8;
  const belfryHeight = 3.6;
  const roofRim: Vec3[] = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = -house.yaw + (side + 0.5) * ((Math.PI * 2) / sides);
    const outward: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const right: Vec3 = [outward[2], 0, -outward[0]];
    const apothem = circumradius * Math.cos(Math.PI / sides);
    const length = 2 * circumradius * Math.sin(Math.PI / sides);
    const from: Vec3 = [towerFrame.x + outward[0] * apothem - (right[0] * length) / 2, 0, towerFrame.z + outward[2] * apothem - (right[2] * length) / 2];
    buildFace(walls, from, right, outward, length, shaftTop, [belfryHeight], style, () => BAY_PLAIN);
    roofRim.push([towerFrame.x + outward[0] * (circumradius + 0.35) / Math.cos(Math.PI / sides), shaftTop + belfryHeight, towerFrame.z + outward[2] * (circumradius + 0.35) / Math.cos(Math.PI / sides)]);
  }

  const apex: Vec3 = [towerFrame.x, shaftTop + belfryHeight + TOWER_ROOF * 0.8, towerFrame.z];
  const steeple = mixColor(house.roof, [0, 0, 0], 0.1);
  roofRim.forEach((corner, index) => {
    const next = roofRim[(index + 1) % sides];
    const middle: Vec3 = [(corner[0] + next[0]) / 2 - towerFrame.x, 0, (corner[2] + next[2]) / 2 - towerFrame.z];
    slateRoof(roofs, [corner, next, apex], steeple, middle, 1 / SLATE_METRES);
  });

  const lantern = [towerFrame.x, apex[1] - 0.3, towerFrame.z];
  roofs.box([lantern[0], lantern[1], lantern[2]], [0.9, 1.6, 0.9], 0, [0.9, 0.9, 0.86], { uv: [0.5, 0.5] });
  roofs.box([lantern[0], lantern[1] + 1.6, lantern[2]], [0.4, 1.6, 0.4], 0, steeple, { uv: [0.5, 0.5] });
}

export function buildVillage(houses: House[], ground: Ground): VillageMeshes {
  const walls = new MeshBuilder();
  const roofs = new MeshBuilder();
  const random = mulberry32(53);
  for (const house of houses) {
    buildHouse(walls, roofs, house, ground, random);
  }

  return { walls: walls.build(), roofs: roofs.build() };
}
