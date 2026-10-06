// Leaves and petals floating on the surface. The shadow pass moves each one away from the
// sun by the water depth beneath it, so the shadow lands on the riverbed, not on the leaf.
uniform sampler2D uTerrain;
uniform vec3 uSun;
uniform float uShadow;

in vec4 aItem; // world x, world y, angle, size
in float aKind;

out vec2 vLocal;
flat out float vKind;
flat out float vSeed;

const vec2 CORNERS[6] = vec2[6](
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
  vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0)
);

void main() {
  vec2 corner = CORNERS[gl_VertexID];
  float depth = max(textureLod(uTerrain, aItem.xy / uWorldSize, 0.0).r, 0.0);
  vec2 shift = uShadow > 0.5 ? -uSun.xy * (0.03 + depth * 0.7) : vec2(0.0);
  float c = cos(aItem.z);
  float s = sin(aItem.z);
  vec2 local = corner * aItem.w;
  vec2 world = aItem.xy + shift + vec2(c * local.x - s * local.y, s * local.x + c * local.y);

  vec2 unit = world / uWorldSize;
  vec2 down = uPortrait > 0.5 ? unit.yx : unit;
  gl_Position = vec4(down.x * 2.0 - 1.0, 1.0 - down.y * 2.0, 0.0, 1.0);

  vLocal = corner;
  vKind = aKind;
  vSeed = fract(aItem.x * 12.9898 + aItem.y * 78.233);
}
