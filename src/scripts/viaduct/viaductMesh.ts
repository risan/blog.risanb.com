// The masonry of the Kreisviadukt: nine arches on a curve, the piers, the abutments with their
// wing walls, the parapet and its railing. Pure: it returns merged geometry for the scene to draw.
//
// Everything is placed with `s` (distance along the line) and `lateral` (metres to the right of
// the direction of travel). The line runs clockwise, so the right side faces the middle of the
// loop and the left side faces the valley, which is the side the camera sees.

import { hexToLinear, MeshBuilder, scaleColor, type BuiltMesh, type Rgb, type Vec3 } from './meshBuilder.ts';
import { ARCH_SPAN, DECK_WIDTH, offsetFromTrack, SPRINGING_BELOW_CROWN, track, CROWN_BELOW_RAIL } from './track.ts';
import type { Ground } from './terrain.ts';

export const FACE_OFFSET = DECK_WIDTH / 2 + 0.1;
const PARAPET_INNER = FACE_OFFSET - 0.45;
const PARAPET_ABOVE_RAIL = 0.25;
const WING_LENGTH = 7;
const BATTER = 0.02;
const ARCH_SEGMENTS = 18;
const TEXTURE_SIZE = 3.2;
const RING_WIDTH = 0.7;
const RING_PROUD = 0.04;
const LEDGE_OUT = 0.14;
const LEDGE_DROP_FROM_RAIL = -0.5;
const LEDGE_HEIGHT = 0.28;

const WHITE: Rgb = [1, 1, 1];
const LIGHT_STONE: Rgb = [1.12, 1.1, 1.05];
const METAL: Rgb = hexToLinear(0xb9bec2);

export interface ViaductMeshes {
  masonry: BuiltMesh;
  rings: BuiltMesh;
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
  const rings = new MeshBuilder();
  const metal = new MeshBuilder();
  const { startS, endS, arches, piers } = track.viaduct;
  const railAt = (s: number) => track.sample(s).y;
  const topAt = (s: number) => railAt(s) + PARAPET_ABOVE_RAIL;
  const springingAt = (s: number) => railAt(s) - CROWN_BELOW_RAIL - SPRINGING_BELOW_CROWN;
  const textureOrigin = startS;

  // A vertical wall strip at a fixed lateral offset, facing outwards. `side` is +1 for the right
  // (loop side) and -1 for the left (valley side).
  function wallStrip(builder: MeshBuilder, side: 1 | -1, lateral: number, columns: Column[], color: Rgb, facing: 1 | -1 = side) {
    const scale = TEXTURE_SIZE;
    for (let index = 0; index < columns.length - 1; index += 1) {
      const a = columns[index];
      const b = columns[index + 1];
      const p00 = place(a.s, side * lateral, a.bottom);
      const p10 = place(b.s, side * lateral, b.bottom);
      const p11 = place(b.s, side * lateral, b.top);
      const p01 = place(a.s, side * lateral, a.top);
      const uv = (c: Column, y: number): [number, number] => [(c.s - textureOrigin) / scale, y / scale];
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [
        uv(a, a.bottom),
        uv(b, b.bottom),
        uv(b, b.top),
        uv(a, a.top),
      ];
      if (facing === 1) {
        builder.flatQuad(p00, p10, p11, p01, coords, color);
      } else {
        builder.flatQuad(p10, p00, p01, p11, [coords[1], coords[0], coords[3], coords[2]], color);
      }
    }
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
      const uv = (s: number, y: number): [number, number] => [(s - textureOrigin) / TEXTURE_SIZE, y / TEXTURE_SIZE];
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [
        uv(from, bottom),
        uv(to, bottom),
        uv(to, top),
        uv(from, top),
      ];
      if (side === 1) {
        masonry.flatQuad(p00, p10, p11, p01, coords, WHITE);
      } else {
        masonry.flatQuad(p10, p00, p01, p11, [coords[1], coords[0], coords[3], coords[2]], WHITE);
      }
    }

