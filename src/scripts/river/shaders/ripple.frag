// One step of the ripple height field. state: r height, g velocity, b/a height gradient.
// The field is carried along by the current, damped, and absorbed by the shore and rocks.
uniform sampler2D uState;
uniform float uTime;
uniform float uStep; // seconds per sim step
uniform vec4 uImpulses[8]; // world x, world y, strength, radius (strength 0 = unused)

in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 p = vUv * uWorldSize;
  vec2 texel = 1.0 / vec2(textureSize(uState, 0));
  vec4 terrain = texture(uTerrain, vUv);
  float depth = terrain.r;

  vec2 current = flowFrom(terrain.gb, p, uTime);
  vec2 source = vUv - current * uStep / uWorldSize * 0.9;
  vec4 center = texture(uState, source);
  float left = texture(uState, source - vec2(texel.x, 0.0)).r;
  float right = texture(uState, source + vec2(texel.x, 0.0)).r;
  float up = texture(uState, source + vec2(0.0, texel.y)).r;
  float down = texture(uState, source - vec2(0.0, texel.y)).r;

  float laplacian = left + right + up + down - 4.0 * center.r;
  float velocity = (center.g + laplacian * 0.2) * 0.9935;
  float height = (center.r + velocity) * 0.9985;

  for (int index = 0; index < 8; index += 1) {
    vec4 impulse = uImpulses[index];
    if (impulse.z != 0.0) {
      vec2 delta = (p - impulse.xy) / impulse.w;
      height += impulse.z * exp(-dot(delta, delta));
    }
  }

  float water = smoothstep(0.03, 0.2, depth);
  height *= water;
  velocity *= water;

  float gradientX = (right - left) * 0.5;
  float gradientY = (up - down) * 0.5;
  outColor = vec4(clamp(height, -1.0, 1.0), clamp(velocity, -1.0, 1.0), gradientX, gradientY);
}
