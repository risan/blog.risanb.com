// Trees, bushes and rocks as instanced low-poly meshes: one draw call per kind however many
// there are. Each instance carries its own colour, which gives the grove its autumn variety.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  Object3D,
  type Texture,
  IcosahedronGeometry,
  SphereGeometry,
} from 'three';
import type { Rgb } from './meshBuilder.ts';
import type { Scenery } from './scenery.ts';
import { valueNoise } from './terrain.ts';
import { mulberry32 } from '../river/world.ts';

// Broadleaf trunks are this tall; the crown starts just above the lowest branches.
const TRUNK_HEIGHT = 3.2;

// A broadleaf crown is a cloud of overlapping lumps inside a flattened ball. The lumps are laid
// out once, from a fixed seed, so every tree shares one geometry.
function crownLumps(count: number): [number, number, number, number][] {
  const random = mulberry32(21);
  const lumps: [number, number, number, number][] = [[0, 0, 0, 0.62]];
  while (lumps.length < count) {
    const angle = random() * Math.PI * 2;
    const reach = 0.25 + random() * 0.55;
    const lift = (random() - 0.4) * 0.55;
    lumps.push([Math.cos(angle) * reach, lift, Math.sin(angle) * reach, 0.4 + random() * 0.2]);
  }

  return lumps;
}

function merge(parts: BufferGeometry[], keepNormals = false): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const source = part.getAttribute('position');
    const shade = part.getAttribute('color');
    const normal = part.getAttribute('normal');
    const first = positions.length / 3;
    for (let index = 0; index < source.count; index += 1) {
      positions.push(source.getX(index), source.getY(index), source.getZ(index));
      colors.push(shade.getX(index), shade.getY(index), shade.getZ(index));
      if (keepNormals) {
        normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      }
    }

    if (part.index) {
      for (let index = 0; index < part.index.count; index += 1) {
        indices.push(first + part.index.getX(index));
      }
    } else {
      for (let index = 0; index < source.count; index += 1) {
        indices.push(first + index);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  if (keepNormals) {
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  } else {
    geometry.computeVertexNormals();
  }

  return geometry;
}

// Shades a part by height: lighter on top, darker underneath, so crowns read as rounded. Every
// vertex also gets its own random tint, which breaks the surface into leafy clusters.
function shaded(geometry: BufferGeometry, low: number, high: number, speckle: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    minY = Math.min(minY, position.getY(index));
    maxY = Math.max(maxY, position.getY(index));
  }

  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const amount = (position.getY(index) - minY) / (maxY - minY || 1);
    const value = (low + (high - low) * amount) * (1 - speckle + 2 * speckle * hashFace(index + position.count));
    colors.set([value, value, value], index * 3);
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  return geometry;
}

function hashFace(face: number): number {
  const value = Math.sin(face * 91.7 + 13.1) * 43758.5453;

  return value - Math.floor(value);
}

// Many small lumps make a broadleaf crown; the high tier uses more and finer ones.
function lumpyCrown(lumpCount: number, widthSegments: number, heightSegments: number): BufferGeometry {
  const parts = crownLumps(lumpCount).map(([x, y, z, radius]) => {
    const lump = new SphereGeometry(radius, widthSegments, heightSegments);
    const position = lump.getAttribute('position');
    const normal = lump.getAttribute('normal');
    for (let index = 0; index < position.count; index += 1) {
      const px = position.getX(index);
      const py = position.getY(index);
      const pz = position.getZ(index);
      const wobble = 1 + (valueNoise(px * 3.2 + x * 7, pz * 3.2 + y * 4 + z * 7) - 0.5) * 0.4;
      const wx = px * wobble + x;
      const wy = py * wobble * 0.85 + y;
      const wz = pz * wobble + z;
      position.setXYZ(index, wx, wy, wz);
      // Normals point out from the middle of the lump and, half as strongly, out from the middle
      // of the whole crown: smooth, whatever the segment count, and the crown reads as one mass.
      const own = Math.hypot(px, py, pz) || 1;
      const crown = Math.hypot(wx, wy, wz) || 1;
      const nx = px / own + wx / crown;
      const ny = py / own + wy / crown;
      const nz = pz / own + wz / crown;
      const length = Math.hypot(nx, ny, nz) || 1;
      normal.setXYZ(index, nx / length, ny / length, nz / length);
    }

    return shaded(lump, 0.55, 1.2, 0.16);
  });

  return merge(parts, true);
}

