// Grass tufts seen from above: each tuft is a fan of thin blades radiating from a
// root, coloured from the lawn baked underneath so it blends in. Tips sway with the wind.
// The shadow pass draws the same blades pushed away from the sun.
uniform sampler2D uGround;
uniform float uTime;
uniform vec3 uSun;
uniform float uShadow;

in vec4 aBlade; // blade index 0..1, position along the blade 0..1, side -1..1
in vec4 aTuft; // world x, world y, size, seed

out float vSide;
out vec3 vColor;

void main() {
  float seed = aTuft.w;
  float size = aTuft.z;
  float angle = (aBlade.x + hash12(vec2(seed, 1.0))) * 6.28318 + (hash12(vec2(aBlade.x * 37.0, seed)) - 0.5) * 0.9;
  float bladeLength = size * (0.55 + 0.7 * hash12(vec2(aBlade.x * 91.0 + 3.0, seed)));
  vec2 direction = vec2(cos(angle), sin(angle));
  vec2 across = vec2(-direction.y, direction.x);
  float t = aBlade.y;

  float curl = (hash12(vec2(aBlade.x * 13.0, seed + 4.0)) - 0.5) * 1.2;
  vec2 offset = direction * bladeLength * t + across * curl * bladeLength * t * t;
  float sway = sin(uTime * 1.3 + aTuft.x * 0.9 + aTuft.y * 0.6 + seed * 20.0) + 0.5 * sin(uTime * 2.6 + aTuft.x * 2.1);
  offset += vec2(0.8, 0.35) * sway * 0.05 * bladeLength * t * t;

  float width = size * 0.1 * (1.0 - 0.85 * t);
  vec2 world = aTuft.xy + offset + across * aBlade.z * width;
  if (uShadow > 0.5) {
    world -= uSun.xy * (0.015 + 0.06 * t * bladeLength / max(size, 0.01));
  }

  vec2 unit = world / uWorldSize;
  vec2 down = uPortrait > 0.5 ? unit.yx : unit;
  gl_Position = vec4(down.x * 2.0 - 1.0, 1.0 - down.y * 2.0, 0.0, 1.0);

  vec3 lawn = textureLod(uGround, aTuft.xy / uWorldSize, 2.0).rgb;
  float tone = hash12(vec2(seed, 9.0));
  vec3 root = lawn * 0.92;
  vec3 tip = lawn * vec3(1.2, 1.2, 0.9) + vec3(0.04, 0.04, 0.0);
  tip = mix(tip, tip * vec3(1.1, 1.0, 0.7), tone * 0.5);

  float facing = 0.94 + 0.12 * dot(direction, uSun.xy);
  vColor = mix(root, tip, t) * facing;
  vSide = aBlade.z;
}
