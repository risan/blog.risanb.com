// The current at a world point and time: the baked base flow, a slow overall surge, and
// travelling cross-stream waves. world.ts defines the same terms (FLOW_WAVES, GUST_TERMS).
uniform sampler2D uTerrain; // depth, flow x, flow y, rock height
uniform vec4 uFlowWaves[3]; // wavenumber, angular speed, amplitude, phase
uniform vec3 uGust[2]; // amplitude, angular speed, phase
uniform float uChannelSpeed;

float gustAt(float t) {
  float gust = 1.0;
  for (int index = 0; index < 2; index += 1) {
    gust += uGust[index].x * sin(uGust[index].y * t + uGust[index].z);
  }

  return gust;
}

vec2 flowFrom(vec2 base, vec2 p, float t) {
  float speed = length(base);
  if (speed < 1e-4) {
    return vec2(0.0);
  }

  float wave = 0.0;
  for (int index = 0; index < 3; index += 1) {
    vec4 term = uFlowWaves[index];
    wave += term.z * sin(term.x * p.x - term.y * t + term.w);
  }

  float share = min(1.0, speed / uChannelSpeed) * wave;

  return base * gustAt(t) + vec2(-base.y, base.x) / speed * share;
}
