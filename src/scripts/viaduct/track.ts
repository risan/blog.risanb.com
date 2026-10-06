// The railway line of the Brusio spiral, as a chain of straights and arcs. Pure: no DOM, no GL.
//
// World axes follow three.js: x points east, y up, z south. The plan is worked out with x east and
// n north (n = -z), because bearings are easier to read that way. A heading is the plan angle of
// the direction of travel, counter-clockwise from east, so the line turns clockwise (to the right)
// by lowering the heading.
//
// The line runs downhill, from the hillside above Brusio round the 70 m circle and out towards
// Tirano, and passes under the viaduct it has just crossed. Distances along the line are `s`.

const DEGREE = Math.PI / 180;

export const LOOP_RADIUS = 70;
export const VIADUCT_LENGTH = 110;
export const ARCH_SPAN = 10;
export const PIER_THICKNESS = 2;
export const ARCH_COUNT = 9;
// Piers and arches repeat every 12 m; a 2 m abutment closes each end.
const ABUTMENT_LENGTH = (VIADUCT_LENGTH - ARCH_COUNT * ARCH_SPAN - (ARCH_COUNT - 1) * PIER_THICKNESS) / 2;

export const DECK_WIDTH = 4.4;
export const BALLAST_WIDTH = 4;
// The rail top sits this far above the top of the deck slab; the arch crown is just below the slab.
export const CROWN_BELOW_RAIL = 1.2;
export const SPRINGING_BELOW_CROWN = ARCH_SPAN / 2;
// The crossing under the viaduct: rail top to rail top.
export const CROSSING_DROP = 14.5;

const VIADUCT_START_THETA = 15 * DEGREE;
const CIRCLE_START_THETA = 20 * DEGREE;
const APPROACH_HEADING = -10 * DEGREE;
const APPROACH_RADIUS = 120;
const APPROACH_STRAIGHT = 220;
const INNER_RADIUS = 40;
const EXIT_HEADING = -58 * DEGREE;
const EXIT_STRAIGHT_AFTER_CROSSING = 140;
// The crossing is under the middle of the fourth arch.
const CROSSING_ARCH = 4;

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  // The unit direction of travel in the ground plane, and its plan heading (see above).
  tx: number;
  tz: number;
  heading: number;
  // Rise per metre of travel; negative while the line descends.
  grade: number;
}

interface Pose {
  x: number;
  n: number;
  heading: number;
}

interface Segment {
  startS: number;
  length: number;
  start: Pose;
  // Counter-clockwise positive. Zero is a straight.
  curvature: number;
}

export interface Span {
  startS: number;
  endS: number;
  centreS: number;
}

export interface Track {
  length: number;
  sample(s: number, out?: TrackPoint): TrackPoint;
  viaduct: {
    startS: number;
    endS: number;
    arches: Span[];
    piers: Span[];
  };
  // Where the exit track passes under the viaduct.
  crossing: { viaductS: number; exitS: number };
  // Where the circle begins: the approach lies before it.
  circleStartS: number;
}

function advance(pose: Pose, curvature: number, distance: number): Pose {
  if (curvature === 0) {
    return {
      x: pose.x + Math.cos(pose.heading) * distance,
      n: pose.n + Math.sin(pose.heading) * distance,
      heading: pose.heading,
    };
  }

  const heading = pose.heading + curvature * distance;

  return {
    x: pose.x + (Math.sin(heading) - Math.sin(pose.heading)) / curvature,
    n: pose.n - (Math.cos(heading) - Math.cos(pose.heading)) / curvature,
    heading,
  };
}

function circlePose(theta: number): Pose {
  return {
    x: LOOP_RADIUS * Math.cos(theta),
    n: LOOP_RADIUS * Math.sin(theta),
    // Clockwise travel round the circle.
    heading: theta - Math.PI / 2,
  };
}

function wrapPositive(angle: number): number {
  const turn = Math.PI * 2;

  return ((angle % turn) + turn) % turn;
}

function createSegments(): { segments: Segment[]; circleStartS: number } {
  const circleStart = circlePose(CIRCLE_START_THETA);
  const clockwise = (radius: number) => -1 / radius;

  const approachSweep = APPROACH_HEADING - circleStart.heading;
  const approachArcLength = Math.abs(approachSweep) * APPROACH_RADIUS;
  // The approach is laid out backwards from the circle, so that it joins the circle exactly.
  const approachArcStart = advance(circleStart, clockwise(APPROACH_RADIUS), -approachArcLength);
  const approachStart = advance(approachArcStart, 0, -APPROACH_STRAIGHT);

  const crossingTheta = VIADUCT_START_THETA - (viaductCrossingOffset() / LOOP_RADIUS);
  const crossing: Pose = { x: LOOP_RADIUS * Math.cos(crossingTheta), n: LOOP_RADIUS * Math.sin(crossingTheta), heading: EXIT_HEADING };

  // The inner arc leaves the circle tangentially, swings inside it and ends on the straight line
  // that reaches the crossing with the exit heading. Its centre is (LOOP_RADIUS - r) from the
  // circle's centre and r to the right of that line.
  const innerOffset = LOOP_RADIUS - INNER_RADIUS;
  const rightX = Math.sin(EXIT_HEADING);
  const rightN = -Math.cos(EXIT_HEADING);
  const ratio = (INNER_RADIUS + crossing.x * rightX + crossing.n * rightN) / innerOffset;
  const innerTheta = EXIT_HEADING - (Math.PI - Math.asin(ratio));
  const innerStart = circlePose(innerTheta);
  const innerSweep = wrapPositive(innerStart.heading - EXIT_HEADING);
  const innerArcLength = innerSweep * INNER_RADIUS;
  const innerEnd = advance(innerStart, clockwise(INNER_RADIUS), innerArcLength);
  const exitStraight = Math.hypot(crossing.x - innerEnd.x, crossing.n - innerEnd.n);

  const circleSweepEnd = CIRCLE_START_THETA - innerTheta;

  const pieces: [number, number, Pose][] = [
    [APPROACH_STRAIGHT, 0, approachStart],
    [approachArcLength, clockwise(APPROACH_RADIUS), approachArcStart],
    [circleSweepEnd * LOOP_RADIUS, clockwise(LOOP_RADIUS), circleStart],
    [innerArcLength, clockwise(INNER_RADIUS), innerStart],
    [exitStraight + EXIT_STRAIGHT_AFTER_CROSSING, 0, innerEnd],
  ];

  const segments: Segment[] = [];
  let startS = 0;
  for (const [length, curvature, start] of pieces) {
    segments.push({ startS, length, start, curvature });
    startS += length;
  }

  return { segments, circleStartS: APPROACH_STRAIGHT + approachArcLength };
}

