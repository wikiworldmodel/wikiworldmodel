// Small WebGL2 helpers: programs, uniforms, textures and render targets.

export type GL = WebGL2RenderingContext;

export interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

function compile(gl: GL, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    // The lines the compiler complains of, not the whole source.
    const lines = src.split('\n');
    const named = [...log.matchAll(/ERROR: \d+:(\d+)/g)].map((m) => Number(m[1]));
    const shown = [...new Set(named)].slice(0, 8).map((n) => `${String(n).padStart(4)} ${lines[n - 1]?.trim().slice(0, 140)}`).join('\n');
    throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log}\n${shown}`);
  }
  return s;
}

export function program(gl: GL, name: string, vs: string, fs: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = new Map<string, WebGLUniformLocation>();
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    const loc = gl.getUniformLocation(p, info.name);
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), loc);
  }
  return { program: p, uniforms };
}

/** Set uniforms by name; numbers become floats unless listed in `ints`. */
export function setUniforms(gl: GL, p: Program, values: Record<string, number | number[] | Float32Array | boolean>, ints: string[] = []): void {
  for (const [name, v] of Object.entries(values)) {
    const loc = p.uniforms.get(name);
    if (!loc) continue;
    if (typeof v === 'boolean') gl.uniform1i(loc, v ? 1 : 0);
    else if (typeof v === 'number') {
      if (ints.includes(name)) gl.uniform1i(loc, v);
      else gl.uniform1f(loc, v);
    } else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
    else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else gl.uniform1fv(loc, v);
  }
}

export function texture2D(
  gl: GL,
  opts: { width: number; height: number; internal: number; format: number; type: number; data: ArrayBufferView | null; filter?: number; wrapS?: number },
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, opts.internal, opts.width, opts.height, 0, opts.format, opts.type, opts.data);
  const f = opts.filter ?? gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** A cube map with one framebuffer and depth buffer per face. */
export interface CubeTarget {
  texture: WebGLTexture;
  size: number;
  framebuffers: WebGLFramebuffer[];
}

export function cubeTarget(gl: GL, size: number, internal: number, format: number, type: number): CubeTarget {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, internal, size, size, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const depth = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);
  const framebuffers: WebGLFramebuffer[] = [];
  for (let f = 0; f < 6; f++) {
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`cube face ${f} framebuffer incomplete (0x${status.toString(16)})`);
    framebuffers.push(fb);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, size, framebuffers };
}

/**
 * Clip-space rows (x_c, y_c, w_c) of each cube face, from the OpenGL cube-map face selection
 * table, so that a direction rendered into face f is the direction that samples it there.
 */
export const CUBE_FACES: number[][] = [
  [0, 0, -1, 0, -1, 0, 1, 0, 0], // +X: sc = −rz, tc = −ry, ma = rx
  [0, 0, 1, 0, -1, 0, -1, 0, 0], // −X: sc = +rz, tc = −ry
  [1, 0, 0, 0, 0, 1, 0, 1, 0], // +Y: sc = +rx, tc = +rz
  [1, 0, 0, 0, 0, -1, 0, -1, 0], // −Y: sc = +rx, tc = −rz
  [1, 0, 0, 0, -1, 0, 0, 0, 1], // +Z: sc = +rx, tc = −ry
  [-1, 0, 0, 0, -1, 0, 0, 0, -1], // −Z: sc = −rx, tc = −ry
];
