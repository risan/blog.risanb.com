// Shared by every pass. World coordinates are metres: x and y lie in the ground plane, z is up
// and the water surface is z = 0. The camera looks at the world from a tilted angle and passes
// that go on screen multiply world positions by uViewProjection.
uniform vec2 uWorldSize;
uniform sampler2D uTerrain; // depth, flow x, flow y, rock height
uniform vec2 uBank; // height of the bank plateau, softness of its lip

// Slightly muted and warmed; the last step of every pass that shows the ground.
vec3 grade(vec3 color) {
  float l = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(l), color, 0.98) * vec3(1.03, 1.0, 0.95);

  return clamp(color, 0.0, 1.0);
}

// Height above the water surface, from the bed depth without rocks and the rock height.
// world.ts has the same formula (elevationFrom).
float elevationFrom(float bed, float rockHeight) {
  float ground = bed > 0.0 ? -bed : uBank.x * (1.0 - exp(bed / uBank.y));

  return ground + rockHeight;
}

float elevationAt(vec2 p) {
  vec4 terrain = textureLod(uTerrain, p / uWorldSize, 0.0);

  return elevationFrom(terrain.r + terrain.a, terrain.a);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);

  return fract((q.x + q.y) * q.z);
}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);

  return fract((q.xx + q.yz) * q.zy);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave += 1) {
    sum += amplitude * valueNoise(p);
    p = p * 2.03 + 17.3;
    amplitude *= 0.5;
  }

  return sum;
}