    const endFace = (s: number, facing: 1 | -1) => {
      const left = place(s, -wide, bottom);
      const right = place(s, wide, bottom);
      const rightTop = place(s, FACE_OFFSET, top);
      const leftTop = place(s, -FACE_OFFSET, top);
      const width = (2 * wide) / TEXTURE_SIZE;
      const height = (top - bottom) / TEXTURE_SIZE;
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [width, 0], [width, height], [0, height]];
      if (facing === 1) {
        masonry.flatQuad(right, left, leftTop, rightTop, [coords[1], coords[0], coords[3], coords[2]], scaleColor(WHITE, 0.92));
      } else {
        masonry.flatQuad(left, right, rightTop, leftTop, coords, scaleColor(WHITE, 0.92));
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

      wallStrip(masonry, side, FACE_OFFSET, columns, WHITE);
    }

    for (const pier of piers) {
      wallStrip(masonry, side, FACE_OFFSET, spacedColumns(pier.startS, pier.endS, springingAt, topAt, 4), WHITE);
    }

    // Abutments above the springing, and the wing walls beyond them.
    const abutmentLow = (s: number) => {
      const point = offsetFromTrack(s, side * FACE_OFFSET);

      return Math.min(ground.heightAt(point.x, point.z), springingAt(s)) - 0.2;
    };
    wallStrip(masonry, side, FACE_OFFSET, spacedColumns(startS, arches[0].startS, abutmentLow, topAt, 4), WHITE);
    wallStrip(masonry, side, FACE_OFFSET, spacedColumns(arches[arches.length - 1].endS, endS, abutmentLow, topAt, 4), WHITE);
    const wingLow = (s: number) => {
      const point = offsetFromTrack(s, side * FACE_OFFSET);

      return ground.heightAt(point.x, point.z) - 0.25;
    };
    wallStrip(masonry, side, FACE_OFFSET, spacedColumns(startS - WING_LENGTH, startS, wingLow, topAt, 1.75), WHITE);
    wallStrip(masonry, side, FACE_OFFSET, spacedColumns(endS, endS + WING_LENGTH, wingLow, topAt, 1.75), WHITE);
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