// Loose angular rock: a faceted ball pushed about by noise, mapped with the scree texture.
function rockGeometry(detail: number): BufferGeometry {
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

function conifer(): BufferGeometry {
  const tiers: [number, number, number][] = [
    [0, 1, 0.5],
    [0.28, 0.76, 0.42],
    [0.55, 0.52, 0.36],
  ];
  const parts = tiers.map(([base, radius, height]) => {
    const cone = new ConeGeometry(radius, height, 7, 1).toNonIndexed();
    cone.translate(0, base + height / 2, 0);

    return shaded(cone, 0.55, 1.05, 0.1);
  });

  return merge(parts);
}

function colorOf([red, green, blue]: Rgb): Color {
  return new Color().setRGB(red, green, blue, LinearSRGBColorSpace);
}

export interface Vegetation {
  meshes: InstancedMesh[];
}

export function buildVegetation(scenery: Scenery, high: boolean, rockTexture: Texture): Vegetation {
  const dummy = new Object3D();
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const flatMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const trunkMaterial = new MeshStandardMaterial({ color: 0x5b4632, roughness: 1 });
  const rockMaterial = new MeshStandardMaterial({ map: rockTexture, roughness: 1, flatShading: true });
  const meshes: InstancedMesh[] = [];

  const broadleaves = scenery.trees.filter((tree) => !tree.conifer);
  const conifers = scenery.trees.filter((tree) => tree.conifer);

  const trunkGeometry = new CylinderGeometry(0.2, 0.42, 1, 6);
  trunkGeometry.translate(0, 0.5, 0);
  const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, scenery.trees.length);
  scenery.trees.forEach((tree, index) => {
    const trunkHeight = tree.conifer ? tree.height * 0.3 : TRUNK_HEIGHT;
    const girth = tree.conifer ? 0.7 : 0.7 + tree.radius * 0.1;
    dummy.position.set(tree.x, tree.y - 0.3, tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(girth, trunkHeight + 0.3, girth);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
  });
  trunks.castShadow = true;
  meshes.push(trunks);

  const crowns = new InstancedMesh(high ? lumpyCrown(8, 9, 6) : lumpyCrown(5, 6, 4), material, broadleaves.length);
  broadleaves.forEach((tree, index) => {
    const horizontal = tree.radius / 1.05;
    dummy.position.set(tree.x, tree.y + TRUNK_HEIGHT + tree.radius * 0.6, tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(horizontal, horizontal, horizontal);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, colorOf(tree.color));
  });
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  meshes.push(crowns);

  const needles = new InstancedMesh(conifer(), flatMaterial, conifers.length);
  conifers.forEach((tree, index) => {
    dummy.position.set(tree.x, tree.y + tree.height * 0.22, tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(tree.radius, tree.height * 0.78, tree.radius);
    dummy.updateMatrix();
    needles.setMatrixAt(index, dummy.matrix);
    needles.setColorAt(index, colorOf(tree.color));
  });
  needles.castShadow = true;
  needles.receiveShadow = true;
  meshes.push(needles);

  const bushGeometry = shaded(new SphereGeometry(1, high ? 9 : 6, high ? 6 : 4), 0.7, 1.1, 0.1);
  const bushes = new InstancedMesh(bushGeometry, material, scenery.bushes.length);
  scenery.bushes.forEach((bush, index) => {
    dummy.position.set(bush.x, bush.y + bush.size * 0.25, bush.z);
    dummy.rotation.set(0, index, 0);
    dummy.scale.set(bush.size, bush.size * 0.72, bush.size);
    dummy.updateMatrix();
    bushes.setMatrixAt(index, dummy.matrix);
    bushes.setColorAt(index, colorOf(bush.color));
  });
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  meshes.push(bushes);

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
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  meshes.push(rocks);

  for (const mesh of meshes) {
    // Instances sit far from the origin; the base geometry's bounds would cull them wrongly.
    mesh.frustumCulled = false;
  }

  return { meshes };
}
