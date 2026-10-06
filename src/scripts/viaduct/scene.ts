// The three.js scene of the Brusio spiral viaduct: ground, masonry, line, overhead wires and the
// Bernina Express. It draws only while the section is on screen (the boot module starts and stops
// it) and steps its own resolution down on slow devices.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Vector3,
  PCFShadowMap,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { createQualityGovernor } from '../river/quality.ts';
import { frameForAspect, lookDirection } from './camera.ts';
import { buildBallast, buildCatenary, buildRails, sleeperPlacements } from './lineMesh.ts';
import type { BuiltMesh } from './meshBuilder.ts';
import { buildProps } from './propsMesh.ts';
import { createScenery } from './scenery.ts';
import { buildVehicle } from './trainMesh.ts';
import { CONSIST, createPoses, PHOTO_TIME, placeConsist, trainStateAt, type VehicleKind } from './train.ts';
import { buildVegetation } from './vegetation.ts';
import { buildTerrainGrid, createGround, type TerrainGrid } from './terrain.ts';
import { createGravelTexture, createMasonryTexture, createScreeTexture, createVoussoirTexture, loadDetailTexture } from './textures.ts';
import { buildViaduct } from './viaductMesh.ts';

export interface ViaductScene {
  start(): void;
  stop(): void;
  renderStill(): void;
}

interface Tier {
  pixelRatioCap: number;
  shadowSize: number;
  terrainSpacing: number;
}

const TIERS: Record<'high' | 'low', Tier> = {
  high: { pixelRatioCap: 2, shadowSize: 2048, terrainSpacing: 2.5 },
  low: { pixelRatioCap: 2, shadowSize: 1024, terrainSpacing: 4 },
};

interface DebugOptions {
  noAdapt?: boolean;
  time?: number;
  tier?: 'high' | 'low';
  // Handed back for measuring draw calls and triangles.
  renderer?: WebGLRenderer;
}

const SUN_DIRECTION: [number, number, number] = [-0.5, 0.58, 0.64];
const SHADOW_CENTRE: [number, number, number] = [10, 0, -5];
const SHADOW_HALF_EXTENT = 135;
const FRAME_COUNTER_EVERY = 15;
const GRASS_TEXTURE_URL = '/river/grass.webp';
const ROCK_TILE_METRES = 8;

function toGeometry(mesh: BuiltMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));

  return geometry;
}

function terrainGeometry(grid: TerrainGrid): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(grid.uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(grid.colors, 3));
  geometry.setAttribute('rock', new BufferAttribute(grid.rock, 1));
  geometry.setIndex(new BufferAttribute(grid.indices, 1));
  geometry.computeVertexNormals();

  return geometry;
}

