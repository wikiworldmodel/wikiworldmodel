// The local scene renderer (section 3.3): below some altitude it takes over from the globe. It
// draws in metres on the site's grid, with the eye at the origin of what the GPU sees, so
// nothing jitters however close the camera is. A depth prepass feeds ambient occlusion; then the
// sky, the distant land, the near land and the city are lit by one sun, in floating point, with
// cascaded shadows, and finished with bloom and a filmic curve.
import type { GroundLevel } from '../../../core/city.ts';
import { hash3 } from '../../../world/generators/city/math.ts';
import { invert, multiply, type Mat4, type V3 } from '../mat.ts';
import { program, setUniforms, texture2D, type GL, type Program } from './context.ts';
import { AO_FS, BLUR_FS, BRIGHT_FS, DEPTH_FS, FULLSCREEN_VS, ID_FS, MESH_FS, MESH_VS, POST_FS, SKY_FS, SKY_LUT_FS, TERRAIN_FS, TERRAIN_VS, WATER_FS, WATER_VS } from './cityShaders.ts';

/** Texture units, the same for every program. */
const UNIT = { noise: 0, sky: 1, shadow: 2, ao: 3, entities: 4, ground: 5, normal: 8, mask: 11 } as const;

const SHADOW_SIZE = 2048;

/** A mesh of the city on the GPU. */
export interface CellGPU {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  bytes: number;
}

export interface CityFrame {
  /** the eye, in local metres above sea level, with the Earth's curve already taken off */
  eye: V3;
  /** the ground under the eye and the point the camera looks at, for shadows */
  focus: V3;
  /** camera-relative: view rotation, then projection */
  view: Mat4;
  proj: Mat4;
  farProj: Mat4;
  fov: number;
  aspect: number;
  near: number;
  far: number;
  /** direction to the sun */
  sun: V3;
  time: number;
  evidence: boolean;
  /** how much of the frame shows: below 1, the globe shows through */
  alpha: number;
  /** the sky is drawn opaque: nothing of space shows */
  solid: boolean;
  /** height of the eye above the ground, in metres */
  clearance: number;
  width: number;
  height: number;
}

const LOOKAT_UP: V3 = [0, 0, 1];

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(f + n) / (f - n);
  m[15] = 1;
  return m;
}

const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A square grid of the terrain's vertices, with the middle of it left out or not. */
function ringMesh(n: number, hole: number): { positions: Float32Array; indices: Uint32Array; ringCount: number } {
  const side = n * 2 + 1;
  const positions = new Float32Array(side * side * 2);
  let o = 0;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      positions[o++] = i;
      positions[o++] = j;
    }
  }
  const at = (i: number, j: number) => (j + n) * side + (i + n);
  const ring: number[] = [];
  const middle: number[] = [];
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      const inside = i >= -hole && i < hole && j >= -hole && j < hole;
      (inside ? middle : ring).push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return { positions, indices: Uint32Array.from([...ring, ...middle]), ringCount: ring.length };
}

export class CityRenderer {
  private meshP: Program;
  private depthP: Program;
  private idP: Program;
  private terrainP: Program;
  private terrainDepthP: Program;
  private waterP: Program;
  private skyP: Program;
  private lutP: Program;
  private aoP: Program;
  private blurP: Program;
  private brightP: Program;
  private postP: Program;

  private noise: WebGLTexture;
  private lut: WebGLTexture;
  private lutFb: WebGLFramebuffer;
  private lutKey = '';
  private shadow: WebGLTexture;
  private shadowFb: WebGLFramebuffer[] = [];
  private shadowKeys = ['', '', ''];
  private shadowM: Float32Array = new Float32Array(48);
  private shadowRadii: V3 = [100, 500, 9000];
  private entityTex: WebGLTexture | null = null;
  private entityData: Float32Array | null = null;
  private entityRows = 0;
  private entitySerial = 0;
  /** counts the meshes added or removed: shadows must be drawn again */
  private meshSerial = 0;
  private groundTex: WebGLTexture[] = [];
  private normalTex: WebGLTexture[] = [];
  private grids: GroundLevel[] = [];
  private mask: WebGLTexture;
  private maskBox: [number, number, number, number] = [0, 0, 1, 1];
  private ringVao: WebGLVertexArrayObject;
  private ringCount = 0;
  private fullCount = 0;
  private emptyVao: WebGLVertexArrayObject;
  private waterVao: WebGLVertexArrayObject | null = null;
  private waterCount = 0;
  private waterLevel = 7;

