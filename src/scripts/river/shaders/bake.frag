// Everything that never moves, drawn once per layout: grass, pebble shore, riverbed, mossy
// boulders lit from a height field, flowers and the soft sun shadows of the rocks.
// Output: rgb colour as seen from above, a = how lit the point is (1 sunlit, 0 shadowed).
uniform sampler2D uGrass;
uniform sampler2D uPebbles;
uniform sampler2D uMoss;
uniform sampler2D uRock;
uniform vec3 uSun; // xy: unit direction to the sun in world space, z: tan of its elevation

in vec2 vUv;
out vec4 outColor;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float rockHeightAt(vec2 p) {
  return texture(uTerrain, p / uWorldSize).a;
}

// The height grid is coarse; averaging four taps keeps boulder edges from showing its steps.
float smoothRockHeight(vec2 p) {
  vec2 reach = 0.7 * uWorldSize / vec2(textureSize(uTerrain, 0));

  return 0.25 * (rockHeightAt(p + reach) + rockHeightAt(p - reach)
    + rockHeightAt(p + vec2(reach.x, -reach.y)) + rockHeightAt(p + vec2(-reach.x, reach.y)));
}

float sunLight(vec2 p, float ownHeight) {
  float lit = 1.0;
  for (int step = 1; step <= 14; step += 1) {
    float distance = float(step) * 0.055;
    float ray = ownHeight + distance * uSun.z;
    float blocker = rockHeightAt(p + uSun.xy * distance);
    lit = min(lit, clamp((ray - blocker) / (0.08 + distance * 0.6) + 0.35, 0.0, 1.0));
  }

  return lit;
}

float nearbyRock(vec2 p) {
  float sum = 0.0;
  for (int tap = 0; tap < 8; tap += 1) {
    float angle = float(tap) * 0.7854;
    sum += rockHeightAt(p + vec2(cos(angle), sin(angle)) * 0.22);
  }

  return sum * 0.125;
}

vec3 grassColor(vec2 p, float inland, float big, float mid) {
  vec3 detailA = texture(uGrass, p * 0.55).rgb;
  vec3 detailB = texture(uGrass, p * 1.9 + vec2(0.37, 0.61)).rgb;
  float detail = luma(mix(detailA, detailB, 0.5));
  float blades = valueNoise(p * vec2(34.0, 22.0)) * 0.5 + valueNoise(p * vec2(13.0, 9.0)) * 0.5;

  vec3 shade = vec3(0.15, 0.33, 0.09);
  vec3 body = vec3(0.36, 0.56, 0.14);
  vec3 sunlit = vec3(0.68, 0.79, 0.27);
  vec3 dry = vec3(0.76, 0.76, 0.36);

  float tone = clamp(0.28 + (detail - 0.34) * 2.2 + (blades - 0.5) * 0.9 + (big - 0.5) * 0.9, 0.0, 1.0);
  vec3 color = mix(shade, body, smoothstep(0.1, 0.55, tone));
  color = mix(color, sunlit, smoothstep(0.5, 0.95, tone));
  color = mix(color, dry, smoothstep(0.62, 0.86, mid) * 0.35 * smoothstep(1.0, 2.2, inland));
  // Damp, deeper green hugging the shore.
  color = mix(color * vec3(0.86, 0.95, 0.86), color, smoothstep(0.2, 1.1, inland));

  return color;
}

vec3 pebbleColor(vec2 p, float scale) {
  vec3 coarse = texture(uPebbles, p * 0.9 * scale).rgb;
  vec3 fine = texture(uPebbles, p * 3.1 * scale + vec2(0.31, 0.77)).rgb;
  vec3 pebbles = mix(coarse, fine, 0.45);
  float l = luma(pebbles);
  float contrast = (l - 0.4) * 1.7 + 0.42;

  return mix(vec3(contrast), pebbles * 1.25, 0.3);
}

