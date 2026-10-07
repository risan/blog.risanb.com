// Trees, bushes and rocks as instanced meshes: one draw call per kind however many there are.
// Crowns are cut-out leaf and needle cards (see treeMesh.ts); each instance carries its own
// colour, which gives the grove its autumn variety. Trees and bushes sway in the wind (wind.ts);
// the rocks stay put.

import {
  Color,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  LinearSRGBColorSpace,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  RGBADepthPacking,
  type Texture,
} from 'three';
import { toGeometry } from './geometry.ts';
import type { Rgb } from './meshBuilder.ts';
import type { Scenery } from './scenery.ts';
import { valueNoise } from './terrain.ts';
import { createLeafTexture, createNeedleTexture, type FoliageTexture } from './textures.ts';
import {
  BROADLEAF_RADIUS,
  buildBroadleafCrown,
  buildBroadleafWood,
  buildBushCrown,
  buildConiferCrown,
  buildConiferTrunk,
  buildFarBroadleaf,
  buildFarSpruce,
  CONIFER_HEIGHT,
  CONIFER_RADIUS,
} from './treeMesh.ts';
import { applyWind, type WindSettings } from './wind.ts';

// The leaf textures are mostly mid-grey, so the instance colours are lifted to compensate.
const LEAF_GAIN = 2.2;
const NEEDLE_GAIN = 5.6;

const BROADLEAF_HEIGHT = 12.2;

const BROADLEAF_WIND: WindSettings = { height: BROADLEAF_HEIGHT, sway: 0.6, speed: 1.3, flutter: 0.08, shimmer: 0.4 };
// Spruces are stiffer: they lean less and spring back faster.
const CONIFER_WIND: WindSettings = { height: CONIFER_HEIGHT, sway: 0.3, speed: 1.9, flutter: 0.1, shimmer: 0.35 };
const BUSH_WIND: WindSettings = { height: 1.2, sway: 0.08, speed: 2.4, flutter: 0.04, shimmer: 0.25 };
// Wood bends with its crown but has no leaves to flutter.
const BROADLEAF_WOOD_WIND: WindSettings = { ...BROADLEAF_WIND, flutter: 0, shimmer: 0 };
const CONIFER_WOOD_WIND: WindSettings = { ...CONIFER_WIND, flutter: 0, shimmer: 0 };

// Loose angular rock: a faceted ball pushed about by noise, mapped with the scree texture.
function rockGeometry(detail: number): IcosahedronGeometry {
  const rock = new IcosahedronGeometry(1, detail);
  const position = rock.getAttribute('position');
  const uv = rock.getAttribute('uv');
  for (let index = 0; index < position.count; index += 1) {
    const px = position.getX(index);
    const py = position.getY(index);
    const pz = position.getZ(index);
    const push = 0.72 + valueNoise(px * 2.2 + 3, pz * 2.2 + py * 2.2) * 0.55;
    position.setXYZ(index, px * push, py * push, pz * push);
    uv.setXY(index, uv.getX(index) * 0.5, uv.getY(index) * 0.5);
  }

  rock.computeVertexNormals();

  return rock;
}

function colorOf([red, green, blue]: Rgb, gain = 1): Color {
  return new Color().setRGB(red * gain, green * gain, blue * gain, LinearSRGBColorSpace);
}

// A cut-out card material. The cards' normals already point where the light should treat them, so
// the back of a card must not flip its normal the way a double-sided surface would.
// No alphaToCoverage: on NVIDIA through ANGLE/D3D11 it sprinkled light speckles along every leaf edge.
function foliageMaterial(texture: FoliageTexture, wind: WindSettings): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: texture.map,
    alphaMap: texture.alphaMap,
    alphaTest: 0.5,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    applyWind(shader, wind);
    shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };

  return material;
}

function woodMaterial(wind: WindSettings): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  material.onBeforeCompile = (shader) => {
    applyWind(shader, wind);
  };

  return material;
}

// The depth material three makes by itself for a cut-out card does not carry the wind, so the
// shadows would stand still while the trees sway.
function windDepthMaterial(source: MeshStandardMaterial, wind: WindSettings): MeshDepthMaterial {
  const material = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    map: source.map,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
  });
  material.onBeforeCompile = (shader) => {
    applyWind(shader, wind);
  };

  return material;
}

export interface Vegetation {
  meshes: InstancedMesh[];
}

// The far forest is plain faceted shapes, a spruce of two cones and a broadleaf of one ball, in the
// colour of each tree. They carry no wind and cast no shadow: the mountain sides are seen small.
function buildFarForest(trees: Scenery['farTrees'], high: boolean): InstancedMesh[] {
  const shown = high ? trees : trees.filter((_, index) => index % 2 === 0);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const dummy = new Object3D();
  const spruces = shown.filter((tree) => tree.conifer);
  const balls = shown.filter((tree) => !tree.conifer);
  const spruceMesh = new InstancedMesh(toGeometry(buildFarSpruce()), material, spruces.length);
  spruces.forEach((tree, index) => {
    dummy.position.set(tree.x, tree.y - 0.5, tree.z);
    dummy.rotation.set(0, index, 0);
    dummy.scale.set(tree.radius, tree.height, tree.radius);
    dummy.updateMatrix();
    spruceMesh.setMatrixAt(index, dummy.matrix);
    spruceMesh.setColorAt(index, colorOf(tree.color, 1.2));
  });

  const ballMesh = new InstancedMesh(toGeometry(buildFarBroadleaf()), material, balls.length);
  balls.forEach((tree, index) => {
    dummy.position.set(tree.x, tree.y + tree.height - tree.radius * 1.8, tree.z);
    dummy.rotation.set(0, index, 0);
    dummy.scale.set(tree.radius * 1.1, tree.radius * 1.8, tree.radius * 1.1);
    dummy.updateMatrix();
    ballMesh.setMatrixAt(index, dummy.matrix);
    ballMesh.setColorAt(index, colorOf(tree.color, 1.25));
  });

  for (const mesh of [spruceMesh, ballMesh]) {
    mesh.frustumCulled = false;
  }

  return [spruceMesh, ballMesh];
}

