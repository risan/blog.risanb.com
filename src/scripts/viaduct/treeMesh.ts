// The shapes of the trees as meshes: broadleaf crowns and bushes made of leaf cards, spruces made
// of drooping needle sprays around a dark core, and the bare wood. Each is built once, in metres
// for a reference tree, from a fixed seed, and instanced with a scale. Pure: no DOM, no GL.
//
// A card's lighting normal does not follow the card. It points mostly out from the middle of the
// crown, so the crown shades as one soft mass instead of as a pile of flat planes.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, MeshBuilder, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import { NEEDLE_SOLID_UV } from './textures.ts';

export const BROADLEAF_RADIUS = 6;
export const CONIFER_RADIUS = 3;
export const CONIFER_HEIGHT = 14;

const CROWN_CENTRE_HEIGHT = 7.4;
const CROWN_RADII: Vec3 = [BROADLEAF_RADIUS, 4.8, BROADLEAF_RADIUS];

function add(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function smoothstep(low: number, high: number, value: number): number {
  const amount = Math.min(Math.max((value - low) / (high - low), 0), 1);

  return amount * amount * (3 - 2 * amount);
}

function randomDirection(random: () => number): Vec3 {
  const up = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const flat = Math.sqrt(1 - up * up);

  return [Math.cos(angle) * flat, up, Math.sin(angle) * flat];
}

interface Cluster {
  centre: Vec3;
  radius: number;
}

interface CrownShape {
  centre: Vec3;
  radii: Vec3;
  cards: number;
  clusters: number;
  clusterRadius: number;
  cardSize: [number, number];
}

// A square card of the given size lying in the plane across `normal`, turned by `roll` about it.
function leafCard(builder: MeshBuilder, centre: Vec3, normal: Vec3, roll: number, size: number, lightNormal: Vec3, colorAt: (point: Vec3) => Rgb, mirror: boolean) {
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const first = normalize(cross(helper, normal));
  const second = cross(normal, first);
  const half = size * 0.5;
  const along = add(add([0, 0, 0], first, Math.cos(roll) * half), second, Math.sin(roll) * half);
  const across = add(add([0, 0, 0], first, -Math.sin(roll) * half), second, Math.cos(roll) * half);
  const corners: Vec3[] = [
    add(add(centre, along, -1), across, -1),
    add(add(centre, along, 1), across, -1),
    add(add(centre, along, 1), across, 1),
    add(add(centre, along, -1), across, 1),
  ];
  const uvs: [number, number][] = mirror
    ? [[1, 0], [0, 0], [0, 1], [1, 1]]
    : [[0, 0], [1, 0], [1, 1], [0, 1]];
  const ids = corners.map((corner, index) => builder.vertex(corner, lightNormal, uvs[index], colorAt(corner)));
  builder.quad(ids[0], ids[1], ids[2], ids[3]);
}

// Cards scattered in clumps inside a flattened ball. Clumps that reach past the ball's skin make
// the bumps of the outline, and the gaps between clumps let the sky and the branches show.
function leafCrown(builder: MeshBuilder, random: () => number, shape: CrownShape, shade: (inside: number, up: number) => number) {
  const { centre, radii } = shape;
  const clusters: Cluster[] = [];
  while (clusters.length < shape.clusters) {
    const direction = randomDirection(random);
    if (direction[1] < -0.3 && random() < 0.75) {
      continue;
    }

    const reach = 0.42 + random() * 0.38;
    clusters.push({
      centre: [centre[0] + direction[0] * radii[0] * reach, centre[1] + direction[1] * radii[1] * reach, centre[2] + direction[2] * radii[2] * reach],
      radius: shape.clusterRadius * (0.8 + random() * 0.4),
    });
  }

  for (let index = 0; index < shape.cards; index += 1) {
    const cluster = clusters[index % clusters.length];
    const offset = randomDirection(random);
    const spread = cluster.radius * Math.cbrt(random());
    let local: Vec3 = [
      (cluster.centre[0] + offset[0] * spread - centre[0]) / radii[0],
      (cluster.centre[1] + offset[1] * spread * 0.8 - centre[1]) / radii[1],
      (cluster.centre[2] + offset[2] * spread - centre[2]) / radii[2],
    ];
    const reach = Math.hypot(local[0], local[1], local[2]);
    if (reach > 1.08) {
      local = [(local[0] / reach) * 1.08, (local[1] / reach) * 1.08, (local[2] / reach) * 1.08];
    }

    const position: Vec3 = [centre[0] + local[0] * radii[0], centre[1] + local[1] * radii[1], centre[2] + local[2] * radii[2]];
    const outward = normalize(local);
    const normal = normalize(add(add([0, 0, 0], outward, 0.6), randomDirection(random), 0.9));
    const facing: Vec3 = dot(normal, outward) < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
    const lightNormal = normalize(add(add([0, 0, 0], outward, 0.78), facing, 0.22));
    const size = shape.cardSize[0] + (shape.cardSize[1] - shape.cardSize[0]) * random();
    const tint = 0.9 + random() * 0.2;
    leafCard(
      builder,
      position,
      normal,
      random() * Math.PI,
      size,
      lightNormal,
      (point) => {
        const inside = Math.min(1, Math.hypot((point[0] - centre[0]) / radii[0], (point[1] - centre[1]) / radii[1], (point[2] - centre[2]) / radii[2]));
        const value = shade(inside, (point[1] - centre[1]) / radii[1]) * tint;

        return [value, value, value];
      },
      random() < 0.5,
    );
  }
}

// Darker toward the middle of the crown and underneath, lighter on the sunny top: a cheap stand-in
// for the shade inside a real crown.
function crownShade(inside: number, up: number): number {
  return (0.34 + 0.78 * smoothstep(0.12, 1, inside)) * (0.8 + 0.26 * Math.min(Math.max(up, -1), 1));
}

// Fewer cards leave the crown thin, so the phone version makes each card larger.
export function buildBroadleafCrown(cards: number, cardScale = 1): BuiltMesh {
  const builder = new MeshBuilder();
  leafCrown(
    builder,
    mulberry32(21),
    { centre: [0, CROWN_CENTRE_HEIGHT, 0], radii: CROWN_RADII, cards, clusters: 10, clusterRadius: 2.5, cardSize: [1.5 * cardScale, 2.3 * cardScale] },
    crownShade,
  );

  return builder.build();
}

export function buildBushCrown(cards: number): BuiltMesh {
  const builder = new MeshBuilder();
  leafCrown(
    builder,
    mulberry32(8),
    { centre: [0, 0.45, 0], radii: [1, 0.72, 1], cards, clusters: 4, clusterRadius: 0.6, cardSize: [0.6, 0.95] },
    crownShade,
  );

  return builder.build();
}

// A tube through the points, thick as `radii` says at each, with outward normals.
function tube(builder: MeshBuilder, points: Vec3[], radii: number[], sides: number, color: Rgb) {
  const rings: number[][] = [];
  points.forEach((point, index) => {
    const next = points[Math.min(index + 1, points.length - 1)];
    const previous = points[Math.max(index - 1, 0)];
    const axis = normalize([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]]);
    const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const first = normalize(cross(helper, axis));
    const second = cross(axis, first);
    const ring: number[] = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const outward = normalize(add(add([0, 0, 0], first, Math.cos(angle)), second, Math.sin(angle)));
      ring.push(builder.vertex(add(point, outward, radii[index]), outward, [side / sides, index / points.length], color));
    }

    rings.push(ring);
  });

  for (let index = 0; index < rings.length - 1; index += 1) {
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides;
      builder.quad(rings[index][side], rings[index][nextSide], rings[index + 1][nextSide], rings[index + 1][side]);
    }
  }
}

