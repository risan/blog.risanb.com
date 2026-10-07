// Where the houses of Brusio stand. The village lies up the valley to the west of the loop, along
// a main road and a few streets, with a church and its bell tower further up. Pure and seeded:
// the same call always gives the same village.

import { hexToLinear, type Rgb } from './meshBuilder.ts';
import type { Ground } from './terrain.ts';

export interface House {
  x: number;
  z: number;
  width: number;
  depth: number;
  // Height of the eaves above the ground.
  height: number;
  floors: number;
  yaw: number;
  wall: Rgb;
  roof: Rgb;
  flatRoof: boolean;
  // A steep lower pitch under a flat top, as on the big villa beside the loop.
  mansard: boolean;
  // Sloping on all four sides instead of gabled.
  hipped: boolean;
  // Stone houses show the bare masonry; the rest are plastered.
  stone: boolean;
  church: boolean;
}

// A street as a polyline of plan points (x, z), with the width of its road surface.
export interface Street {
  points: [number, number][];
  width: number;
}

// How a street is lined with houses: the gap between them and the road edge, how many to try,
// and which stretch of the street (as shares of its length) they may stand on.
export interface Frontage {
  street: number;
  setback: number;
  from: number;
  to: number;
  // The most houses on each side.
  perSide: number;
  // Most houses stand in terraces, a few metres apart at most; 1 spreads them out as on a farm.
  looseness: number;
  sides: (1 | -1)[];
}

export const FLOOR_HEIGHT = 3;
const HOUSE_CLEARANCE_TO_BED = 15;
const HOUSE_CLEARANCE_TO_VIADUCT = 24;
const MAX_SLOPE = 0.22;
const STREET_MARGIN = 2;

const PLASTER = [0xf2eee4, 0xf4f1ea, 0xefe9da, 0xe9dfc4, 0xe7d9b4, 0xdcc590, 0xd8b878, 0xf0e4d0, 0xe8c9bd, 0xe2b8a6, 0xd9d3c4, 0xeadcc0].map(hexToLinear);
const STONE = hexToLinear(0xd2cabb);
const SLATE = [0xa4a6aa, 0x969a9e, 0xb2b3b5, 0x8c9195].map(hexToLinear);

export function polylineLength(points: [number, number][]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
  }

  return length;
}

// The point a given distance along a polyline, and the unit direction there.
export function alongPolyline(points: [number, number][], distance: number): { x: number; z: number; tx: number; tz: number } {
  let remaining = distance;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, az] = points[index];
    const [bx, bz] = points[index + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (remaining <= length || index === points.length - 2) {
      const t = Math.min(remaining / length, 1);

      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / length, tz: (bz - az) / length };
    }

    remaining -= length;
  }

  throw new Error('viaduct: a street has fewer than two points');
}

export function distanceToPolyline(points: [number, number][], x: number, z: number): number {
  let nearest = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, az] = points[index];
    const [bx, bz] = points[index + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const t = Math.min(Math.max(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0), 1);
    nearest = Math.min(nearest, Math.hypot(x - (ax + abx * t), z - (az + abz * t)));
  }

  return nearest;
}

// The point of a polyline nearest to (x, z), the unit direction there, and how far away it is.
export function nearestOnPolyline(points: [number, number][], x: number, z: number): { x: number; z: number; tx: number; tz: number; distance: number } {
  let best = { x: points[0][0], z: points[0][1], tx: 1, tz: 0, distance: Infinity };
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, az] = points[index];
    const [bx, bz] = points[index + 1];
    const abx = bx - ax;
    const abz = bz - az;
    const length = Math.hypot(abx, abz);
    const t = Math.min(Math.max(((x - ax) * abx + (z - az) * abz) / (length * length), 0), 1);
    const nearX = ax + abx * t;
    const nearZ = az + abz * t;
    const distance = Math.hypot(x - nearX, z - nearZ);
    if (distance < best.distance) {
      best = { x: nearX, z: nearZ, tx: abx / length, tz: abz / length, distance };
    }
  }

  return best;
}

type Corner = [number, number];

export function footprint(house: Pick<House, 'x' | 'z' | 'width' | 'depth' | 'yaw'>, grow = 0): Corner[] {
  const cos = Math.cos(house.yaw);
  const sin = Math.sin(house.yaw);
  const halfWidth = house.width / 2 + grow;
  const halfDepth = house.depth / 2 + grow;

  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Corner[]).map(([along, across]) => [
    house.x + along * halfWidth * cos + across * halfDepth * sin,
    house.z - along * halfWidth * sin + across * halfDepth * cos,
  ]);
}

