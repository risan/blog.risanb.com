uniform float uShadow;

in vec2 vLocal;
flat in float vKind;
flat in float vSeed;

out vec4 outColor;

void main() {
  vec2 q = vLocal;
  int kind = int(vKind + 0.5);
  float aa = fwidth(q.y) * 1.2 + 1e-4;

  float width;
  if (kind == 3) {
    width = 0.78 * sqrt(max(1.0 - q.x * q.x, 0.0)) * (1.0 - 0.18 * q.x);
  } else {
    width = 0.5 * pow(max(1.0 - q.x * q.x, 0.0), 0.8) * (1.0 - 0.22 * q.x);
  }

  float inside = smoothstep(aa, -aa, abs(q.y) - width);
  if (uShadow > 0.5) {
    outColor = vec4(vec3(0.01, 0.07, 0.12) * 0.3, 0.3) * inside;

    return;
  }

  vec3 base;
  if (kind == 0) {
    base = vec3(0.66, 0.7, 0.3);
  } else if (kind == 1) {
    base = vec3(0.82, 0.76, 0.42);
  } else if (kind == 2) {
    base = vec3(0.5, 0.58, 0.26);
  } else if (kind == 3) {
    base = vec3(0.96, 0.82, 0.86);
  } else {
    base = vec3(0.8, 0.5, 0.22);
  }

  base *= 0.88 + 0.24 * vSeed;
  float rib = 1.0 - smoothstep(0.0, 0.07, abs(q.y));
  float veins = 1.0 - smoothstep(0.0, 0.05, abs(fract((q.x + abs(q.y) * 1.3) * 3.0) - 0.5) - 0.42);
  vec3 color = base * (0.84 + 0.2 * (1.0 - abs(q.y) / max(width, 0.01)));
  color = mix(color, base * 1.25, rib * 0.5 * (kind == 3 ? 0.0 : 1.0));
  color = mix(color, base * 0.8, veins * 0.2 * step(0.5, abs(q.y)) * (kind == 3 ? 0.0 : 1.0));
  outColor = vec4(color, 1.0) * inside;
}
