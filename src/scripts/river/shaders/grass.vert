// Grass tufts: each tuft is a fan of thin blades that stand up from a root on the ground and
// lean outwards, coloured from the lawn baked underneath so they blend in. Blades are as wide
// along the screen's right-hand direction, so none ever turns edge-on to the camera. Tips sway
// with the wind. The shadow pass lays each blade on the ground along the sun's rays.
uniform mat4 uViewProjection;
uniform sampler2D uGround;
uniform vec2 uAcross;
uniform vec2 uToward;
uniform float uTime;
uniform vec3 uSun;
uniform float uShadow;

in vec4 aBlade; // blade index 0..1, position along the blade 0..1, side -1..1
in vec4 aTuft; // world x, world y, size, seed
in float aRootHeight; // height of the ground at the root

out float vSide;
out vec3 vColor;

void main() {
  float seed = aTuft.w;
  float size = aTuft.z;
  float angle = (aBlade.x + hash12(vec2(seed, 1.0))) * 6.28318 + (hash12(vec2(aBlade.x * 37.0, seed)) - 0.5) * 0.9;
  float bladeLength = size * (0.55 + 0.7 * hash12(vec2(aBlade.x * 91.0 + 3.0, seed)));
  vec2 direction = vec2(cos(angle), sin(angle));
  vec2 sideways = vec2(-direction.y, direction.x);
  float t = aBlade.y;

  float curl = (hash12(vec2(aBlade.x * 13.0, seed + 4.0)) - 0.5) * 1.2;
  vec2 lean = direction * bladeLength * 0.5 * t * t + sideways * curl * bladeLength * 0.4 * t * t;
  vec2 wind = uAcross * 0.85 + uToward * 0.35;
  float sway = sin(uTime * 1.3 + aTuft.x * 0.9 + aTuft.y * 0.6 + seed * 20.0) + 0.5 * sin(uTime * 2.6 + aTuft.x * 2.1);
  lean += wind * sway * 0.1 * bladeLength * t * t;

  float rise = bladeLength * 1.6 * t * (1.0 - 0.2 * t);
  float width = size * 0.2 * (1.0 - 0.9 * t);
  vec2 ground = aTuft.xy + lean + uAcross * aBlade.z * width;

  if (uShadow > 0.5) {
    vec2 shadow = ground - uSun.xy * rise / uSun.z;
    gl_Position = uViewProjection * vec4(shadow, aRootHeight + 0.004, 1.0);
  } else {
    gl_Position = uViewProjection * vec4(ground, aRootHeight + rise, 1.0);
  }

  vec3 lawn = grade(textureLod(uGround, aTuft.xy / uWorldSize, 2.0).rgb);
  float tone = hash12(vec2(seed, 9.0));
  vec3 root = lawn * 0.78;
  vec3 tip = lawn * vec3(1.2, 1.2, 0.9) + vec3(0.04, 0.04, 0.0);
  tip = mix(tip, tip * vec3(1.1, 1.0, 0.7), tone * 0.5);

  float facing = 0.94 + 0.12 * dot(direction, uSun.xy);
  vColor = mix(root, tip, t) * facing;
  vSide = aBlade.z;
}
