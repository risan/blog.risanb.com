// GPU ripple height field, carried downstream by the current. State per texel: height,
// velocity and the height gradient the water pass uses as extra surface slope.

import { bindTexture, createTarget, deleteTarget, drawFullscreen, type Program, type Target } from './gl.ts';

const STEP = 1 / 60;
const MAX_IMPULSES = 8;
const MAX_STEPS_PER_FRAME = 2;

export interface Ripples {
  texture(): WebGLTexture;
  addImpulse(x: number, y: number, strength: number, radius: number): void;
  step(dt: number, time: number): void;
  dispose(): void;
}

export interface RippleOptions {
  width: number;
  height: number;
  // Sets the shared world uniforms (size, orientation, terrain, flow terms) on the program.
  bindWorld: (program: Program) => void;
}

export function createRipples(gl: WebGL2RenderingContext, program: Program, options: RippleOptions): Ripples {
  const { width, height } = options;
  const spec = { width, height, internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
  let read: Target = createTarget(gl, spec);
  let write: Target = createTarget(gl, spec);
  const impulses = new Float32Array(MAX_IMPULSES * 4);
  let queued = 0;
  let pending = 0;

  function runStep(time: number) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(program.program);
    options.bindWorld(program);
    bindTexture(gl, 1, read.texture);
    gl.uniform1i(program.uniforms.uState, 1);
    gl.uniform1f(program.uniforms.uTime, time);
    gl.uniform1f(program.uniforms.uStep, STEP);
    gl.uniform4fv(program.uniforms.uImpulses, impulses);
    drawFullscreen(gl);
    impulses.fill(0);
    queued = 0;

    const swap = read;
    read = write;
    write = swap;
  }

  return {
    texture() {
      return read.texture;
    },
    addImpulse(x, y, strength, radius) {
      if (queued >= MAX_IMPULSES) {
        return;
      }

      const offset = queued * 4;
      impulses[offset] = x;
      impulses[offset + 1] = y;
      impulses[offset + 2] = strength;
      impulses[offset + 3] = radius;
      queued += 1;
    },
    step(dt, time) {
      pending = Math.min(pending + dt, STEP * MAX_STEPS_PER_FRAME + STEP);
      let steps = 0;
      while (pending >= STEP && steps < MAX_STEPS_PER_FRAME) {
        pending -= STEP;
        steps += 1;
        runStep(time);
      }
    },
    dispose() {
      deleteTarget(gl, read);
      deleteTarget(gl, write);
    },
  };
}
