// The water surface, seen from the tilted camera: the riverbed through a moving surface, with
// refraction, caustics, light absorption, fish, foam, sun glints and sky tint. Land hides this
// pass by depth, so only the shoreline blends with the ground colour.
uniform sampler2D uGround; // mipmapped: rgb colour, a sun light
uniform sampler2D uFoam;
uniform sampler2D uNormalTile;
uniform sampler2D uCausticTile;
uniform sampler2D uRipple;
uniform sampler2D uFish; // fish seen from above, in world space
uniform vec3 uSun; // xy: unit direction to the sun in world space, z: tan of its elevation
uniform vec2 uToward; // horizontal unit direction from the scene to the viewer
uniform vec3 uViewDir; // unit direction from the water to the viewer
uniform float uRefraction; // horizontal shift of the bed per metre of depth, as seen through the surface
uniform float uTime;

in vec2 vPosition;
out vec4 outColor;

const vec3 ABSORPTION = vec3(2.0, 0.62, 0.4);
const vec3 DEEP_COLOR = vec3(0.05, 0.36, 0.52);
const vec3 SUN_COLOR = vec3(1.0, 0.95, 0.82);
const vec3 SKY_COLOR = vec3(0.62, 0.82, 0.98);

// Slope of the surface in world space from two layers of detail normals drifting with the
// current. The tile is sampled in course coordinates so the ripples stretch along the river.
vec2 detailNormal(vec2 p, vec2 current, float speed) {
  float cycle = 1.6;
  float phase0 = fract(uTime / cycle);
  float phase1 = fract(uTime / cycle + 0.5);
  float weight0 = 1.0 - abs(1.0 - 2.0 * phase0);
  float weight1 = 1.0 - abs(1.0 - 2.0 * phase1);
  vec2 shift0 = toCourse(current) * phase0 * cycle;
  vec2 shift1 = toCourse(current) * phase1 * cycle;
  vec2 q = toCourse(p);

  vec2 stretch = vec2(0.85, 1.0);
  vec2 coarse = (q * 0.55 - shift0 * 0.55) * stretch;
  vec2 coarse1 = (q * 0.55 - shift1 * 0.55) * stretch + 0.5;
  vec2 fine = (q * 1.35 - shift0 * 1.35) * stretch + 0.23;
  vec2 fine1 = (q * 1.35 - shift1 * 1.35) * stretch + 0.73;

  vec2 slopeCoarse = (texture(uNormalTile, coarse).xy - 0.5) * weight0 + (texture(uNormalTile, coarse1).xy - 0.5) * weight1;
  vec2 slopeFine = (texture(uNormalTile, fine).xy - 0.5) * weight0 + (texture(uNormalTile, fine1).xy - 0.5) * weight1;

  return fromCourse(slopeCoarse * (0.22 + speed * 0.18) + slopeFine * (0.07 + speed * 0.1));
}

float foamNoise(vec2 p, vec2 current, float stretchX) {
  float cycle = 3.0;
  float phase0 = fract(uTime / cycle);
  float phase1 = fract(uTime / cycle + 0.5);
  float weight0 = 1.0 - abs(1.0 - 2.0 * phase0);
  float weight1 = 1.0 - abs(1.0 - 2.0 * phase1);
  vec2 stretch = vec2(stretchX, 1.0);
  vec2 q = toCourse(p);
  vec2 drift = toCourse(current);
  float a = texture(uNormalTile, (q * 1.3 - drift * phase0 * cycle * 1.3) * stretch).z;
  float b = texture(uNormalTile, (q * 1.3 - drift * phase1 * cycle * 1.3) * stretch + 0.5).z;

  return a * weight0 + b * weight1;
}

