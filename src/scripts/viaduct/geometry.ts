// Turns the pure meshes of meshBuilder.ts into three.js geometry.

import { BufferAttribute, BufferGeometry } from 'three';
import type { BuiltMesh } from './meshBuilder.ts';

export function toGeometry(mesh: BuiltMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));

  return geometry;
}
