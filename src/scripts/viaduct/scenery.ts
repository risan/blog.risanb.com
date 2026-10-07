// Where the trees, bushes, rocks, walls, houses and the other small things of the valley
// stand. Pure and seeded: the same call always gives the same valley.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, type Rgb } from './meshBuilder.ts';
import { mountainCover, TERRAIN_BOUNDS, valueNoise, type Ground } from './terrain.ts';
import { offsetFromTrack, track } from './track.ts';
import {
  distanceToPolyline,
  FLOOR_HEIGHT,
  nearestOnPolyline,
  placeHouses,
  type Frontage,
  type House,
  type Street,
} from './village.ts';

export type { House, Street } from './village.ts';

export interface Tree {
  x: number;
  y: number;
  z: number;
  conifer: boolean;
  // Crown radius and total height in metres.
  radius: number;
  height: number;
  yaw: number;
  color: Rgb;
}

export interface Bush {
  x: number;
  y: number;
  z: number;
  size: number;
  color: Rgb;
}

export interface Rock {
  x: number;
  y: number;
  z: number;
  size: number;
  yaw: number;
  squash: number;
  color: Rgb;
}

export interface Wall {
  // Plan points (x, z) the wall runs through.
  points: [number, number][];
  height: number;
  thickness: number;
}

export interface Post {
  x: number;
  y: number;
  z: number;
  height: number;
  color: Rgb;
}

// A tree of the far forest: a plain cone, seen only from a distance.
export interface FarTree {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  color: Rgb;
}

export interface Scenery {
  trees: Tree[];
  bushes: Bush[];
  rocks: Rock[];
  walls: Wall[];
  houses: House[];
  posts: Post[];
  standingStones: Post[];
  lane: [number, number][];
  // The village roads, smoothed, with their widths.
  streets: Street[];
  // Small fruit trees, in the orchard's rows and in the gardens: their crowns are bushes, the
  // trunks are drawn with the props.
  orchard: Bush[];
  // Low hedges along the gardens.
  hedges: Bush[];
  farTrees: FarTree[];
}

// Plan positions below are written as (x, north): the loop is round about (0, 0) and the viaduct
// is its south-east side. Everything is stored with z = -north, as the rest of the scene does.
type Plan = [number, number];

export const MIN_TREE_DISTANCE_TO_BED = 6;
export const MIN_TREE_DISTANCE_TO_VIADUCT = 12;
export const LANE_HALF_WIDTH = 1.7;
export const MAX_BUSHES = 60;
const FAR_FOREST_SPACING = 7.2;

// Early autumn in the valley: the broadleaves turning, gold and orange among the last greens,
// some rust. Conifers stay green.
const BROADLEAF_COLORS = [0x667a32, 0x587030, 0x76843a, 0x4f6a2e, 0x6a7a30, 0x86882f].map(hexToLinear);
const GOLD_COLORS = [0xb89a2e, 0xc4a33a, 0xa8862c, 0xd0ac40].map(hexToLinear);
const ORANGE_COLORS = [0xb8682a, 0xc0782e, 0xa65a24].map(hexToLinear);
const RUST_COLORS = [0x9a4426, 0x8a3a22].map(hexToLinear);
const CONIFER_COLORS = [0x2f4f26, 0x38592b, 0x435f2a].map(hexToLinear);
const BUSH_COLORS = [0x4a5a26, 0x5a6228, 0x6e5a28, 0x3f5426].map(hexToLinear);
const LARCH_COLORS = [0x9c7a2a, 0x9a5826, 0xb08c34].map(hexToLinear);
const HEDGE_COLORS = [0x3f5426, 0x4a5a26, 0x365022].map(hexToLinear);
const ORCHARD_COLORS = [0x6a7a30, 0x76843a, 0x86882f, 0xa89030, 0x8a8a36].map(hexToLinear);
const ROCK_COLORS = [0xd2cabb, 0xbfb6a6, 0xe0d9cb, 0xa59c8d].map(hexToLinear);