// How far below the surface the refracted ray from `start` meets the ground. Coarse steps find
// the first one inside the ground, then a few halvings sharpen it, so submerged rock flanks
// are seen crisply and not smeared between the bed and the rock.
float descentToGround(vec2 start, float surfaceDepth) {
  vec2 shift = uToward * uRefraction;
  float reach = min(1.8, surfaceDepth * 1.6 + 0.3);
  float low = 0.0;
  float high = reach;
  for (int step = 1; step <= 6; step += 1) {
    float z = reach * float(step) / 6.0;
    if (z >= textureLod(uTerrain, (start - shift * z) / uWorldSize, 0.0).r) {
      high = z;
      break;
    }

    low = z;
  }

  for (int refine = 0; refine < 4; refine += 1) {
    float middle = 0.5 * (low + high);
    if (middle >= textureLod(uTerrain, (start - shift * middle) / uWorldSize, 0.0).r) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return high;
}

void main() {
  vec2 p = vPosition;
  vec2 unit = p / uWorldSize;
  vec4 terrain = texture(uTerrain, unit);
  float depth = terrain.r;

  float waterMask = smoothstep(-0.012, 0.03, depth);
  if (waterMask < 0.002) {
    discard;
  }

  vec4 ground = texture(uGround, unit);
  vec2 current = flowFrom(terrain.gb, p, uTime);
  float speed = length(current);
  float surfaceDepth = max(depth, 0.0);

  vec2 slope = detailNormal(p, current, speed);
  vec4 ripple = texture(uRipple, unit);
  slope += ripple.ba * 12.0;
  slope *= smoothstep(0.0, 0.1, surfaceDepth) * 0.9 + 0.1;

  // The camera looks down at a slant, so the bed under a surface point lies farther from the
  // viewer: follow the refracted ray down until it meets the ground, rock flanks included.
  vec2 bendPoint = p + slope * min(surfaceDepth * 0.42 + 0.02, 0.3);
  float seenDepth = descentToGround(bendPoint, surfaceDepth);

  vec2 bedPoint = bendPoint - uToward * seenDepth * uRefraction;
  vec2 bedUnit = bedPoint / uWorldSize;
  vec4 bedSample = textureLod(uGround, bedUnit, clamp(seenDepth * 1.2 - 0.05, 0.0, 2.5));
  vec3 bed = bedSample.rgb;
  float sunlit = bedSample.a;

  // Sun caustics dancing on the bed: two drifting layers, bent by the surface slope.
  float cycle = 2.4;
  float phase0 = fract(uTime / cycle);
  float phase1 = fract(uTime / cycle + 0.5);
  float weight0 = 1.0 - abs(1.0 - 2.0 * phase0);
  float weight1 = 1.0 - abs(1.0 - 2.0 * phase1);
  vec2 causticBase = bedPoint * 0.62 + slope * 0.9;
  float causticA = texture(uCausticTile, causticBase - current * phase0 * cycle * 0.62).r * weight0
    + texture(uCausticTile, causticBase - current * phase1 * cycle * 0.62 + 0.5).r * weight1;
  vec2 causticOther = bedPoint * 1.05 * mat2(0.8, 0.6, -0.6, 0.8) + slope * 0.6 + vec2(uTime * 0.045, -uTime * 0.03);
  float causticB = texture(uCausticTile, causticOther).r;
  float caustic = pow(clamp(causticA * 0.9 + causticB * 0.6, 0.0, 1.6), 1.3) * 1.2;
  float causticDepth = smoothstep(0.02, 0.2, seenDepth) * (1.0 - smoothstep(0.5, 1.4, seenDepth));
  bed += SUN_COLOR * caustic * 0.5 * causticDepth * sunlit * (0.6 + 0.4 * bed);

  // Fish shadows on the bed: offset towards the sun by the depth, softer the deeper it is.
  vec2 shadowPoint = bedPoint + uSun.xy * (0.03 + seenDepth * 0.9 / uSun.z);
  vec2 shadowUv = shadowPoint / uWorldSize;
  vec2 blur = vec2(0.04 + seenDepth * 0.1) / uWorldSize;
  float shadow = texture(uFish, shadowUv).a * 0.4
    + texture(uFish, shadowUv + vec2(blur.x, 0.0)).a * 0.15
    + texture(uFish, shadowUv - vec2(blur.x, 0.0)).a * 0.15
    + texture(uFish, shadowUv + vec2(0.0, blur.y)).a * 0.15
    + texture(uFish, shadowUv - vec2(0.0, blur.y)).a * 0.15;
  bed *= 1.0 - shadow * 0.88 * smoothstep(0.05, 0.25, seenDepth);

  // Beer-Lambert: red light dies first; a calm teal scatter takes over with depth.
  // A rock seen through the surface is hazier than its depth alone says: its flank is lit
  // and seen through a skin of foam, ripples and suspended silt.
  float seenRock = smoothstep(0.02, 0.1, textureLod(uTerrain, bedUnit, 0.0).a);
  float pathLength = seenDepth * 1.25 + 0.01 + 0.3 * seenRock;
  vec3 transmission = exp(-ABSORPTION * pathLength);
  vec3 scatter = DEEP_COLOR * (1.0 - exp(-1.5 * pathLength)) * (0.75 + 0.25 * sunlit);
  vec3 water = bed * transmission + scatter;

  // Fish, drawn a little below the surface so they bend less than the bed.
  float fishDepth = min(0.18, seenDepth * 0.6);
  vec2 fishPoint = p + slope * 0.05 - uToward * fishDepth * uRefraction;
  vec4 fish = texture(uFish, fishPoint / uWorldSize);
  vec3 fishTint = exp(-ABSORPTION * 0.2);
  vec3 fishColor = fish.rgb * fishTint + DEEP_COLOR * 0.08 * fish.a;
  water = water * (1.0 - fish.a) + fishColor;

  // Foam: a baked mask where rocks and shallows break the current, broken up by streaming noise.
  float foamBase = texture(uFoam, unit).r;
  float noise = foamNoise(p, current, 0.22);
  float broken = foamNoise(p * 2.4 + vec2(3.7, 9.1), current, 0.22);
  float pattern = noise * 0.4 + broken * 0.85;
  float speedShare = smoothstep(0.35, 0.9, speed / uChannelSpeed);
  float riffle = speedShare * smoothstep(0.7, 0.15, surfaceDepth) * 0.22;
  float foam = smoothstep(0.55, 0.8, (foamBase + riffle) * pattern * 1.35) * 0.85;
  // Break the foam into fragments, finer than the streaming noise above.
  foam *= 0.25 + 0.75 * smoothstep(0.35, 0.62, valueNoise(p * 15.0 - current * uTime * 15.0));
  foam *= smoothstep(0.0, 0.04, surfaceDepth + 0.02);

  // The current shows as sparse, thin lines and specks travelling downstream.
  // Broad, soft and short, so they read as foam lines and not as drawn strokes.
  float lines = (1.0 - smoothstep(0.0, 0.1, abs(foamNoise(p, current, 0.45) - 0.56))) * smoothstep(0.45, 0.75, foamNoise(p * 0.35 + vec2(7.3, 2.1), current, 0.45));
  float specks = smoothstep(0.84, 0.92, broken) * smoothstep(0.55, 0.85, noise);
  float streaming = (lines * 0.16 + specks * 0.5) * speedShare * smoothstep(0.1, 0.3, surfaceDepth);
  foam = max(foam, streaming);
  water = mix(water, vec3(0.94, 0.98, 0.97), foam);

  // A thin bright line where water laps the shore.
  float lap = (1.0 - smoothstep(0.0, 0.05, surfaceDepth)) * smoothstep(-0.01, 0.01, depth);
  water = mix(water, vec3(0.9, 0.97, 0.95), lap * 0.25);

  // Sky tint (Schlick's Fresnel for the real view angle) and sun glints. Ripples are steep;
  // counting half of them keeps their rings from burning out white.
  vec2 reflectedSlope = slope - ripple.ba * 6.0;
  vec3 skyNormal = normalize(vec3(-reflectedSlope * 1.6, 1.0));
  float fresnel = 0.03 + 0.97 * pow(1.0 - clamp(dot(skyNormal, uViewDir), 0.0, 1.0), 5.0);
  water *= 1.0 + 1.5 * clamp(dot(slope, uSun.xy), -0.35, 0.35);
  vec3 sky = mix(SKY_COLOR, vec3(0.9, 0.95, 1.0), 0.3);
  water = mix(water, sky, clamp(fresnel * 2.5 + 0.012, 0.0, 0.85) * (1.0 - foam * 0.5));

  vec3 light = normalize(vec3(uSun.xy, uSun.z));
  vec3 halfway = normalize(light + uViewDir);
  float alpha = 0.06;
  float ndh = max(dot(normalize(vec3(-reflectedSlope * 3.0, 1.0)), halfway), 0.0);
  float denominator = ndh * ndh * (alpha * alpha - 1.0) + 1.0;
  float glint = alpha * alpha / (3.14159 * denominator * denominator) * 0.03;
  glint = glint / (1.0 + glint / 0.65);
  water += SUN_COLOR * glint * (0.5 + 0.5 * sunlit) * smoothstep(0.0, 0.08, surfaceDepth);

  outColor = vec4(grade(mix(ground.rgb, water, waterMask)), 1.0);
}
