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
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
import { toGeometry } from './geometry.ts';
import { createQualityGovernor } from '../river/quality.ts';
import { clampView, defaultView, frameForView, lookDirection, type ViewState } from './camera.ts';
import { attachViewControls } from './controls.ts';
import { buildBallast, buildCatenary, buildRails, sleeperPlacements } from './lineMesh.ts';
import type { BuiltMesh } from './meshBuilder.ts';
import { buildProps } from './propsMesh.ts';
import { createScenery } from './scenery.ts';
import { buildHeadLamps, buildTailLamps, buildVehicle } from './trainMesh.ts';
import { createLiveryTexture, createSkyReflection } from './trainTextures.ts';
import { CONSIST, createPoses, PHOTO_TIME, placeConsist, trainStateAt, type VehicleSpec } from './train.ts';
import { buildVegetation } from './vegetation.ts';
import { windTime } from './wind.ts';
import { buildTerrainGrid, createGround, type TerrainGrid } from './terrain.ts';
import { CANOPY_TILE_METRES, createCanopyTexture } from './canopyTexture.ts';
import { createStoneTextures, createTrimTextures } from './stonework.ts';
import { createGravelTexture, createMasonryTexture, createScreeTexture, loadDetailTexture } from './textures.ts';
import { buildViaduct } from './viaductMesh.ts';
import { buildVillage } from './villageMesh.ts';
import { createFacadeAtlas, createSlateTexture } from './villageTextures.ts';

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
  // Where the camera starts, over the default view. Clamped like any other view.
  view?: Partial<ViewState>;
  // Handed back for reading the view the visitor has asked for.
  getView?: () => ViewState;
}

const SUN_DIRECTION: [number, number, number] = [-0.5, 0.58, 0.64];
const SHADOW_DISTANCE = 300;
const SHADOW_MIN_EXTENT = 40;
const SHADOW_MAX_EXTENT = 135;
// How quickly the view settles on the one the visitor asked for, in seconds.
const VIEW_EASE = 0.06;
const FRAME_COUNTER_EVERY = 15;
const GRASS_TEXTURE_URL = '/river/grass.webp';
const ROCK_TILE_METRES = 8;
// Distance haze, measured along the view from the camera, which stands 500 m back from the point
// the view is centred on. At a low tilt the depth grows fast up the screen: the loop in the default
// view lies at about 500 and keeps its colours, and the far mountain sides fade into a pale blue-grey.
const CAMERA_DISTANCE = 500;
const HAZE_COLOR = 0xb7c5cf;
const HAZE_START = CAMERA_DISTANCE + 70;
const HAZE_END = CAMERA_DISTANCE + 420;

