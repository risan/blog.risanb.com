// Fish behaviour. Pure: no DOM, no GL. Trout and grayling hold station facing upstream in the
// slow water behind rocks and bends, now and then darting to a new spot. Minnows loosely follow
// a shared anchor in the shallows. Anything that splashes nearby makes them bolt.

import { mulberry32, type Vec2, type World } from './world.ts';

export const TROUT = 0;
export const GRAYLING = 1;
export const MINNOW = 2;

// Per fish: x, y, heading, length, species, swim phase, swim amplitude, turn, id, depth below the surface, 0, 0.
export const FISH_INSTANCE_FLOATS = 12;

const STEP = 1 / 60;
const MAX_STEPS_PER_UPDATE = 5;

interface SpeciesSpec {
  lengthLow: number;
  lengthHigh: number;
  maxSpeed: number;
  dartSpeed: number;
  minDepth: number;
  turnRate: number;
  swimDepth: number;
  startleRadius: number;
}

const SPECIES: readonly SpeciesSpec[] = [
  { lengthLow: 0.83, lengthHigh: 0.95, maxSpeed: 1.05, dartSpeed: 1.9, minDepth: 0.3, turnRate: 2.6, swimDepth: 0.26, startleRadius: 1.9 },
  { lengthLow: 0.74, lengthHigh: 0.85, maxSpeed: 1.0, dartSpeed: 1.8, minDepth: 0.3, turnRate: 2.8, swimDepth: 0.22, startleRadius: 1.9 },
  { lengthLow: 0.3, lengthHigh: 0.38, maxSpeed: 0.7, dartSpeed: 1.2, minDepth: 0.16, turnRate: 4.5, swimDepth: 0.12, startleRadius: 1.3 },
];

export interface Fish {
  x: number;
  y: number;
  heading: number;
  speed: number;
  length: number;
  species: number;
  phase: number;
  amplitude: number;
  turn: number;
  id: number;
  depthBelow: number;
  holdX: number;
  holdY: number;
  offsetX: number;
  offsetY: number;
  darting: boolean;
  panicUntil: number;
  nextMove: number;
}

export interface FishSim {
  fish: Fish[];
  time: number;
  update(dt: number): void;
  startle(x: number, y: number): void;
  pack(out: Float32Array): number;
}

const TAU = Math.PI * 2;

function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) {
    wrapped -= TAU;
  }

  while (wrapped < -Math.PI) {
    wrapped += TAU;
  }

  return wrapped;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export interface FishCounts {
  trout: number;
  grayling: number;
  minnows: number;
}

