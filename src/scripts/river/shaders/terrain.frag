// The ground seen from the tilted camera: the colour baked from above, drawn on the lifted grid.
// The bake looks straight down, so the steep sides of rocks would show one stretched texel;
// there the stone texture (or, on the cut face of a bank, soil) is projected from the sides
// instead and lit by the real surface normal.
// Parts below the water are left to the water pass, which shows the bed through the surface;
// the terrain only skips what lies deep, because the mesh and the water mask meet at slightly
// different places on steep rock edges and a gap there would show the background.
uniform sampler2D uGround; // mipmapped: rgb colour, a sun light
uniform sampler2D uRock;
uniform sampler2D uPebbles;
uniform vec3 uSun; // xy: unit direction to the sun in world space, z: tan of its elevation

in vec3 vWorld;
out vec4 outColor;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec3 stoneAt(vec3 p, vec3 normal) {
  vec3 weights = pow(abs(normal), vec3(4.0));
  weights /= weights.x + weights.y + weights.z;
  vec3 stone = texture(uRock, vec2(p.y, p.z) * 1.15).rgb * weights.x
    + texture(uRock, vec2(p.x, p.z) * 1.15 + 0.37).rgb * weights.y
    + texture(uRock, p.xy * 1.15).rgb * weights.z;
  stone = mix(vec3(luma(stone)), stone, 0.55) * vec3(1.2, 1.17, 1.1);

  return (stone - 0.4) * 1.2 + 0.4;
}

// Bare earth for the cut face of a bank: pebbles in dark soil, projected from three sides.
vec3 soilAt(vec3 p, vec3 normal) {
  vec3 weights = pow(abs(normal), vec3(4.0));
  weights /= weights.x + weights.y + weights.z;
  vec3 pebbles = texture(uPebbles, vec2(p.y, p.z) * 1.6).rgb * weights.x
    + texture(uPebbles, vec2(p.x, p.z) * 1.6 + 0.37).rgb * weights.y
    + texture(uPebbles, p.xy * 1.6).rgb * weights.z;
  vec3 earth = mix(vec3(0.31, 0.25, 0.18), vec3(0.45, 0.36, 0.26), valueNoise(p.xy * 3.0 + p.z * 5.0));

  return mix(earth, earth * (0.45 + 1.5 * luma(pebbles)) * vec3(1.1, 1.0, 0.85), 0.85);
}

void main() {
  if (vWorld.z < -0.3) {
    discard;
  }

  vec2 unit = vWorld.xy / uWorldSize;
  vec4 ground = texture(uGround, unit);
  vec3 color = ground.rgb;

  float rockHeight = textureLod(uTerrain, unit, 0.0).a;
  bool onRock = rockHeight > 0.02;
  // The cut face of a bank lies between the water and the plateau.
  bool maybeBankFace = !onRock && vWorld.z < uBank.x * 0.95;
  if (onRock || maybeBankFace) {
    vec2 step = 1.5 / vec2(textureSize(uTerrain, 0)) * uWorldSize;
    vec2 gradient = vec2(
      elevationAt(vWorld.xy + vec2(step.x, 0.0)) - elevationAt(vWorld.xy - vec2(step.x, 0.0)),
      elevationAt(vWorld.xy + vec2(0.0, step.y)) - elevationAt(vWorld.xy - vec2(0.0, step.y))
    ) / (2.0 * step);
    vec3 normal = normalize(vec3(-gradient, 1.0));
    vec3 light = normalize(uSun);
    float diffuse = clamp((dot(normal, light) + 0.25) / 1.25, 0.0, 1.0);
    vec3 ambient = vec3(0.3, 0.37, 0.5) * (0.45 + 0.55 * normal.z);
    vec3 sunlight = vec3(1.02, 0.95, 0.82) * diffuse * mix(0.4, 1.0, ground.a);

    if (onRock) {
      float side = (1.0 - smoothstep(0.5, 0.85, normal.z)) * smoothstep(0.02, 0.08, rockHeight);
      if (side > 0.0) {
        vec3 stone = stoneAt(vWorld, normal);
        float patches = fbm(vec2(vWorld.x + vWorld.y, vWorld.z * 2.0) * 3.0 + 5.0);
        float mossy = smoothstep(0.5, 0.75, patches * 0.9 + normal.z * 0.5 - 0.1) * 0.7;
        vec3 lichen = vec3(0.3, 0.42, 0.14) * (0.6 + luma(stone));
        vec3 lit = mix(stone, lichen, mossy) * (ambient + sunlight);
        // Darker towards the foot of the rock, where it meets the ground.
        lit *= mix(0.75, 1.0, smoothstep(0.0, 0.2, rockHeight));
        color = mix(color, lit, side);
      }

      // A band of foam where the water laps the stone. It is drawn on the rock itself, so it
      // follows the edge of the mesh exactly; a line drawn by the water pass breaks into dashes there.
      float lapping = 1.0 - smoothstep(0.0, 0.035, vWorld.z);
      color = mix(color, vec3(0.9, 0.96, 0.94), lapping * 0.5);
    } else {
      float face = 1.0 - smoothstep(0.55, 0.88, normal.z);
      if (face > 0.0) {
        float height = vWorld.z / uBank.x;
        vec3 soil = soilAt(vWorld, normal);
        // Earth layers, a dark wet foot, and a ragged fringe of turf along the top edge.
        float layers = valueNoise(vec2((vWorld.x + vWorld.y) * 2.2, vWorld.z * 22.0));
        soil *= 0.8 + 0.4 * layers;
        // Thin roots hanging down the upper part of the face.
        float roots = smoothstep(0.7, 0.78, valueNoise(vec2((vWorld.x + vWorld.y) * 30.0, vWorld.z * 3.0))) * smoothstep(0.3, 0.85, height);
        soil = mix(soil, vec3(0.22, 0.15, 0.09), roots * 0.7);
        soil *= mix(0.55, 1.0, smoothstep(0.0, 0.2, height));
        float fringe = smoothstep(0.72, 0.9, height + (valueNoise(vWorld.xy * 14.0) - 0.5) * 0.3);
        vec3 face_color = mix(soil * (ambient + sunlight), color * 0.85, fringe);
        color = mix(color, face_color, face);
      }
    }
  }

  outColor = vec4(grade(color), 1.0);
}
