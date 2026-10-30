// The globe: background (stars, atmosphere halo), the surface shaded from the field cube map,
// and the cloud layer. The coastline is derived here, as the sea-level isoline of the
// blended field, so it is never stored and always agrees with the terrain under it.
//
// The surface has three modes, after the field that covers the time shown: elevation;
// continental blocks (inside a block or not, no relief and no sea level); and none, where no
// geography is known and the globe is drawn plain.
import { program, setUniforms, texture2D, type GL, type Program } from './context.ts';
import type { Mat4 } from '../mat.ts';

const SPHERE_VS = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uViewProj;
uniform float uRadius;
out vec3 vN;
void main() {
  vN = aPos;
  gl_Position = uViewProj * vec4(aPos * uRadius, 1.0);
}`;

const SURFACE_FS = `#version 300 es
precision highp float;
uniform highp samplerCube uField;
uniform float uMix;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uEvidence;
uniform float uCoast;
uniform float uTexel;
uniform int uMode;
in vec3 vN;
out vec4 o;

float elev(vec3 n) {
  vec4 f = texture(uField, n);
  return mix(f.r, f.g, uMix);
}

// A tent filter about one source cell wide: the source grid is 1°, and its isolines are
// rounder after smoothing at that scale than straight off the triangulated grid.
float smoothElev(vec3 n, vec3 t1, vec3 t2, float h) {
  float s = 4.0 * elev(n);
  s += 2.0 * (elev(normalize(n + t1 * h)) + elev(normalize(n - t1 * h)) + elev(normalize(n + t2 * h)) + elev(normalize(n - t2 * h)));
  s += elev(normalize(n + (t1 + t2) * h)) + elev(normalize(n + (t1 - t2) * h)) + elev(normalize(n - (t1 - t2) * h)) + elev(normalize(n - (t1 + t2) * h));
  return s / 16.0;
}

vec3 ramp(float e) {
  if (e < 0.0) {
    float d = clamp(-e / 6500.0, 0.0, 1.0);
    vec3 shelf = vec3(0.20, 0.52, 0.66);
    vec3 mid = vec3(0.06, 0.25, 0.45);
    vec3 deep = vec3(0.025, 0.08, 0.20);
    vec3 c = mix(shelf, mid, smoothstep(0.0, 0.35, d));
    return mix(c, deep, smoothstep(0.35, 1.0, d));
  }
  float h = e / 1000.0;
  vec3 low = vec3(0.47, 0.53, 0.33);
  vec3 up = vec3(0.62, 0.57, 0.38);
  vec3 high = vec3(0.55, 0.45, 0.33);
  vec3 peak = vec3(0.86, 0.84, 0.80);
  vec3 c = mix(low, up, smoothstep(0.1, 0.9, h));
  c = mix(c, high, smoothstep(0.9, 2.4, h));
  return mix(c, peak, smoothstep(2.8, 5.0, h));
}

// Continental blocks: bare crust and open water, their relief and depth unknown.
vec3 blockRamp(float e) {
  return e < 0.0 ? vec3(0.07, 0.24, 0.40) : vec3(0.52, 0.48, 0.42);
}

// No geography known: a plain sphere with a 30° graticule.
vec3 unknownSurface(vec3 n) {
  float lat = degrees(asin(clamp(n.z, -1.0, 1.0)));
  float lon = degrees(atan(n.y, n.x));
  float glat = 1.0 - smoothstep(0.0, 1.5 * fwidth(lat), abs(mod(lat + 15.0, 30.0) - 15.0));
  float glon = 1.0 - smoothstep(0.0, 1.5 * fwidth(lon), abs(mod(lon + 15.0, 30.0) - 15.0));
  float light = 0.35 + 0.75 * max(dot(n, uSun), 0.0);
  return vec3(0.11, 0.14, 0.20) * light + vec3(0.32, 0.38, 0.50) * max(glat, glon) * 0.3;
}

