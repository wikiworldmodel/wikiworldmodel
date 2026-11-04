// The field pass: render the two keyframes that bracket the current time into a cube map,
// each moved with its plates from its own time to the current one ("plate-warp").
//
// Every grid node of a keyframe sits on a plate (or none). Moving a node from keyframe time
// T_k to time t is the rotation q_p(t) · q_p(T_k)⁻¹ of its plate p: the same rotation model
// that moves the entities, so markers and coastlines move together. Where neighbouring nodes
// sit on different plates the triangles between them stretch or fold; folds are resolved by
// depth, higher ground winning. The cube map holds (elev_k, elev_k+1, plate_k, plate_k+1).
import type { FieldGrid } from '../../../core/tileset.ts';
import { CUBE_FACES, cubeTarget, program, setUniforms, type CubeTarget, type GL, type Program } from './context.ts';

const VS = `#version 300 es
precision highp float;
precision highp int;
uniform highp isampler2D uKey;
uniform highp sampler2D uRot;
uniform int uRow;
uniform int uNx;
uniform vec3 uGrid;
uniform vec3 uFx;
uniform vec3 uFy;
uniform vec3 uFw;
uniform float uLodBias;
out float vElev;
flat out float vPlate;
void main() {
  int i = gl_VertexID % uNx;
  int j = gl_VertexID / uNx;
  ivec2 kv = texelFetch(uKey, ivec2(i, j), 0).rg;
  float lon = radians(uGrid.x + float(i) * uGrid.z);
  float lat = radians(uGrid.y - float(j) * uGrid.z);
  vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  vec4 q = texelFetch(uRot, ivec2(kv.g, uRow), 0);
  vec3 u = q.yzw;
  vec3 c = cross(u, p);
  p = p + 2.0 * (q.x * c + cross(u, c));
  float e = float(kv.r);
  vElev = e;
  vPlate = float(kv.g);
  float d = clamp(0.25 - e / 50000.0, 0.01, 0.49) + uLodBias;
  float w = dot(uFw, p);
  gl_Position = vec4(dot(uFx, p), dot(uFy, p), (2.0 * d - 1.0) * w, w);
}`;

const FS = `#version 300 es
precision highp float;
in float vElev;
flat in float vPlate;
out vec4 o;
void main() { o = vec4(vElev, vElev, vPlate, vPlate); }`;

export interface FieldTileGPU {
  id: string;
  lod: number;
  grid: FieldGrid;
  /** keyframe age (Ma) → RG16I texture of (elevation, plate index) */
  keyframes: Map<number, WebGLTexture>;
  bytes: number;
}

interface GridMesh {
  index: WebGLBuffer;
  count: number;
}

export const OCEAN_DEFAULT = -4000;

