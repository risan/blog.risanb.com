// Fern fronds: each is a strip that arches up and out from its root, rises, then droops, and
// tapers to a point. The fragment shader cuts the rib and the alternating leaflets out of it.
// The shadow pass lays the same strip on the ground along the sun's rays.
uniform mat4 uViewProjection;
uniform vec2 uAcross;
uniform vec2 uToward;
uniform float uTime;
uniform vec3 uSun;
uniform float uShadow;

in vec2 aCorner; // x: 0 root .. 1 tip, y: -1 .. 1 across
in vec4 aFrond; // root x, root y, length, angle
in vec4 aShape; // seed, curl, width scale, 0

out vec2 vFrond;
flat out float vSeed;

void main() {
  float along = aCorner.x;
  float length2 = aFrond.z;
  vec2 direction = vec2(cos(aFrond.w), sin(aFrond.w));
  vec2 sideways = vec2(-direction.y, direction.x);

  vec2 centre = aFrond.xy + direction * length2 * along * 0.85 + sideways * aShape.y * length2 * along * along;
  vec2 tangent = normalize(direction * 0.85 + sideways * 2.0 * aShape.y * along);
  vec2 side = vec2(-tangent.y, tangent.x);
  float taper = pow(max(sin(3.14159 * pow(along, 0.7)), 0.0), 0.8);
  float halfWidth = length2 * 0.19 * aShape.z * taper;

  vec2 wind = uAcross * 0.85 + uToward * 0.35;
  float sway = sin(uTime * 1.1 + aFrond.x * 0.8 + aFrond.y * 0.5 + aShape.x * 20.0);
  centre += wind * sway * 0.035 * length2 * along * along;

  float rise = length2 * (1.1 * along - 0.95 * along * along);
  vec2 ground = centre + side * aCorner.y * halfWidth;
  if (uShadow > 0.5) {
    vec2 shadow = ground - uSun.xy * rise / uSun.z;
    gl_Position = uViewProjection * vec4(shadow, elevationAt(shadow) + 0.004, 1.0);
  } else {
    gl_Position = uViewProjection * vec4(ground, elevationAt(aFrond.xy) + 0.01 + rise, 1.0);
  }

  vFrond = aCorner;
  vSeed = aShape.x;
}