const BARK = hexToLinear(0x4f4336);
const BARK_DARK = hexToLinear(0x3b3128);

// The trunk, a leader up into the crown and a few main limbs that fork out of it.
export function buildBroadleafWood(): BuiltMesh {
  const builder = new MeshBuilder();
  const random = mulberry32(4);
  tube(
    builder,
    [[0, -0.4, 0], [0, 0.5, 0.02], [0.05, 1.8, 0], [0, 3.2, -0.08], [-0.08, 5, 0.05], [0, 7.2, 0.1]],
    [0.62, 0.44, 0.36, 0.32, 0.24, 0.08],
    7,
    BARK,
  );

  const limbs = 4;
  const turn = random() * Math.PI;
  for (let limb = 0; limb < limbs; limb += 1) {
    const angle = turn + (limb / limbs) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const start = 3.1 + limb * 0.55 + random() * 0.5;
    const reach = 2.8 + random() * 1.4;
    const direction: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
    tube(
      builder,
      [
        [0, start, 0],
        add([0, start + 0.7, 0], direction, reach * 0.4),
        add([0, start + 1.9 + random() * 0.6, 0], direction, reach * 0.75),
        add([0, start + 3 + random() * 0.8, 0], direction, reach),
      ],
      [0.3, 0.22, 0.14, 0.06],
      5,
      BARK_DARK,
    );
  }

  return builder.build();
}

