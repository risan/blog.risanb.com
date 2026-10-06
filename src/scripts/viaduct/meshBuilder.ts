// Collects triangles with flat or smooth normals, texture coordinates and vertex colours, so that
// many small shapes can be merged into one geometry and drawn in one call. Pure: no three.js.

export type Rgb = [number, number, number];

export function hexToLinear(hex: number): Rgb {
  const channel = (value: number) => {
    const srgb = value / 255;

    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
}

export function scaleColor(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

export function mixColor(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

export type Vec3 = [number, number, number];

export interface BuiltMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(position: Vec3, normal: Vec3, uv: [number, number], color: Rgb): number {
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.uvs.push(uv[0], uv[1]);
    this.colors.push(color[0], color[1], color[2]);

    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  // Two triangles over four vertices in order around the quad.
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  // A flat quad whose normal follows the winding: counter-clockwise seen from the front.
  flatQuad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, uv: [[number, number], [number, number], [number, number], [number, number]], color: Rgb): void {
    const normal = faceNormal(p0, p1, p2);
    const a = this.vertex(p0, normal, uv[0], color);
    const b = this.vertex(p1, normal, uv[1], color);
    const c = this.vertex(p2, normal, uv[2], color);
    const d = this.vertex(p3, normal, uv[3], color);
    this.quad(a, b, c, d);
  }

  // A convex flat polygon, wound so that it faces the side `outward` points to.
  polygon(points: Vec3[], color: Rgb, outward: Vec3, uv: (point: Vec3) => [number, number] = () => [0, 0]): void {
    const normal = faceNormal(points[0], points[1], points[2]);
    const flip = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0;
    const ordered = flip ? [...points].reverse() : points;
    const facing = flip ? [-normal[0], -normal[1], -normal[2]] as Vec3 : normal;
    const first = this.vertex(ordered[0], facing, uv(ordered[0]), color);
    let previous = this.vertex(ordered[1], facing, uv(ordered[1]), color);
    for (let index = 2; index < ordered.length; index += 1) {
      const next = this.vertex(ordered[index], facing, uv(ordered[index]), color);
      this.triangle(first, previous, next);
      previous = next;
    }
  }

  // A box rotated by `yaw` about the vertical axis, centred on (x, z) with its base at y, and
  // optionally sheared so that its two ends sit at different heights (`pitch` over its length).
  box(
    centre: Vec3,
    size: Vec3,
    yaw: number,
    color: Rgb,
    options: { topColor?: Rgb; uvScale?: number; pitch?: number } = {},
  ): void {
    const [cx, cy, cz] = centre;
    const [length, height, width] = size;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const pitchSlope = Math.tan(options.pitch ?? 0);
    const scale = options.uvScale ?? 1;
    const top = options.topColor ?? color;

    // Local axes: along the length (forward), up, and across. Yaw turns forward from +x towards -z,
    // as three.js does.
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const point = (along: number, up: number, across: number): Vec3 => [
      cx + along * cos + across * sin,
      cy + up + along * pitchSlope,
      cz - along * sin + across * cos,
    ];
    const lo = 0;
    const hi = height;
    const p = {
      a: point(-halfLength, lo, -halfWidth),
      b: point(halfLength, lo, -halfWidth),
      c: point(halfLength, lo, halfWidth),
      d: point(-halfLength, lo, halfWidth),
      e: point(-halfLength, hi, -halfWidth),
      f: point(halfLength, hi, -halfWidth),
      g: point(halfLength, hi, halfWidth),
      h: point(-halfLength, hi, halfWidth),
    };
    const uvLength = length * scale;
    const uvHeight = height * scale;
    const uvWidth = width * scale;
    // Each face wound counter-clockwise seen from outside.
    this.flatQuad(p.d, p.c, p.g, p.h, [[0, 0], [uvLength, 0], [uvLength, uvHeight], [0, uvHeight]], color); // across +
    this.flatQuad(p.b, p.a, p.e, p.f, [[0, 0], [uvLength, 0], [uvLength, uvHeight], [0, uvHeight]], color); // across -
    this.flatQuad(p.c, p.b, p.f, p.g, [[0, 0], [uvWidth, 0], [uvWidth, uvHeight], [0, uvHeight]], color); // front
    this.flatQuad(p.a, p.d, p.h, p.e, [[0, 0], [uvWidth, 0], [uvWidth, uvHeight], [0, uvHeight]], color); // back
    this.flatQuad(p.h, p.g, p.f, p.e, [[0, 0], [uvLength, 0], [uvLength, uvWidth], [0, uvWidth]], top); // top
    this.flatQuad(p.a, p.b, p.c, p.d, [[0, 0], [uvLength, 0], [uvLength, uvWidth], [0, uvWidth]], color); // bottom
  }

  build(): BuiltMesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

export function faceNormal(p0: Vec3, p1: Vec3, p2: Vec3): Vec3 {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  const x = ay * bz - az * by;
  const y = az * bx - ax * bz;
  const z = ax * by - ay * bx;
  const length = Math.hypot(x, y, z) || 1;

  return [x / length, y / length, z / length];
}