export async function createViaductScene(canvas: HTMLCanvasElement): Promise<ViaductScene> {
  const debugHost = (window as unknown as { __viaductDebug?: DebugOptions }).__viaductDebug;
  const debug: DebugOptions = debugHost ?? {};
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  const tierName: 'high' | 'low' = debug.tier ?? (window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(new Color(0x9fb4a0));

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const grassDetail = await loadDetailTexture(GRASS_TEXTURE_URL, 0.82, 1.9, anisotropy);
  const rockDetail = createScreeTexture(anisotropy);
  grassDetail.wrapS = RepeatWrapping;
  grassDetail.wrapT = RepeatWrapping;
  const masonryTexture = createMasonryTexture(anisotropy);
  const voussoirTexture = createVoussoirTexture(anisotropy);
  const gravelTexture = createGravelTexture(anisotropy);

  const scene = new Scene();
  const ground = createGround();

  const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, map: grassDetail, roughness: 1, metalness: 0 });
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rockDetail };
    shader.uniforms.rockTile = { value: 1 / ROCK_TILE_METRES };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;\nvarying vec3 vWorldPosition;\nvarying vec3 vWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rock;\nvWorldPosition = position;\nvWorldNormal = normal;');
    // The scree is mapped from three sides by world position, so it does not stretch on steep
    // slopes: each side counts as much as the ground faces it.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D rockMap;\nuniform float rockTile;\nvarying float vRock;\nvarying vec3 vWorldPosition;\nvarying vec3 vWorldNormal;',
      )
      .replace(
        '#include <map_fragment>',
        `vec3 grassSample = texture2D(map, vMapUv).rgb;
vec3 triplanarWeight = pow(abs(normalize(vWorldNormal)), vec3(4.0));
triplanarWeight /= triplanarWeight.x + triplanarWeight.y + triplanarWeight.z;
vec3 rockSample =
  texture2D(rockMap, vWorldPosition.zy * rockTile).rgb * triplanarWeight.x +
  texture2D(rockMap, vWorldPosition.xz * rockTile).rgb * triplanarWeight.y +
  texture2D(rockMap, vWorldPosition.xy * rockTile).rgb * triplanarWeight.z;
diffuseColor.rgb *= mix(grassSample, rockSample, vRock);`,
      );
  };

  const terrain = new Mesh(terrainGeometry(buildTerrainGrid(ground, TIERS[tierName].terrainSpacing)), terrainMaterial);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const masonryMaterial = new MeshStandardMaterial({ map: masonryTexture, vertexColors: true, roughness: 0.93, metalness: 0, side: DoubleSide });
  const ringMaterial = new MeshStandardMaterial({ map: voussoirTexture, vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide });
  const metalMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  const ballastMaterial = new MeshStandardMaterial({ map: gravelTexture, vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
  const railMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3, side: DoubleSide });
  const sleeperMaterial = new MeshStandardMaterial({ color: 0x8d867b, roughness: 1 });

  const viaduct = buildViaduct(ground);
  const solids: [BuiltMesh, MeshStandardMaterial, boolean][] = [
    [viaduct.masonry, masonryMaterial, true],
    [viaduct.rings, ringMaterial, true],
    [viaduct.metal, metalMaterial, true],
    [buildBallast(), ballastMaterial, false],
    [buildRails(), railMaterial, false],
    [buildCatenary(ground), metalMaterial, true],
  ];
  for (const [mesh, material, casts] of solids) {
    const object = new Mesh(toGeometry(mesh), material);
    object.castShadow = casts;
    object.receiveShadow = true;
    scene.add(object);
  }

  const sleepers = sleeperPlacements();
  const sleeperMesh = new InstancedMesh(new BoxGeometry(0.2, 0.16, 2.3), sleeperMaterial, sleepers.length);
  const dummy = new Object3D();
  sleepers.forEach((placement, index) => {
    dummy.position.set(placement.x, placement.y, placement.z);
    dummy.rotation.set(0, placement.heading, 0);
    dummy.updateMatrix();
    sleeperMesh.setMatrixAt(index, dummy.matrix);
  });
  sleeperMesh.receiveShadow = true;
  scene.add(sleeperMesh);

  const scenery = createScenery(ground);
  const props = buildProps(scenery, ground);
  const propsMesh = new Mesh(toGeometry(props.props), new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  propsMesh.castShadow = true;
  propsMesh.receiveShadow = true;
  const wallsMesh = new Mesh(toGeometry(props.walls), masonryMaterial);
  wallsMesh.castShadow = true;
  wallsMesh.receiveShadow = true;
  scene.add(propsMesh, wallsMesh);
  for (const mesh of buildVegetation(scenery, tierName === 'high', rockDetail).meshes) {
    scene.add(mesh);
  }

  const bodyMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
  const glassMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.35 });
  const trainKinds: VehicleKind[] = ['locomotive', 'locomotiveWrap', 'standard', 'panorama'];
  const panoramaCount = CONSIST.filter((vehicle) => vehicle.kind === 'panorama').length;
  const vehicleMeshes = new Map<VehicleKind, { body: Mesh | InstancedMesh; glass: Mesh | InstancedMesh }>();
  for (const kind of trainKinds) {
    const { body, glass } = buildVehicle(kind);
    const instanced = kind === 'panorama';
    const bodyObject = instanced
      ? new InstancedMesh(toGeometry(body), bodyMaterial, panoramaCount)
      : new Mesh(toGeometry(body), bodyMaterial);
    const glassObject = instanced
      ? new InstancedMesh(toGeometry(glass), glassMaterial, panoramaCount)
      : new Mesh(toGeometry(glass), glassMaterial);
    for (const object of [bodyObject, glassObject]) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
      object.matrixAutoUpdate = false;
      scene.add(object);
    }

    vehicleMeshes.set(kind, { body: bodyObject, glass: glassObject });
  }

  const poses = createPoses();
  const vehicleMatrix = new Matrix4();
  const forward = new Vector3();
  const up = new Vector3();
  const across = new Vector3();

  function placeTrain(time: number) {
    const state = trainStateAt(time);
    placeConsist(state.headS, state.direction, poses);
    const panoramaIndex = { value: 0 };
    CONSIST.forEach((vehicle, index) => {
      const pose = poses[index];
      forward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
      up.set(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
      across.crossVectors(forward, up);
      vehicleMatrix.makeBasis(forward, up, across).setPosition(pose.x, pose.y, pose.z);
      const parts = vehicleMeshes.get(vehicle.kind);
      if (!parts) {
        return;
      }

      if (vehicle.kind === 'panorama') {
        (parts.body as InstancedMesh).setMatrixAt(panoramaIndex.value, vehicleMatrix);
        (parts.glass as InstancedMesh).setMatrixAt(panoramaIndex.value, vehicleMatrix);
        panoramaIndex.value += 1;
      } else {
        parts.body.matrix.copy(vehicleMatrix);
        parts.glass.matrix.copy(vehicleMatrix);
        parts.body.matrixWorldNeedsUpdate = true;
        parts.glass.matrixWorldNeedsUpdate = true;
      }
    });
    for (const parts of vehicleMeshes.values()) {
      for (const object of [parts.body, parts.glass]) {
        if (object instanceof InstancedMesh) {
          object.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  const sun = new DirectionalLight(0xfff0d2, 3.1);
  sun.position.set(
    SHADOW_CENTRE[0] + SUN_DIRECTION[0] * 300,
    SHADOW_CENTRE[1] + SUN_DIRECTION[1] * 300,
    SHADOW_CENTRE[2] + SUN_DIRECTION[2] * 300,
  );
  sun.target.position.set(...SHADOW_CENTRE);
  sun.castShadow = true;
  sun.shadow.mapSize.set(TIERS[tierName].shadowSize, TIERS[tierName].shadowSize);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -SHADOW_HALF_EXTENT;
  shadowCamera.right = SHADOW_HALF_EXTENT;
  shadowCamera.top = SHADOW_HALF_EXTENT;
  shadowCamera.bottom = -SHADOW_HALF_EXTENT;
  shadowCamera.near = 50;
  shadowCamera.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.12;
  scene.add(sun, sun.target);
  scene.add(new HemisphereLight(0xcfe3ff, 0x6a7a45, 0.9));
  scene.add(new AmbientLight(0xffffff, 0.12));

  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 1200);

  let running = false;
  let frameHandle = 0;
  let lastNow = 0;
  let frames = 0;
  let clock = debug.time ?? PHOTO_TIME;
  let renderScale = 1;
  // How far the shadows have been cut back on a slow device: 1 halves the shadow map, 2 also
  // redraws it only every other frame.
  let shadowStage = 0;
  let lost = false;
  let width = 0;
  let height = 0;
  const governor = createQualityGovernor();

  function pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, TIERS[tierName].pixelRatioCap) * renderScale;
  }

  function frameCamera() {
    const aspect = width / height;
    const frame = frameForAspect(aspect);
    const [lookX, lookZ] = lookDirection(frame);
    const horizontal = Math.cos(frame.elevation);
    const direction: [number, number, number] = [lookX * horizontal, -Math.sin(frame.elevation), lookZ * horizontal];
    const distance = 500;
    camera.left = -frame.halfWidth;
    camera.right = frame.halfWidth;
    camera.top = frame.halfHeight;
    camera.bottom = -frame.halfHeight;
    camera.position.set(
      frame.target[0] - direction[0] * distance,
      frame.target[1] - direction[1] * distance,
      frame.target[2] - direction[2] * distance,
    );
    camera.lookAt(frame.target[0], frame.target[1], frame.target[2]);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height) {
      return;
    }

    width = nextWidth;
    height = nextHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    frameCamera();
  }

  function renderFrame() {
    placeTrain(clock);
    if (shadowStage >= 2) {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = frames % 2 === 0;
    }

    renderer.render(scene, camera);
    frames += 1;
    if (frames % FRAME_COUNTER_EVERY === 0 || !running) {
      canvas.dataset.frames = String(frames);
    }
  }

  function adapt(frameMs: number, now: number) {
    if (debug.noAdapt) {
      return;
    }

    const action = governor.record(frameMs, now, renderScale < 1);
    if (action === 'hold') {
      return;
    }

    if (action === 'improve') {
      renderScale = Math.min(1, renderScale + 0.15);
    } else if (renderScale > 0.61) {
      renderScale = Math.max(0.6, renderScale - 0.15);
    } else {
      // Resolution is as low as it goes; cut back the shadows instead.
      if (shadowStage < 2) {
        shadowStage += 1;
      }

      if (shadowStage === 1) {
        const size = TIERS[tierName].shadowSize / 2;
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }

      governor.restart(now);

      return;
    }

    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    governor.restart(now);
  }

  function loop(now: number) {
    if (!running) {
      return;
    }

    const frameMs = lastNow === 0 ? 16 : now - lastNow;
    lastNow = now;
    clock += Math.min(frameMs / 1000, 0.05);
    renderFrame();
    adapt(frameMs, now);
    frameHandle = requestAnimationFrame(loop);
  }

  const observer = new ResizeObserver(() => {
    if (lost) {
      return;
    }

    resize();
    if (!running) {
      renderFrame();
    }
  });
  observer.observe(canvas);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frameHandle);
  });
  // three.js re-creates its GPU resources on demand after a restore, so the loop only resumes.
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (running) {
      lastNow = 0;
      frameHandle = requestAnimationFrame(loop);
    } else {
      renderFrame();
    }
  });

  resize();
  if (debugHost) {
    debugHost.renderer = renderer;
  }

  return {
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
        renderFrame();
      }
    },
  };
}
