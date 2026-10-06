// Fish are flat strips drawn from straight above into a world-space layer that the water pass
// looks through at an angle. The vertex shader bends the strip into a swimming
// S-wave that grows towards the tail (as the koi do in the reference pond), and the
// fragment shader paints the body, fins and markings in body coordinates.
in vec2 aCorner; // x: 0 head .. 1 tail, y: -1 .. 1 across
in vec4 aPose; // world x, world y, heading, length
in vec4 aState; // species, swim phase, swim amplitude, turn
in vec4 aExtra; // id, 0, 0, 0

out vec2 vBody;
flat out float vSpecies;
flat out float vId;
flat out float vPhase;
flat out float vTurn;

const float HALF_WIDTH = 0.34;

void main() {
  float along = aCorner.x;
  float bodyLength = aPose.w;
  float tail = along * along;
  float bend = sin(aState.y - along * 5.6) * aState.z * bodyLength * tail + aState.w * 0.1 * bodyLength * tail;
  vec2 local = vec2((0.5 - along) * bodyLength, aCorner.y * HALF_WIDTH * bodyLength + bend);
  float c = cos(aPose.z);
  float s = sin(aPose.z);
  vec2 world = aPose.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);

  gl_Position = vec4(world / uWorldSize * 2.0 - 1.0, 0.0, 1.0);

  vBody = aCorner;
  vSpecies = aState.x;
  vId = aExtra.x;
  vPhase = aState.y;
  vTurn = aState.w;
}