  // Render targets, remade when the size changes.
  private w = 0;
  private h = 0;
  private samples = 4;
  private msFb!: WebGLFramebuffer;
  private msColor!: WebGLRenderbuffer;
  private msDepth!: WebGLRenderbuffer;
  private resolveFb!: WebGLFramebuffer;
  private colorTex!: WebGLTexture;
  private depthTex!: WebGLTexture;
  private aoFb: WebGLFramebuffer[] = [];
  private aoTex: WebGLTexture[] = [];
  private bloomFb: WebGLFramebuffer[] = [];
  private bloomTex: WebGLTexture[] = [];
  private pickFb: WebGLFramebuffer | null = null;
  private pickTex: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  /** what the last frame used, for picking */
  private lastFrame: CityFrame | null = null;
  private lastDraw: CellGPU[] = [];
  private sunColor: V3 = [3, 2.8, 2.5];
  private skyTop: V3 = [0.3, 0.45, 0.8];
  private skyLow: V3 = [0.5, 0.55, 0.65];
  private bounce: V3 = [0.2, 0.17, 0.12];

  /** The cells to draw this frame; the scene sets it. */
  shadowCells: (focus: V3, radius: number) => CellGPU[] = () => [];

  constructor(private gl: GL) {
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('This view of the city needs floating-point render targets (EXT_color_buffer_float).');
    gl.getExtension('OES_texture_float_linear');
    this.meshP = program(gl, 'city mesh', MESH_VS, MESH_FS);
    this.depthP = program(gl, 'city depth', MESH_VS, DEPTH_FS);
    this.idP = program(gl, 'city id', MESH_VS, ID_FS);
    this.terrainP = program(gl, 'city terrain', TERRAIN_VS, TERRAIN_FS);
    this.terrainDepthP = program(gl, 'city terrain depth', TERRAIN_VS, `#version 300 es
precision highp float;
in vec3 vPos;
uniform vec4 uInner;
out vec4 o;
void main() {
  if (vPos.x > uInner.x && vPos.y > uInner.y && vPos.x < uInner.z && vPos.y < uInner.w) discard;
  o = vec4(0.0);
}`);
    this.waterP = program(gl, 'city water', WATER_VS, WATER_FS);
    this.skyP = program(gl, 'city sky', FULLSCREEN_VS, SKY_FS);
    this.lutP = program(gl, 'city sky table', FULLSCREEN_VS, SKY_LUT_FS);
    this.aoP = program(gl, 'city ao', FULLSCREEN_VS, AO_FS);
    this.blurP = program(gl, 'city blur', FULLSCREEN_VS, BLUR_FS);
    this.brightP = program(gl, 'city bright', FULLSCREEN_VS, BRIGHT_FS);
    this.postP = program(gl, 'city post', FULLSCREEN_VS, POST_FS);

    // Noise, tiling, in four independent channels: everything's roughness and grain comes from it.
    const size = 64;
    const data = new Uint8Array(size * size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      const n = i / 4;
      const x = n % size;
      const y = Math.floor(n / size) % size;
      const z = Math.floor(n / (size * size));
      for (let c = 0; c < 4; c++) data[i + c] = Math.floor(hash3(x, y, z, 0x3779 + c * 101) * 256);
    }
    this.noise = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + UNIT.noise);
    gl.bindTexture(gl.TEXTURE_3D, this.noise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);

