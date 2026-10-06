// Owns the GL context and the frame loop. world.ts, fish.ts and drift.ts decide what happens;
// this file only draws it. Static things (ground, banks, rocks, shadows) are baked once per
// layout; every frame draws the water, the fish, floating leaves and swaying grass.

import { createDrift, DRIFT_INSTANCE_FLOATS, type Drift } from './drift.ts';
import { createFishSim, FISH_INSTANCE_FLOATS, type FishSim } from './fish.ts';
import {
  bindTexture,
  createImageTexture,
  createProgram,
  createTarget,
  createTexture,
  deleteTarget,
  drawFullscreen,
  required,
  type Program,
  type Target,
} from './gl.ts';
import { attachInput, type ViewShape } from './input.ts';
import { createQualityGovernor } from './quality.ts';
import { createRipples, type Ripples } from './ripples.ts';
import { shaderSources } from './shaders/index.ts';
import { FROND_FLOATS, scatterFerns, scatterTufts, TUFT_FLOATS } from './tufts.ts';
import { CHANNEL_SPEED, createWorld, FLOW_WAVES, GUST_TERMS, type World } from './world.ts';

export interface RiverScene {
  start(): void;
  stop(): void;
  renderStill(): void;
  rippleAt(x: number, y: number, strength: number): void;
}

interface Tier {
  pixelRatioCap: number;
  fishScale: number;
  rippleCells: number;
  grassTufts: number;
  ferns: number;
  grassShadows: boolean;
}

const TIERS: Record<'high' | 'low', Tier> = {
  high: { pixelRatioCap: 1.5, fishScale: 1, rippleCells: 256, grassTufts: 4500, ferns: 24, grassShadows: true },
  low: { pixelRatioCap: 1.25, fishScale: 0.75, rippleCells: 128, grassTufts: 1500, ferns: 10, grassShadows: false },
};

const TEXTURE_URLS = {
  grass: '/river/grass.webp',
  pebbles: '/river/pebbles.webp',
  moss: '/river/moss.webp',
  rock: '/river/rock.webp',
};

const LANDSCAPE_SPAN = 7;
const PORTRAIT_SPAN = 5.2;
const WORLD_SEED = 7;
const MAX_BAKE_SIDE = 2048;
const FISH_SEGMENTS = 24;
const BLADES_PER_TUFT = 16;
const FROND_SEGMENTS = 14;
const MAX_DRIFT = 7;
const FRAME_COUNTER_EVERY = 15;

interface Layout {
  portrait: boolean;
  cssWidth: number;
  cssHeight: number;
  worldWidth: number;
  worldHeight: number;
}

function measureLayout(canvas: HTMLCanvasElement): Layout {
  const cssWidth = Math.max(1, canvas.clientWidth);
  const cssHeight = Math.max(1, canvas.clientHeight);
  const portrait = cssHeight > cssWidth * 1.02;
  const worldHeight = portrait ? PORTRAIT_SPAN : LANDSCAPE_SPAN;
  const worldWidth = portrait ? (PORTRAIT_SPAN * cssHeight) / cssWidth : (LANDSCAPE_SPAN * cssWidth) / cssHeight;

  return { portrait, cssWidth, cssHeight, worldWidth, worldHeight };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();

  return image;
}

