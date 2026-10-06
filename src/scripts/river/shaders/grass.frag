uniform float uShadow;

in float vSide;
in vec3 vColor;

out vec4 outColor;

void main() {
  float alpha = 1.0 - smoothstep(0.5, 1.0, abs(vSide));
  if (uShadow > 0.5) {
    outColor = vec4(vec3(0.02, 0.07, 0.04) * 0.2, 0.2) * alpha;

    return;
  }

  outColor = vec4(vColor, 1.0) * alpha;
}
