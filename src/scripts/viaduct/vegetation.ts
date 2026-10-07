// Trees, bushes and rocks as instanced meshes: one draw call per kind however many there are.
// Crowns are cut-out leaf and needle cards (see treeMesh.ts); each instance carries its own
// colour, which gives the grove its autumn variety.

import {
  Color,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  Object3D,
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
  CONIFER_HEIGHT,
  CONIFER_RADIUS,
} from './treeMesh.ts';

// The leaf textures are mostly mid-grey, so the instance colours are lifted to compensate.
const LEAF_GAIN = 1.9;
const NEEDLE_GAIN = 5.6;

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
function foliageMaterial(texture: FoliageTexture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: texture.map,
    alphaMap: texture.alphaMap,
    alphaTest: 0.5,
    alphaToCoverage: true,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
  };

  return material;
}

export interface Vegetation {
  meshes: InstancedMesh[];
}

export function buildVegetation(scenery: Scenery, high: boolean, rockTexture: Texture, anisotropy: number): Vegetation {
  const dummy = new Object3D();
  const textureSize = high ? 512 : 256;
  const leafMaterial = foliageMaterial(createLeafTexture(textureSize, anisotropy));
  const needleMaterial = foliageMaterial(createNeedleTexture(textureSize, anisotropy));
  const woodMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const rockMaterial = new MeshStandardMaterial({ map: rockTexture, roughness: 1, flatShading: true });
  const meshes: InstancedMesh[] = [];

  const broadleaves = scenery.trees.filter((tree) => !tree.conifer);
  const conifers = scenery.trees.filter((tree) => tree.conifer);

  const wood = new InstancedMesh(toGeometry(buildBroadleafWood()), woodMaterial, broadleaves.length);
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

  const spruceTrunks = new InstancedMesh(toGeometry(buildConiferTrunk()), woodMaterial, conifers.length);
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

  const bushes = new InstancedMesh(toGeometry(buildBushCrown(high ? 36 : 20)), leafMaterial, scenery.bushes.length);
  scenery.bushes.forEach((bush, index) => {
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

  for (const mesh of [wood, crowns, spruceTrunks, needles, bushes, rocks]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Instances sit far from the origin; the base geometry's bounds would cull them wrongly.
    mesh.frustumCulled = false;
    meshes.push(mesh);
  }

  return { meshes };
}
