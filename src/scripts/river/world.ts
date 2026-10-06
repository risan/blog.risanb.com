// The river's geometry and current. Pure: no DOM, no GL. The world always flows along +x;
// the renderer rotates the view for portrait canvases, so nothing here knows about screens.
// Units are metres. A baked grid is the single source of truth: JS samples it directly and
// the GPU samples the same numbers through a texture.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rock {
  x: number;
  y: number;
  radius: number;
  height: number;
  // Outline irregularity: radius is scaled by 1 + sum of amplitude * cos(k θ + phase)
  // for the lobes k = 2..5, stored as [amplitude, phase] pairs.
  lobes: readonly (readonly [number, number])[];
  inStream: boolean;
  breaksSurface: boolean;
}

export interface World {
  width: number;
  height: number;
  rocks: Rock[];
  cellsPerMetre: number;
  columns: number;
  rows: number;
  // Per cell, interleaved: depth (m, <= 0 on land and rock tops), flow x, flow y (m/s), rock height (m).
  terrain: Float32Array;
  // Per cell foam intensity 0..255: wakes, rock fronts, shallow edges.
  foam: Uint8Array;
  depthAt(x: number, y: number): number;
  rockHeightAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
  // Writes the current at (x, y) at time t into `out`.
  flowAt(x: number, y: number, t: number, out: Vec2): Vec2;
  nearestRock(x: number, y: number): Rock | undefined;
  randomWaterPoint(random: () => number, minDepth: number, out: Vec2): Vec2;
  seed: number;
}

export interface WorldOptions {
  seed: number;
  width: number;
  height: number;
  cellsPerMetre?: number;
}

// Mid-channel speed in m/s. The shaders get the same value as a uniform.
export const CHANNEL_SPEED = 0.62;
const MIN_WATER_DEPTH = 0.03;

// Travelling cross-stream sine waves that make the current meander randomly. Mirrored in
// GLSL through uniforms built from these entries: [wavenumber, angular speed, amplitude, phase].
export const FLOW_WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.52, 0.31, 0.14, 0.4],
  [1.13, -0.47, 0.09, 2.1],
  [2.3, 0.83, 0.05, 4.0],
];

// Slow overall surges of the whole current: 1 + sum(amplitude * sin(omega * t + phase)).
export const GUST_TERMS: readonly (readonly [number, number, number])[] = [
  [0.12, 0.17, 0],
  [0.07, 0.43, 1.3],
];

