// One quad over the whole world at the water surface (z = 0). Land hides it by depth.
uniform mat4 uViewProjection;

out vec2 vPosition;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vPosition = corner * uWorldSize;
  gl_Position = uViewProjection * vec4(vPosition, 0.0, 1.0);
}
