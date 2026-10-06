import common from './common.glsl?raw';
import flow from './flow.glsl?raw';
import fullscreenVertex from './fullscreen.vert?raw';
import tilesFragment from './tiles.frag?raw';
import bakeFragment from './bake.frag?raw';
import rippleFragment from './ripple.frag?raw';
import waterFragment from './water.frag?raw';
import fishVertex from './fish.vert?raw';
import fishFragment from './fish.frag?raw';
import driftVertex from './drift.vert?raw';
import driftFragment from './drift.frag?raw';
import grassVertex from './grass.vert?raw';
import grassFragment from './grass.frag?raw';
import fernVertex from './fern.vert?raw';
import fernFragment from './fern.frag?raw';

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

function assemble(...chunks: string[]): string {
  return HEADER + chunks.join('\n');
}

export const shaderSources = {
  fullscreenVertex: assemble(fullscreenVertex),
  tiles: assemble(common, tilesFragment),
  bake: assemble(common, flow, bakeFragment),
  ripple: assemble(common, flow, rippleFragment),
  water: assemble(common, flow, waterFragment),
  fishVertex: assemble(common, fishVertex),
  fishFragment: assemble(common, fishFragment),
  driftVertex: assemble(common, driftVertex),
  driftFragment: assemble(common, driftFragment),
  grassVertex: assemble(common, grassVertex),
  grassFragment: assemble(common, grassFragment),
  fernVertex: assemble(common, fernVertex),
  fernFragment: assemble(common, fernFragment),
};