void main() {
  vec2 p = vUv * uWorldSize;
  vec4 terrain = texture(uTerrain, vUv);
  float depth = terrain.r;
  float height = smoothRockHeight(p);
  float inland = -depth;

  float big = fbm(p * 0.45);
  float mid = valueNoise(p * 2.3 + 4.0);

  vec3 warm = vec3(1.0, 0.94, 0.8);
  vec3 pebbles = pebbleColor(p, 1.0);
  // Dry pebbles are light and warm; the wet band at the water's edge is darker and cooler.
  vec3 shore = mix(pebbles * 1.25, vec3(0.86, 0.8, 0.68) * (0.6 + luma(pebbles) * 1.0), 0.55) * warm * vec3(1.0, 0.97, 0.9);
  vec3 wetShore = shore * vec3(0.74, 0.68, 0.58);

  // Under water the stones turn greener and darker with depth; the water pass tints the rest.
  float algae = smoothstep(0.35, 0.8, fbm(p * 1.1 + 9.0));
  vec3 stones = pebbleColor(p, 1.25) * vec3(0.95, 0.95, 0.9);
  vec3 bed = mix(stones, vec3(0.30, 0.36, 0.20) * (0.6 + luma(stones)), algae * 0.45);
  bed = mix(shore * 0.9, bed, smoothstep(0.02, 0.45, depth));

  // Beaches come and go along the bank: none in places, wide in others.
  float beach = smoothstep(0.5, 0.64, fbm(p * 0.3 + 5.0));
  float shoreWidth = 0.95 * beach * (0.7 + 0.5 * mid);
  float grassMix = smoothstep(shoreWidth * 0.6, shoreWidth * 0.6 + 0.1 + 0.4 * beach, inland + (mid - 0.5) * 0.12);
  float wetness = (1.0 - smoothstep(0.0, 0.3, inland)) * (0.35 + 0.65 * beach);
  vec3 lawn = grassColor(p, inland, big, mid) * (1.0 - 0.16 * wetness);
  vec3 bank = mix(mix(shore, wetShore, wetness), lawn, grassMix);

  // Flowers scattered on the grass.
  vec2 flowerCell = floor(p * 6.5);
  vec2 flowerRandom = hash22(flowerCell);
  vec2 flowerAt = (flowerCell + 0.2 + 0.6 * flowerRandom) / 6.5;
  vec2 offset = p - flowerAt;
  float petalAngle = atan(offset.y, offset.x);
  float petalReach = 0.05 * (0.78 + 0.22 * cos(petalAngle * 5.0));
  float flowerChance = step(hash12(flowerCell + 5.3), 0.13 * smoothstep(0.3, 0.7, big));
  float flowerBody = flowerChance * (1.0 - smoothstep(petalReach * 0.75, petalReach, length(offset)));
  float tint = hash12(flowerCell + 11.0);
  vec3 petal = tint < 0.5 ? vec3(0.98, 0.96, 0.92) : (tint < 0.8 ? vec3(0.97, 0.66, 0.78) : vec3(0.98, 0.86, 0.34));
  vec3 flowerColor = mix(petal, vec3(0.96, 0.78, 0.2), 1.0 - smoothstep(0.0, 0.015, length(offset)));
  bank = mix(bank, flowerColor, flowerBody * grassMix);

  vec3 ground = mix(bank, bed, smoothstep(-0.015, 0.03, depth));

  // Contact darkening where boulders sit on the ground.
  float crowding = nearbyRock(p);
  ground *= 1.0 - 0.4 * smoothstep(0.0, 0.2, crowding) * (1.0 - smoothstep(0.0, 0.03, height));

  float lit = sunLight(p, height);
  vec3 color = ground;

  if (height > 0.003) {
    vec2 texel = 1.5 / vec2(textureSize(uTerrain, 0));
    vec2 worldTexel = texel * uWorldSize;
    float dx = (smoothRockHeight(p + vec2(worldTexel.x, 0.0)) - smoothRockHeight(p - vec2(worldTexel.x, 0.0))) / (2.0 * worldTexel.x);
    float dy = (smoothRockHeight(p + vec2(0.0, worldTexel.y)) - smoothRockHeight(p - vec2(0.0, worldTexel.y))) / (2.0 * worldTexel.y);

    vec2 rockUv = p * 1.15;
    float bump = luma(texture(uRock, rockUv).rgb);
    float bumpX = luma(texture(uRock, rockUv + vec2(0.002, 0.0)).rgb);
    float bumpY = luma(texture(uRock, rockUv + vec2(0.0, 0.002)).rgb);
    vec3 normal = normalize(vec3(-dx * 0.7 - (bumpX - bump) * 5.0, -dy * 0.7 - (bumpY - bump) * 5.0, 1.0));

    // Two scales blended by noise, so the dark crack and patches of the photos never repeat visibly.
    float scaleMix = smoothstep(0.3, 0.7, valueNoise(p * 1.3 + 2.0));
    vec3 stone = mix(texture(uRock, rockUv).rgb, texture(uRock, rockUv * 0.37 + vec2(0.41, 0.73)).rgb, scaleMix);
    stone = mix(vec3(luma(stone)), stone, 0.55) * vec3(1.2, 1.17, 1.1);
    stone = (stone - 0.4) * 1.2 + 0.4;
    vec3 lichen = mix(texture(uMoss, p * 1.7).rgb, texture(uMoss, p * 0.61 + vec2(0.29, 0.53)).rgb, 1.0 - scaleMix);
    lichen = mix(vec3(luma(lichen)), lichen, 1.5) * vec3(0.85, 1.05, 0.62);
    float greenness = clamp((lichen.g - lichen.b) * 4.0, 0.0, 1.0);
    float mossy = smoothstep(0.5, 0.72, normal.z * 0.4 + fbm(p * 4.2) * 0.8 + greenness * 0.15 - 0.3) * 0.85;
    vec3 albedo = mix(stone, lichen, mossy);

    // A dark wet band where the rock meets the water line.
    float splash = 1.0 - smoothstep(0.0, 0.09, abs(depth + 0.03));
    albedo *= 1.0 - 0.32 * splash;

    vec3 light = normalize(vec3(uSun.xy, uSun.z));
    float diffuse = clamp((dot(normal, light) + 0.25) / 1.25, 0.0, 1.0);
    vec3 ambient = vec3(0.3, 0.37, 0.5) * (0.45 + 0.55 * normal.z);
    vec3 rockColor = albedo * (ambient + vec3(1.02, 0.95, 0.82) * diffuse * 1.0 * mix(0.4, 1.0, lit));
    vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
    rockColor += vec3(1.0, 0.96, 0.85) * pow(max(dot(normal, halfway), 0.0), 20.0) * 0.1 * (1.0 - mossy * 0.6);
    // Ambient occlusion where the rock meets the ground, and in its steep flanks.
    rockColor *= mix(0.8, 1.0, smoothstep(0.0, 0.1, height)) * mix(0.88, 1.0, smoothstep(0.35, 0.9, normal.z));

    // Seen through water a rock is darker and browner than in the air.
    rockColor *= mix(1.0, 0.5, smoothstep(0.0, 0.15, depth));

    float rockEdge = smoothstep(0.003, 0.03, height);
    color = mix(ground, rockColor, rockEdge);
  }

  float shadowAmount = (1.0 - lit) * (1.0 - smoothstep(0.003, 0.03, height));
  // Shadows on the riverbed look softer and weaker through the water.
  color *= mix(vec3(1.0), vec3(0.46, 0.58, 0.76), shadowAmount * (1.0 - 0.4 * smoothstep(0.0, 0.3, depth)));

  outColor = vec4(color, mix(lit, 1.0, smoothstep(0.003, 0.03, height)));
}
