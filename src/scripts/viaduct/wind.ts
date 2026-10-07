// Wind for the instanced trees and bushes, done in their vertex shaders so the CPU only sets one
// time uniform per frame. Gusts roll across the valley as slow waves. Each tree leans downwind with
// a bend that grows with the square of its height, so the foot never moves; its leaf cards also
// flutter, and their lighting normals tilt with it. At the default view the sway is under a pixel,
// and the shimmer of the cards is what shows the wind from far away.

import { ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three';

// Seconds on the scene clock. Every wind material shares this one object, so one assignment per
// frame moves them all.
export const windTime = { value: 0 };

export interface WindSettings {
  // Height of the reference tree in its own units, which the bend is measured against.
  height: number;
  // How far the crown top leans in a full gust, in metres of a full-size tree.
  sway: number;
  // Radians per second of the swaying to and fro.
  speed: number;
  // How far a leaf card wobbles, in the tree's own units. Zero for bare wood.
  flutter: number;
  // How far the lighting normal of a leaf card tilts, as a share of a unit.
  shimmer: number;
}

const WIND_COMMON = /* glsl */ `
uniform float uWindTime;
uniform float uWindHeight;
uniform float uWindSway;
uniform float uWindSpeed;
uniform float uWindFlutter;
uniform float uWindShimmer;

const vec2 WIND_DIRECTION = vec2(0.87, 0.5);

// Three slow waves of different pace and length travelling down the valley: the sum never repeats
// at a glance, and never drops to dead calm.
float windGust(vec2 ground) {
  float along = dot(ground, WIND_DIRECTION);
  float across = dot(ground, vec2(-WIND_DIRECTION.y, WIND_DIRECTION.x));
  float slow = sin(along * 0.031 - uWindTime * 0.42 + across * 0.012);
  float middle = sin(along * 0.057 - uWindTime * 0.77 + across * 0.027 + 2.1);
  float quick = sin(along * 0.11 - uWindTime * 1.4 - across * 0.05 + 4.2);

  return 0.6 + 0.22 * slow + 0.12 * middle + 0.06 * quick;
}

vec2 windTreeBase() {
  return (modelMatrix * instanceMatrix[3]).xz;
}

vec3 windWobble(vec3 point, float frequency, float pace) {
  float phase = dot(point, vec3(1.7, 2.3, 1.3)) * frequency;

  return vec3(
    sin(uWindTime * 5.3 * pace + phase),
    0.6 * sin(uWindTime * 4.1 * pace + phase * 1.7 + 1.0),
    cos(uWindTime * 6.1 * pace + phase * 0.8)
  );
}
`;

const WIND_NORMAL = /* glsl */ `
objectNormal += windWobble(position, 3.0, 0.9) * uWindShimmer * windGust(windTreeBase());
`;

const WIND_VERTEX = /* glsl */ `
vec2 windBase = windTreeBase();
float windStrength = windGust(windBase);
transformed += windWobble(position, 0.5, 1.0) * uWindFlutter * windStrength;
float windBend = pow(clamp(position.y / uWindHeight, 0.0, 1.2), 2.0);
float windPhase = dot(windBase, vec2(0.7, 0.45));
float windLean = 0.6 + 0.4 * sin(uWindTime * uWindSpeed + windPhase);
float windSide = sin(uWindTime * uWindSpeed * 0.73 + windPhase * 1.3);
vec2 windAcross = vec2(-WIND_DIRECTION.y, WIND_DIRECTION.x);
vec2 windSway = (WIND_DIRECTION * windLean + windAcross * windSide * 0.3) * windBend * uWindSway * windStrength * length(instanceMatrix[1].xyz);
vec3 windOffset = vec3(windSway.x, 0.0, windSway.y);
`;

// The sway moves points after the instance matrix, in scene space, so it blows the same way for
// every tree whichever way the tree itself faces. Shadow lookups need the moved position too.
const PROJECT_VERTEX = ShaderChunk.project_vertex.replace('mvPosition = instanceMatrix * mvPosition;', 'mvPosition = instanceMatrix * mvPosition;\nmvPosition.xyz += windOffset;');
const WORLD_POSITION = ShaderChunk.worldpos_vertex.replace('worldPosition = instanceMatrix * worldPosition;', 'worldPosition = instanceMatrix * worldPosition;\nworldPosition.xyz += windOffset;');

// For the vertex shader of a material or depth material on an instanced mesh.
export function applyWind(shader: WebGLProgramParametersWithUniforms, settings: WindSettings) {
  shader.uniforms.uWindTime = windTime;
  shader.uniforms.uWindHeight = { value: settings.height };
  shader.uniforms.uWindSway = { value: settings.sway };
  shader.uniforms.uWindSpeed = { value: settings.speed };
  shader.uniforms.uWindFlutter = { value: settings.flutter };
  shader.uniforms.uWindShimmer = { value: settings.shimmer };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_COMMON}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${WIND_NORMAL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX}`)
    .replace('#include <worldpos_vertex>', WORLD_POSITION)
    .replace('#include <project_vertex>', PROJECT_VERTEX);
}
