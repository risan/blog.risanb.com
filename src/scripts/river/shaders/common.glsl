// Shared by every pass. The world is always laid out with the river flowing along +x; on
// portrait canvases the screen shows it turned so the water runs top to bottom.
uniform vec2 uWorldSize;
uniform float uPortrait;

// glUv is the screen position in 0..1 with y pointing up, as gl_FragCoord gives it.
vec2 worldFromScreen(vec2 glUv) {
  vec2 down = vec2(glUv.x, 1.0 - glUv.y);

  return (uPortrait > 0.5 ? down.yx : down) * uWorldSize;
}

vec2 screenFromWorld(vec2 p) {
  vec2 unit = p / uWorldSize;
  vec2 down = uPortrait > 0.5 ? unit.yx : unit;

  return vec2(down.x, 1.0 - down.y);
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
