// Merged geometry for the small things of the valley that are not instanced: the lane, the
// houses, the fence posts, the standing stones and the dry-stone walls. Pure.

import { hexToLinear, MeshBuilder, mixColor, type BuiltMesh, type Vec3 } from './meshBuilder.ts';
import { mulberry32 } from '../river/world.ts';
import { LANE_HALF_WIDTH, type Scenery } from './scenery.ts';
import type { Ground } from './terrain.ts';

const LANE_COLOR = hexToLinear(0x8f8b84);
const LANE_EDGE = hexToLinear(0x7a8446);
const WALL_TILE_METRES = 3.2;

export interface PropsMeshes {
  // Vertex-coloured: lane, houses, posts, stones.
  props: BuiltMesh;
  // Textured with the viaduct's masonry: dry-stone walls, and the houses.
  walls: BuiltMesh;
}

// A stone house with a gabled roof of grey slabs. Walls and roof both use the masonry texture,
// the roof darkened so its courses read as slates.
function buildHouse(builder: MeshBuilder, house: Scenery['houses'][number], ground: Ground) {
  const base = Math.min(
    ground.heightAt(house.x, house.z),
    ground.heightAt(house.x + house.width / 2, house.z),
    ground.heightAt(house.x - house.width / 2, house.z),
  ) - 0.5;
  const { x, z, width, depth, height, yaw } = house;
  const scale = 1 / WALL_TILE_METRES;
  builder.box([x, base, z], [width, height + 0.5, depth], yaw, house.wall, { uvScale: scale });
  const top = base + height + 0.5;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const point = (along: number, up: number, across: number): Vec3 => [x + along * cos + across * sin, up, z - along * sin + across * cos];

  const hw = width / 2 + 0.5;
  const hd = depth / 2 + 0.5;
  const ridge = top + depth * 0.36;
  const slope = Math.hypot(hd, ridge - top + 0.2) * scale;
  const run = 2 * hw * scale;
  const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [run, 0], [run, slope], [0, slope]];
  builder.flatQuad(point(-hw, top - 0.2, hd), point(hw, top - 0.2, hd), point(hw, ridge, 0), point(-hw, ridge, 0), uv, house.roof);
  builder.flatQuad(point(hw, top - 0.2, -hd), point(-hw, top - 0.2, -hd), point(-hw, ridge, 0), point(hw, ridge, 0), uv, mixColor(house.roof, [0, 0, 0], 0.18));
  for (const end of [-1, 1]) {
    const gable = [point(end * (width / 2), top, -depth / 2), point(end * (width / 2), top, depth / 2), point(end * (width / 2), ridge - 0.2, 0)];
    builder.polygon(gable, house.wall, [cos * end, 0, -sin * end], (corner) => [(corner[0] + corner[2]) * scale, corner[1] * scale]);
  }

  builder.box(point(width * 0.28, 0, depth * 0.2), [0.9, ridge - base + 0.5, 0.9], yaw, mixColor(house.wall, [0.35, 0.3, 0.28], 0.4), { uvScale: scale });
}

function buildLane(builder: MeshBuilder, lane: [number, number][], ground: Ground) {
  let previous: { left: Vec3; right: Vec3; outerLeft: Vec3; outerRight: Vec3 } | undefined;
  for (let index = 0; index < lane.length; index += 1) {
    const [x, z] = lane[index];
    const [nextX, nextZ] = lane[Math.min(index + 1, lane.length - 1)];
    const [lastX, lastZ] = lane[Math.max(index - 1, 0)];
    const dx = nextX - lastX;
    const dz = nextZ - lastZ;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    const at = (offset: number): Vec3 => {
      const px = x + nx * offset;
      const pz = z + nz * offset;

      return [px, ground.heightAt(px, pz) + 0.07, pz];
    };
    const current = {
      left: at(-LANE_HALF_WIDTH),
      right: at(LANE_HALF_WIDTH),
      outerLeft: at(-LANE_HALF_WIDTH - 0.7),
      outerRight: at(LANE_HALF_WIDTH + 0.7),
    };
    if (previous) {
      const uv: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      builder.flatQuad(previous.left, previous.right, current.right, current.left, uv, LANE_COLOR);
      builder.flatQuad(previous.outerLeft, previous.left, current.left, current.outerLeft, uv, LANE_EDGE);
      builder.flatQuad(previous.right, previous.outerRight, current.outerRight, current.right, uv, LANE_EDGE);
    }

    previous = current;
  }
}

export function buildProps(scenery: Scenery, ground: Ground): PropsMeshes {
  const props = new MeshBuilder();
  const walls = new MeshBuilder();
  const random = mulberry32(17);

  buildLane(props, scenery.lane, ground);
  for (const house of scenery.houses) {
    buildHouse(walls, house, ground);
  }

  for (const post of scenery.posts) {
    props.box([post.x, post.y - 0.1, post.z], [0.07, post.height + 0.1, 0.07], 0, post.color);
  }

  for (const stone of scenery.standingStones) {
    props.box([stone.x, stone.y - 0.2, stone.z], [0.45, stone.height + 0.2, 0.28], random() * Math.PI, stone.color);
  }

  for (const wall of scenery.walls) {
    for (let index = 0; index < wall.points.length - 1; index += 1) {
      const [ax, az] = wall.points[index];
      const [bx, bz] = wall.points[index + 1];
      const length = Math.hypot(bx - ax, bz - az);
      const pieces = Math.max(1, Math.round(length / 4));
      for (let piece = 0; piece < pieces; piece += 1) {
        const t0 = piece / pieces;
        const t1 = (piece + 1) / pieces;
        const x0 = ax + (bx - ax) * t0;
        const z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1;
        const z1 = az + (bz - az) * t1;
        const start = ground.heightAt(x0, z0);
        const end = ground.heightAt(x1, z1);
        const pieceLength = length / pieces;
        const rise = end - start;
        walls.box(
          [(x0 + x1) / 2, (start + end) / 2 - 0.5, (z0 + z1) / 2],
          [pieceLength + 0.05, wall.height + 0.5, wall.thickness],
          Math.atan2(-(z1 - z0), x1 - x0),
          [1, 1, 1],
          { uvScale: 1 / WALL_TILE_METRES, pitch: Math.atan2(rise, pieceLength), topColor: [0.9, 0.9, 0.86] },
        );
      }
    }
  }

  return { props: props.build(), walls: walls.build() };
}