export async function createRiverScene(canvas: HTMLCanvasElement): Promise<RiverScene> {
  const context = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!context) {
    throw new Error('river: WebGL2 is not available');
  }

  const gl: WebGL2RenderingContext = context;

  const images = await Promise.all(Object.values(TEXTURE_URLS).map(loadImage));
  const imageByName = Object.fromEntries(Object.keys(TEXTURE_URLS).map((name, index) => [name, images[index]]));

  const flowWaves = new Float32Array(12);
  FLOW_WAVES.forEach((term, index) => flowWaves.set(term, index * 4));
  const gustTerms = new Float32Array(6);
  GUST_TERMS.forEach((term, index) => gustTerms.set(term, index * 3));

  const sun = new Float32Array(3);
  const sunOnScreen = { x: -0.62, y: -0.78 };
  const sunTan = 1.8;

  let tierName: 'high' | 'low' = window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high';
  let renderScale = 1;
  let layout = measureLayout(canvas);
  let world: World = createWorld({ seed: WORLD_SEED, width: layout.worldWidth, height: layout.worldHeight });
  let fishSim: FishSim;
  let drift: Drift;

  let programs: Record<string, Program>;
  let terrainTexture: WebGLTexture;
  let foamTexture: WebGLTexture;
  let groundTarget: Target | undefined;
  let fishTarget: Target | undefined;
  let ripples: Ripples | null;
  let emptyRipple: WebGLTexture;
  let normalTile: WebGLTexture;
  let causticTile: WebGLTexture;
  let imageTextures: Record<string, WebGLTexture>;
  let fishBuffer: WebGLBuffer;
  let fishInstances: WebGLBuffer;
  let fishVao: WebGLVertexArrayObject;
  let driftInstances: WebGLBuffer;
  let driftVao: WebGLVertexArrayObject;
  let grassVao: WebGLVertexArrayObject;
  let fernVao: WebGLVertexArrayObject;
  let frondBuffer: WebGLBuffer | undefined;
  let frondCount = 0;
  let tuftBuffer: WebGLBuffer | undefined;
  let grassTuftCount = 0;
  const fishData = new Float32Array(FISH_INSTANCE_FLOATS * 24);
  const driftData = new Float32Array(DRIFT_INSTANCE_FLOATS * MAX_DRIFT);
  let canRenderFloat = false;
  let bakeWidth = 0;
  let bakeHeight = 0;

  let running = false;
  let lost = false;
  let frameHandle = 0;
  let lastNow = 0;
  let time = 0;
  let frames = 0;
  const governor = createQualityGovernor();
  let resizeTimer = 0;
  let tierChanged = false;

  function tier(): Tier {
    return TIERS[tierName];
  }

  function baseRatio(): number {
    return Math.min(window.devicePixelRatio || 1, tier().pixelRatioCap);
  }

  function updateSun() {
    const x = layout.portrait ? sunOnScreen.y : sunOnScreen.x;
    const y = layout.portrait ? sunOnScreen.x : sunOnScreen.y;
    sun[0] = x;
    sun[1] = y;
    sun[2] = sunTan;
  }

  function bindWorld(program: Program) {
    gl.uniform2f(program.uniforms.uWorldSize, world.width, world.height);
    gl.uniform1f(program.uniforms.uPortrait, layout.portrait ? 1 : 0);
    gl.uniform4fv(program.uniforms.uFlowWaves, flowWaves);
    gl.uniform3fv(program.uniforms.uGust, gustTerms);
    gl.uniform1f(program.uniforms.uChannelSpeed, CHANNEL_SPEED);
    bindTexture(gl, 0, terrainTexture);
    gl.uniform1i(program.uniforms.uTerrain, 0);
  }

  function useProgram(program: Program) {
    gl.useProgram(program.program);
    bindWorld(program);
  }

  function buildPrograms() {
    const vertex = shaderSources.fullscreenVertex;
    programs = {
      tiles: createProgram(gl, vertex, shaderSources.tiles, 'tiles'),
      bake: createProgram(gl, vertex, shaderSources.bake, 'bake'),
      ripple: createProgram(gl, vertex, shaderSources.ripple, 'ripple'),
      water: createProgram(gl, vertex, shaderSources.water, 'water'),
      fish: createProgram(gl, shaderSources.fishVertex, shaderSources.fishFragment, 'fish'),
      drift: createProgram(gl, shaderSources.driftVertex, shaderSources.driftFragment, 'drift'),
      grass: createProgram(gl, shaderSources.grassVertex, shaderSources.grassFragment, 'grass'),
      fern: createProgram(gl, shaderSources.fernVertex, shaderSources.fernFragment, 'fern'),
    };
  }

  function bakeTile(kind: number): WebGLTexture {
    const target = createTarget(gl, {
      width: 256,
      height: 256,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      repeat: true,
      mipmaps: true,
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, 256, 256);
    gl.useProgram(programs.tiles.program);
    gl.uniform1f(programs.tiles.uniforms.uKind, kind);
    drawFullscreen(gl);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(target.framebuffer);

    return target.texture;
  }

  function createGeometry() {
    const corners = new Float32Array((FISH_SEGMENTS + 1) * 4);
    for (let segment = 0; segment <= FISH_SEGMENTS; segment += 1) {
      const along = segment / FISH_SEGMENTS;
      corners.set([along, -1, along, 1], segment * 4);
    }

    fishBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, fishBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    fishInstances = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, fishInstances);
    gl.bufferData(gl.ARRAY_BUFFER, fishData.byteLength, gl.DYNAMIC_DRAW);

    fishVao = required(gl.createVertexArray(), 'vertex array');
    gl.bindVertexArray(fishVao);
    const fish = programs.fish.program;
    const cornerLocation = gl.getAttribLocation(fish, 'aCorner');
    gl.bindBuffer(gl.ARRAY_BUFFER, fishBuffer);
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
    const stride = FISH_INSTANCE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, fishInstances);
    for (const [name, offset] of [['aPose', 0], ['aState', 16], ['aExtra', 32]] as const) {
      const location = gl.getAttribLocation(fish, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    }

    driftInstances = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, driftInstances);
    gl.bufferData(gl.ARRAY_BUFFER, driftData.byteLength, gl.DYNAMIC_DRAW);
    driftVao = required(gl.createVertexArray(), 'vertex array');
    gl.bindVertexArray(driftVao);
    const driftProgram = programs.drift.program;
    const driftStride = DRIFT_INSTANCE_FLOATS * 4;
    const itemLocation = gl.getAttribLocation(driftProgram, 'aItem');
    gl.enableVertexAttribArray(itemLocation);
    gl.vertexAttribPointer(itemLocation, 4, gl.FLOAT, false, driftStride, 0);
    gl.vertexAttribDivisor(itemLocation, 1);
    const kindLocation = gl.getAttribLocation(driftProgram, 'aKind');
    gl.enableVertexAttribArray(kindLocation);
    gl.vertexAttribPointer(kindLocation, 1, gl.FLOAT, false, driftStride, 16);
    gl.vertexAttribDivisor(kindLocation, 1);

    const blades = new Float32Array(BLADES_PER_TUFT * 5 * 4);
    const indices = new Uint16Array(BLADES_PER_TUFT * 9);
    for (let blade = 0; blade < BLADES_PER_TUFT; blade += 1) {
      const bladeIndex = blade / BLADES_PER_TUFT;
      const base = blade * 5;
      blades.set(
        [bladeIndex, 0, -1, 0, bladeIndex, 0, 1, 0, bladeIndex, 0.5, -1, 0, bladeIndex, 0.5, 1, 0, bladeIndex, 1, 0, 0],
        base * 4,
      );
      indices.set([base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4], blade * 9);
    }

    grassVao = required(gl.createVertexArray(), 'vertex array');
    gl.bindVertexArray(grassVao);
    const grassProgram = programs.grass.program;
    const bladeBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, bladeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, blades, gl.STATIC_DRAW);
    const bladeLocation = gl.getAttribLocation(grassProgram, 'aBlade');
    gl.enableVertexAttribArray(bladeLocation);
    gl.vertexAttribPointer(bladeLocation, 4, gl.FLOAT, false, 0, 0);
    const indexBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const frondCorners = new Float32Array((FROND_SEGMENTS + 1) * 4);
    for (let segment = 0; segment <= FROND_SEGMENTS; segment += 1) {
      const along = segment / FROND_SEGMENTS;
      frondCorners.set([along, -1, along, 1], segment * 4);
    }

    fernVao = required(gl.createVertexArray(), 'vertex array');
    gl.bindVertexArray(fernVao);
    const frondCornerBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, frondCornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, frondCorners, gl.STATIC_DRAW);
    const frondCornerLocation = gl.getAttribLocation(programs.fern.program, 'aCorner');
    gl.enableVertexAttribArray(frondCornerLocation);
    gl.vertexAttribPointer(frondCornerLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  function uploadWorld() {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    terrainTexture = createTexture(gl, {
      width: world.columns,
      height: world.rows,
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.FLOAT,
      data: world.terrain,
    });
    foamTexture = createTexture(gl, {
      width: world.columns,
      height: world.rows,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: world.foam,
    });
  }

  function uploadTufts() {
    const tufts = scatterTufts(world, WORLD_SEED + 1, tier().grassTufts);
    grassTuftCount = tufts.length / TUFT_FLOATS;
    if (tuftBuffer) {
      gl.deleteBuffer(tuftBuffer);
    }

    tuftBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindVertexArray(grassVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, tuftBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tufts, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(programs.grass.program, 'aTuft');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, 1);

    const fronds = scatterFerns(world, WORLD_SEED + 3, tier().ferns);
    frondCount = fronds.length / FROND_FLOATS;
    if (frondBuffer) {
      gl.deleteBuffer(frondBuffer);
    }

    frondBuffer = required(gl.createBuffer(), 'buffer');
    gl.bindVertexArray(fernVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, frondBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, fronds, gl.STATIC_DRAW);
    for (const [name, offset] of [['aFrond', 0], ['aShape', 16]] as const) {
      const frondLocation = gl.getAttribLocation(programs.fern.program, name);
      gl.enableVertexAttribArray(frondLocation);
      gl.vertexAttribPointer(frondLocation, 4, gl.FLOAT, false, FROND_FLOATS * 4, offset);
      gl.vertexAttribDivisor(frondLocation, 1);
    }

    gl.bindVertexArray(null);
  }

  function bakeGround() {
    const pixelRatio = baseRatio();
    const worldPixelsLong = (layout.portrait ? layout.cssHeight : layout.cssWidth) * pixelRatio;
    const longScale = Math.min(1, MAX_BAKE_SIDE / worldPixelsLong);
    bakeWidth = Math.round((layout.portrait ? layout.cssHeight : layout.cssWidth) * pixelRatio * longScale);
    bakeHeight = Math.round((layout.portrait ? layout.cssWidth : layout.cssHeight) * pixelRatio * longScale);

    if (groundTarget) {
      deleteTarget(gl, groundTarget);
    }

    groundTarget = createTarget(gl, {
      width: bakeWidth,
      height: bakeHeight,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      mipmaps: true,
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, groundTarget.framebuffer);
    gl.viewport(0, 0, bakeWidth, bakeHeight);
    gl.disable(gl.BLEND);
    const bake = programs.bake;
    useProgram(bake);
    gl.uniform3fv(bake.uniforms.uSun, sun);
    const names = ['grass', 'pebbles', 'moss', 'rock'] as const;
    names.forEach((name, index) => {
      bindTexture(gl, 1 + index, imageTextures[name]);
    });
    gl.uniform1i(bake.uniforms.uGrass, 1);
    gl.uniform1i(bake.uniforms.uPebbles, 2);
    gl.uniform1i(bake.uniforms.uMoss, 3);
    gl.uniform1i(bake.uniforms.uRock, 4);
    drawFullscreen(gl);
    gl.bindTexture(gl.TEXTURE_2D, groundTarget.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function buildRipples() {
    ripples?.dispose();
    ripples = null;
    if (!canRenderFloat) {
      return;
    }

    const cells = tier().rippleCells;
    const long = Math.max(world.width, world.height);
    const cellSize = long / cells;
    try {
      ripples = createRipples(gl, programs.ripple, {
        width: Math.max(8, Math.round(world.width / cellSize)),
        height: Math.max(8, Math.round(world.height / cellSize)),
        bindWorld,
      });
    } catch (error) {
      console.warn('river: ripples disabled', error);
    }
  }

  function buildFishLayer() {
    if (fishTarget) {
      deleteTarget(gl, fishTarget);
    }

    fishTarget = createTarget(gl, {
      width: Math.max(2, Math.round(canvas.width * tier().fishScale)),
      height: Math.max(2, Math.round(canvas.height * tier().fishScale)),
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
    });
  }

  function buildWorldState() {
    updateSun();
    uploadWorld();
    fishSim = createFishSim(world, WORLD_SEED, { trout: 3, grayling: 2, minnows: 12 }, layout.portrait ? 0.88 : 1);
    drift = createDrift(world, WORLD_SEED + 2, MAX_DRIFT);
    uploadTufts();
    bakeGround();
    buildRipples();
  }

  function resizeBuffer(force = false): boolean {
    const pixelRatio = baseRatio() * renderScale;
    const width = Math.max(2, Math.round(layout.cssWidth * pixelRatio));
    const height = Math.max(2, Math.round(layout.cssHeight * pixelRatio));
    const changed = canvas.width !== width || canvas.height !== height;
    if (changed) {
      canvas.width = width;
      canvas.height = height;
    }

    if (changed || force) {
      buildFishLayer();
    }

    return changed;
  }

  function initGpu() {
    // Extensions switch off with a lost context, so ask for them again on every init.
    canRenderFloat = Boolean(gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float'));
    buildPrograms();
    createGeometry();
    imageTextures = Object.fromEntries(
      Object.keys(TEXTURE_URLS).map((name) => [name, createImageTexture(gl, imageByName[name])]),
    );
    emptyRipple = createTexture(gl, {
      width: 1,
      height: 1,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(4),
    });
    gl.bindVertexArray(null);
    normalTile = bakeTile(0);
    causticTile = bakeTile(1);
    resizeBuffer(true);
    buildWorldState();
  }

  function drawFish() {
    const count = fishSim.pack(fishData);
    const target = required(fishTarget, 'fish layer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    useProgram(programs.fish);
    gl.bindVertexArray(fishVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fishInstances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fishData, 0, count * FISH_INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (FISH_SEGMENTS + 1) * 2, count);
    gl.bindVertexArray(null);
  }

  function drawWater() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    const water = programs.water;
    useProgram(water);
    bindTexture(gl, 1, required(groundTarget, 'ground').texture);
    bindTexture(gl, 2, foamTexture);
    bindTexture(gl, 3, normalTile);
    bindTexture(gl, 4, causticTile);
    bindTexture(gl, 5, ripples ? ripples.texture() : emptyRipple);
    bindTexture(gl, 6, required(fishTarget, 'fish layer').texture);
    gl.uniform1i(water.uniforms.uGround, 1);
    gl.uniform1i(water.uniforms.uFoam, 2);
    gl.uniform1i(water.uniforms.uNormalTile, 3);
    gl.uniform1i(water.uniforms.uCausticTile, 4);
    gl.uniform1i(water.uniforms.uRipple, 5);
    gl.uniform1i(water.uniforms.uFish, 6);
    gl.uniform3fv(water.uniforms.uSun, sun);
    gl.uniform2f(water.uniforms.uRes, canvas.width, canvas.height);
    gl.uniform1f(water.uniforms.uTime, time);
    drawFullscreen(gl);
  }

  function drawDrift() {
    const count = drift.pack(driftData);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(driftVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, driftInstances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, driftData, 0, count * DRIFT_INSTANCE_FLOATS);
    const program = programs.drift;
    useProgram(program);
    gl.uniform3fv(program.uniforms.uSun, sun);
    gl.uniform1f(program.uniforms.uShadow, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.uniform1f(program.uniforms.uShadow, 0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);

    gl.bindVertexArray(null);
  }

  function drawGrass() {
    const program = programs.grass;
    useProgram(program);
    bindTexture(gl, 1, required(groundTarget, 'ground').texture);
    gl.uniform1i(program.uniforms.uGround, 1);
    gl.uniform3fv(program.uniforms.uSun, sun);
    gl.uniform1f(program.uniforms.uTime, time);
    gl.bindVertexArray(grassVao);
    if (tier().grassShadows) {
      gl.uniform1f(program.uniforms.uShadow, 1);
      gl.drawElementsInstanced(gl.TRIANGLES, BLADES_PER_TUFT * 9, gl.UNSIGNED_SHORT, 0, grassTuftCount);
    }

    gl.uniform1f(program.uniforms.uShadow, 0);
    gl.drawElementsInstanced(gl.TRIANGLES, BLADES_PER_TUFT * 9, gl.UNSIGNED_SHORT, 0, grassTuftCount);

    const fern = programs.fern;
    useProgram(fern);
    gl.uniform3fv(fern.uniforms.uSun, sun);
    gl.uniform1f(fern.uniforms.uTime, time);
    gl.bindVertexArray(fernVao);
    if (tier().grassShadows) {
      gl.uniform1f(fern.uniforms.uShadow, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (FROND_SEGMENTS + 1) * 2, frondCount);
    }

    gl.uniform1f(fern.uniforms.uShadow, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (FROND_SEGMENTS + 1) * 2, frondCount);
    gl.bindVertexArray(null);
  }

  function renderFrame(dt: number) {
    ripples?.step(dt, time);
    drawFish();
    drawWater();
    drawDrift();
    drawGrass();
    frames += 1;
    if (frames % FRAME_COUNTER_EVERY === 0 || !running) {
      canvas.dataset.frames = String(frames);
    }
  }

  function adapt(frameMs: number, now: number) {
    const action = governor.record(frameMs, now, renderScale < 1);
    if (action === 'hold') {
      return;
    }

    if (action === 'improve') {
      renderScale = Math.min(1, renderScale + 0.15);
      resizeBuffer();
      governor.restart(now);

      return;
    }

    if (renderScale > 0.61) {
      renderScale = Math.max(0.6, renderScale - 0.15);
      resizeBuffer();
    } else if (tierName === 'high') {
      tierName = 'low';
      scheduleRelayout(true);
    }

    governor.restart(now);
  }

  function loop(now: number) {
    if (!running) {
      return;
    }

    const frameMs = lastNow === 0 ? 16 : now - lastNow;
    const dt = Math.min(frameMs / 1000, 0.05);
    lastNow = now;
    time += dt;
    fishSim.update(dt);
    drift.update(dt, time);
    renderFrame(dt);
    adapt(frameMs, now);
    frameHandle = requestAnimationFrame(loop);
  }

  function relayout() {
    if (lost) {
      return;
    }

    const next = measureLayout(canvas);
    const previousAspect = layout.worldWidth / layout.worldHeight;
    const nextAspect = next.worldWidth / next.worldHeight;
    const worldChanged = next.portrait !== layout.portrait || Math.abs(nextAspect / previousAspect - 1) > 0.1;
    const pixelRatio = baseRatio();
    const wantedBakeWidth = (next.portrait ? next.cssHeight : next.cssWidth) * pixelRatio;
    const bakeChanged = Math.abs(wantedBakeWidth / Math.max(bakeWidth, 1) - 1) > 0.1 && bakeWidth < MAX_BAKE_SIDE;
    layout = next;
    const bufferChanged = resizeBuffer(tierChanged);

    if (worldChanged) {
      world = createWorld({ seed: WORLD_SEED, width: layout.worldWidth, height: layout.worldHeight });
      gl.deleteTexture(terrainTexture);
      gl.deleteTexture(foamTexture);
      buildWorldState();
    } else if (bakeChanged || tierChanged) {
      updateSun();
      bakeGround();
      buildRipples();
      if (tierChanged) {
        uploadTufts();
      }
    }

    const redrawNeeded = worldChanged || bakeChanged || tierChanged || bufferChanged;
    tierChanged = false;
    if (redrawNeeded && !running) {
      renderFrame(0);
    }
  }

  function scheduleRelayout(immediate = false) {
    if (immediate) {
      tierChanged = true;
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, immediate ? 0 : 200);
  }

  const observer = new ResizeObserver(() => {
    if (!lost) {
      scheduleRelayout();
    }
  });
  observer.observe(canvas);

  // A media query on the current ratio fires once when the window moves to another screen.
  function onDprChange() {
    scheduleRelayout();
    watchDpr();
  }

  function watchDpr() {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener('change', onDprChange, { once: true });
  }

  watchDpr();

  attachInput(
    canvas,
    (): ViewShape => ({ worldWidth: world.width, worldHeight: world.height, portrait: layout.portrait }),
    (x, y, strength) => scene.rippleAt(x, y, strength),
  );

  function onContextLost(event: Event) {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frameHandle);
  }

  function onContextRestored() {
    // Handles from the lost context are dead; forget them instead of deleting them.
    groundTarget = undefined;
    fishTarget = undefined;
    tuftBuffer = undefined;
    frondBuffer = undefined;
    ripples = null;
    lost = false;
    initGpu();
    if (running) {
      lastNow = 0;
      frameHandle = requestAnimationFrame(loop);
    } else {
      renderFrame(0);
    }
  }

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  initGpu();

  const scene: RiverScene = {
    start() {
      if (running || lost) {
        return;
      }

      running = true;
      lastNow = 0;
      governor.restart(performance.now());
      frameHandle = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameHandle);
      canvas.dataset.frames = String(frames);
    },
    renderStill() {
      if (!lost) {
        renderFrame(0);
      }
    },
    rippleAt(x, y, strength) {
      ripples?.addImpulse(x, y, strength * 0.6, 0.15 + strength * 0.05);
      fishSim.startle(x, y);
    },
  };

  return scene;
}