// The climate pass: the same warp, but of four bytes per node, into a smaller cube. Where warping
// folds a node of the model's land onto a node it spread over the sea, the land wins.
const CLIMATE_VS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uVal;
uniform highp usampler2D uPlate;
uniform highp sampler2D uRot;
uniform int uRow;
uniform int uNx;
uniform vec3 uGrid;
uniform vec3 uFx;
uniform vec3 uFy;
uniform vec3 uFw;
out vec4 vV;
void main() {
  int i = gl_VertexID % uNx;
  int j = gl_VertexID / uNx;
  uint pl = texelFetch(uPlate, ivec2(i, j), 0).r;
  vV = texelFetch(uVal, ivec2(i, j), 0);
  float lon = radians(uGrid.x + float(i) * uGrid.z);
  float lat = radians(uGrid.y - float(j) * uGrid.z);
  vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  vec4 q = texelFetch(uRot, ivec2(int(pl & 0x7fffu), uRow), 0);
  vec3 u = q.yzw;
  vec3 c = cross(u, p);
  p = p + 2.0 * (q.x * c + cross(u, c));
  float d = (pl & 0x8000u) != 0u ? 0.25 : 0.75;
  float w = dot(uFw, p);
  gl_Position = vec4(dot(uFx, p), dot(uFy, p), (2.0 * d - 1.0) * w, w);
}`;

const CLIMATE_FS = `#version 300 es
precision highp float;
in vec4 vV;
out vec4 o;
void main() { o = vV; }`;

export interface ClimateKeyGPU {
  values: WebGLTexture;
  plate: WebGLTexture;
}

export class FieldRenderer {
  readonly cube: CubeTarget;
  private prog: Program;
  private rot: WebGLTexture;
  private meshes = new Map<string, GridMesh>();
  private vao: WebGLVertexArrayObject;
  private climateProg: Program | null = null;
  private climateRot: WebGLTexture | null = null;
  /** the climate at the two keyframes around the time shown, each moved with its plates to it */
  climateCubes: [CubeTarget, CubeTarget] | null = null;
  private climateKeys = new Map<number, ClimateKeyGPU>();
  private climateGrid: FieldGrid | null = null;

  constructor(private gl: GL, private plateCount: number, size = 512) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This viewer needs WebGL2 with EXT_color_buffer_float.');
    this.cube = cubeTarget(gl, size, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    this.prog = program(gl, 'field', VS, FS);
    this.rot = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.rot);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, plateCount, 2, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.vao = gl.createVertexArray()!;
    // Until the first tiles arrive, the map is open ocean everywhere.
    for (const fb of this.cube.framebuffers) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.clearColor(OCEAN_DEFAULT, OCEAN_DEFAULT, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  addTile(id: string, lod: number, grid: FieldGrid, keyframes: { ageMa: number; elev: Int16Array; plate: Uint16Array }[]): FieldTileGPU {
    const gl = this.gl;
    const tex = new Map<number, WebGLTexture>();
    const n = grid.nx * grid.ny;
    for (const k of keyframes) {
      const data = new Int16Array(2 * n);
      for (let i = 0; i < n; i++) {
        data[2 * i] = k.elev[i];
        data[2 * i + 1] = k.plate[i];
      }
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16I, grid.nx, grid.ny, 0, gl.RG_INTEGER, gl.SHORT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      tex.set(k.ageMa, t);
    }
    return { id, lod, grid, keyframes: tex, bytes: n * 4 * keyframes.length };
  }

  removeTile(t: FieldTileGPU): void {
    for (const tex of t.keyframes.values()) this.gl.deleteTexture(tex);
    t.keyframes.clear();
  }

  private mesh(grid: FieldGrid): GridMesh {
    const key = `${grid.nx}x${grid.ny}${grid.wrap ? 'w' : ''}`;
    let m = this.meshes.get(key);
    if (m) return m;
    const cols = grid.wrap ? grid.nx : grid.nx - 1;
    const idx = new Uint32Array(cols * (grid.ny - 1) * 6);
    let o = 0;
    for (let j = 0; j < grid.ny - 1; j++) {
      for (let i = 0; i < cols; i++) {
        const i1 = (i + 1) % grid.nx;
        const a = j * grid.nx + i;
        const b = j * grid.nx + i1;
        const c = (j + 1) * grid.nx + i;
        const d = (j + 1) * grid.nx + i1;
        idx.set([a, c, b, b, c, d], o);
        o += 6;
      }
    }
    const gl = this.gl;
    const index = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    m = { index, count: idx.length };
    this.meshes.set(key, m);
    return m;
  }

  /**
   * Render keyframes k0 and k1 (ages in Ma), with per-plate rotations from each keyframe's
   * time to the current time (`rotK0`, `rotK1`: w,x,y,z per plate index), into the cube map.
   * Tiles are drawn coarse first; finer tiles win where they overlap.
   */
  render(k0: number, k1: number, rotK0: Float32Array, rotK1: Float32Array, tiles: FieldTileGPU[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.rot);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.plateCount, 1, gl.RGBA, gl.FLOAT, rotK0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, this.plateCount, 1, gl.RGBA, gl.FLOAT, rotK1);
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.cube.size, this.cube.size);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rot);
    setUniforms(gl, this.prog, { uRot: 1 }, ['uRot']);
    const sorted = [...tiles].sort((a, b) => a.lod - b.lod);
    for (let f = 0; f < 6; f++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cube.framebuffers[f]);
      gl.colorMask(true, true, true, true);
      gl.clearColor(OCEAN_DEFAULT, OCEAN_DEFAULT, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const F = CUBE_FACES[f];
      setUniforms(gl, this.prog, { uFx: F.slice(0, 3), uFy: F.slice(3, 6), uFw: F.slice(6, 9) });
      for (const [row, age] of [[0, k0], [1, k1]] as const) {
        if (row === 1) gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(row === 0, row === 1, row === 0, row === 1);
        setUniforms(gl, this.prog, { uRow: row }, ['uRow']);
        for (const t of sorted) {
          const tex = t.keyframes.get(age);
          if (!tex) continue;
          const m = this.mesh(t.grid);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          setUniforms(gl, this.prog, { uKey: 0, uNx: t.grid.nx }, ['uKey', 'uNx']);
          setUniforms(gl, this.prog, { uGrid: [t.grid.lon0, t.grid.lat0, t.grid.step], uLodBias: t.lod === 0 ? 0.5 : 0 });
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.index);
          gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
        }
      }
    }
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Take the climate field's keyframes to the GPU. */
  setClimate(grid: FieldGrid, keyframes: { ageMa: number; values: Uint8Array; plate: Uint16Array }[], size = 256): void {
    const gl = this.gl;
    this.climateProg = program(gl, 'climate', CLIMATE_VS, CLIMATE_FS);
    this.climateGrid = grid;
    this.climateCubes = [cubeTarget(gl, size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), cubeTarget(gl, size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)];
    this.climateRot = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.climateRot);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.plateCount, 2, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (const k of keyframes) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const values = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, values);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid.nx, grid.ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, k.values);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const plate = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, plate);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, grid.nx, grid.ny, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, k.plate);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.climateKeys.set(k.ageMa, { values, plate });
    }
  }

  /** Warp the climate's keyframes k0 and k1 to the current time, as `render` does the elevation. */
  renderClimate(k0: number, k1: number, rotK0: Float32Array, rotK1: Float32Array): void {
    const gl = this.gl;
    if (!this.climateProg || !this.climateCubes || !this.climateGrid) return;
    const grid = this.climateGrid;
    gl.bindTexture(gl.TEXTURE_2D, this.climateRot);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.plateCount, 1, gl.RGBA, gl.FLOAT, rotK0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, this.plateCount, 1, gl.RGBA, gl.FLOAT, rotK1);
    gl.useProgram(this.climateProg.program);
    gl.bindVertexArray(this.vao);
    const size = this.climateCubes[0].size;
    gl.viewport(0, 0, size, size);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.climateRot);
    setUniforms(gl, this.climateProg, { uVal: 0, uPlate: 1, uRot: 2, uNx: grid.nx }, ['uVal', 'uPlate', 'uRot', 'uNx']);
    setUniforms(gl, this.climateProg, { uGrid: [grid.lon0, grid.lat0, grid.step] });
    const m = this.mesh(grid);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.index);
    for (const [row, age] of [[0, k0], [1, k1]] as const) {
      const key = this.climateKeys.get(age);
      if (!key) continue;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, key.values);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, key.plate);
      setUniforms(gl, this.climateProg, { uRow: row }, ['uRow']);
      for (let f = 0; f < 6; f++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.climateCubes[row].framebuffers[f]);
        gl.clearColor(0.5, 0.5, 0.5, 0.5);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const F = CUBE_FACES[f];
        setUniforms(gl, this.climateProg, { uFx: F.slice(0, 3), uFy: F.slice(3, 6), uFw: F.slice(6, 9) });
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The climate in the direction `d`, blended between its keyframes: four values in 0–1. */
  sampleClimate(d: [number, number, number], mix: number): [number, number, number, number] | null {
    if (!this.climateCubes) return null;
    const a = this.readFace(this.climateCubes[0], d, true);
    const b = this.readFace(this.climateCubes[1], d, true);
    return [0, 1, 2, 3].map((i) => (a[i] + (b[i] - a[i]) * mix) / 255) as [number, number, number, number];
  }

  /** Read the cube map in the direction `d`: [elev_k, elev_k+1, plate_k, plate_k+1]. */
  sample(d: [number, number, number]): [number, number, number, number] {
    return this.readFace(this.cube, d, false) as [number, number, number, number];
  }

  private readFace(cube: CubeTarget, d: [number, number, number], bytes: boolean): number[] {
    const [x, y, z] = d;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let face: number;
    let sc: number;
    let tc: number;
    let ma: number;
    if (ax >= ay && ax >= az) {
      face = x > 0 ? 0 : 1;
      sc = x > 0 ? -z : z;
      tc = -y;
      ma = ax;
    } else if (ay >= az) {
      face = y > 0 ? 2 : 3;
      sc = x;
      tc = y > 0 ? z : -z;
      ma = ay;
    } else {
      face = z > 0 ? 4 : 5;
      sc = z > 0 ? x : -x;
      tc = -y;
      ma = az;
    }
    const s = Math.min(cube.size - 1, Math.floor(((sc / ma + 1) / 2) * cube.size));
    const t = Math.min(cube.size - 1, Math.floor(((tc / ma + 1) / 2) * cube.size));
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, cube.framebuffers[face]);
    const px = bytes ? new Uint8Array(4) : new Float32Array(4);
    gl.readPixels(s, t, 1, 1, gl.RGBA, bytes ? gl.UNSIGNED_BYTE : gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [...px];
  }
}
