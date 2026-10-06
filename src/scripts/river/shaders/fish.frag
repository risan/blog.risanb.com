// Paints one fish in body coordinates: u runs 0 (snout) to 1 (tail tip), y is the sideways
// offset in body lengths. Output is premultiplied so fins can be translucent.
in vec2 vBody;
flat in float vSpecies;
flat in float vId;
flat in float vPhase;
flat in float vTurn;

out vec4 outColor;

const float HALF_WIDTH = 0.34;

struct Species {
  float maxWidth;
  float peak;
  float peduncle;
  float tailSpan;
  float fork;
};

vec4 over(vec4 top, vec4 bottom) {
  return top + bottom * (1.0 - top.a);
}

float bodyHalfWidth(float u, Species s) {
  float head = pow(clamp(u / 0.17, 0.0, 1.0), 0.55);
  float taper = mix(1.0, s.peduncle / s.maxWidth, smoothstep(s.peak, 0.88, u));

  return s.maxWidth * head * taper;
}

float ellipse(vec2 q, vec2 radii, float soft) {
  float e = length(q / radii);

  return 1.0 - smoothstep(1.0 - soft, 1.0, e);
}

float spots(vec2 g, float scale, float radius, float density, float seed) {
  vec2 cell = floor(g * scale);
  vec2 random = hash22(cell + seed);
  vec2 centre = cell + 0.25 + 0.5 * random;
  float present = step(hash12(cell + seed + 7.7), density);
  float d = length(g * scale - centre);

  return present * smoothstep(radius, radius * 0.2, d);
}

