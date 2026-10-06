// The fixed orthographic camera of the scene and how it frames the loop for each frame shape.
// Pure: no DOM, no GL.
//
// The camera looks roughly north from above the lane in front of the viaduct, like the aerial
// photograph. Wide frames show the whole loop with hillside above; tall frames come in on the
// viaduct and the part of the loop it spans.

export interface CameraFrame {
  // Half the visible width and height, in metres measured on the screen.
  halfWidth: number;
  halfHeight: number;
  // The world point at the centre of the screen.
  target: [number, number, number];
  elevation: number;
  // Turns the view clockwise seen from above: zero looks due north.
  azimuth: number;
}

const DEGREE = Math.PI / 180;

interface Anchor {
  aspect: number;
  width: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  elevation: number;
}

// Frame shapes from the widest to the tallest. Between two anchors everything is interpolated.
const ANCHORS: Anchor[] = [
  { aspect: 2.1, width: 184, targetX: 8, targetY: 10, targetZ: -24, elevation: 17 },
  { aspect: 1.33, width: 160, targetX: 6, targetY: 6, targetZ: 2, elevation: 25 },
  { aspect: 0.8, width: 100, targetX: 46, targetY: 6, targetZ: -25, elevation: 34 },
];

const AZIMUTH = 4 * DEGREE;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function frameForAspect(aspect: number): CameraFrame {
  const clamped = Math.min(Math.max(aspect, ANCHORS[ANCHORS.length - 1].aspect), ANCHORS[0].aspect);
  let upper = 1;
  while (upper < ANCHORS.length - 1 && clamped < ANCHORS[upper].aspect) {
    upper += 1;
  }

  const wide = ANCHORS[upper - 1];
  const tall = ANCHORS[upper];
  const amount = (wide.aspect - clamped) / (wide.aspect - tall.aspect);
  const width = lerp(wide.width, tall.width, amount);

  return {
    halfWidth: width / 2,
    halfHeight: width / 2 / aspect,
    target: [lerp(wide.targetX, tall.targetX, amount), lerp(wide.targetY, tall.targetY, amount), lerp(wide.targetZ, tall.targetZ, amount)],
    elevation: lerp(wide.elevation, tall.elevation, amount) * DEGREE,
    azimuth: AZIMUTH,
  };
}

// The horizontal unit vector the camera looks along.
export function lookDirection(frame: CameraFrame): [number, number] {
  return [Math.sin(frame.azimuth), -Math.cos(frame.azimuth)];
}

// Where a world point lands on the screen: x and y in -1..1, y up, as for clip space.
export function projectToScreen(frame: CameraFrame, x: number, y: number, z: number): [number, number] {
  const [lookX, lookZ] = lookDirection(frame);
  const dx = x - frame.target[0];
  const dy = y - frame.target[1];
  const dz = z - frame.target[2];
  const across = dx * -lookZ + dz * lookX;
  const ahead = dx * lookX + dz * lookZ;
  const up = ahead * Math.sin(frame.elevation) + dy * Math.cos(frame.elevation);

  return [across / frame.halfWidth, up / frame.halfHeight];
}