export function gustAt(t: number): number {
  let gust = 1;
  for (let index = 0; index < GUST_TERMS.length; index += 1) {
    const term = GUST_TERMS[index];
    gust += term[0] * Math.sin(term[1] * t + term[2]);
  }

  return gust;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);

    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash2(ix, iy, seed) * (1 - fx) + hash2(ix + 1, iy, seed) * fx;
  const bottom = hash2(ix, iy + 1, seed) * (1 - fx) + hash2(ix + 1, iy + 1, seed) * fx;

  return top * (1 - fy) + bottom * fy;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function createWorld(options: WorldOptions): World {
  const { seed, width, height } = options;
  const cellsPerMetre = options.cellsPerMetre ?? 32;
  const columns = Math.max(2, Math.round(width * cellsPerMetre));
  const rows = Math.max(2, Math.round(height * cellsPerMetre));
  const random = mulberry32(seed);

  const wavelengthA = width * (0.62 + random() * 0.18);
  const wavelengthB = width * (0.28 + random() * 0.1);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseWidth = random() * Math.PI * 2;
  const kA = (Math.PI * 2) / wavelengthA;
  const kB = (Math.PI * 2) / wavelengthB;
  const meanHalfWidth = height * 0.245;

  function centreY(x: number): number {
    return height * (0.5 + 0.06 * Math.sin(kA * x + phaseA) + 0.03 * Math.sin(kB * x + phaseB));
  }

  function centreSlope(x: number): number {
    return height * (0.06 * kA * Math.cos(kA * x + phaseA) + 0.03 * kB * Math.cos(kB * x + phaseB));
  }

  function halfWidthAt(x: number): number {
    return meanHalfWidth * (1 + 0.16 * Math.sin(kB * 1.3 * x + phaseWidth));
  }

  function channelDepthAt(x: number): number {
    return 0.65 + 0.9 * valueNoise(x * 0.3, 0, seed + 11);
  }

  // Depth of the riverbed alone, before rocks.
  function bedDepthAt(x: number, y: number): number {
    const crossing = Math.abs(y - centreY(x)) / halfWidthAt(x);
    const profile = 1 - Math.pow(crossing, 1.8);
    const wobble =
      (valueNoise(x * 0.9, y * 0.9, seed + 3) - 0.5) * 0.34 +
      (valueNoise(x * 3.1, y * 3.1, seed + 5) - 0.5) * 0.07;
    const bars = profile > 0 ? (valueNoise(x * 1.2, y * 1.6, seed + 7) - 0.5) * 0.22 : 0;

    return Math.max(-4, channelDepthAt(x) * profile + wobble + bars);
  }

  function pickRocks(): Rock[] {
    const rocks: Rock[] = [];
    const scale = height / 7;

    function addRock(x: number, y: number, radius: number, wantsStream: boolean) {
      rocks.push({
        x,
        y,
        radius,
        height: wantsStream ? 0 : radius * (0.55 + random() * 0.35),
        lobes: [
          [0.12 + random() * 0.12, random() * Math.PI * 2],
          [0.06 + random() * 0.08, random() * Math.PI * 2],
          [0.03 + random() * 0.05, random() * Math.PI * 2],
          [0.02 + random() * 0.04, random() * Math.PI * 2],
        ],
        inStream: wantsStream,
        breaksSurface: false,
      });
    }

    // Bank boulders come with one or two smaller stones leaning against them.
    function addSatellites(rock: Rock) {
      const count = random() < 0.35 ? 0 : random() < 0.5 ? 1 : 2;
      for (let index = 0; index < count; index += 1) {
        const radius = rock.radius * (0.3 + random() * 0.3);
        const angle = random() * Math.PI * 2;
        const distance = (rock.radius + radius) * 0.85;
        const x = rock.x + Math.cos(angle) * distance;
        const y = rock.y + Math.sin(angle) * distance;
        const overlapsOther = rocks.some(
          (other) => other !== rock && Math.hypot(other.x - x, other.y - y) < (other.radius + radius) * 0.9,
        );
        const inBounds = y > radius && y < height - radius && x > radius && x < width - radius;
        if (!overlapsOther && inBounds && bedDepthAt(x, y) < 0.05) {
          addRock(x, y, radius, false);
        }
      }
    }

    function place(radiusLow: number, radiusHigh: number, wantsStream: boolean, attempts: number) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const x = width * (0.06 + random() * 0.88);
        const side = random() < 0.5 ? -1 : 1;
        const offset = wantsStream
          ? (random() * 2 - 1) * halfWidthAt(x) * 0.6
          : side * halfWidthAt(x) * (1.0 + random() * 0.32);
        const y = centreY(x) + offset;
        const radius = (radiusLow + Math.pow(random(), 1.6) * (radiusHigh - radiusLow)) * scale;
        const bed = bedDepthAt(x, y);
        const crowded = rocks.some(
          (other) => Math.hypot(other.x - x, other.y - y) < (other.radius + radius) * 1.5,
        );
        const inBounds = y > radius && y < height - radius && x > radius && x < width - radius;

        if (crowded || !inBounds || (wantsStream && bed < 0.35)) {
          continue;
        }

        addRock(x, y, radius, wantsStream);
        if (!wantsStream) {
          addSatellites(rocks[rocks.length - 1]);
        }

        return;
      }
    }

    const bankCount = Math.max(4, Math.round(width / 3.2));
    for (let index = 0; index < bankCount; index += 1) {
      place(0.4, 1.0, false, 40);
    }

    const streamCount = Math.max(3, Math.round(width / 5));
    for (let index = 0; index < streamCount; index += 1) {
      place(0.35, 0.6, true, 60);
    }

    let protruding = 0;
    for (const rock of rocks) {
      if (!rock.inStream) {
        continue;
      }

      const bed = bedDepthAt(rock.x, rock.y);
      const breaksSurface = protruding < 2 || random() < 0.4;
      rock.breaksSurface = breaksSurface;
      rock.height = breaksSurface ? bed + 0.12 + rock.radius * 0.25 : bed * (0.5 + random() * 0.2);
      if (breaksSurface) {
        protruding += 1;
      }
    }

    return rocks;
  }

  const rocks = pickRocks();

  function outlineAt(rock: Rock, angle: number): number {
    let wobble = 1;
    for (let index = 0; index < rock.lobes.length; index += 1) {
      wobble += rock.lobes[index][0] * Math.cos((index + 2) * angle + rock.lobes[index][1]);
    }

    return rock.radius * wobble;
  }

  function rockHeightAt(x: number, y: number): number {
    let best = 0;
    for (const rock of rocks) {
      const dx = x - rock.x;
      const dy = y - rock.y;
      const distance = Math.hypot(dx, dy);
      if (distance > rock.radius * 1.6) {
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const outline = outlineAt(rock, angle);
      const t = distance / outline;
      if (t < 1) {
        best = Math.max(best, rock.height * Math.pow(1 - t * t, 0.45));
      }
    }

    return best;
  }

  const baseDirection: Vec2 = { x: 1, y: 0 };

  // The undisturbed current: along the centreline, fastest mid-channel and where the river
  // narrows or shallows, still at the banks. Rocks split it (potential flow) and leave wakes.
  function baseFlowAt(x: number, y: number, out: Vec2): Vec2 {
    const slope = centreSlope(x);
    const norm = Math.hypot(1, slope);
    baseDirection.x = 1 / norm;
    baseDirection.y = slope / norm;

    const bed = bedDepthAt(x, y);
    const channel = channelDepthAt(x);
    const squeeze = clamp((meanHalfWidth * 0.8) / (halfWidthAt(x) * channel), 0.65, 1.7);
    const lateral = Math.sqrt(clamp(bed / channel, 0, 1));
    const speed = CHANNEL_SPEED * squeeze * lateral;
    out.x = baseDirection.x * speed;
    out.y = baseDirection.y * speed;

    for (const rock of rocks) {
      if (!rock.inStream) {
        continue;
      }

      const strength = rock.breaksSurface ? 1 : 0.4;
      const dx = x - rock.x;
      const dy = y - rock.y;
      const along = dx * baseDirection.x + dy * baseDirection.y;
      const across = -dx * baseDirection.y + dy * baseDirection.x;
      const rho2 = along * along + across * across;
      const radius = rock.radius * 1.05;
      if (rho2 > radius * radius * 30) {
        continue;
      }

      const safeRho2 = Math.max(rho2, radius * radius);
      const reference = CHANNEL_SPEED * squeeze;
      const sideways = along * along - across * across;
      let deltaAlong = (-reference * (radius * radius) * sideways) / (safeRho2 * safeRho2);
      let deltaAcross = (-2 * reference * (radius * radius) * along * across) / (safeRho2 * safeRho2);

      if (along > 0) {
        const lane = Math.exp(-Math.pow(across / (radius * 0.95), 2));
        const reach = Math.exp(-along / (radius * 5)) * Math.min(1, along / radius);
        deltaAlong -= reference * 0.62 * lane * reach;
      }

      out.x += strength * (deltaAlong * baseDirection.x - deltaAcross * baseDirection.y);
      out.y += strength * (deltaAlong * baseDirection.y + deltaAcross * baseDirection.x);
    }

    return out;
  }

  function foamAtCell(x: number, y: number, bed: number, rockHeight: number): number {
    const depth = bed - rockHeight;
    if (bed < -0.2 && rockHeight <= 0) {
      return 0;
    }

    let foam = 0;
    if (depth > 0 && depth < 0.06) {
      foam += (1 - depth / 0.06) * 0.3;
    }

    if (depth > 0) {
      for (const rock of rocks) {
        if (!rock.breaksSurface) {
          continue;
        }

        const slope = centreSlope(rock.x);
        const norm = Math.hypot(1, slope);
        const dx = x - rock.x;
        const dy = y - rock.y;
        const along = (dx + dy * slope) / norm;
        const across = (-dx * slope + dy) / norm;
        const distance = Math.hypot(along, across);
        const edge = distance - outlineAt(rock, Math.atan2(dy, dx));
        if (along < 0) {
          foam += Math.exp(-Math.pow(edge / 0.04, 2)) * (0.3 + 0.7 * clamp(-along / distance, 0, 1)) * 0.9;
        }

        if (along > 0) {
          const streak = Math.abs(across) - (rock.radius * 0.8 + 0.2 * along);
          foam += Math.exp(-Math.pow(streak / (0.04 + 0.02 * along), 2)) * Math.exp(-along / (rock.radius * 5)) * 0.55;
        }
      }
    }

    return clamp(foam, 0, 1);
  }

  const terrain = new Float32Array(columns * rows * 4);
  const foam = new Uint8Array(columns * rows);
  const scratch: Vec2 = { x: 0, y: 0 };

  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) / cellsPerMetre;
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / cellsPerMetre;
      const bed = bedDepthAt(x, y);
      const rockHeight = rockHeightAt(x, y);
      const depth = bed - rockHeight;
      const index = (row * columns + column) * 4;
      baseFlowAt(x, y, scratch);
      const wet = smooth(clamp((depth - MIN_WATER_DEPTH) / 0.12, 0, 1));
      terrain[index] = depth;
      terrain[index + 1] = scratch.x * wet;
      terrain[index + 2] = scratch.y * wet;
      terrain[index + 3] = rockHeight;
      foam[row * columns + column] = Math.round(foamAtCell(x, y, bed, rockHeight) * 255);
    }
  }

  function cellValue(column: number, row: number, channel: number): number {
    const c = clamp(column, 0, columns - 1);
    const r = clamp(row, 0, rows - 1);

    return terrain[(r * columns + c) * 4 + channel];
  }

  function sample(x: number, y: number, channel: number): number {
    const gx = x * cellsPerMetre - 0.5;
    const gy = y * cellsPerMetre - 0.5;
    const column = Math.floor(gx);
    const row = Math.floor(gy);
    const fx = gx - column;
    const fy = gy - row;
    const top = cellValue(column, row, channel) * (1 - fx) + cellValue(column + 1, row, channel) * fx;
    const bottom = cellValue(column, row + 1, channel) * (1 - fx) + cellValue(column + 1, row + 1, channel) * fx;

    return top * (1 - fy) + bottom * fy;
  }

  return {
    width,
    height,
    rocks,
    cellsPerMetre,
    columns,
    rows,
    terrain,
    foam,
    seed,
    depthAt(x, y) {
      return sample(x, y, 0);
    },
    rockHeightAt(x, y) {
      return sample(x, y, 3);
    },
    isWater(x, y) {
      return sample(x, y, 0) > MIN_WATER_DEPTH;
    },
    flowAt(x, y, t, out) {
      const baseX = sample(x, y, 1);
      const baseY = sample(x, y, 2);
      const speed = Math.hypot(baseX, baseY);
      const gust = gustAt(t);
      if (speed < 1e-4) {
        out.x = 0;
        out.y = 0;

        return out;
      }

      let wave = 0;
      for (let index = 0; index < FLOW_WAVES.length; index += 1) {
        const term = FLOW_WAVES[index];
        wave += term[2] * Math.sin(term[0] * x - term[1] * t + term[3]);
      }

      const share = Math.min(1, speed / CHANNEL_SPEED) * wave;
      out.x = baseX * gust - (baseY / speed) * share;
      out.y = baseY * gust + (baseX / speed) * share;

      return out;
    },
    nearestRock(x, y) {
      let nearest: Rock | undefined;
      let bestDistance = Infinity;
      for (const rock of rocks) {
        const distance = Math.hypot(rock.x - x, rock.y - y) - rock.radius;
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = rock;
        }
      }

      return nearest;
    },
    randomWaterPoint(pick, minDepth, out) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const x = pick() * width;
        const y = pick() * height;
        if (sample(x, y, 0) >= minDepth) {
          out.x = x;
          out.y = y;

          return out;
        }
      }

      out.x = width * 0.5;
      out.y = centreY(width * 0.5);

      return out;
    },
  };
}
