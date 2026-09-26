import { framebuffer, program, texture, type Program } from './core';

const TRI_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 13-tap downsample (Jimenez 2014); the first pass also applies a soft threshold.
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uPrefilter;
out vec4 o;
vec3 s(vec2 d) { return texture(uSrc, vUv + d * uTexel).rgb; }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(40.0));
  }
  o = vec4(col, 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
vec3 s(vec2 d) { return texture(uSrc, vUv + d * uTexel * uRadius).rgb; }
void main() {
  vec3 col = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
    + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
  o = vec4(col / 16.0, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uPrev;
uniform float uPrevMix;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uFade;
uniform float uCA;
uniform vec2 uRes;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSaturation;
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * uCA * r2;
  vec3 col;
  col.r = texture(uScene, vUv - off).r;
  col.g = texture(uScene, vUv).g;
  col.b = texture(uScene, vUv + off).b;
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  col *= uExposure;
  col = aces(col);
  // split toning: cool shadows, warm highlights (graded in display space)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * uShadowTint * 1.9, (1.0 - smoothstep(0.0, 0.42, l)) * 0.22);
  col = mix(col, col * uHighTint * 1.25, smoothstep(0.55, 1.0, l) * 0.18);
  col = mix(vec3(l), col, uSaturation);
  col *= mix(1.0, smoothstep(1.05, 0.2, sqrt(r2) * 1.35), uVignette);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float g = hash(vUv * uRes + fract(uTime * 13.7) * 591.3) - 0.5;
  col += g * uGrain + (hash(vUv * uRes * 1.37 + 17.0) - 0.5) / 255.0;
  col *= uFade;
  if (uPrevMix > 0.0) col = mix(col, texture(uPrev, vUv).rgb, uPrevMix);
  o = vec4(col, 1.0);
}`;

export interface Grade {
  exposure: number;
  bloom: number;
  threshold: number;
  vignette: number;
  grain: number;
  ca: number;
  saturation: number;
  shadowTint: [number, number, number];
  highTint: [number, number, number];
  fade: number;
  time: number;
  prevMix: number;
}

/** HDR scene target (MSAA when available) → soft-knee bloom → ACES + grade + grain → canvas. */
export class Post {
  w = 0;
  h = 0;
  readonly hdr: boolean;
  samples: number;
  private msaaFbo: WebGLFramebuffer | null = null;
  private colorRb: WebGLRenderbuffer | null = null;
  private depthRb: WebGLRenderbuffer | null = null;
  sceneFbo: WebGLFramebuffer | null = null;
  sceneTex: WebGLTexture | null = null;
  private sceneDepth: WebGLRenderbuffer | null = null;
  private mips: Array<{ tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }> = [];
  private prev: { tex: WebGLTexture; fbo: WebGLFramebuffer } | null = null;
  private down: Program;
  private up: Program;
  private comp: Program;
  private vao: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext, samples: number) {
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    const max = gl.getParameter(gl.MAX_SAMPLES) as number;
    this.samples = Math.min(samples, max || 0);
    this.down = program(gl, TRI_VS, DOWN_FS, 'bloom-down');
    this.up = program(gl, TRI_VS, UP_FS, 'bloom-up');
    this.comp = program(gl, TRI_VS, COMPOSITE_FS, 'composite');
    this.vao = gl.createVertexArray()!;
  }

  private get fmt() {
    const gl = this.gl;
    return this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.dispose();
    this.w = w;
    this.h = h;
    const f = this.fmt;
    this.sceneTex = texture(gl, w, h, f.internal, f.format, f.type);
    this.sceneFbo = framebuffer(gl, this.sceneTex);
    if (this.samples > 1) {
      this.msaaFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      this.colorRb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, f.internal, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb);
      this.depthRb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        this.samples = 0;
        gl.deleteFramebuffer(this.msaaFbo);
        this.msaaFbo = null;
      }
    }
    if (!this.msaaFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      this.sceneDepth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);
    }
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      const tex = texture(gl, mw, mh, f.internal, f.format, f.type);
      this.mips.push({ tex, fbo: framebuffer(gl, tex), w: mw, h: mh });
    }
    const pt = texture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.prev = { tex: pt, fbo: framebuffer(gl, pt) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  begin(clear: [number, number, number]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo ?? this.sceneFbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  finish(g: Grade, canvasW: number, canvasH: number) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindVertexArray(this.vao);
    // bloom: downsample chain
    gl.useProgram(this.down.p);
    gl.uniform1i(this.down.u.uSrc, 0);
    gl.uniform1f(this.down.u.uThreshold, g.threshold);
    gl.activeTexture(gl.TEXTURE0);
    let src = this.sceneTex!, sw = this.w, sh = this.h;
    this.mips.forEach((m, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
      gl.viewport(0, 0, m.w, m.h);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform2f(this.down.u.uTexel, 1 / sw, 1 / sh);
      gl.uniform1f(this.down.u.uPrefilter, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = m.tex;
      sw = m.w;
      sh = m.h;
    });
    // upsample and accumulate
    gl.useProgram(this.up.p);
    gl.uniform1i(this.up.u.uSrc, 0);
    gl.uniform1f(this.up.u.uRadius, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) {
      const from = this.mips[i], to = this.mips[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.w, to.h);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(this.up.u.uTexel, 1 / from.w, 1 / from.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this.comp.p);
    const u = this.comp.u;
    gl.uniform1i(u.uScene, 0);
    gl.uniform1i(u.uBloom, 1);
    gl.uniform1i(u.uPrev, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.prev!.tex);
    gl.uniform1f(u.uExposure, g.exposure);
    gl.uniform1f(u.uBloomStrength, g.bloom);
    gl.uniform1f(u.uVignette, g.vignette);
    gl.uniform1f(u.uGrain, g.grain);
    gl.uniform1f(u.uTime, g.time);
    gl.uniform1f(u.uFade, g.fade);
    gl.uniform1f(u.uCA, g.ca);
    gl.uniform1f(u.uSaturation, g.saturation);
    gl.uniform1f(u.uPrevMix, g.prevMix);
    gl.uniform2f(u.uRes, canvasW, canvasH);
    gl.uniform3fv(u.uShadowTint, g.shadowTint);
    gl.uniform3fv(u.uHighTint, g.highTint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Keeps the last graded frame for reduced-motion cross-dissolves. */
  snapshot(canvasW: number, canvasH: number) {
    const gl = this.gl;
    if (!this.prev) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.prev.fbo);
    gl.blitFramebuffer(0, 0, canvasW, canvasH, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    const gl = this.gl;
    for (const m of this.mips) {
      gl.deleteTexture(m.tex);
      gl.deleteFramebuffer(m.fbo);
    }
    this.mips = [];
    if (this.prev) {
      gl.deleteTexture(this.prev.tex);
      gl.deleteFramebuffer(this.prev.fbo);
      this.prev = null;
    }
    for (const rb of [this.colorRb, this.depthRb, this.sceneDepth]) if (rb) gl.deleteRenderbuffer(rb);
    for (const fb of [this.msaaFbo, this.sceneFbo]) if (fb) gl.deleteFramebuffer(fb);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    this.colorRb = this.depthRb = this.sceneDepth = null;
    this.msaaFbo = this.sceneFbo = null;
    this.sceneTex = null;
  }
}