// Woods and groves as (centre x, centre north, radius, trees, share of conifers, size scale).
const GROVES: [number, number, number, number, number, number][] = [
  // Straddling the track across the top of the meadow.
  [-4, 62, 17, 15, 0, 1.0],
  // The large wood between the inner track and the viaduct, and up the east side.
  [47, 33, 22, 30, 0, 1.05],
  [60, 8, 12, 10, 0, 1.0],
  [100, 22, 27, 30, 0.3, 1.0],
  [96, -36, 16, 12, 0.2, 0.95],
  // The two single trees in the meadow, on the viaduct side, and the lower left.
  [29, -34, 1.5, 1, 0, 1.05],
  [9, -47, 1.5, 1, 0, 0.95],
  // Along the lane and in the bottom left corner.
  [-55, -93, 9, 5, 0, 1.0],
  [-34, -103, 8, 4, 0, 1.0],
  [-80, -88, 8, 4, 0, 1.0],
  [8, -104, 12, 6, 0.2, 1.0],
  [60, -104, 10, 5, 0.2, 1.0],
];

function pickFrom<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

function planToWorld(point: Plan): [number, number] {
  return [point[0], -point[1]];
}

function route(points: Plan[]): [number, number][] {
  return points.map(planToWorld);
}

// A smooth curve through the control points (Catmull-Rom), eight steps to each stretch.
function smoothRoute(control: Plan[]): Plan[] {
  const smooth: Plan[] = [];
  for (let index = 0; index < control.length - 1; index += 1) {
    const p0 = control[Math.max(index - 1, 0)];
    const p1 = control[index];
    const p2 = control[index + 1];
    const p3 = control[Math.min(index + 2, control.length - 1)];
    for (let step = 0; step < 8; step += 1) {
      const t = step / 8;
      const point = (axis: 0 | 1) =>
        0.5 *
        (2 * p1[axis] +
          (-p0[axis] + p2[axis]) * t +
          (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t +
          (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t * t * t);
      smooth.push([point(0), point(1)]);
    }
  }

  smooth.push(control[control.length - 1]);

  return smooth;
}

// The lane runs the length of the valley, below the loop; the village main road joins it.
const LANE_CONTROL: Plan[] = [
  [-520, -140], [-450, -133], [-380, -126], [-310, -121], [-250, -117], [-190, -112], [-150, -103], [-104, -101],
  [-60, -97], [-20, -84], [20, -83], [60, -92], [100, -99], [140, -108], [190, -122],
];

// The village streets, as plan points: the main road runs north from the lane up the west side of
// the loop and on up the valley; the others branch off it.
const MAIN_ROAD: Plan[] = [
  [-133, -102], [-128, -80], [-122, -50], [-118, -20], [-119, 10], [-127, 36], [-146, 56], [-176, 62], [-198, 84], [-226, 102],
  [-268, 110], [-318, 106], [-362, 98],
];
const SIDE_STREETS: { control: Plan[]; width: number }[] = [
  { control: [[-121, -36], [-160, -42], [-205, -52], [-250, -58]], width: 4.5 },
  { control: [[-200, 88], [-209, 56], [-213, 20], [-210, -48]], width: 4.5 },
  { control: [[-268, 110], [-277, 72], [-285, 36], [-292, -2]], width: 4.5 },
  { control: [[-318, 106], [-328, 88], [-337, 70]], width: 4.5 },
  { control: [[-62, -99], [-42, -140], [8, -168], [64, -196]], width: 4.5 },
];
const MAIN_ROAD_WIDTH = 6;
const LANE_SURFACE_WIDTH = 2 * LANE_HALF_WIDTH + 1.4;
const CHURCH_AT: Plan = [-340, 54];
const ORCHARD_AT = { x: -101, north: -76, radius: 30 };

function insideHouse(house: House, x: number, z: number, margin: number): boolean {
  const dx = x - house.x;
  const dz = z - house.z;
  const along = dx * Math.cos(house.yaw) - dz * Math.sin(house.yaw);
  const across = dx * Math.sin(house.yaw) + dz * Math.cos(house.yaw);

  return Math.abs(along) < house.width / 2 + margin && Math.abs(across) < house.depth / 2 + margin;
}

// Brusio: two old houses by the lane (kept where they were), the church with its tower, and the
// houses along the streets. Frontages say how each street is lined, in the order of `streets`:
// the main road, the four side streets, then the lane.
function createVillage(ground: Ground, streets: Street[], random: () => number): House[] {
  const stone = hexToLinear(0xcfc6b4);
  const slate = hexToLinear(0xa09e9a);
  const [churchX, churchZ] = planToWorld(CHURCH_AT);
  const fixed: House[] = [
    { x: -72, z: 110, width: 12, depth: 8.5, height: 6.2, floors: 2, yaw: 0.08, wall: stone, roof: slate, flatRoof: false, mansard: false, hipped: false, stone: true, church: false },
    { x: -56, z: 90, width: 8, depth: 6, height: 4.4, floors: 1, yaw: 0.3, wall: hexToLinear(0xd9d0be), roof: slate, flatRoof: false, mansard: false, hipped: true, stone: false, church: false },
    // The big white villa with the green-grey mansard roof, on its terrace just west of the loop.
    {
      x: -101,
      z: 26,
      width: 15,
      depth: 11,
      height: 3 * FLOOR_HEIGHT + 0.6,
      floors: 3,
      yaw: 0.12,
      wall: hexToLinear(0xf3efe4),
      roof: hexToLinear(0x93a090),
      flatRoof: false,
      mansard: true,
      hipped: false,
      stone: false,
      church: false,
    },
    {
      x: churchX,
      z: churchZ,
      width: 20,
      depth: 9,
      height: 2 * FLOOR_HEIGHT + 1.5,
      floors: 2,
      yaw: 0.04,
      wall: hexToLinear(0xf4f1e8),
      roof: hexToLinear(0x8a8d92),
      flatRoof: false,
      mansard: false,
      hipped: false,
      stone: false,
      church: true,
    },
  ];
  const frontages: Frontage[] = [
    { street: 0, setback: 1.8, from: 0.04, to: 0.98, perSide: 8, looseness: 0.08, sides: [1, -1] },
    { street: 1, setback: 2.4, from: 0.06, to: 0.96, perSide: 2, looseness: 0.3, sides: [1, -1] },
    { street: 2, setback: 2.4, from: 0.04, to: 0.96, perSide: 2, looseness: 0.25, sides: [1, -1] },
    { street: 3, setback: 2.4, from: 0.04, to: 0.96, perSide: 2, looseness: 0.3, sides: [1, -1] },
    { street: 4, setback: 3, from: 0.05, to: 0.5, perSide: 1, looseness: 0.8, sides: [1, -1] },
    { street: 5, setback: 4, from: 0.4, to: 0.96, perSide: 2, looseness: 0.9, sides: [1, -1] },
    { street: 6, setback: 4.5, from: 0.03, to: 0.46, perSide: 3, looseness: 0.35, sides: [1, -1] },
  ];
  const [orchardX, orchardZ] = planToWorld([ORCHARD_AT.x, ORCHARD_AT.north]);

  return placeHouses(
    ground,
    {
      streets,
      frontages,
      fixed,
      reserved: [[orchardX, orchardZ, ORCHARD_AT.radius], [churchX, churchZ, 24]],
      random,
    },
    40,
  );
}

export function createScenery(ground: Ground, seed = 3): Scenery {
  const random = mulberry32(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const lane = route(smoothRoute(LANE_CONTROL));

  const villageRandom = mulberry32(seed + 101);
  const streets: Street[] = [
    { points: route(smoothRoute(MAIN_ROAD)), width: MAIN_ROAD_WIDTH },
    ...SIDE_STREETS.map(({ control, width }) => ({ points: route(smoothRoute(control)), width })),
  ];
  const houses = createVillage(ground, [...streets, { points: lane, width: LANE_SURFACE_WIDTH }], villageRandom);

  // A spot is free when the line, the viaduct, the lane, the village streets and houses keep clear of it.
  function clearOfLine(x: number, z: number, margin: number, viaductMargin = MIN_TREE_DISTANCE_TO_VIADUCT): boolean {
    return (
      ground.distanceToBed(x, z) > margin &&
      ground.viaductAt(x, z).distance > viaductMargin &&
      distanceToPolyline(lane, x, z) > LANE_HALF_WIDTH + margin * 0.5 &&
      streets.every((street) => distanceToPolyline(street.points, x, z) > street.width / 2 + margin * 0.5) &&
      houses.every((house) => !insideHouse(house, x, z, margin * 0.4))
    );
  }

  function leafColor(): Rgb {
    const roll = random();
    if (roll < 0.28) {
      return pick(GOLD_COLORS);
    }

    if (roll < 0.46) {
      return pick(ORANGE_COLORS);
    }

    return roll < 0.6 ? pick(RUST_COLORS) : pick(BROADLEAF_COLORS);
  }

  const trees: Tree[] = [];
  for (const [centreX, centreNorth, spread, count, conifers, scale] of GROVES) {
    const [cx, cz] = planToWorld([centreX, centreNorth]);
    let placed = 0;
    for (let attempt = 0; attempt < count * 60 && placed < count; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * spread;
      const x = cx + Math.cos(angle) * distance;
      const z = cz + Math.sin(angle) * distance;
      const conifer = random() < conifers;
      const radius = conifer ? (2.4 + 1.2 * random()) * scale : (4.8 + 3.6 * random()) * scale;
      if (!clearOfLine(x, z, MIN_TREE_DISTANCE_TO_BED + radius * 0.35, MIN_TREE_DISTANCE_TO_VIADUCT + radius * 0.4)) {
        continue;
      }

      trees.push({
        x,
        y: ground.heightAt(x, z),
        z,
        conifer,
        radius,
        height: conifer ? 10 + 7 * random() * scale : 3.4 + radius * 1.75,
        yaw: random() * Math.PI * 2,
        color: conifer ? pick(CONIFER_COLORS) : leafColor(),
      });
      placed += 1;
    }
  }

  // Conifers scattered over the steep hillside.
  for (let attempt = 0; attempt < 1500 && trees.length < 175; attempt += 1) {
    const x = -140 + random() * 320;
    const z = -170 + random() * 230;
    if ((ground.uphillAt(x, z) < 25 && x < 108) || random() > 0.2 || !clearOfLine(x, z, MIN_TREE_DISTANCE_TO_BED + 3)) {
      continue;
    }

    if (ground.slopeAt(x, z) > 1) {
      continue;
    }

    const conifer = random() < 0.7;
    const radius = conifer ? 2.3 + 1.2 * random() : 4.6 + 2.4 * random();
    trees.push({
      x,
      y: ground.heightAt(x, z),
      z,
      conifer,
      radius,
      height: conifer ? 9 + 7 * random() : 3.4 + radius * 1.75,
      yaw: random() * Math.PI * 2,
      color: conifer ? pick(CONIFER_COLORS) : leafColor(),
    });
  }

  // Walls first, because the bushes gather along them.
  const walls: Wall[] = [
    { points: route([[-170, 75], [-130, 74], [-95, 72], [-62, 71], [-44, 73]]), height: 1.3, thickness: 0.6 },
    { points: route([[-170, 89], [-130, 87], [-95, 86], [-60, 85], [-30, 87]]), height: 1.5, thickness: 0.6 },
    { points: route([[-170, 101], [-135, 99], [-100, 98], [-72, 99]]), height: 1.7, thickness: 0.7 },
    // The low curved wall in the middle of the meadow.
    { points: route([[-47, -12], [-42, -5], [-36, 1], [-30, 7], [-26, 12]]), height: 0.55, thickness: 0.45 },
  ];
  // A retaining wall holds the cutting on the uphill side of the upper track.
  const upperWall: [number, number][] = [];
  for (let s = 40; s <= track.circleStartS - 20; s += 6) {
    const spot = offsetFromTrack(s, -3.9);
    upperWall.push([spot.x, spot.z]);
  }

  walls.push({ points: upperWall, height: 1.9, thickness: 0.7 });
  walls.push(...roadsideWalls(ground, houses, [...streets, { points: lane, width: LANE_SURFACE_WIDTH }]));

  const bushes: Bush[] = [];
  const addBush = (x: number, z: number) => {
    if (bushes.length < MAX_BUSHES && clearOfLine(x, z, 4, 8)) {
      bushes.push({ x, y: ground.heightAt(x, z), z, size: 0.8 + random() * 0.7, color: pick(BUSH_COLORS) });
    }
  };
  // Low, dark clumps at the edge of the woods.
  for (const tree of trees) {
    if (!tree.conifer && random() < 0.2) {
      const angle = random() * Math.PI * 2;
      const reach = tree.radius * (0.95 + random() * 0.3);
      for (let clump = 0; clump < 3; clump += 1) {
        addBush(tree.x + Math.cos(angle) * reach + (random() - 0.5) * 2.4, tree.z + Math.sin(angle) * reach + (random() - 0.5) * 2.4);
      }
    }
  }

  // And a few along the dry-stone walls.
  for (const wall of walls.slice(0, 3)) {
    for (let index = 0; index < wall.points.length - 1; index += 1) {
      if (random() < 0.5) {
        const [x, z] = wall.points[index];
        addBush(x + random() * 3, z + 1.2 + random());
      }
    }
  }

  const rocks: Rock[] = [];
  for (let attempt = 0; attempt < 12000 && rocks.length < 380; attempt += 1) {
    // Only the part of the hillside the camera can see.
    const x = -60 + random() * 230;
    const z = -150 + random() * 150;
    const scree = ground.uphillAt(x, z) > 24 || (x > 104 && z < 45);
    if (!scree || random() > 0.5 || !clearOfLine(x, z, 4.5, 8)) {
      continue;
    }

    rocks.push({
      x,
      y: ground.heightAt(x, z),
      z,
      // Mostly small rubble, now and then a block or an outcrop.
      size: 0.7 + random() * random() * 3 + (random() < 0.07 ? 3.5 : 0),
      yaw: random() * Math.PI,
      squash: 0.6 + random() * 0.4,
      color: pick(ROCK_COLORS),
    });
  }

  const posts: Post[] = [];
  const fenceLines: Plan[][] = [
    [[-150, 28], [-60, 36]],
    [[-165, 8], [-80, 12]],
    [[-146, 52], [-98, 55]],
    [[-36, -18], [-8, -12]],
  ];
  for (const line of fenceLines) {
    const [from, to] = line.map(planToWorld);
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const count = Math.floor(length / 5.5);
    for (let index = 0; index <= count; index += 1) {
      const x = from[0] + ((to[0] - from[0]) * index) / count;
      const z = from[1] + ((to[1] - from[1]) * index) / count;
      if (clearOfLine(x, z, 5, 8)) {
        posts.push({ x, y: ground.heightAt(x, z), z, height: 1.05, color: hexToLinear(0xf2f0ea) });
      }
    }
  }

  const standingStones: Post[] = ([[-31, 20, 2.6], [-26, 24, 2.1], [-22, 28, 1.6]] as [number, number, number][]).map(([east, north, height]) => {
    const [x, z] = planToWorld([east, north]);

    return { x, y: ground.heightAt(x, z), z, height, color: hexToLinear(0xdcd8cf) };
  });

  // Every second house has a tree in its garden, on the side away from the street.
  for (const house of houses) {
    if (house.church || villageRandom() > 0.4) {
      continue;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const side = villageRandom() < 0.5 ? 1 : -1;
      const along = (villageRandom() - 0.5) * house.width;
      const across = side * (house.depth / 2 + 3.5 + villageRandom() * 3);
      const x = house.x + along * Math.cos(house.yaw) + across * Math.sin(house.yaw);
      const z = house.z - along * Math.sin(house.yaw) + across * Math.cos(house.yaw);
      const radius = 2.8 + villageRandom() * 2;
      if (!clearOfLine(x, z, MIN_TREE_DISTANCE_TO_BED, MIN_TREE_DISTANCE_TO_VIADUCT) || houses.some((other) => insideHouse(other, x, z, radius))) {
        continue;
      }

      const roll = villageRandom();
      trees.push({
        x,
        y: ground.heightAt(x, z),
        z,
        conifer: false,
        radius,
        height: 3.4 + radius * 1.75,
        yaw: villageRandom() * Math.PI * 2,
        color: roll < 0.3 ? GOLD_COLORS[Math.floor(villageRandom() * GOLD_COLORS.length)] : roll < 0.5 ? ORANGE_COLORS[Math.floor(villageRandom() * ORANGE_COLORS.length)] : BROADLEAF_COLORS[Math.floor(villageRandom() * BROADLEAF_COLORS.length)],
      });
      break;
    }
  }

  const orchard = createOrchard(ground, villageRandom);
  const hedges: Bush[] = [];
  addGardens(ground, houses, villageRandom, orchard, hedges, (x, z) => clearOfLine(x, z, 2.5, 8));

  return {
    trees,
    bushes,
    rocks,
    walls,
    houses,
    posts,
    standingStones,
    lane,
    streets,
    orchard,
    hedges,
    farTrees: createFarForest(ground, villageRandom, [...streets, { points: lane, width: LANE_SURFACE_WIDTH }], houses),
  };
}

// Low dry-stone walls along the road in front of the houses, as in the village photographs. A wall
// stops short of junctions and of other houses.
function roadsideWalls(ground: Ground, houses: House[], streets: Street[]): Wall[] {
  const walls: Wall[] = [];
  for (const house of houses) {
    if (house.church) {
      continue;
    }

    let nearest: { x: number; z: number; tx: number; tz: number; distance: number; width: number } | undefined;
    for (const street of streets) {
      const near = nearestOnPolyline(street.points, house.x, house.z);
      if (!nearest || near.distance < nearest.distance) {
        nearest = { ...near, width: street.width };
      }
    }

    if (!nearest || nearest.distance > house.depth / 2 + 14) {
      continue;
    }

    // Which side of the street the house is on, as the sign of the cross product with the direction.
    const side = (house.x - nearest.x) * -nearest.tz + (house.z - nearest.z) * nearest.tx > 0 ? 1 : -1;
    const offset = nearest.width / 2 + 0.9;
    const points: [number, number][] = [];
    for (let along = -house.width / 2 - 1; along <= house.width / 2 + 1; along += 2.5) {
      const x = nearest.x + nearest.tx * along + -nearest.tz * side * offset;
      const z = nearest.z + nearest.tz * along + nearest.tx * side * offset;
      const crowded = streets.some((street) => distanceToPolyline(street.points, x, z) < street.width / 2 + 0.4);
      const inside = houses.some((other) => insideHouse(other, x, z, 0.6));
      if (!crowded && !inside && ground.distanceToBed(x, z) > 8) {
        points.push([x, z]);
      } else if (points.length >= 2) {
        break;
      } else {
        points.length = 0;
      }
    }

    if (points.length >= 2) {
      walls.push({ points, height: 0.95, thickness: 0.5 });
    }
  }

  return walls;
}

// Each house has a few small fruit trees and a low hedge on the sides away from the street.
function addGardens(ground: Ground, houses: House[], random: () => number, orchard: Bush[], hedges: Bush[], free: (x: number, z: number) => boolean) {
  const frame = (house: House, along: number, across: number): [number, number] => [
    house.x + along * Math.cos(house.yaw) + across * Math.sin(house.yaw),
    house.z - along * Math.sin(house.yaw) + across * Math.cos(house.yaw),
  ];
  for (const house of houses) {
    if (house.church) {
      continue;
    }

    const trees = random() < 0.6 ? 1 : 0;
    for (let tree = 0; tree < trees; tree += 1) {
      const [x, z] = frame(house, (random() - 0.5) * house.width * 1.2, (random() < 0.5 ? 1 : -1) * (house.depth / 2 + 2.5 + random() * 3));
      if (free(x, z) && !houses.some((other) => insideHouse(other, x, z, 1.2))) {
        orchard.push({ x, y: ground.heightAt(x, z) + 1, z, size: 0.9 + random() * 0.4, color: pickFrom(random, ORCHARD_COLORS) });
      }
    }

    const side = random() < 0.5 ? 1 : -1;
    for (let along = -house.width / 2; along <= house.width / 2; along += 3.4) {
      const [x, z] = frame(house, along, side * (house.depth / 2 + 1.6));
      if (free(x, z) && !houses.some((other) => insideHouse(other, x, z, 0.8))) {
        hedges.push({ x, y: ground.heightAt(x, z), z, size: 1 + random() * 0.3, color: pickFrom(random, HEDGE_COLORS) });
      }
    }
  }
}

// Rows of small fruit trees on the slope between the main road and the loop, laid slightly askew.
function createOrchard(ground: Ground, random: () => number): Bush[] {
  const [centreX, centreZ] = planToWorld([ORCHARD_AT.x, ORCHARD_AT.north]);
  const tilt = 0.35;
  const trees: Bush[] = [];
  for (let row = -4; row <= 4; row += 1) {
    for (let column = -6; column <= 6; column += 1) {
      const across = row * 5.4;
      const along = column * 4.4;
      const x = centreX + along * Math.cos(tilt) - across * Math.sin(tilt);
      const z = centreZ + along * Math.sin(tilt) + across * Math.cos(tilt);
      const inside = Math.hypot(x - centreX, z - centreZ) < ORCHARD_AT.radius * 0.8 && x > centreX - 22 && x < centreX + 15;
      if (inside && ground.distanceToBed(x, z) > 24) {
        trees.push({ x, y: ground.heightAt(x, z) + 1, z, size: 1 + random() * 0.25, color: pickFrom(random, ORCHARD_COLORS) });
      }
    }
  }

  return trees;
}

// The forested mountain sides beyond the ground the scene had before: spruces and larches as plain
// cones, about six metres apart with clearings between, over the painted canopy of the terrain.
function createFarForest(ground: Ground, random: () => number, streets: Street[], houses: House[]): FarTree[] {
  const trees: FarTree[] = [];
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  const spacing = FAR_FOREST_SPACING;
  for (let gridX = minX; gridX < maxX; gridX += spacing) {
    for (let gridZ = minZ; gridZ < maxZ; gridZ += spacing) {
      const x = gridX + random() * spacing;
      const z = gridZ + random() * spacing;
      const clearing = valueNoise(x * 0.035 + 11, z * 0.035 - 4);
      if (clearing < 0.22) {
        continue;
      }

      const height = ground.heightAt(x, z);
      const cover = mountainCover(x, z, height, ground.slopeAt(x, z), ground.uphillAt(x, z));
      if (cover.forest < 0.15 || cover.stony > 0.3 || random() > Math.min(1, cover.forest * 2) * (1 - cover.stony)) {
        continue;
      }

      if (ground.distanceToBed(x, z) < 9 || streets.some((street) => distanceToPolyline(street.points, x, z) < street.width / 2 + 3) || houses.some((house) => insideHouse(house, x, z, 3))) {
        continue;
      }

      trees.push({
        x,
        y: height,
        z,
        radius: 2.9 + random() * 1.3,
        height: 12 + random() * 6,
        // Spruces are dark green; the larches among them have turned gold and orange.
        color: random() < 0.1 ? pickFrom(random, LARCH_COLORS) : pickFrom(random, CONIFER_COLORS),
      });
    }
  }

  return trees;
}