function viaductCrossingOffset(): number {
  return ABUTMENT_LENGTH + (CROSSING_ARCH - 1) * (ARCH_SPAN + PIER_THICKNESS) + ARCH_SPAN / 2;
}

function createTrack(): Track {
  const { segments, circleStartS } = createSegments();
  const last = segments[segments.length - 1];
  const length = last.startS + last.length;
  const viaductStartS = circleStartS + ((CIRCLE_START_THETA - VIADUCT_START_THETA) * LOOP_RADIUS);
  const viaductS = viaductStartS + viaductCrossingOffset();

  const arches: Span[] = [];
  const piers: Span[] = [];
  for (let index = 0; index < ARCH_COUNT; index += 1) {
    const startS = viaductStartS + ABUTMENT_LENGTH + index * (ARCH_SPAN + PIER_THICKNESS);
    arches.push({ startS, endS: startS + ARCH_SPAN, centreS: startS + ARCH_SPAN / 2 });
    if (index < ARCH_COUNT - 1) {
      const pierStart = startS + ARCH_SPAN;
      piers.push({ startS: pierStart, endS: pierStart + PIER_THICKNESS, centreS: pierStart + PIER_THICKNESS / 2 });
    }
  }

  function planAt(s: number): Pose {
    // Both ends are straights, so beyond them the line simply carries on: a train can stand
    // wholly off the line's ends.
    let index = segments.length - 1;
    while (index > 0 && segments[index].startS > s) {
      index -= 1;
    }

    const segment = segments[index];

    return advance(segment.start, segment.curvature, s - segment.startS);
  }

  // Distance along the exit straight where it crosses the viaduct: found by walking it, since
  // the crossing is defined by the viaduct's own position rather than by the line's length.
  const exitSegment = segments[segments.length - 1];
  const crossingTheta = VIADUCT_START_THETA - (viaductCrossingOffset() / LOOP_RADIUS);
  const crossingX = LOOP_RADIUS * Math.cos(crossingTheta);
  const exitS = exitSegment.startS + Math.hypot(crossingX - exitSegment.start.x, LOOP_RADIUS * Math.sin(crossingTheta) - exitSegment.start.n);

  // One constant gradient from the approach to the exit, set so that the rail under the viaduct is
  // CROSSING_DROP below the rail over it.
  const gradient = CROSSING_DROP / (exitS - viaductS);

  function railHeight(s: number): number {
    return gradient * (exitS - s);
  }

  return {
    length,
    sample(s, out = { x: 0, y: 0, z: 0, tx: 0, tz: 0, heading: 0, grade: 0 }) {
      const pose = planAt(s);
      out.x = pose.x;
      out.z = -pose.n;
      out.y = railHeight(s);
      out.tx = Math.cos(pose.heading);
      out.tz = -Math.sin(pose.heading);
      out.heading = pose.heading;
      out.grade = -gradient;

      return out;
    },
    viaduct: { startS: viaductStartS, endS: viaductStartS + VIADUCT_LENGTH, arches, piers },
    crossing: { viaductS, exitS },
    circleStartS,
  };
}

export const track: Track = createTrack();

// The ground-plane position of a point beside the line: `lateral` metres to the right of the
// direction of travel. Used to place things along the viaduct and the catenary.
export function offsetFromTrack(s: number, lateral: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const point = track.sample(s);
  // Right of (tx, tz) with z pointing south: rotate the tangent a quarter turn clockwise on the plan.
  out.x = point.x + -point.tz * lateral;
  out.z = point.z + point.tx * lateral;

  return out;
}

export function isOnViaduct(s: number): boolean {
  return s >= track.viaduct.startS && s <= track.viaduct.endS;
}

// Height of the top of the deck slab, the arch crown and the springing at distance s on the viaduct.
export function deckHeights(s: number): { crown: number; springing: number } {
  const crown = track.sample(s).y - CROWN_BELOW_RAIL;

  return { crown, springing: crown - SPRINGING_BELOW_CROWN };
}
