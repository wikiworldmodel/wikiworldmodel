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

export class FieldRenderer {
  readonly cube: CubeTarget;
  private prog: Program;
  private rot: WebGLTexture;
  private meshes = new Map<string, GridMesh>();
  private vao: WebGLVertexArrayObject;

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

  /** Read the cube map in the direction `d`: [elev_k, elev_k+1, plate_k, plate_k+1]. */
  sample(d: [number, number, number]): [number, number, number, number] {
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
    const s = Math.min(this.cube.size - 1, Math.floor(((sc / ma + 1) / 2) * this.cube.size));
    const t = Math.min(this.cube.size - 1, Math.floor(((tc / ma + 1) / 2) * this.cube.size));
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cube.framebuffers[face]);
    const px = new Float32Array(4);
    gl.readPixels(s, t, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [px[0], px[1], px[2], px[3]];
  }
}