  // The soffit of each arch: the underside of the vault, lit from the opening.
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
      const shade = 0.78;
      rowIndices.push(
        [-FACE_OFFSET, FACE_OFFSET].map((lateral) =>
          masonry.vertex(place(s, lateral, y), normal, [(s - textureOrigin) / TEXTURE_SIZE, (lateral + FACE_OFFSET) / TEXTURE_SIZE], scaleColor(WHITE, shade)),
        ),
      );
    }

    for (let index = 0; index < ARCH_SEGMENTS; index += 1) {
      const [a0, a1] = rowIndices[index];
      const [b0, b1] = rowIndices[index + 1];
      masonry.quad(a0, b0, b1, a1);
    }
  }

  // The voussoir rings: lighter, radially jointed stones framing each arch on both faces.
  for (const side of [1, -1] as const) {
    for (const arch of arches) {
      const springing = springingAt(arch.centreS);
      const inner = ARCH_SPAN / 2;
      const outer = inner + RING_WIDTH;
      const blocksAround = 22;
      const lateral = side * (FACE_OFFSET + RING_PROUD);
      const ring: [number, number][] = [];
      for (let index = 0; index <= ARCH_SEGMENTS; index += 1) {
        const angle = (Math.PI * index) / ARCH_SEGMENTS;
        ring.push([angle, index]);
      }

      for (let index = 0; index < ARCH_SEGMENTS; index += 1) {
        const [angleA] = ring[index];
        const [angleB] = ring[index + 1];
        const point = (angle: number, radius: number): Vec3 => {
          const s = arch.centreS - radius * Math.cos(angle);

          return place(s, lateral, springing + radius * Math.sin(angle));
        };
        const uA = (angleA / Math.PI) * (blocksAround / 8);
        const uB = (angleB / Math.PI) * (blocksAround / 8);
        const p00 = point(angleA, inner);
        const p10 = point(angleB, inner);
        const p11 = point(angleB, outer);
        const p01 = point(angleA, outer);
        if (side === 1) {
          rings.flatQuad(p00, p10, p11, p01, [[uA, 0], [uB, 0], [uB, 1], [uA, 1]], WHITE);
        } else {
          rings.flatQuad(p10, p00, p01, p11, [[uB, 0], [uA, 0], [uA, 1], [uB, 1]], WHITE);
        }
      }
    }
  }

  // Parapet: inner faces, the cap, and the ledge under it on the valley side.
  const parapetFrom = startS - WING_LENGTH;
  const parapetTo = endS + WING_LENGTH;
  const railRange = (s: number) => railAt(s) - 0.55;
  for (const side of [1, -1] as const) {
    // The inner face looks at the track, so it faces the opposite way to the outer face.
    wallStrip(masonry, side, PARAPET_INNER, spacedColumns(parapetFrom, parapetTo, railRange, topAt, 1.75), scaleColor(WHITE, 0.95), (-side) as 1 | -1);

    const step = 1.75;
    const count = Math.ceil((parapetTo - parapetFrom) / step);
    for (let index = 0; index < count; index += 1) {
      const a = parapetFrom + (index * (parapetTo - parapetFrom)) / count;
      const b = parapetFrom + ((index + 1) * (parapetTo - parapetFrom)) / count;
      const capA = [place(a, side * PARAPET_INNER, topAt(a)), place(a, side * FACE_OFFSET, topAt(a))];
      const capB = [place(b, side * PARAPET_INNER, topAt(b)), place(b, side * FACE_OFFSET, topAt(b))];
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [[0, 0], [1, 0], [1, 0.3], [0, 0.3]];
      if (side === 1) {
        masonry.flatQuad(capA[0], capB[0], capB[1], capA[1], coords, LIGHT_STONE);
      } else {
        masonry.flatQuad(capA[1], capB[1], capB[0], capA[0], coords, LIGHT_STONE);
      }
    }
  }

  // The ledge: a slightly proud band under the parapet on the valley side.
  {
    const side = -1 as const;
    const step = 1.75;
    const count = Math.ceil((endS - startS) / step);
    for (let index = 0; index < count; index += 1) {
      const a = startS + (index * (endS - startS)) / count;
      const b = startS + ((index + 1) * (endS - startS)) / count;
      const lateral = side * (FACE_OFFSET + LEDGE_OUT);
      const bottomA = railAt(a) + LEDGE_DROP_FROM_RAIL;
      const bottomB = railAt(b) + LEDGE_DROP_FROM_RAIL;
      const uv = (s: number, y: number): [number, number] => [(s - textureOrigin) / TEXTURE_SIZE, y / TEXTURE_SIZE];
      masonry.flatQuad(
        place(b, lateral, bottomB),
        place(a, lateral, bottomA),
        place(a, lateral, bottomA + LEDGE_HEIGHT),
        place(b, lateral, bottomB + LEDGE_HEIGHT),
        [uv(b, bottomB), uv(a, bottomA), uv(a, bottomA + LEDGE_HEIGHT), uv(b, bottomB + LEDGE_HEIGHT)],
        LIGHT_STONE,
      );
      masonry.flatQuad(
        place(a, side * FACE_OFFSET, bottomA + LEDGE_HEIGHT),
        place(a, lateral, bottomA + LEDGE_HEIGHT),
        place(b, lateral, bottomB + LEDGE_HEIGHT),
        place(b, side * FACE_OFFSET, bottomB + LEDGE_HEIGHT),
        [[0, 0], [1, 0], [1, 0.4], [0, 0.4]],
        LIGHT_STONE,
      );
    }
  }

  // Railing: a post every 2.4 m and two thin rails, on both sides, over the viaduct and its wings.
  const railingLateral = FACE_OFFSET - 0.2;
  for (const side of [1, -1] as const) {
    const postCount = Math.round((parapetTo - parapetFrom) / 2.4);
    for (let index = 0; index <= postCount; index += 1) {
      const s = parapetFrom + (index * (parapetTo - parapetFrom)) / postCount;
      const point = offsetFromTrack(s, side * railingLateral);
      const tangent = track.sample(s);
      metal.box([point.x, topAt(s), point.z], [0.07, 0.95, 0.07], tangent.heading, METAL);
    }

    for (const height of [0.5, 0.95]) {
      const step = 1.2;
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

  return { masonry: masonry.build(), rings: rings.build(), metal: metal.build() };
}
