// The ground as a grid over the world, lifted to the baked elevation: banks stand above the
// water as a lip and rocks stand up. Vertices come from gl_VertexID, so there is no vertex buffer.
uniform mat4 uViewProjection;
uniform ivec2 uGrid; // vertices per row, rows

out vec3 vWorld;

void main() {
  vec2 cell = vec2(float(gl_VertexID % uGrid.x), float(gl_VertexID / uGrid.x));
  vec2 xy = cell / vec2(uGrid - 1) * uWorldSize;
  vWorld = vec3(xy, elevationAt(xy));
  gl_Position = uViewProjection * vec4(vWorld, 1.0);
}