void main() {
  float u = vBody.x;
  float y = vBody.y * HALF_WIDTH;
  float ay = abs(y);
  float flank = sign(y);
  int kind = int(vSpecies + 0.5);

  Species species = Species(0.1, 0.5, 0.024, 0.125, 0.045);
  if (kind == 1) {
    species = Species(0.1, 0.46, 0.026, 0.15, 0.1);
  } else if (kind == 2) {
    species = Species(0.078, 0.44, 0.024, 0.1, 0.05);
  }

  float aa = fwidth(y) * 1.1 + 1e-4;
  float aaU = fwidth(u) * 1.1 + 1e-4;
  float w = bodyHalfWidth(u, species);
  float flutter = 0.85 + 0.15 * sin(vPhase * 0.6 + vId * 3.1);

  // --- fins behind the body (translucent) ---
  vec3 finColor = vec3(0.78, 0.62, 0.38);
  if (kind == 1) {
    finColor = vec3(0.5, 0.5, 0.54);
  } else if (kind == 2) {
    finColor = vec3(0.82, 0.7, 0.45);
  }

  vec4 result = vec4(0.0);

  float rootY = bodyHalfWidth(0.23, species) * 0.85;
  float pectoralU = u - 0.30 - 0.45 * (ay - rootY - 0.04);
  float pectoral = ellipse(vec2(pectoralU, (ay - rootY - 0.042) / flutter), vec2(0.07, 0.05), 0.35);
  pectoral *= step(0.0, u);
  float pelvicRoot = bodyHalfWidth(0.5, species) * 0.7;
  float pelvicU = u - 0.54 - 0.4 * (ay - pelvicRoot - 0.02);
  float pelvic = ellipse(vec2(pelvicU, (ay - pelvicRoot - 0.022) / flutter), vec2(0.04, 0.028), 0.4);
  float fins = max(pectoral, pelvic * 0.9);
  result = over(result, vec4(finColor * 0.85, 0.62) * fins);

  float finStart = 0.84;
  if (u > finStart) {
    float grow = pow(smoothstep(finStart, 1.0, u), 0.75);
    float span = mix(species.peduncle * 0.9, species.tailSpan, grow);
    float edge = 1.0 - species.fork * (1.0 - clamp(ay / species.tailSpan, 0.0, 1.0));
    float tailAlpha = smoothstep(-aa, aa, span - ay) * smoothstep(-aaU, aaU, edge - u);
    float rays = 0.92 + 0.08 * sin(ay * 520.0 / max(u, 0.5));
    vec3 tailColor = finColor * rays;
    result = over(result, vec4(tailColor * 0.9, kind == 1 ? 0.9 : 0.78) * tailAlpha * smoothstep(0.82, 0.9, u));
  }

  // --- body ---
  float bodyAlpha = smoothstep(-aa, aa, w - ay) * (1.0 - smoothstep(0.86, 0.9, u));
  float t = clamp(ay / max(w, 1e-3), 0.0, 1.0);
  float roundness = sqrt(max(1.0 - t * t, 0.0));

  vec3 back;
  vec3 side;
  vec3 rim;
  if (kind == 0) {
    back = vec3(0.12, 0.12, 0.05);
    side = vec3(0.7, 0.56, 0.2);
    rim = vec3(0.95, 0.86, 0.56);
  } else if (kind == 1) {
    back = vec3(0.24, 0.27, 0.19);
    side = vec3(0.7, 0.72, 0.67);
    rim = vec3(0.9, 0.9, 0.85);
  } else {
    back = vec3(0.3, 0.28, 0.1);
    side = vec3(0.74, 0.72, 0.5);
    rim = vec3(0.92, 0.92, 0.82);
  }

  vec3 body = mix(back, side, smoothstep(0.12, 0.6, t));
  body = mix(body, rim, smoothstep(0.68, 0.98, t));

  vec2 g = vec2(u, y);
  float spotZone = smoothstep(0.17, 0.26, u) * (1.0 - smoothstep(0.74, 0.86, u)) * smoothstep(0.12, 0.45, t);
  if (kind == 0) {
    float dark = spots(g, 26.0, 0.3, 0.5, vId * 3.0) * spotZone;
    body = mix(body, vec3(0.07, 0.05, 0.04), dark * 0.85);
    vec2 redGrid = g + vec2(0.013, 0.01);
    float redDot = spots(redGrid, 15.0, 0.34, 0.3, vId * 5.0 + 1.0) * spotZone * smoothstep(0.35, 0.6, t);
    float halo = spots(redGrid, 15.0, 0.52, 0.3, vId * 5.0 + 1.0) * spotZone * smoothstep(0.35, 0.6, t);
    body = mix(body, vec3(0.74, 0.82, 0.88), halo * 0.55);
    body = mix(body, vec3(0.86, 0.2, 0.08), redDot);
  } else if (kind == 1) {
    float dark = spots(g, 20.0, 0.28, 0.4, vId * 3.0) * spotZone * (1.0 - smoothstep(0.4, 0.62, u));
    body = mix(body, vec3(0.2, 0.19, 0.22), dark * 0.5);
  } else {
    float stripe = smoothstep(0.35, 0.5, t) * (1.0 - smoothstep(0.55, 0.72, t));
    body = mix(body, vec3(0.12, 0.1, 0.05), stripe * 0.8 * smoothstep(0.2, 0.3, u));
  }

  float lateralLine = (1.0 - smoothstep(0.0, 0.05, abs(t - 0.52))) * smoothstep(0.2, 0.3, u) * (1.0 - smoothstep(0.78, 0.86, u));
  body = mix(body, rim, lateralLine * 0.22);

  float shade = 0.56 + 0.58 * roundness;
  float sheen = pow(roundness, 26.0) * 0.14;
  body = body * shade + vec3(1.0, 0.97, 0.88) * sheen;
  body *= mix(0.72, 1.0, smoothstep(0.04, 0.2, u));
  body *= 1.0 - 0.25 * smoothstep(0.88, 1.0, t);

  float eyeU = 0.085;
  float eyeReach = bodyHalfWidth(eyeU, species) * 0.62;
  float eye = ellipse(vec2(u - eyeU, ay - eyeReach), vec2(0.0085), 0.8);
  body = mix(body, vec3(0.08, 0.07, 0.06), eye * 0.8);

  result = over(vec4(body, 1.0) * bodyAlpha, result);

  // --- dorsal fins over the back ---
  if (kind == 1) {
    float lean = vId < 0.5 ? 1.0 : (fract(vId * 0.5) < 0.5 ? 1.0 : -1.0);
    float sailU = (u - 0.29) / 0.36;
    float rise = pow(clamp(sailU, 0.0, 1.0), 0.6) * (1.0 - 0.35 * smoothstep(0.7, 1.0, sailU));
    // Mostly folded flat along the back; now and then the fish raises it.
    float raised = smoothstep(0.8, 1.0, sin(vPhase * 0.06 + vId * 9.0));
    float reach = mix(0.016, 0.11, raised) * pow(max(sin(3.14159 * pow(clamp(sailU, 0.0, 1.0), 0.8)), 0.0), 0.5) * (0.55 + 0.45 * rise);
    float across = y * lean;
    float sail = smoothstep(-aa, aa, across + 0.006) * smoothstep(-aa, aa, reach - across) * step(0.0, sailU) * step(sailU, 1.0);
    float rays = mix(1.0, 0.93 + 0.07 * sin(sailU * 45.0), raised);
    float fade = pow(max(sin(3.14159 * clamp(sailU, 0.0, 1.0)), 0.0), 0.7);
    vec2 sailGrid = vec2(sailU * 4.0, across * 14.0);
    float sailSpots = spots(sailGrid, 1.0, 0.3, 0.3, vId + 2.0) * raised;
    vec3 folded = vec3(0.3, 0.28, 0.36);
    vec3 sailColor = mix(folded, mix(vec3(0.4, 0.38, 0.48), vec3(0.66, 0.46, 0.6), smoothstep(0.72, 1.0, across / max(reach, 0.01))), raised);
    sailColor = mix(sailColor, vec3(0.14, 0.12, 0.2), sailSpots * 0.8) * rays;
    result = over(vec4(sailColor, mix(0.4, 0.42, raised) * fade) * sail, result);
  } else {
    float dorsalU = kind == 0 ? 0.46 : 0.45;
    float dorsal = ellipse(vec2(u - dorsalU, y - 0.012 * (kind == 0 ? 1.0 : 0.6)), vec2(0.045, 0.024), 0.5);
    vec3 dorsalColor = kind == 0 ? vec3(0.45, 0.38, 0.2) : vec3(0.55, 0.5, 0.3);
    result = over(vec4(dorsalColor, 0.65) * dorsal, result);
  }

  outColor = result;
}