    // The sky table.
    gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
    this.lut = texture2D(gl, { width: 192, height: 128, internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, data: null, filter: gl.LINEAR });
    this.lutFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lut, 0);

    // Shadows: three cascades.
    this.shadow = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + UNIT.shadow);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadow);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 3);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    for (let k = 0; k < 3; k++) {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.shadow, 0, k);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.shadowFb.push(fb);
    }

    gl.activeTexture(gl.TEXTURE0 + UNIT.mask);
    this.mask = texture2D(gl, { width: 1, height: 1, internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: new Uint8Array([0, 0, 0, 0]), filter: gl.LINEAR });

    const ring = ringMesh(64, 30);
    this.ringVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.ringVao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, ring.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ring.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.ringCount = ring.ringCount;
    this.fullCount = ring.indices.length;
    this.emptyVao = gl.createVertexArray()!;
    this.bindSamplers();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private bindSamplers(): void {
    const gl = this.gl;
    const ints = (p: Program, names: Record<string, number>) => {
      gl.useProgram(p.program);
      for (const [n, v] of Object.entries(names)) {
        const loc = p.uniforms.get(n);
        if (loc) gl.uniform1i(loc, v);
      }
    };
    const lit = { uNoise: UNIT.noise, uSkyLut: UNIT.sky, uShadow: UNIT.shadow, uAO: UNIT.ao, uEntities: UNIT.entities };
    const ground = { uGround0: UNIT.ground, uGround1: UNIT.ground + 1, uGround2: UNIT.ground + 2, uNormal0: UNIT.normal, uNormal1: UNIT.normal + 1, uNormal2: UNIT.normal + 2, uMask: UNIT.mask };
    ints(this.meshP, lit);
    ints(this.depthP, { uEntities: UNIT.entities });
    ints(this.idP, { uEntities: UNIT.entities });
    ints(this.terrainP, { ...lit, ...ground });
    ints(this.terrainDepthP, ground);
    ints(this.waterP, lit);
    ints(this.skyP, { uNoise: UNIT.noise, uSkyLut: UNIT.sky });
    ints(this.aoP, { uDepth: 12 });
    ints(this.blurP, { uTex: 13, uDepth: 12 });
    ints(this.brightP, { uTex: 13 });
    ints(this.postP, { uScene: 13, uBloom0: 14, uBloom1: 15, uBloom2: 16 });
  }

  /** The ground's grids: heights to sample in the vertex shader, and normals to filter. */
  setGround(levels: GroundLevel[], heights: Int16Array[]): void {
    const gl = this.gl;
    this.grids = levels;
    levels.forEach((g, k) => {
      const z = heights[k];
      gl.activeTexture(gl.TEXTURE0 + UNIT.ground + k);
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, g.nx, g.ny, 0, gl.RED_INTEGER, gl.SHORT, z);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.groundTex.push(t);
      const n = new Uint8Array(g.nx * g.ny * 4);
      const scale = 0.1 / (2 * g.cell);
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const l = z[j * g.nx + Math.max(0, i - 1)];
          const r = z[j * g.nx + Math.min(g.nx - 1, i + 1)];
          const d = z[Math.max(0, j - 1) * g.nx + i];
          const u = z[Math.min(g.ny - 1, j + 1) * g.nx + i];
          const nx = (l - r) * scale;
          const ny = (d - u) * scale;
          const q = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          const at = (j * g.nx + i) * 4;
          n[at] = Math.round((nx * q * 0.5 + 0.5) * 255);
          n[at + 1] = Math.round((ny * q * 0.5 + 0.5) * 255);
          // How far above the sea, finely near the shore: the coast is drawn where this crosses a half.
          n[at + 2] = Math.max(0, Math.min(255, Math.floor(127 + z[j * g.nx + i] * 0.04)));
          n[at + 3] = 255;
        }
      }
      gl.activeTexture(gl.TEXTURE0 + UNIT.normal + k);
      const nt = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, nt);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, g.nx, g.ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, n);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.normalTex.push(nt);
    });
    gl.activeTexture(gl.TEXTURE0);
  }

  /** What the plan says the ground is: R built-up, G garden. */
  setMask(data: Uint8Array, size: number, box: [number, number, number, number]): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT.mask);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);
    this.maskBox = box;
  }

  setWater(vertices: Float32Array, indices: Uint32Array, level: number): void {
    const gl = this.gl;
    this.waterLevel = level;
    this.waterVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.waterCount = indices.length;
  }

  /** When each entity stood, and what it rests on: [start, end, flags, ground] per entity. */
  setEntities(data: Float32Array): void {
    const gl = this.gl;
    this.entityData = data;
    this.entityRows = Math.ceil(data.length / 4 / 256);
    if (this.entityTex) gl.deleteTexture(this.entityTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT.entities);
    const padded = new Float32Array(256 * this.entityRows * 4);
    padded.set(data);
    this.entityData = padded;
    this.entityTex = texture2D(gl, { width: 256, height: this.entityRows, internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: padded });
    gl.activeTexture(gl.TEXTURE0);
    this.entitySerial++;
  }

  /** Change when an entity stood, as a scenario dates it. */
  setEntityTime(index: number, start: number, end: number): void {
    if (!this.entityData || !this.entityTex) return;
    const gl = this.gl;
    if (this.entityData[index * 4] === start && this.entityData[index * 4 + 1] === end) return;
    this.entityData[index * 4] = start;
    this.entityData[index * 4 + 1] = end;
    gl.activeTexture(gl.TEXTURE0 + UNIT.entities);
    gl.bindTexture(gl.TEXTURE_2D, this.entityTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, index & 255, index >> 8, 1, 1, gl.RGBA, gl.FLOAT, this.entityData, index * 4);
    gl.activeTexture(gl.TEXTURE0);
    this.entitySerial++;
  }

  /** Change one entity's flags: its basis, selection and hover. */
  setEntityFlags(index: number, flags: number): void {
    if (!this.entityData || !this.entityTex) return;
    const gl = this.gl;
    if (this.entityData[index * 4 + 2] === flags) return;
    this.entityData[index * 4 + 2] = flags;
    gl.activeTexture(gl.TEXTURE0 + UNIT.entities);
    gl.bindTexture(gl.TEXTURE_2D, this.entityTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, index & 255, index >> 8, 1, 1, gl.RGBA, gl.FLOAT, this.entityData, index * 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Put a mesh on the GPU. */
  upload(vertices: ArrayBuffer, indices: Uint32Array): CellGPU {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const stride = 28;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 2, gl.UNSIGNED_BYTE, stride, 24);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_SHORT, stride, 26);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.meshSerial++;
    return { vao, vbo, ibo, count: indices.length, bytes: vertices.byteLength + indices.byteLength };
  }

  remove(c: CellGPU): void {
    const gl = this.gl;
    this.meshSerial++;
    gl.deleteVertexArray(c.vao);
    gl.deleteBuffer(c.vbo);
    gl.deleteBuffer(c.ibo);
  }

  private resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    const maxS = (gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array | null)?.[0] ?? 0;
    this.samples = Math.min(4, maxS);
    if (!this.msFb) {
      this.msFb = gl.createFramebuffer()!;
      this.msColor = gl.createRenderbuffer()!;
      this.msDepth = gl.createRenderbuffer()!;
      this.resolveFb = gl.createFramebuffer()!;
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA16F, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('the city needs a multisampled floating-point target');
    gl.activeTexture(gl.TEXTURE12);
    if (this.colorTex) gl.deleteTexture(this.colorTex);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    this.colorTex = texture2D(gl, { width: w, height: h, internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, data: null, filter: gl.LINEAR });
    this.depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    // Half-size occlusion, and the bloom's chain.
    for (const t of [...this.aoTex, ...this.bloomTex]) gl.deleteTexture(t);
    for (const f of [...this.aoFb, ...this.bloomFb]) gl.deleteFramebuffer(f);
    this.aoTex = [];
    this.aoFb = [];
    this.bloomTex = [];
    this.bloomFb = [];
    const target = (tw: number, th: number, internal: number, format: number, type: number, list: WebGLTexture[], fbs: WebGLFramebuffer[]) => {
      const t = texture2D(gl, { width: tw, height: th, internal, format, type, data: null, filter: gl.LINEAR });
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      list.push(t);
      fbs.push(f);
    };
    const aw = Math.max(1, w >> 1);
    const ah = Math.max(1, h >> 1);
    target(aw, ah, gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.aoTex, this.aoFb);
    target(aw, ah, gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.aoTex, this.aoFb);
    for (let k = 0; k < 3; k++) target(Math.max(1, w >> (k + 1)), Math.max(1, h >> (k + 1)), gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, this.bloomTex, this.bloomFb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The sky table and the light of this sun, seen from this height. */
  private updateSky(sun: V3, height: number): void {
    const gl = this.gl;
    const sunKey = sun.map((x) => x.toFixed(4)).join();
    const key = `${sunKey}|${Math.round(height / 200)}`;
    if (key === this.lutKey) return;
    const sunChanged = this.lutKey.split('|')[0] !== sunKey;
    this.lutKey = key;
    const el = Math.asin(Math.max(-1, Math.min(1, sun[2])));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFb);
    gl.viewport(0, 0, 192, 128);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.lutP.program);
    gl.bindVertexArray(this.emptyVao);
    const draw = (h: number) => {
      setUniforms(gl, this.lutP, { uSunLut: [Math.cos(el), 0, Math.sin(el)], uHeight: Math.max(1, h) });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    if (!sunChanged) return draw(height);
    draw(20);
    // The light it gives: read back from the table straight up, and around the horizon.
    const read = (u: number, v: number): V3 => {
      const px = new Float32Array(4);
      gl.readPixels(Math.floor(u * 191), Math.floor(v * 127), 1, 1, gl.RGBA, gl.FLOAT, px);
      return [px[0], px[1], px[2]];
    };
    const zen = read(0.5, 0.97);
    const hA = read(0.1, 0.56);
    const hB = read(0.9, 0.56);
    const hM = read(0.5, 0.56);
    const low: V3 = [(hA[0] + hB[0] + 2 * hM[0]) / 4, (hA[1] + hB[1] + 2 * hM[1]) / 4, (hA[2] + hB[2] + 2 * hM[2]) / 4];
    // Sunlight, reddened by the air it crossed.
    const deg = (el * 180) / Math.PI;
    const air = 1 / (Math.max(Math.sin(el), 0) + 0.15 * Math.pow(Math.max(deg + 3.885, 0.3), -1.253));
    const tr = (b: number, m: number) => Math.exp(-(b * 8000 + m * 1500 * 1.1) * air);
    const up = Math.max(0, Math.min(1, (deg + 2) / 4));
    // Softened toward white a little: a camera's white balance would do as much.
    const soft = (x: number) => Math.pow(x, 0.62);
    this.sunColor = [soft(tr(5.8e-6, 14e-6)) * 3.8 * up, soft(tr(13.5e-6, 14e-6)) * 3.75 * up, soft(tr(33.1e-6, 14e-6)) * 3.7 * up];
    this.skyTop = [zen[0] * 0.62, zen[1] * 0.62, zen[2] * 0.62];
    this.skyLow = [low[0] * 0.26, low[1] * 0.26, low[2] * 0.26];
    const s = Math.max(sun[2], 0);
    this.bounce = [(this.sunColor[0] * s + this.skyTop[0]) * 0.13, (this.sunColor[1] * s + this.skyTop[1]) * 0.105, (this.sunColor[2] * s + this.skyTop[2]) * 0.075];
    for (let k = 0; k < 3; k++) this.shadowKeys[k] = '';
    draw(height);
  }

  private useLit(p: Program, f: CityFrame, vp: Mat4): void {
    const gl = this.gl;
    gl.useProgram(p.program);
    setUniforms(gl, p, {
      uViewProj: vp,
      uEye: f.eye,
      uSun: f.sun,
      uSunColor: this.sunColor,
      uSkyTop: this.skyTop,
      uSkyLow: this.skyLow,
      uBounce: this.bounce,
      uShadowFocus: f.focus,
      uShadowRadii: this.shadowRadii,
      uHazeK: 2.0e-5,
      uTime: f.time,
      uAOSize: [this.w, this.h],
      uEvidence: f.evidence ? 1 : 0,
    });
    const m = p.uniforms.get('uShadowM');
    if (m) gl.uniformMatrix4fv(m, false, this.shadowM);
  }

  private setGrids(p: Program): void {
    const gl = this.gl;
    const grid = p.uniforms.get('uGrid');
    const size = p.uniforms.get('uGridSize');
    if (grid) gl.uniform4fv(grid, this.grids.flatMap((g) => [g.x0, g.y0, g.cell, 32 * g.cell]));
    if (size) gl.uniform2fv(size, this.grids.flatMap((g) => [g.nx, g.ny]));
  }

  /** Draw a span of the terrain's rings: each twice the size of the last, centred on the eye. */
  private drawRings(p: Program, eye: V3, from: number, to: number, finest: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.ringVao);
    const cellLoc = p.uniforms.get('uCell');
    const centerLoc = p.uniforms.get('uCenter');
    const innerLoc = p.uniforms.get('uInner');
    for (let k = from; k <= to; k++) {
      const cell = 5 * 2 ** k;
      const snap = cell * 2;
      const cx = Math.round(eye[0] / snap) * snap;
      const cy = Math.round(eye[1] / snap) * snap;
      gl.uniform1f(cellLoc!, cell);
      gl.uniform2f(centerLoc!, cx, cy);
      if (k === finest) {
        gl.uniform4f(innerLoc!, 1e9, 1e9, -1e9, -1e9);
        gl.drawElements(gl.TRIANGLES, this.fullCount, gl.UNSIGNED_INT, 0);
      } else {
        const fine = cell / 2;
        const fsnap = fine * 2;
        const fx = Math.round(eye[0] / fsnap) * fsnap;
        const fy = Math.round(eye[1] / fsnap) * fsnap;
        const ext = fine * 64;
        gl.uniform4f(innerLoc!, fx - ext, fy - ext, fx + ext, fy + ext);
        gl.drawElements(gl.TRIANGLES, this.ringCount, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);
  }

  /** The terrain's rings in view of this frame: the finest worth drawing, and where far and near part. */
  private ringsFor(f: CityFrame): { finest: number; split: number; last: number } {
    // Fine enough for a narrow valley or the river's bed to show from a few kilometres up.
    const finest = Math.max(0, Math.min(10, Math.floor(Math.log2(Math.max(f.clearance, 1) / 40)) - 3));
    let split = finest;
    // A ring goes in the near pass if it reaches no further than the near pass's far plane.
    while (split < 11 && 5 * 2 ** split * 64 < f.far * 0.8) split++;
    return { finest, split, last: 11 };
  }

  /** The shadow cascades: nearest, middle, and the whole city, each from the sun's side. */
  private updateShadows(f: CityFrame): void {
    const gl = this.gl;
    const sun = f.sun;
    if (sun[2] <= 0) return;
    const range = Math.max(30, Math.hypot(f.eye[0] - f.focus[0], f.eye[1] - f.focus[1], f.eye[2] - f.focus[2]));
    const r0 = Math.min(Math.max(70, range * 1.0), 1400);
    const r1 = Math.min(r0 * 5, 7000);
    const r2 = Math.max(r1 * 2.5, 9000);
    this.shadowRadii = [r0, r1, r2];
    const right = nrm(crs(LOOKAT_UP, sun));
    const up = crs(sun, right);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.0, 4.0);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    for (let k = 2; k >= 0; k--) {
      const r = this.shadowRadii[k];
      const texel = (r * 2) / SHADOW_SIZE;
      // Snap to the shadow map's own grid, so its edges do not crawl as the camera moves.
      const cR = dt(f.focus, right);
      const cU = dt(f.focus, up);
      const sR = Math.round(cR / texel) * texel;
      const sU = Math.round(cU / texel) * texel;
      const key = `${sR.toFixed(1)},${sU.toFixed(1)},${r.toFixed(1)},${sun.join()},${k === 2 ? Math.round(f.time / 4) : f.time},${this.entitySerial},${this.meshSerial}`;
      const depthRange = Math.max(r * 4, 2500);
      const zc = dt(f.focus, sun);
      const view = new Float32Array([right[0], up[0], sun[0], 0, right[1], up[1], sun[1], 0, right[2], up[2], sun[2], 0, 0, 0, 0, 1]);
      const proj = ortho(sR - r, sR + r, sU - r, sU + r, -(zc + depthRange), -(zc - depthRange));
      const m = multiply(proj, view);
      this.shadowM.set(m, k * 16);
      if (key === this.shadowKeys[k]) continue;
      this.shadowKeys[k] = key;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb[k]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // Everything's position already has the eye taken off for the camera; here it is absolute.
      gl.useProgram(this.depthP.program);
      setUniforms(gl, this.depthP, { uViewProj: m, uEye: [0, 0, 0], uTime: f.time });
      // Both sides of a face: many of a building's are shells, seen from either side.
      gl.disable(gl.CULL_FACE);
      for (const c of this.shadowCells(f.focus, r * 1.45)) {
        gl.bindVertexArray(c.vao);
        gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
      // The hills cast shadows too.
      gl.useProgram(this.terrainDepthP.program);
      setUniforms(gl, this.terrainDepthP, { uViewProj: m, uEye: [0, 0, 0] });
      this.setGrids(this.terrainDepthP);
      const ring = Math.max(0, Math.ceil(Math.log2((r * 2.2) / 320)));
      this.drawRings(this.terrainDepthP, f.focus, ring, ring, ring);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(null);
  }

  /** A frame of the scene. The globe, if it shows through, has already been drawn. */
  render(f: CityFrame, cells: CellGPU[], outW: number, outH: number): void {
    const gl = this.gl;
    this.resize(outW, outH);
    this.lastFrame = f;
    this.lastDraw = cells;
    this.updateSky(f.sun, f.eye[2]);

    const vp = multiply(f.proj, f.view);
    const farVp = multiply(f.farProj, f.view);
    const { finest, split, last } = this.ringsFor(f);

    // The bindings every lit program reads.
    gl.activeTexture(gl.TEXTURE0 + UNIT.noise);
    gl.bindTexture(gl.TEXTURE_3D, this.noise);
    gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.activeTexture(gl.TEXTURE0 + UNIT.shadow);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadow);
    gl.activeTexture(gl.TEXTURE0 + UNIT.entities);
    gl.bindTexture(gl.TEXTURE_2D, this.entityTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT.mask);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    this.groundTex.forEach((t, k) => {
      gl.activeTexture(gl.TEXTURE0 + UNIT.ground + k);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    this.normalTex.forEach((t, k) => {
      gl.activeTexture(gl.TEXTURE0 + UNIT.normal + k);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    this.updateShadows(f);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);

    // The sky.
    gl.useProgram(this.skyP.program);
    setUniforms(gl, this.skyP, { uInvViewProj: invert(farVp), uSun: f.sun, uSunColor: this.sunColor, uHeight: f.eye[2], uAlpha: f.solid ? 1 : 0 });
    gl.activeTexture(gl.TEXTURE0 + UNIT.ao);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // The distant land, in its own depth range.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    if (split <= last) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.ao);
      gl.bindTexture(gl.TEXTURE_2D, this.aoTex[1] ?? null);
      this.useLit(this.terrainP, f, farVp);
      setUniforms(gl, this.terrainP, { uUseAO: 0, uMaskBox: [this.maskBox[0], this.maskBox[1], this.maskBox[2] - this.maskBox[0], this.maskBox[3] - this.maskBox[1]], uWater: this.waterLevel });
      this.setGrids(this.terrainP);
      this.drawRings(this.terrainP, f.eye, Math.max(split, finest), last, -1);
    }
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // The near scene's depth, for its occlusion.
    gl.colorMask(false, false, false, false);
    gl.useProgram(this.terrainDepthP.program);
    setUniforms(gl, this.terrainDepthP, { uViewProj: vp, uEye: f.eye });
    this.setGrids(this.terrainDepthP);
    this.drawRings(this.terrainDepthP, f.eye, finest, Math.min(split, last), finest);
    gl.useProgram(this.depthP.program);
    setUniforms(gl, this.depthP, { uViewProj: vp, uEye: f.eye, uTime: f.time });
    // Both sides, as the lit pass draws them.
    gl.disable(gl.CULL_FACE);
    for (const c of cells) {
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    this.occlusion(f);

    // The near scene, lit.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0 + UNIT.ao);
    gl.bindTexture(gl.TEXTURE_2D, this.aoTex[1]);
    this.useLit(this.terrainP, f, vp);
    setUniforms(gl, this.terrainP, { uUseAO: 1, uMaskBox: [this.maskBox[0], this.maskBox[1], this.maskBox[2] - this.maskBox[0], this.maskBox[3] - this.maskBox[1]], uWater: this.waterLevel });
    this.setGrids(this.terrainP);
    this.drawRings(this.terrainP, f.eye, finest, Math.min(split, last), finest);
    gl.disable(gl.CULL_FACE);
    this.useLit(this.meshP, f, vp);
    for (const c of cells) {
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0);
    }
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    if (this.waterVao) {
      this.useLit(this.waterP, f, vp);
      gl.bindVertexArray(this.waterVao);
      gl.drawElements(gl.TRIANGLES, this.waterCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);

    // Resolve, then finish.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    this.finish(f);
  }

  private occlusion(f: CityFrame): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    const aw = Math.max(1, this.w >> 1);
    const ah = Math.max(1, this.h >> 1);
    const kY = Math.tan(f.fov / 2);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT.ao);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(this.emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFb[0]);
    gl.viewport(0, 0, aw, ah);
    gl.useProgram(this.aoP.program);
    setUniforms(gl, this.aoP, { uProjK: [kY * f.aspect, kY], uNearFar: [f.near, f.far], uTexel: [1 / aw, 1 / ah] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blurP.program);
    setUniforms(gl, this.blurP, { uNearFar: [f.near, f.far] });
    // Blur across, into the second, then back along into the first; the last read is the second.
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.aoTex[0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFb[1]);
    setUniforms(gl, this.blurP, { uDir: [1 / aw, 0] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.aoTex[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFb[0]);
    setUniforms(gl, this.blurP, { uDir: [0, 1 / ah] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.aoTex[0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFb[1]);
    setUniforms(gl, this.blurP, { uDir: [0.7 / aw, 0.7 / ah] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private finish(f: CityFrame): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE13);
    gl.useProgram(this.brightP.program);
    let src = this.colorTex;
    let sw = this.w;
    let sh = this.h;
    this.bloomTex.forEach((t, k) => {
      const tw = Math.max(1, this.w >> (k + 1));
      const th = Math.max(1, this.h >> (k + 1));
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFb[k]);
      gl.viewport(0, 0, tw, th);
      setUniforms(gl, this.brightP, { uTexel: [0.5 / sw, 0.5 / sh], uThreshold: k === 0 ? 1.1 : 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t;
      sw = tw;
      sh = th;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.postP.program);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.activeTexture(gl.TEXTURE14);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[1]);
    gl.activeTexture(gl.TEXTURE16);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[2]);
    // A camera stops down for a high sun.
    setUniforms(gl, this.postP, { uExposure: 0.62 * (1 - 0.42 * Math.max(f.sun[2], 0)), uAlpha: f.alpha });
    if (f.alpha < 1 || !f.solid) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.frontFace(gl.CCW);
  }

  /** What entity is at a pixel of the last frame, if any. CSS pixels are for the caller to scale. */
  pick(x: number, y: number): number {
    const gl = this.gl;
    const f = this.lastFrame;
    if (!f) return 0;
    if (!this.pickFb) {
      this.pickFb = gl.createFramebuffer()!;
      this.pickTex = gl.createTexture()!;
      this.pickDepth = gl.createRenderbuffer()!;
    }
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.w, this.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0 + UNIT.entities);
    gl.bindTexture(gl.TEXTURE_2D, this.entityTex);
    const vp = multiply(f.proj, f.view);
    // The ground first, so it hides what lies behind a hill.
    gl.colorMask(false, false, false, false);
    gl.useProgram(this.terrainDepthP.program);
    setUniforms(gl, this.terrainDepthP, { uViewProj: vp, uEye: f.eye });
    this.setGrids(this.terrainDepthP);
    const { finest, split, last } = this.ringsFor(f);
    this.drawRings(this.terrainDepthP, f.eye, finest, Math.min(split, last), finest);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.idP.program);
    setUniforms(gl, this.idP, { uViewProj: vp, uEye: f.eye, uTime: f.time });
    for (const c of this.lastDraw) {
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return px[0] + px[1] * 256;
  }
}