export function buildConiferTrunk(): BuiltMesh {
  const builder = new MeshBuilder();
  tube(builder, [[0, -0.3, 0], [0, 1.2, 0], [0, 4.5, 0], [0, 9.5, 0]], [0.42, 0.3, 0.2, 0.06], 6, hexToLinear(0x5b4632));

  return builder.build();
}

// A spruce: whorls of drooping needle sprays that shorten toward the top, round a dark cone so the
// tree never looks hollow. Each spray bends in three steps, up on the near end and down at the tip.
export function buildConiferCrown(whorls: number, branchesLow: number, branchesHigh: number, steps = 3): BuiltMesh {
  const builder = new MeshBuilder();
  const random = mulberry32(12);
  const [solidU, solidV] = NEEDLE_SOLID_UV;
  const coneSides = 8;
  const coneBase = CONIFER_HEIGHT * 0.1;
  const coneTop = CONIFER_HEIGHT * 0.99;
  const coneRadius = CONIFER_RADIUS * 0.4;
  const rim: number[] = [];
  for (let side = 0; side < coneSides; side += 1) {
    const angle = (side / coneSides) * Math.PI * 2;
    rim.push(builder.vertex([Math.cos(angle) * coneRadius, coneBase, Math.sin(angle) * coneRadius], normalize([Math.cos(angle), 0.35, Math.sin(angle)]), [solidU, solidV], [0.6, 0.6, 0.6]));
  }

  const apex = builder.vertex([0, coneTop, 0], [0, 1, 0], [solidU, solidV], [0.55, 0.55, 0.55]);
  for (let side = 0; side < coneSides; side += 1) {
    builder.triangle(rim[side], rim[(side + 1) % coneSides], apex);
  }

  let turn = random() * Math.PI * 2;
  for (let whorl = 0; whorl < whorls; whorl += 1) {
    const height = whorl / (whorls - 1);
    const y = CONIFER_HEIGHT * (0.17 + 0.8 * height);
    const reach = CONIFER_RADIUS * (0.14 + 0.86 * (1 - height) ** 0.9);
    const branches = Math.round(branchesLow + (branchesHigh - branchesLow) * (1 - height));
    turn += 2.4;
    for (let branch = 0; branch < branches; branch += 1) {
      const angle = turn + (branch / branches) * Math.PI * 2 + (random() - 0.5) * 0.6;
      const length = reach * (0.85 + random() * 0.3);
      const width = Math.max(1, length * 1.1);
      const droop = length * (0.3 + random() * 0.15);
      const direction: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
      const sideways: Vec3 = [-direction[2], 0, direction[0]];
      const roll = (random() - 0.5) * 0.7;
      const start = y + (random() - 0.5) * 0.5;
      const ids: number[][] = [];
      for (let step = 0; step <= steps; step += 1) {
        const along = step / steps;
        const spine: Vec3 = [direction[0] * (0.2 + (length - 0.2) * along), start + 0.25 * Math.sin(along * Math.PI) - droop * along ** 1.6, direction[2] * (0.2 + (length - 0.2) * along)];
        const lightNormal = normalize([direction[0] * 0.8, 0.5, direction[2] * 0.8]);
        const value = (0.62 + 0.8 * along) * (0.8 + 0.3 * height);
        const row: number[] = [];
        for (const edge of [-1, 1]) {
          const lift = Math.sin(roll) * edge * width * 0.5;
          const point = add(add(spine, sideways, edge * width * 0.5 * Math.cos(roll)), [0, 1, 0], lift);
          row.push(builder.vertex(point, lightNormal, [along, edge < 0 ? 0 : 1], [value, value, value]));
        }

        ids.push(row);
      }

      for (let step = 0; step < steps; step += 1) {
        builder.quad(ids[step][0], ids[step + 1][0], ids[step + 1][1], ids[step][1]);
      }
    }
  }

  return builder.build();
}
