uniform float uShadow;

in vec2 vFrond;
flat in float vSeed;

out vec4 outColor;

void main() {
  float along = vFrond.x;
  float across = vFrond.y;
  float edge = abs(across);

  // Leaflets alternate on the two sides and lean towards the tip; gaps separate them.
  float phase = along * 15.0 - edge * 1.2 + (across > 0.0 ? 0.5 : 0.0);
  float cell = fract(phase);
  float soft = fwidth(phase) * 1.5 + 0.02;
  float leaflet = smoothstep(0.0, soft + 0.08, cell) * (1.0 - smoothstep(0.5 - soft, 0.5 + soft + 0.1, cell));
  leaflet *= 1.0 - smoothstep(0.82, 1.0, edge);
  float rib = 1.0 - smoothstep(0.03, 0.09, edge);
  float mask = max(leaflet, rib);

  if (uShadow > 0.5) {
    outColor = vec4(vec3(0.02, 0.07, 0.04) * 0.2, 0.2) * mask;

    return;
  }

  vec3 deep = vec3(0.14, 0.34, 0.09);
  vec3 bright = vec3(0.4, 0.6, 0.2);
  float variation = fract(vSeed * 7.7);
  vec3 leafColor = mix(deep, bright, smoothstep(0.1, 0.95, edge) * 0.8 + along * 0.25);
  leafColor *= vec3(0.94 + 0.12 * variation, 1.0, 0.9 + 0.2 * variation);
  vec3 ribColor = vec3(0.5, 0.64, 0.3);
  vec3 color = mix(leafColor, ribColor, rib * 0.7) * (0.88 + 0.12 * along);
  outColor = vec4(color, 1.0) * mask;
}
