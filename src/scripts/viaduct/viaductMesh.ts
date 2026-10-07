// The masonry of the Kreisviadukt: nine arches on a curve, the piers, the abutments with their
// wing walls, the parapet and its railing. Pure: it returns merged geometry for the scene to draw.
//
// Everything is placed with `s` (distance along the line) and `lateral` (metres to the right of
// the direction of travel). The line runs clockwise, so the right side faces the middle of the
// loop and the left side faces the valley, which is the side the camera sees.

import { mulberry32 } from '../river/world.ts';
import { hexToLinear, MeshBuilder, scaleColor, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import { SLAB_LENGTH, SLAB_THICKNESS, SLAB_V, STONE_TILE, TRIM, TRIM_REPEAT, VOUSSOIR_V } from './stoneLayout.ts';
import { ARCH_SPAN, DECK_WIDTH, offsetFromTrack, SPRINGING_BELOW_CROWN, track, CROWN_BELOW_RAIL } from './track.ts';
import type { Ground } from './terrain.ts';

export const FACE_OFFSET = DECK_WIDTH / 2 + 0.1;
const PARAPET_INNER = FACE_OFFSET - 0.45;
const PARAPET_ABOVE_RAIL = 0.25;
const WING_LENGTH = 7;
const BATTER = 0.02;
const ARCH_SEGMENTS = 18;
const VOUSSOIRS = 42;
const VOUSSOIR_LONG = 0.74;
const VOUSSOIR_SHORT = 0.6;
const RING_PROUD = 0.04;
const CORNICE_OUT = 0.16;
const CORBEL_SPACING = SLAB_LENGTH;
// The band of darker stone under the cornice.
const FRIEZE_HEIGHT = 0.5;
const CORBEL_SIZE: Vec3 = [0.3, 0.26, 0.2];
const SPRINGING_CORBEL_SIZE: Vec3 = [0.34, 0.26, 0.36];
const IMPOST_HEIGHT = 0.14;
const IMPOST_PROUD = 0.07;
const RAIL_HEIGHTS = [0.35, 0.68, 0.95];
const POST_SPACING = 2;

const WHITE: Rgb = [1, 1, 1];
const FRIEZE: Rgb = [0.66, 0.68, 0.72];
const METAL: Rgb = hexToLinear(0xb9bec2);

export interface ViaductMeshes {
  masonry: BuiltMesh;
  trim: BuiltMesh;
  metal: BuiltMesh;
}

interface Column {
  s: number;
  bottom: number;
  top: number;
}

function place(s: number, lateral: number, y: number): Vec3 {
  const point = offsetFromTrack(s, lateral);

  return [point.x, y, point.z];
}

export function buildViaduct(ground: Ground): ViaductMeshes {
  const masonry = new MeshBuilder();
  const trim = new MeshBuilder();
  const metal = new MeshBuilder();
  const { startS, endS, arches, piers } = track.viaduct;
  const railAt = (s: number) => track.sample(s).y;
  const topAt = (s: number) => railAt(s) + PARAPET_ABOVE_RAIL;
  const springingAt = (s: number) => railAt(s) - CROWN_BELOW_RAIL - SPRINGING_BELOW_CROWN;
  const textureOrigin = startS;
  const random = mulberry32(3);
  // Courses are level at a fixed size: u follows the line, v follows the height.
  const stoneUv = (s: number, y: number): [number, number] => [(s - textureOrigin) / STONE_TILE, y / STONE_TILE];
  const slabUv = (s: number, row: number): [number, number] => [(s - textureOrigin) / TRIM_REPEAT, SLAB_V[0] + (SLAB_V[1] - SLAB_V[0]) * row];
  const slabCentre = (index: number): [number, number] => [(index + 0.5) / TRIM.slabCount, (SLAB_V[0] + SLAB_V[1]) / 2];

  // A vertical wall strip at a fixed lateral offset, facing outwards. `side` is +1 for the right
  // (loop side) and -1 for the left (valley side).
  function wallStrip(builder: MeshBuilder, side: 1 | -1, lateral: number, columns: Column[], color: Rgb, facing: 1 | -1 = side) {
    for (let index = 0; index < columns.length - 1; index += 1) {
      const a = columns[index];
      const b = columns[index + 1];
      const p00 = place(a.s, side * lateral, a.bottom);
      const p10 = place(b.s, side * lateral, b.bottom);
      const p11 = place(b.s, side * lateral, b.top);
      const p01 = place(a.s, side * lateral, a.top);
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [
        stoneUv(a.s, a.bottom),
        stoneUv(b.s, b.bottom),
        stoneUv(b.s, b.top),
        stoneUv(a.s, a.top),
      ];
      if (facing === 1) {
        builder.flatQuad(p00, p10, p11, p01, coords, color);
      } else {
        builder.flatQuad(p10, p00, p01, p11, [coords[1], coords[0], coords[3], coords[2]], color);
      }
    }
  }

  // The outer face of a wall: courses up to the frieze, then the frieze under the cornice.
  function facade(side: 1 | -1, columns: Column[]) {
    const friezeBottom = (column: Column) => Math.max(column.bottom, column.top - FRIEZE_HEIGHT);
    wallStrip(masonry, side, FACE_OFFSET, columns.map((column) => ({ ...column, top: friezeBottom(column) })), WHITE);
    wallStrip(masonry, side, FACE_OFFSET, columns.map((column) => ({ ...column, bottom: friezeBottom(column) })), FRIEZE);
  }

  function spacedColumns(from: number, to: number, bottom: (s: number) => number, top: (s: number) => number, step: number): Column[] {
    const count = Math.max(1, Math.ceil((to - from) / step));
    const columns: Column[] = [];
    for (let index = 0; index <= count; index += 1) {
      const s = from + ((to - from) * index) / count;
      columns.push({ s, bottom: bottom(s), top: top(s) });
    }

    return columns;
  }

  function archIntrados(arch: { startS: number; centreS: number }, offsetFromCentre: number): number {
    const radius = ARCH_SPAN / 2;

    return springingAt(arch.centreS) + Math.sqrt(Math.max(radius * radius - offsetFromCentre * offsetFromCentre, 0));
  }

  // The ground a pier or abutment stands on: the lowest ground at its four corners, less a margin
  // so a foot never floats.
  function footingLevel(from: number, to: number): number {
    let lowest = Infinity;
    for (const s of [from, (from + to) / 2, to]) {
      for (const lateral of [-FACE_OFFSET, 0, FACE_OFFSET]) {
        const point = offsetFromTrack(s, lateral);
        lowest = Math.min(lowest, ground.heightAt(point.x, point.z));
      }
    }

    return lowest - 0.9;
  }

  // A pier: battered faces on both sides and the two end faces seen inside the arches.
  function pierBody(from: number, to: number, top: number, bottom: number, endFaces: { start: boolean; end: boolean }) {
    const batter = BATTER * (top - bottom);
    const wide = FACE_OFFSET + batter;
    for (const side of [1, -1] as const) {
      const p00 = place(from, side * wide, bottom);
      const p10 = place(to, side * wide, bottom);
      const p11 = place(to, side * FACE_OFFSET, top);
      const p01 = place(from, side * FACE_OFFSET, top);
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [
        stoneUv(from, bottom),
        stoneUv(to, bottom),
        stoneUv(to, top),
        stoneUv(from, top),
      ];
      if (side === 1) {
        masonry.flatQuad(p00, p10, p11, p01, coords, WHITE);
      } else {
        masonry.flatQuad(p10, p00, p01, p11, [coords[1], coords[0], coords[3], coords[2]], WHITE);
      }

      const middle = (from + to) / 2;
      trim.box(place(middle, side * (FACE_OFFSET + IMPOST_PROUD / 2), top - IMPOST_HEIGHT), [to - from, IMPOST_HEIGHT, IMPOST_PROUD], track.sample(middle).heading, WHITE, {
        uv: slabCentre(Math.floor(random() * TRIM.slabCount)),
      });
    }

    // The end faces start from the same courses as the sides. `phase` shifts the joints so two
    // neighbouring piers do not repeat each other.
    const endFace = (s: number, facing: 1 | -1) => {
      const left = place(s, -wide, bottom);
      const right = place(s, wide, bottom);
      const rightTop = place(s, FACE_OFFSET, top);
      const leftTop = place(s, -FACE_OFFSET, top);
      const phase = (s - textureOrigin) * 0.37;
      const uv = (lateral: number, y: number): [number, number] => [(lateral + phase) / STONE_TILE, y / STONE_TILE];
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [
        uv(-wide, bottom),
        uv(wide, bottom),
        uv(FACE_OFFSET, top),
        uv(-FACE_OFFSET, top),
      ];
      if (facing === 1) {
        masonry.flatQuad(right, left, leftTop, rightTop, [coords[1], coords[0], coords[3], coords[2]], scaleColor(WHITE, 0.92));
      } else {
        masonry.flatQuad(left, right, rightTop, leftTop, coords, scaleColor(WHITE, 0.92));
      }

      // The stubs the timber centring rested on, standing out under the springing of the arch.
      const [depth, height] = SPRINGING_CORBEL_SIZE;
      for (const lateral of [-1.35, 0, 1.35]) {
        trim.box(place(s + (facing * depth) / 2, lateral, top - height), SPRINGING_CORBEL_SIZE, track.sample(s).heading, WHITE, {
          uv: slabCentre(Math.floor(random() * TRIM.slabCount)),
        });
      }
    };
    if (endFaces.start) {
      endFace(from, -1);
    }

    if (endFaces.end) {
      endFace(to, 1);
    }
  }

  // The spandrel walls above the arches, on both faces.
  for (const side of [1, -1] as const) {
    for (const arch of arches) {
      const columns: Column[] = [];
      for (let index = 0; index <= ARCH_SEGMENTS; index += 1) {
        const offset = (ARCH_SPAN * index) / ARCH_SEGMENTS - ARCH_SPAN / 2;
        const s = arch.centreS + offset;
        columns.push({ s, bottom: archIntrados(arch, offset), top: topAt(s) });
      }

      facade(side, columns);
    }

    for (const pier of piers) {
      facade(side, spacedColumns(pier.startS, pier.endS, springingAt, topAt, 4));
    }

    // Abutments above the springing, and the wing walls beyond them.
    const abutmentLow = (s: number) => {
      const point = offsetFromTrack(s, side * FACE_OFFSET);

      return Math.min(ground.heightAt(point.x, point.z), springingAt(s)) - 0.2;
    };
    facade(side, spacedColumns(startS, arches[0].startS, abutmentLow, topAt, 4));
    facade(side, spacedColumns(arches[arches.length - 1].endS, endS, abutmentLow, topAt, 4));
    const wingLow = (s: number) => {
      const point = offsetFromTrack(s, side * FACE_OFFSET);

      return ground.heightAt(point.x, point.z) - 0.25;
    };
    facade(side, spacedColumns(startS - WING_LENGTH, startS, wingLow, topAt, 1.75));
    facade(side, spacedColumns(endS, endS + WING_LENGTH, wingLow, topAt, 1.75));
  }

  // Piers under the springing and the abutment bodies.
  for (const pier of piers) {
    const top = springingAt((pier.startS + pier.endS) / 2);
    pierBody(pier.startS, pier.endS, top, footingLevel(pier.startS, pier.endS), { start: true, end: true });
  }

  const firstArch = arches[0];
  const lastArch = arches[arches.length - 1];
  const abutments: [number, number, boolean, boolean][] = [
    [startS, firstArch.startS, false, true],
    [lastArch.endS, endS, true, false],
  ];
  for (const [from, to, startFace, endFace] of abutments) {
    const top = springingAt((from + to) / 2);
    pierBody(from, to, top, footingLevel(from, to), { start: startFace, end: endFace });
  }

  // The soffit of each arch: the underside of the vault, lit from the opening. Its courses run
  // across the vault, so v follows the length of the curve.
  for (const arch of arches) {
    const radius = ARCH_SPAN / 2;
    const springing = springingAt(arch.centreS);
    const rowIndices: number[][] = [];
    for (let index = 0; index <= ARCH_SEGMENTS; index += 1) {
      const angle = (Math.PI * index) / ARCH_SEGMENTS;
      const s = arch.centreS - radius * Math.cos(angle);
      const y = springing + radius * Math.sin(angle);
      const tangent = track.sample(s);
      const normal: Vec3 = [tangent.tx * Math.cos(angle), -Math.sin(angle), tangent.tz * Math.cos(angle)];
      const shade = 0.72;
      rowIndices.push(
        [-FACE_OFFSET, FACE_OFFSET].map((lateral) =>
          masonry.vertex(place(s, lateral, y), normal, [(lateral + FACE_OFFSET) / STONE_TILE, (radius * angle) / STONE_TILE], scaleColor(WHITE, shade)),
        ),
      );
    }

    for (let index = 0; index < ARCH_SEGMENTS; index += 1) {
      const [a0, a1] = rowIndices[index];
      const [b0, b1] = rowIndices[index + 1];
      masonry.quad(a0, b0, b1, a1);
    }
  }

  // The voussoir rings: radial stones framing each arch on both faces. Every other stone is
  // shorter, so the ring steps into the coursed wall like the real one.
  const voussoirCell = TRIM.width / TRIM.voussoirCells / TRIM.width;
  for (const side of [1, -1] as const) {
    for (const arch of arches) {
      const springing = springingAt(arch.centreS);
      const inner = ARCH_SPAN / 2;
      const lateral = side * (FACE_OFFSET + RING_PROUD);
      for (let index = 0; index < VOUSSOIRS; index += 1) {
        const angleA = (Math.PI * index) / VOUSSOIRS;
        const angleB = (Math.PI * (index + 1)) / VOUSSOIRS;
        const length = (index % 2 === 0 ? VOUSSOIR_LONG : VOUSSOIR_SHORT) + random() * 0.06;
        const point = (angle: number, radius: number): Vec3 => place(arch.centreS - radius * Math.cos(angle), lateral, springing + radius * Math.sin(angle));
        const cell = Math.floor(random() * TRIM.voussoirCells);
        const u0 = cell * voussoirCell + 0.004;
        const u1 = (cell + 1) * voussoirCell - 0.004;
        const v0 = VOUSSOIR_V[0];
        const v1 = v0 + (VOUSSOIR_V[1] - v0) * (length / (VOUSSOIR_LONG + 0.06));
        const p00 = point(angleA, inner);
        const p10 = point(angleB, inner);
        const p11 = point(angleB, inner + length);
        const p01 = point(angleA, inner + length);
        if (side === 1) {
          trim.flatQuad(p00, p10, p11, p01, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], WHITE);
        } else {
          trim.flatQuad(p10, p00, p01, p11, [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], WHITE);
        }
      }
    }
  }

  // Parapet inner faces, the cornice that runs the length of the deck and the coping above it.
  const parapetFrom = startS - WING_LENGTH;
  const parapetTo = endS + WING_LENGTH;
  const railRange = (s: number) => railAt(s) - 0.55;
  for (const side of [1, -1] as const) {
    // The inner face looks at the track, so it faces the opposite way to the outer face.
    wallStrip(masonry, side, PARAPET_INNER, spacedColumns(parapetFrom, parapetTo, railRange, topAt, 1.75), scaleColor(WHITE, 0.95), (-side) as 1 | -1);

    const outer = FACE_OFFSET + CORNICE_OUT;
    const count = Math.ceil((parapetTo - parapetFrom) / SLAB_LENGTH);
    for (let index = 0; index < count; index += 1) {
      const a = parapetFrom + (index * (parapetTo - parapetFrom)) / count;
      const b = parapetFrom + ((index + 1) * (parapetTo - parapetFrom)) / count;
      const topA = topAt(a);
      const topB = topAt(b);
      const quad = (points: [Vec3, Vec3, Vec3, Vec3], coords: [[number, number], [number, number], [number, number], [number, number]], reversed: boolean) => {
        if (reversed) {
          trim.flatQuad(points[1], points[0], points[3], points[2], [coords[1], coords[0], coords[3], coords[2]], WHITE);
        } else {
          trim.flatQuad(points[0], points[1], points[2], points[3], coords, WHITE);
        }
      };
      const bottomA = topA - SLAB_THICKNESS;
      const bottomB = topB - SLAB_THICKNESS;
      const slabCoords: [[number, number], [number, number], [number, number], [number, number]] = [slabUv(a, 0), slabUv(b, 0), slabUv(b, 1), slabUv(a, 1)];
      // The coping on top, the front of the slab and its underside, each wound to face out.
      quad([place(a, side * PARAPET_INNER, topA), place(b, side * PARAPET_INNER, topB), place(b, side * outer, topB), place(a, side * outer, topA)], slabCoords, side === 1);
      quad([place(a, side * outer, bottomA), place(b, side * outer, bottomB), place(b, side * outer, topB), place(a, side * outer, topA)], slabCoords, side === -1);
      quad([place(a, side * FACE_OFFSET, bottomA), place(b, side * FACE_OFFSET, bottomB), place(b, side * outer, bottomB), place(a, side * outer, bottomA)], slabCoords, side === -1);
    }

    // The corbels under the slab.
    const [length, height, depth] = CORBEL_SIZE;
    for (let s = parapetFrom + CORBEL_SPACING / 2; s < parapetTo; s += CORBEL_SPACING) {
      trim.box(place(s, side * (FACE_OFFSET + depth / 2), topAt(s) - SLAB_THICKNESS - height), [length, height, depth], track.sample(s).heading, WHITE, {
        uv: slabCentre(Math.floor(random() * TRIM.slabCount)),
      });
    }
  }

  // Railing: a post every 2 m and three thin rails, on both sides, over the viaduct and its wings.
  const railingLateral = FACE_OFFSET - 0.2;
  for (const side of [1, -1] as const) {
    const postCount = Math.round((parapetTo - parapetFrom) / POST_SPACING);
    for (let index = 0; index <= postCount; index += 1) {
      const s = parapetFrom + (index * (parapetTo - parapetFrom)) / postCount;
      const point = offsetFromTrack(s, side * railingLateral);
      const tangent = track.sample(s);
      metal.box([point.x, topAt(s), point.z], [0.07, 0.95, 0.07], tangent.heading, METAL);
    }

    for (const height of RAIL_HEIGHTS) {
      const step = POST_SPACING;
      const count = Math.ceil((parapetTo - parapetFrom) / step);
      for (let index = 0; index < count; index += 1) {
        const a = parapetFrom + (index * (parapetTo - parapetFrom)) / count;
        const b = parapetFrom + ((index + 1) * (parapetTo - parapetFrom)) / count;
        const from = place(a, side * railingLateral, topAt(a) + height);
        const to = place(b, side * railingLateral, topAt(b) + height);
        const centre: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - 0.025, (from[2] + to[2]) / 2];
        const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
        const yaw = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
        metal.box(centre, [length + 0.02, 0.05, 0.05], yaw, METAL, { pitch: Math.atan2(to[1] - from[1], length) });
      }
    }
  }

  return { masonry: masonry.build(), trim: trim.build(), metal: metal.build() };
}