function terrainGeometry(grid: TerrainGrid): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(grid.uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(grid.colors, 3));
  geometry.setAttribute('rock', new BufferAttribute(grid.rock, 1));
  geometry.setAttribute('forest', new BufferAttribute(grid.forest, 1));
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
  const canopyDetail = createCanopyTexture(anisotropy);
  grassDetail.wrapS = RepeatWrapping;
  grassDetail.wrapT = RepeatWrapping;
  const masonryTexture = createMasonryTexture(anisotropy);
  const stoneTextures = createStoneTextures(tierName === 'high' ? 1024 : 512, anisotropy);
  const trimTextures = createTrimTextures(anisotropy);
  const gravelTexture = createGravelTexture(anisotropy);

  const scene = new Scene();
  scene.fog = new Fog(HAZE_COLOR, HAZE_START, HAZE_END);
  const ground = createGround();

  const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, map: grassDetail, roughness: 1, metalness: 0 });
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rockDetail };
    shader.uniforms.rockTile = { value: 1 / ROCK_TILE_METRES };
    shader.uniforms.canopyMap = { value: canopyDetail };
    shader.uniforms.canopyTile = { value: 1 / CANOPY_TILE_METRES };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rock;\nattribute float forest;\nvarying float vRock;\nvarying float vForest;\nvarying vec3 vWorldPosition;\nvarying vec3 vWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rock;\nvForest = forest;\nvWorldPosition = position;\nvWorldNormal = normal;');
    // The scree is mapped from three sides by world position, so it does not stretch on steep
    // slopes: each side counts as much as the ground faces it.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D rockMap;\nuniform float rockTile;\nuniform sampler2D canopyMap;\nuniform float canopyTile;\nvarying float vRock;\nvarying float vForest;\nvarying vec3 vWorldPosition;\nvarying vec3 vWorldNormal;',
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
vec3 canopySample = texture2D(canopyMap, vWorldPosition.xz * canopyTile).rgb;
diffuseColor.rgb *= mix(mix(grassSample, rockSample, vRock), canopySample, vForest);`,
      );
  };

  const terrain = new Mesh(terrainGeometry(buildTerrainGrid(ground, TIERS[tierName].terrainSpacing)), terrainMaterial);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const masonryMaterial = new MeshStandardMaterial({ map: masonryTexture, vertexColors: true, roughness: 0.93, metalness: 0, side: DoubleSide });
  const viaductMaterial = new MeshStandardMaterial({ map: stoneTextures.map, normalMap: stoneTextures.normalMap, vertexColors: true, roughness: 0.93, metalness: 0, side: DoubleSide });
  const trimMaterial = new MeshStandardMaterial({ map: trimTextures.map, normalMap: trimTextures.normalMap, vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide });
  const metalMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  const ballastMaterial = new MeshStandardMaterial({ map: gravelTexture, vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
  const railMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3, side: DoubleSide });
  const sleeperMaterial = new MeshStandardMaterial({ color: 0x8d867b, roughness: 1 });

  const viaduct = buildViaduct(ground);
  const solids: [BuiltMesh, MeshStandardMaterial, boolean][] = [
    [viaduct.masonry, viaductMaterial, true],
    [viaduct.trim, trimMaterial, true],
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

  const village = buildVillage(scenery.houses, ground);
  const villageWalls = new Mesh(toGeometry(village.walls), new MeshStandardMaterial({ map: createFacadeAtlas(anisotropy), vertexColors: true, roughness: 0.92, metalness: 0 }));
  const villageRoofs = new Mesh(toGeometry(village.roofs), new MeshStandardMaterial({ map: createSlateTexture(anisotropy), vertexColors: true, roughness: 0.85, metalness: 0 }));
  for (const mesh of [villageWalls, villageRoofs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (const mesh of buildVegetation(scenery, tierName === 'high', rockDetail, anisotropy).meshes) {
    scene.add(mesh);
  }

  const liverySize = tierName === 'high' ? 1024 : 512;
  const paint = (spec: VehicleSpec) =>
    new MeshStandardMaterial({ map: createLiveryTexture(spec, liverySize, anisotropy), vertexColors: true, roughness: 0.42, metalness: 0.08 });
  const glassMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.1,
    metalness: 0.55,
    envMap: createSkyReflection(),
  });
  const lampMaterial = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  function trainObject<T extends Mesh | InstancedMesh>(object: T, casts = true): T {
    object.castShadow = casts;
    object.receiveShadow = casts;
    object.frustumCulled = false;
    object.matrixAutoUpdate = false;
    scene.add(object);

    return object;
  }

  const locomotiveSpec = CONSIST.find((vehicle) => vehicle.kind === 'locomotive');
  const panoramaSpec = CONSIST.find((vehicle) => vehicle.kind === 'panorama');
  if (!locomotiveSpec || !panoramaSpec) {
    throw new Error('viaduct: the consist has no locomotive or no panorama coach');
  }

  const locomotive = buildVehicle(locomotiveSpec);
  const locomotiveBody = toGeometry(locomotive.body);
  const locomotiveGlass = toGeometry(locomotive.glass);
  const panorama = buildVehicle(panoramaSpec);
  const panoramaCount = CONSIST.filter((vehicle) => vehicle.kind === 'panorama').length;
  const panoramaBody = trainObject(new InstancedMesh(toGeometry(panorama.body), paint(panoramaSpec), panoramaCount));
  const panoramaGlass = trainObject(new InstancedMesh(toGeometry(panorama.glass), glassMaterial, panoramaCount));

  // For each vehicle of the consist, what has to move with it.
  const followers: Mesh[][] = [];
  const panoramaSlots: number[] = [];
  let nextPanoramaSlot = 0;
  CONSIST.forEach((vehicle, index) => {
    const attached: Mesh[] = [];
    if (vehicle.kind === 'locomotive') {
      attached.push(trainObject(new Mesh(locomotiveBody, paint(vehicle))), trainObject(new Mesh(locomotiveGlass, glassMaterial)));
    }

    // The head is always the first locomotive's front and the tail the last coach's rear.
    if (index === 0) {
      attached.push(trainObject(new Mesh(toGeometry(buildHeadLamps(vehicle)), lampMaterial), false));
    }

    if (index === CONSIST.length - 1) {
      attached.push(trainObject(new Mesh(toGeometry(buildTailLamps(vehicle)), lampMaterial), false));
    }

    followers.push(attached);
    panoramaSlots.push(vehicle.kind === 'panorama' ? nextPanoramaSlot++ : -1);
  });

  const poses = createPoses();
  const vehicleMatrix = new Matrix4();
  const forward = new Vector3();
  const up = new Vector3();
  const across = new Vector3();

  function placeTrain(time: number) {
    const state = trainStateAt(time);
    placeConsist(state.headS, state.direction, poses);
    CONSIST.forEach((_, index) => {
      const pose = poses[index];
      forward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
      up.set(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
      across.crossVectors(forward, up);
      vehicleMatrix.makeBasis(forward, up, across).setPosition(pose.x, pose.y, pose.z);
      for (const object of followers[index]) {
        object.matrix.copy(vehicleMatrix);
        object.matrixWorldNeedsUpdate = true;
      }

      if (panoramaSlots[index] >= 0) {
        panoramaBody.setMatrixAt(panoramaSlots[index], vehicleMatrix);
        panoramaGlass.setMatrixAt(panoramaSlots[index], vehicleMatrix);
      }
    });
    panoramaBody.instanceMatrix.needsUpdate = true;
    panoramaGlass.instanceMatrix.needsUpdate = true;
  }

  const sun = new DirectionalLight(0xfff0d2, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(TIERS[tierName].shadowSize, TIERS[tierName].shadowSize);
  const shadowCamera = sun.shadow.camera;
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
  // The view the visitor asked for, and the one on screen, which eases toward it.
  let goal = defaultView(1);
  let current = goal;
  let viewChanged = true;
  const governor = createQualityGovernor();

  function pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, TIERS[tierName].pixelRatioCap) * renderScale;
  }

  // The shadow map covers only what is on screen, so zooming in sharpens the shadows. Its centre
  // moves in whole texels, which keeps the shadow edges from crawling while the view pans.
  function placeShadow(target: [number, number, number], halfWidth: number, halfDepth: number) {
    const extent = Math.min(Math.max(Math.ceil((1.1 * Math.hypot(halfWidth, halfDepth)) / 5) * 5, SHADOW_MIN_EXTENT), SHADOW_MAX_EXTENT);
    const texel = (2 * extent) / sun.shadow.mapSize.x;
    const toSun = new Vector3(...SUN_DIRECTION).normalize();
    const right = new Vector3(0, 1, 0).cross(toSun).normalize();
    const up = new Vector3().crossVectors(toSun, right);
    const centre = new Vector3(...target);
    const alongRight = Math.round(centre.dot(right) / texel) * texel;
    const alongUp = Math.round(centre.dot(up) / texel) * texel;
    centre.copy(right).multiplyScalar(alongRight).addScaledVector(up, alongUp).addScaledVector(toSun, new Vector3(...target).dot(toSun));
    shadowCamera.left = -extent;
    shadowCamera.right = extent;
    shadowCamera.top = extent;
    shadowCamera.bottom = -extent;
    shadowCamera.updateProjectionMatrix();
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(toSun, SHADOW_DISTANCE);
  }

  function frameCamera() {
    const frame = frameForView(width / height, current);
    const [lookX, lookZ] = lookDirection(frame);
    const horizontal = Math.cos(frame.elevation);
    const direction: [number, number, number] = [lookX * horizontal, -Math.sin(frame.elevation), lookZ * horizontal];
    const distance = CAMERA_DISTANCE;
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
    placeShadow(frame.target, frame.halfWidth, frame.halfHeight / Math.sin(frame.elevation));
    viewChanged = true;
  }

  // Moves the on-screen view toward the goal; true while it is still moving.
  function easeView(seconds: number): boolean {
    const amount = 1 - Math.exp(-seconds / VIEW_EASE);
    const next: ViewState = {
      zoom: current.zoom + (goal.zoom - current.zoom) * amount,
      elevation: current.elevation + (goal.elevation - current.elevation) * amount,
      azimuth: current.azimuth + (goal.azimuth - current.azimuth) * amount,
      panX: current.panX + (goal.panX - current.panX) * amount,
      panZ: current.panZ + (goal.panZ - current.panZ) * amount,
    };
    const close =
      Math.abs(goal.zoom - next.zoom) < 0.002 &&
      Math.abs(goal.elevation - next.elevation) < 0.0005 &&
      Math.abs(goal.azimuth - next.azimuth) < 0.0005 &&
      Math.abs(goal.panX - next.panX) < 0.02 &&
      Math.abs(goal.panZ - next.panZ) < 0.02;
    current = close ? goal : next;
    frameCamera();

    return !close;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height) {
      return;
    }

    const previousAspect = width / height;
    width = nextWidth;
    height = nextHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    const aspect = width / height;
    if (previousAspect > 0) {
      // Keep the tilt the visitor chose, measured from the new default.
      const tilt = defaultView(aspect).elevation - defaultView(previousAspect).elevation;
      goal = clampView(aspect, { ...goal, elevation: goal.elevation + tilt });
      current = clampView(aspect, { ...current, elevation: current.elevation + tilt });
    } else {
      goal = clampView(aspect, { ...defaultView(aspect), ...debug.view });
      current = goal;
    }

    frameCamera();
  }

  function renderFrame() {
    placeTrain(clock);
    windTime.value = clock;
    if (shadowStage >= 2) {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = frames % 2 === 0 || viewChanged;
    }

    viewChanged = false;

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
    if (current !== goal) {
      easeView(Math.min(frameMs / 1000, 0.05));
    }

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

  function changeView(next: ViewState) {
    goal = clampView(width / height, next);
    // Off screen or under reduced motion nothing runs, so the view jumps and draws once.
    if (!running && !lost) {
      current = goal;
      frameCamera();
      renderFrame();
    }
  }

  resize();
  attachViewControls(canvas, { aspect: () => width / height, view: () => goal, change: changeView });
  if (debugHost) {
    debugHost.renderer = renderer;
    debugHost.getView = () => goal;
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
        current = goal;
        frameCamera();
        renderFrame();
      }
    },
  };
}
