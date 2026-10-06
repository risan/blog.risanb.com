// Leaves and petals floating on the surface. The shadow pass moves each one away from the
// sun by the water depth beneath it, and away from the viewer by the refraction shift, so the
// shadow lands on the riverbed where the water pass shows it, not under the leaf.
uniform mat4 uViewProjection;
uniform vec3 uSun;
uniform vec2 uToward;
uniform float uRefraction;
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
  vec2 shift = uShadow > 0.5 ? -uSun.xy * (0.03 + depth * 0.7) - uToward * depth * uRefraction : vec2(0.0);
  float c = cos(aItem.z);
  float s = sin(aItem.z);
  vec2 local = corner * aItem.w;
  vec2 world = aItem.xy + shift + vec2(c * local.x - s * local.y, s * local.x + c * local.y);

  // A hair above the surface, and the shadow just under the leaf, so depth sorting keeps them apart.
  float lift = uShadow > 0.5 ? 0.001 : 0.003;
  gl_Position = uViewProjection * vec4(world, lift, 1.0);

  vLocal = corner;
  vKind = aKind;
  vSeed = fract(aItem.x * 12.9898 + aItem.y * 78.233);
}
