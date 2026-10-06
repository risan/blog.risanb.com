// One-off tileable textures: surface detail normals (kind 0) and sun caustics (kind 1).
uniform float uKind;
in vec2 vUv;
out vec4 outColor;

const float TAU = 6.28318530718;

float periodicNoise(vec2 p, float period) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(cell, period));
  float b = hash12(mod(cell + vec2(1.0, 0.0), period));
  float c = hash12(mod(cell + vec2(0.0, 1.0), period));
  float d = hash12(mod(cell + vec2(1.0, 1.0), period));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float surfaceHeight(vec2 uv) {
  float sum = 0.0;
  float amplitude = 0.55;
  float period = 4.0;
  for (int octave = 0; octave < 5; octave += 1) {
    float n = periodicNoise(uv * period + float(octave) * 7.0, period);
    float ridged = 1.0 - abs(2.0 * n - 1.0);
    sum += amplitude * mix(n, ridged, 0.55);
    period *= 2.0;
    amplitude *= 0.5;
  }

  return sum;
}

float caustic(vec2 uv) {
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float intensity = 0.005;
  for (int n = 0; n < 5; n += 1) {
    float t = 1.7 * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / intensity), p.y / (cos(i.y + t) / intensity)));
  }

  c /= 5.0;
  c = 1.17 - pow(c, 1.4);

  return pow(abs(c), 8.0);
}

void main() {
  if (uKind < 0.5) {
    float step = 1.0 / 256.0;
    float h = surfaceHeight(vUv);
    float dx = surfaceHeight(vUv + vec2(step, 0.0)) - surfaceHeight(vUv - vec2(step, 0.0));
    float dy = surfaceHeight(vUv + vec2(0.0, step)) - surfaceHeight(vUv - vec2(0.0, step));
    outColor = vec4(vec2(dx, dy) * 6.0 + 0.5, h, 1.0);
  } else {
    float c = clamp(caustic(vUv) * 0.55, 0.0, 1.0);
    outColor = vec4(c, c, c, 1.0);
  }
}