// Separating-axis test for two convex quadrilaterals.
function overlap(first: Corner[], second: Corner[]): boolean {
  for (const shape of [first, second]) {
    for (let index = 0; index < shape.length; index += 1) {
      const [ax, az] = shape[index];
      const [bx, bz] = shape[(index + 1) % shape.length];
      const axisX = -(bz - az);
      const axisZ = bx - ax;
      const project = (corners: Corner[]) => {
        const values = corners.map(([x, z]) => x * axisX + z * axisZ);

        return [Math.min(...values), Math.max(...values)];
      };
      const [lowA, highA] = project(first);
      const [lowB, highB] = project(second);
      if (highA < lowB || highB < lowA) {
        return false;
      }
    }
  }

  return true;
}

export function housesOverlap(first: House, second: House, gap: number): boolean {
  return overlap(footprint(first, gap / 2), footprint(second, gap / 2));
}

export interface VillagePlan {
  streets: Street[];
  frontages: Frontage[];
  // Houses fixed by hand, which the rest keep clear of.
  fixed: House[];
  // Where nothing may be built: [x, z, radius].
  reserved: [number, number, number][];
  random: () => number;
}

export function placeHouses(ground: Ground, plan: VillagePlan, limit: number): House[] {
  const { random } = plan;
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const houses: House[] = [...plan.fixed];

  function acceptable(house: House, ownStreet: number, ownSetback: number): boolean {
    const corners = footprint(house, 1);
    for (const [x, z] of [...corners, [house.x, house.z] as Corner]) {
      if (ground.distanceToBed(x, z) < HOUSE_CLEARANCE_TO_BED || ground.viaductAt(x, z).distance < HOUSE_CLEARANCE_TO_VIADUCT) {
        return false;
      }

      if (plan.reserved.some(([rx, rz, radius]) => Math.hypot(x - rx, z - rz) < radius)) {
        return false;
      }

      for (let index = 0; index < plan.streets.length; index += 1) {
        const street = plan.streets[index];
        const margin = index === ownStreet ? ownSetback - 2 : STREET_MARGIN;
        if (distanceToPolyline(street.points, x, z) < street.width / 2 + margin) {
          return false;
        }
      }
    }

    if (ground.slopeAt(house.x, house.z) > MAX_SLOPE) {
      return false;
    }

    return houses.every((other) => !housesOverlap(house, other, 1.2));
  }

  interface Walker {
    frontage: Frontage;
    side: 1 | -1;
    distance: number;
    built: number;
  }

  // Tries a house at the walker's position and moves it on: past the house when it fits, a few
  // metres otherwise. Returns true when a house was built.
  function tryHouse(walker: Walker): boolean {
    const { frontage, side } = walker;
    const street = plan.streets[frontage.street];
    const floors = pick([2, 2, 3, 3, 3, 4]);
    const width = 7 + random() * 8 + (random() < 0.2 ? 4 : 0);
    const depth = 6.5 + random() * 4.5;
    const centre = alongPolyline(street.points, walker.distance + width / 2);
    // The normal to the right of the way the street runs is the `side` = 1 edge.
    const offset = street.width / 2 + frontage.setback + depth / 2;
    const house: House = {
      x: centre.x + -centre.tz * side * offset,
      z: centre.z + centre.tx * side * offset,
      width,
      depth,
      height: floors * FLOOR_HEIGHT + 0.6,
      floors,
      yaw: Math.atan2(-centre.tz, centre.tx) + (random() - 0.5) * 0.12,
      wall: random() < 0.14 ? STONE : pick(PLASTER),
      roof: pick(SLATE),
      flatRoof: random() < 0.07,
      mansard: false,
      hipped: random() < 0.35 && width > depth + 3,
      stone: false,
      church: false,
    };
    house.stone = house.wall === STONE;
    const terraced = random() > frontage.looseness;
    const gap = terraced ? 0.3 + random() * 1.2 : 4 + random() * 10 * frontage.looseness;
    if (!acceptable(house, frontage.street, frontage.setback)) {
      walker.distance += 5;

      return false;
    }

    houses.push(house);
    walker.built += 1;
    walker.distance += width + gap;

    return true;
  }

  // The frontages are worked in turn, one house at a time, so that a short limit still spreads
  // the village over all its streets.
  const walkers: Walker[] = plan.frontages.flatMap((frontage) =>
    frontage.sides.map((side) => ({ frontage, side, distance: polylineLength(plan.streets[frontage.street].points) * frontage.from, built: 0 })),
  );
  const reaches = (walker: Walker) =>
    walker.built < walker.frontage.perSide && walker.distance < polylineLength(plan.streets[walker.frontage.street].points) * walker.frontage.to;
  while (houses.length < limit && walkers.some(reaches)) {
    for (const walker of walkers) {
      let built = false;
      while (!built && reaches(walker) && houses.length < limit) {
        built = tryHouse(walker);
      }
    }
  }

  return houses;
}