export function buildVegetation(scenery: Scenery, high: boolean, rockTexture: Texture, anisotropy: number): Vegetation {
  const dummy = new Object3D();
  const textureSize = high ? 512 : 256;
  const leafTexture = createLeafTexture(textureSize, anisotropy);
  const leafMaterial = foliageMaterial(leafTexture, BROADLEAF_WIND);
  // The bushes share the leaf texture but sway to their own settings.
  const bushMaterial = foliageMaterial(leafTexture, BUSH_WIND);
  const needleMaterial = foliageMaterial(createNeedleTexture(textureSize, anisotropy), CONIFER_WIND);
  const broadleafWoodMaterial = woodMaterial(BROADLEAF_WOOD_WIND);
  const coniferWoodMaterial = woodMaterial(CONIFER_WOOD_WIND);
  const rockMaterial = new MeshStandardMaterial({ map: rockTexture, roughness: 1, flatShading: true });
  const meshes: InstancedMesh[] = [];

  const broadleaves = scenery.trees.filter((tree) => !tree.conifer);
  const conifers = scenery.trees.filter((tree) => tree.conifer);

  const wood = new InstancedMesh(toGeometry(buildBroadleafWood()), broadleafWoodMaterial, broadleaves.length);
  const crowns = new InstancedMesh(toGeometry(high ? buildBroadleafCrown(200) : buildBroadleafCrown(130, 1.2)), leafMaterial, broadleaves.length);
  broadleaves.forEach((tree, index) => {
    const scale = tree.radius / BROADLEAF_RADIUS;
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    wood.setMatrixAt(index, dummy.matrix);
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, colorOf(tree.color, LEAF_GAIN));
  });

  const spruceTrunks = new InstancedMesh(toGeometry(buildConiferTrunk()), coniferWoodMaterial, conifers.length);
  const needles = new InstancedMesh(toGeometry(high ? buildConiferCrown(16, 7, 11) : buildConiferCrown(11, 5, 8, 2)), needleMaterial, conifers.length);
  conifers.forEach((tree, index) => {
    const width = tree.radius / CONIFER_RADIUS;
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(width, tree.height / CONIFER_HEIGHT, width);
    dummy.updateMatrix();
    spruceTrunks.setMatrixAt(index, dummy.matrix);
    needles.setMatrixAt(index, dummy.matrix);
    needles.setColorAt(index, colorOf(tree.color, NEEDLE_GAIN));
  });

  const allBushes = [...scenery.bushes, ...scenery.orchard];
  const bushes = new InstancedMesh(toGeometry(buildBushCrown(high ? 36 : 20)), bushMaterial, allBushes.length);
  allBushes.forEach((bush, index) => {
    dummy.position.set(bush.x, bush.y, bush.z);
    dummy.rotation.set(0, index, 0);
    dummy.scale.set(bush.size, bush.size, bush.size);
    dummy.updateMatrix();
    bushes.setMatrixAt(index, dummy.matrix);
    bushes.setColorAt(index, colorOf(bush.color, LEAF_GAIN));
  });

  // Phones draw only the larger share of the rocks, as coarser shapes.
  const shownRocks = high ? scenery.rocks : scenery.rocks.filter((_, index) => index % 5 < 3);
  const rocks = new InstancedMesh(rockGeometry(high ? 1 : 0), rockMaterial, shownRocks.length);
  shownRocks.forEach((rock, index) => {
    dummy.position.set(rock.x, rock.y + rock.size * rock.squash * 0.25, rock.z);
    dummy.rotation.set(0, rock.yaw, (index % 5) * 0.08);
    dummy.scale.set(rock.size, rock.size * rock.squash, rock.size * 0.85);
    dummy.updateMatrix();
    rocks.setMatrixAt(index, dummy.matrix);
    rocks.setColorAt(index, colorOf(rock.color));
  });

  const swaying: [InstancedMesh, MeshStandardMaterial, WindSettings][] = [
    [wood, broadleafWoodMaterial, BROADLEAF_WOOD_WIND],
    [crowns, leafMaterial, BROADLEAF_WIND],
    [spruceTrunks, coniferWoodMaterial, CONIFER_WOOD_WIND],
    [needles, needleMaterial, CONIFER_WIND],
    [bushes, bushMaterial, BUSH_WIND],
  ];
  for (const [mesh, material, wind] of swaying) {
    mesh.customDepthMaterial = windDepthMaterial(material, wind);
  }

  for (const mesh of [wood, crowns, spruceTrunks, needles, bushes, rocks]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Instances sit far from the origin; the base geometry's bounds would cull them wrongly.
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }

  meshes.push(...buildFarForest(scenery.farTrees, high));

  return { meshes };
}
