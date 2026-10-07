// Where the trees, bushes, rocks, walls, houses and the other small things of the valley
// stand. Pure and seeded: the same call always gives the same valley.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, type Rgb } from './meshBuilder.ts';
import type { Ground } from './terrain.ts';
import { offsetFromTrack, track } from './track.ts';

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

export interface House {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  yaw: number;
  wall: Rgb;
  roof: Rgb;
  flatRoof: boolean;
}

export interface Post {
  x: number;
  y: number;
  z: number;
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
}

// Plan positions below are written as (x, north): the loop is round about (0, 0) and the viaduct
// is its south-east side. Everything is stored with z = -north, as the rest of the scene does.
type Plan = [number, number];

export const MIN_TREE_DISTANCE_TO_BED = 6;
export const MIN_TREE_DISTANCE_TO_VIADUCT = 12;
export const LANE_HALF_WIDTH = 1.7;
export const MAX_BUSHES = 60;

// Early autumn in the valley: the broadleaves turning, gold and orange among the last greens,
// some rust. Conifers stay green.
const BROADLEAF_COLORS = [0x667a32, 0x587030, 0x76843a, 0x4f6a2e, 0x6a7a30, 0x86882f].map(hexToLinear);
const GOLD_COLORS = [0xb89a2e, 0xc4a33a, 0xa8862c, 0xd0ac40].map(hexToLinear);
const ORANGE_COLORS = [0xb8682a, 0xc0782e, 0xa65a24].map(hexToLinear);
const RUST_COLORS = [0x9a4426, 0x8a3a22].map(hexToLinear);
const CONIFER_COLORS = [0x2f4f26, 0x38592b, 0x435f2a].map(hexToLinear);
const BUSH_COLORS = [0x4a5a26, 0x5a6228, 0x6e5a28, 0x3f5426].map(hexToLinear);
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
  [-100, 40, 16, 6, 0.1, 0.9],
  [-152, 30, 14, 6, 0.1, 0.9],
  // Along the lane and in the bottom left corner.
  [-55, -93, 9, 5, 0, 1.0],
  [-34, -103, 8, 4, 0, 1.0],
  [-80, -88, 8, 4, 0, 1.0],
  [8, -104, 12, 6, 0.2, 1.0],
  [60, -104, 10, 5, 0.2, 1.0],
];

function planToWorld(point: Plan): [number, number] {
  return [point[0], -point[1]];
}

function route(points: Plan[]): [number, number][] {
  return points.map(planToWorld);
}

function lanePoints(): Plan[] {
  const control: Plan[] = [[-190, -112], [-150, -103], [-104, -101], [-60, -97], [-20, -84], [20, -83], [60, -92], [100, -99], [140, -108], [190, -122]];
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

function distanceToLane(lane: [number, number][], x: number, z: number): number {
  let nearest = Infinity;
  for (let index = 0; index < lane.length - 1; index += 1) {
    const [ax, az] = lane[index];
    const [bx, bz] = lane[index + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const t = Math.min(Math.max(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0), 1);
    nearest = Math.min(nearest, Math.hypot(x - (ax + abx * t), z - (az + abz * t)));
  }

  return nearest;
}

export function createScenery(ground: Ground, seed = 3): Scenery {
  const random = mulberry32(seed);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const lane = lanePoints().map(planToWorld);

  // A spot is free when the line, the viaduct and the lane keep clear of it.
  function clearOfLine(x: number, z: number, margin: number, viaductMargin = MIN_TREE_DISTANCE_TO_VIADUCT): boolean {
    return (
      ground.distanceToBed(x, z) > margin &&
      ground.viaductAt(x, z).distance > viaductMargin &&
      distanceToLane(lane, x, z) > LANE_HALF_WIDTH + margin * 0.5
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
  for (let s = track.circleStartS - 330; s <= track.circleStartS - 20; s += 6) {
    const spot = offsetFromTrack(s, -3.9);
    upperWall.push([spot.x, spot.z]);
  }

  walls.push({ points: upperWall, height: 1.9, thickness: 0.7 });

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

  const stone = hexToLinear(0xcfc6b4);
  const slate = hexToLinear(0x6f6c68);
  const houses: House[] = [
    { x: -72, z: 110, width: 12, depth: 8.5, height: 6.2, yaw: 0.08, wall: stone, roof: slate, flatRoof: false },
    { x: -56, z: 90, width: 8, depth: 6, height: 4.4, yaw: 0.3, wall: hexToLinear(0xd9d0be), roof: slate, flatRoof: false },
  ];

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

  return { trees, bushes, rocks, walls, houses, posts, standingStones, lane };
}
