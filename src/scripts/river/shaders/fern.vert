// Fern fronds seen from above: each is an arching strip that tapers to a point. The fragment
// shader cuts the rib and the alternating leaflets out of it. The shadow pass draws the same
// strip pushed away from the sun.
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
  vec2 across = vec2(-direction.y, direction.x);

  vec2 centre = aFrond.xy + direction * length2 * along + across * aShape.y * length2 * along * along;
  vec2 tangent = normalize(direction + across * 2.0 * aShape.y * along);
  vec2 side = vec2(-tangent.y, tangent.x);
  float taper = pow(max(sin(3.14159 * pow(along, 0.7)), 0.0), 0.8);
  float halfWidth = length2 * 0.19 * aShape.z * taper;

  float sway = sin(uTime * 1.1 + aFrond.x * 0.8 + aFrond.y * 0.5 + aShape.x * 20.0);
  centre += vec2(0.8, 0.35) * sway * 0.035 * length2 * along * along;

  vec2 world = centre + side * aCorner.y * halfWidth;
  if (uShadow > 0.5) {
    world -= uSun.xy * (0.02 + 0.045 * along);
  }

  vec2 unit = world / uWorldSize;
  vec2 down = uPortrait > 0.5 ? unit.yx : unit;
  gl_Position = vec4(down.x * 2.0 - 1.0, 1.0 - down.y * 2.0, 0.0, 1.0);

  vFrond = aCorner;
  vSeed = aShape.x;
}