void main() {
  vec3 n = normalize(vN);
  if (uMode == 2) {
    float rim0 = pow(1.0 - max(dot(n, normalize(uEye - n)), 0.0), 3.0);
    o = vec4(unknownSurface(n) + vec3(0.25, 0.45, 0.85) * rim0 * 0.45, 1.0);
    return;
  }
  vec3 ref = abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(ref, n));
  vec3 t2 = cross(n, t1);
  float e = smoothElev(n, t1, t2, 0.006) - uCoast;
  float h = uTexel;
  float ex = elev(normalize(n + t1 * h)) - elev(normalize(n - t1 * h));
  float ey = elev(normalize(n + t2 * h)) - elev(normalize(n - t2 * h));
  float exaggeration = uMode == 1 ? 0.0 : e > 0.0 ? 30.0 : 8.0;  // e is relative to the coastline isoline
  vec3 grad = (t1 * ex + t2 * ey) / (2.0 * h * 6371000.0) * exaggeration;
  vec3 bump = normalize(n - grad);
  vec3 view = normalize(uEye - n);
  float diffuse = max(dot(bump, uSun), 0.0);
  vec3 c = (uMode == 1 ? blockRamp(e) : ramp(e)) * (0.22 + 0.85 * diffuse);
  if (e < 0.0) {
    float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0);
    c += vec3(0.55, 0.65, 0.75) * spec * 0.35;
  }
  // Coastline: the sea-level isoline, about one pixel wide.
  float de = max(fwidth(e), 1.0);
  float line = 1.0 - smoothstep(0.5, 1.5, abs(e) / de);
  c = mix(c, vec3(0.93, 0.96, 0.95), line * 0.85);
  // Evidence mode: the whole field is a reconstruction — amber hatching.
  float hatch = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
  c = mix(c, vec3(0.95, 0.65, 0.18), uEvidence * (0.14 + 0.26 * hatch));
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  c += vec3(0.25, 0.45, 0.85) * rim * 0.45;
  o = vec4(c, 1.0);
}`;

const CLOUD_FS = `#version 300 es
precision highp float;
uniform sampler2D uClouds;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uEvidence;
uniform float uOpacity;
in vec3 vN;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float lon = atan(n.y, n.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
  float d = textureGrad(uClouds, uv, vec2(0.0), vec2(0.0)).r;
  float light = 0.35 + 0.75 * max(dot(n, uSun), 0.0);
  vec3 c = vec3(1.0) * light;
  float a = d * uOpacity;
  // Evidence mode: procedural — magenta, thinned.
  c = mix(c, vec3(0.92, 0.25, 0.75), uEvidence * 0.75);
  a *= 1.0 - 0.45 * uEvidence;
  o = vec4(c * a, a);
}`;

const SKY_VS = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 uInvViewProj;
uniform vec3 uEye;
in vec2 vNdc;
out vec4 o;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float bq = dot(uEye, d);
  float r = sqrt(max(dot(uEye, uEye) - bq * bq, 0.0));
  vec3 c = vec3(0.008, 0.012, 0.03);
  // Stars: at most one per cell of a direction grid, at a random spot in the cell.
  vec3 g = d * 180.0;
  vec3 cell = floor(g);
  float s = hash(cell);
  vec3 spot = vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) * 0.6 + 0.2;
  float sr = length(fract(g) - spot);
  float star = step(0.985, s) * smoothstep(0.09, 0.0, sr) * (0.25 + 0.75 * hash(cell + 7.0));
  c += vec3(0.9, 0.93, 1.0) * star;
  if (bq < 0.0) {
    float glow = exp(-max(r - 1.0, 0.0) * 28.0) * smoothstep(0.97, 1.0, r);
    c += vec3(0.22, 0.42, 0.95) * glow * 0.9;
  }
  o = vec4(c, 1.0);
}`;

function sphere(segLon: number, segLat: number): { pos: Float32Array; idx: Uint32Array } {
  const pos = new Float32Array((segLon + 1) * (segLat + 1) * 3);
  let o = 0;
  for (let j = 0; j <= segLat; j++) {
    const lat = Math.PI / 2 - (j / segLat) * Math.PI;
    for (let i = 0; i <= segLon; i++) {
      const lon = -Math.PI + (i / segLon) * 2 * Math.PI;
      pos[o++] = Math.cos(lat) * Math.cos(lon);
      pos[o++] = Math.cos(lat) * Math.sin(lon);
      pos[o++] = Math.sin(lat);
    }
  }
  const idx = new Uint32Array(segLon * segLat * 6);
  o = 0;
  for (let j = 0; j < segLat; j++) {
    for (let i = 0; i < segLon; i++) {
      const a = j * (segLon + 1) + i;
      const b = a + 1;
      const c = a + segLon + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { pos, idx };
}

export interface GlobeFrame {
  viewProj: Mat4;
  invViewProj: Mat4;
  eye: [number, number, number];
  sun: [number, number, number];
  mix: number;
  evidence: number;
  coast: number;
  /** 0: elevation, 1: continental blocks, 2: no geography known */
  mode: number;
  showClouds: boolean;
}

export class GlobeRenderer {
  private surface: Program;
  private clouds: Program;
  private sky: Program;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private cloudTex: WebGLTexture | null = null;
  private emptyVao: WebGLVertexArrayObject;

  constructor(private gl: GL, private fieldCube: WebGLTexture, private cubeSize: number) {
    this.surface = program(gl, 'surface', SPHERE_VS, SURFACE_FS);
    this.clouds = program(gl, 'clouds', SPHERE_VS, CLOUD_FS);
    this.sky = program(gl, 'sky', SKY_VS, SKY_FS);
    const { pos, idx } = sphere(256, 128);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    for (const p of [this.surface, this.clouds]) {
      const loc = gl.getAttribLocation(p.program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray()!;
  }

  setClouds(width: number, height: number, density: Uint8Array): void {
    const gl = this.gl;
    if (this.cloudTex) gl.deleteTexture(this.cloudTex);
    this.cloudTex = texture2D(gl, { width, height, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: density, filter: gl.LINEAR, wrapS: gl.REPEAT });
  }

  render(f: GlobeFrame, width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sky.program);
    setUniforms(gl, this.sky, { uInvViewProj: f.invViewProj, uEye: f.eye });
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.surface.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.fieldCube);
    setUniforms(gl, this.surface, { uField: 0 }, ['uField']);
    setUniforms(gl, this.surface, {
      uViewProj: f.viewProj,
      uRadius: 1,
      uMix: f.mix,
      uSun: f.sun,
      uEye: f.eye,
      uEvidence: f.evidence,
      uCoast: f.coast,
      uTexel: 1.5 / this.cubeSize,
    });
    setUniforms(gl, this.surface, { uMode: f.mode }, ['uMode']);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);

    if (f.showClouds && this.cloudTex) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.clouds.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
      setUniforms(gl, this.clouds, { uClouds: 0 }, ['uClouds']);
      setUniforms(gl, this.clouds, { uViewProj: f.viewProj, uRadius: 1.008, uSun: f.sun, uEye: f.eye, uEvidence: f.evidence, uOpacity: 0.78 });
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }
}