// `lengthScale` shrinks every fish, for the smaller world of portrait canvases.
export function createFishSim(world: World, seed: number, counts: FishCounts, lengthScale = 1): FishSim {
  const random = mulberry32(seed);
  const flow: Vec2 = { x: 0, y: 0 };
  const point: Vec2 = { x: 0, y: 0 };
  const anchor = { x: 0, y: 0, nextMove: 0 };
  const fish: Fish[] = [];
  const state = { time: 0, pending: 0 };

  function pickAnchor() {
    let bestSpeed = Infinity;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      world.randomWaterPoint(random, 0.2, point);
      const depth = world.depthAt(point.x, point.y);
      world.flowAt(point.x, point.y, state.time, flow);
      const speed = Math.hypot(flow.x, flow.y);
      if (depth > 0.65 || speed >= bestSpeed) {
        continue;
      }

      bestSpeed = speed;
      anchor.x = point.x;
      anchor.y = point.y;
    }

    anchor.nextMove = state.time + 5 + random() * 8;
  }

  function crowded(candidateX: number, candidateY: number, self: Fish): boolean {
    for (const other of fish) {
      if (other !== self && other.species !== MINNOW && Math.hypot(other.holdX - candidateX, other.holdY - candidateY) < 1.6) {
        return true;
      }
    }

    return false;
  }

  function pickHoldSpot(self: Fish) {
    const spec = SPECIES[self.species];
    let best = Infinity;
    let bestX = self.x;
    let bestY = self.y;
    world.flowAt(self.x, self.y, state.time, flow);
    const upstream = Math.atan2(-flow.y, -flow.x);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const angle = upstream + (random() - 0.5) * 2.4;
      const distance = 0.8 + random() * 2.8;
      const candidateX = self.x + Math.cos(angle) * distance;
      const candidateY = self.y + Math.sin(angle) * distance;
      if (world.depthAt(candidateX, candidateY) < spec.minDepth + 0.15) {
        continue;
      }

      world.flowAt(candidateX, candidateY, state.time, flow);
      const score = Math.hypot(flow.x, flow.y) + (crowded(candidateX, candidateY, self) ? 2 : 0) + random() * 0.15;
      if (score < best) {
        best = score;
        bestX = candidateX;
        bestY = candidateY;
      }
    }

    self.holdX = bestX;
    self.holdY = bestY;
  }

  function spawn(species: number, count: number) {
    const spec = SPECIES[species];
    for (let index = 0; index < count; index += 1) {
      world.randomWaterPoint(random, spec.minDepth + 0.2, point);
      const length = (spec.lengthLow + random() * (spec.lengthHigh - spec.lengthLow)) * lengthScale;
      world.flowAt(point.x, point.y, 0, flow);
      fish.push({
        x: point.x,
        y: point.y,
        heading: Math.atan2(-flow.y, -flow.x),
        speed: 0,
        length,
        species,
        phase: random() * TAU,
        amplitude: 0.04,
        turn: 0,
        id: fish.length + random(),
        depthBelow: spec.swimDepth,
        holdX: point.x,
        holdY: point.y,
        offsetX: (random() - 0.5) * 0.9,
        offsetY: (random() - 0.5) * 0.9,
        darting: false,
        panicUntil: 0,
        nextMove: 2 + random() * 9,
      });
    }
  }

  spawn(TROUT, counts.trout);
  spawn(GRAYLING, counts.grayling);
  spawn(MINNOW, counts.minnows);
  pickAnchor();
  for (const member of fish) {
    if (member.species === MINNOW) {
      member.holdX = anchor.x + member.offsetX;
      member.holdY = anchor.y + member.offsetY;
    }
  }

  function step(self: Fish) {
    const spec = SPECIES[self.species];
    const time = state.time;
    const panic = time < self.panicUntil;

    if (self.species === MINNOW) {
      self.holdX = anchor.x + self.offsetX;
      self.holdY = anchor.y + self.offsetY;
      if (!self.darting && Math.hypot(self.holdX - self.x, self.holdY - self.y) > 0.9) {
        self.darting = true;
      }
    } else if (!self.darting && !panic && time >= self.nextMove) {
      pickHoldSpot(self);
      self.darting = true;
    }

    let toHoldX = self.holdX - self.x;
    let toHoldY = self.holdY - self.y;
    const holdDistance = Math.hypot(toHoldX, toHoldY);
    if (self.darting && holdDistance < 0.22) {
      self.darting = false;
      self.nextMove = time + 5 + random() * 12;
    }

    world.flowAt(self.x, self.y, time, flow);

    let wantX = 0;
    let wantY = 0;
    if (self.darting || panic) {
      const urgency = (panic ? 1.35 : 1) * spec.dartSpeed * clamp(holdDistance / 0.5, 0.25, 1);
      wantX = (toHoldX / Math.max(holdDistance, 1e-4)) * urgency;
      wantY = (toHoldY / Math.max(holdDistance, 1e-4)) * urgency;
    } else {
      toHoldX *= 1.5;
      toHoldY *= 1.5;
      const hold = Math.hypot(toHoldX, toHoldY);
      const limit = 0.3;
      const scale = hold > limit ? limit / hold : 1;
      wantX = toHoldX * scale;
      wantY = toHoldY * scale;
    }

    const probe = self.length * 0.7 + 0.2;
    const aheadX = self.x + Math.cos(self.heading) * probe;
    const aheadY = self.y + Math.sin(self.heading) * probe;
    if (world.depthAt(aheadX, aheadY) < spec.minDepth) {
      const gx = world.depthAt(self.x + 0.2, self.y) - world.depthAt(self.x - 0.2, self.y);
      const gy = world.depthAt(self.x, self.y + 0.2) - world.depthAt(self.x, self.y - 0.2);
      const norm = Math.max(Math.hypot(gx, gy), 1e-4);
      wantX += (gx / norm) * 0.8;
      wantY += (gy / norm) * 0.8;
    }

    for (const other of fish) {
      if (other === self) {
        continue;
      }

      const gapX = self.x - other.x;
      const gapY = self.y - other.y;
      const gap = Math.hypot(gapX, gapY);
      const comfort = self.species === MINNOW ? (other.species === MINNOW ? 0.16 : 0.5) : self.length * 1.3;
      if (gap < comfort && gap > 1e-4) {
        const push = ((comfort - gap) / comfort) * (self.species === MINNOW ? 0.6 : 0.9);
        wantX += (gapX / gap) * push;
        wantY += (gapY / gap) * push;
      }
    }

    const swimX = wantX - flow.x;
    const swimY = wantY - flow.y;
    const swimSpeed = Math.hypot(swimX, swimY);
    const cruiseLimit = panic || self.darting ? spec.dartSpeed * 1.35 : spec.maxSpeed;

    const turnRate = spec.turnRate * (panic ? 2.5 : 1);
    let alignment = 1;
    if (swimSpeed > 0.07) {
      const error = wrapAngle(Math.atan2(swimY, swimX) - self.heading);
      const turnStep = clamp(error, -turnRate * STEP, turnRate * STEP);
      self.heading += turnStep;
      self.turn += (clamp(turnStep / (turnRate * STEP), -1, 1) - self.turn) * 0.12;
      alignment = Math.max(0, Math.cos(error));
    } else {
      self.turn *= 0.9;
    }

    const targetSpeed = Math.min(swimSpeed, cruiseLimit) * alignment;
    self.speed += (targetSpeed - self.speed) * Math.min(1, STEP * 4);

    const velocityX = flow.x + Math.cos(self.heading) * self.speed;
    const velocityY = flow.y + Math.sin(self.heading) * self.speed;
    let nextX = self.x + velocityX * STEP;
    let nextY = self.y + velocityY * STEP;
    if (world.depthAt(nextX, nextY) < spec.minDepth * 0.55) {
      const gx = world.depthAt(self.x + 0.15, self.y) - world.depthAt(self.x - 0.15, self.y);
      const gy = world.depthAt(self.x, self.y + 0.15) - world.depthAt(self.x, self.y - 0.15);
      const norm = Math.max(Math.hypot(gx, gy), 1e-4);
      nextX = self.x + (gx / norm) * 0.5 * STEP;
      nextY = self.y + (gy / norm) * 0.5 * STEP;
      self.darting = false;
      self.nextMove = time + 1;
    }

    self.x = nextX;
    self.y = nextY;

    const effort = clamp(self.speed / spec.dartSpeed, 0, 1.3);
    self.phase += STEP * TAU * (1.1 + 2.6 * effort + (panic ? 1.5 : 0));
    const targetAmplitude = 0.035 + 0.075 * effort;
    self.amplitude += (targetAmplitude - self.amplitude) * 0.1;
    const bed = world.depthAt(self.x, self.y);
    self.depthBelow += (Math.min(spec.swimDepth, bed * 0.45) - self.depthBelow) * 0.05;
  }

  const sim: FishSim = {
    fish,
    get time() {
      return state.time;
    },
    update(dt) {
      let remaining = Math.min(dt, STEP * MAX_STEPS_PER_UPDATE) + state.pending;
      let steps = 0;
      while (remaining >= STEP && steps < MAX_STEPS_PER_UPDATE) {
        remaining -= STEP;
        steps += 1;
        state.time += STEP;
        if (state.time >= anchor.nextMove) {
          pickAnchor();
        }

        for (const member of fish) {
          step(member);
        }
      }

      state.pending = remaining;
    },
    startle(x, y) {
      for (const member of fish) {
        const spec = SPECIES[member.species];
        const dx = member.x - x;
        const dy = member.y - y;
        const distance = Math.hypot(dx, dy);
        if (distance > spec.startleRadius) {
          continue;
        }

        const away = Math.atan2(dy, dx);
        let bestScore = -Infinity;
        for (let attempt = 0; attempt < 7; attempt += 1) {
          const angle = away + (attempt - 3) * 0.35;
          const targetX = member.x + Math.cos(angle) * 2.2;
          const targetY = member.y + Math.sin(angle) * 2.2;
          const depth = world.depthAt(targetX, targetY);
          const score = Math.min(depth, 1) - Math.abs(attempt - 3) * 0.05;
          if (depth > spec.minDepth + 0.1 && score > bestScore) {
            bestScore = score;
            member.holdX = targetX;
            member.holdY = targetY;
          }
        }

        member.panicUntil = state.time + 1.1 + random() * 0.7;
        member.darting = true;
      }
    },
    pack(out) {
      let offset = 0;
      for (const member of fish) {
        out[offset] = member.x;
        out[offset + 1] = member.y;
        out[offset + 2] = member.heading;
        out[offset + 3] = member.length;
        out[offset + 4] = member.species;
        out[offset + 5] = member.phase;
        out[offset + 6] = member.amplitude;
        out[offset + 7] = member.turn;
        out[offset + 8] = member.id;
        out[offset + 9] = member.depthBelow;
        offset += FISH_INSTANCE_FLOATS;
      }

      return fish.length;
    },
  };

  return sim;
}
