import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CFG } from '../config.js';

// Grade, vignette, grain and radial speed blur in one pass.
//
// Radial blur sells speed better than true motion blur and costs a fraction as
// much: eight taps along the ray from the vanishing point.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uShadow: { value: new THREE.Color(CFG.art.gradeShadow) },
    uHighlight: { value: new THREE.Color(CFG.art.gradeHighlight) },
    uGrade: { value: CFG.art.gradeStrength },
    uVignette: { value: CFG.art.vignette },
    uGrain: { value: CFG.art.grain },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uShadow, uHighlight;
    uniform float uGrade, uVignette, uGrain, uTime, uBlur;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 dir = vUv - uCenter;
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      if (uBlur > 0.001) {
        vec3 sum = col;
        for (int i = 1; i < 8; i++) {
          float t = float(i) / 7.0;
          sum += texture2D(tDiffuse, vUv - dir * t * uBlur).rgb;
        }
        col = sum / 8.0;
      }

      // Split-tone: cool into the shadows, warm into the highlights. This is
      // what makes a single-light scene read as photographed rather than lit.
      // The tint is LUMINANCE-NORMALISED so it shifts hue only -- multiplying
      // by the raw colour changes exposure too and blows every highlight.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(uShadow, uHighlight, smoothstep(0.0, 0.75, l));
      tint /= max(1e-3, dot(tint, vec3(0.2126, 0.7152, 0.0722)));
      col = mix(col, col * tint, uGrade);

      col *= 1.0 - uVignette * pow(length(dir) * 1.35, 2.4);
      col += (hash(vUv * 1024.0 + uTime) - 0.5) * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // EffectComposer's default target is NOT multisampled, so simply adding a
    // composer silently destroys antialiasing and every road edge starts to
    // crawl. This is the fix, and it has to be explicit.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: 4, type: THREE.HalfFloatType,
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    const art = CFG.art;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y), art.bloomStrength, art.bloomRadius, art.bloomThreshold,
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass applies tone mapping and colour space at the very end, which
    // is why the renderer must not do it while drawing into the composer.
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  syncArt() {
    const art = CFG.art;
    this.bloom.strength = art.bloomStrength;
    this.bloom.radius = art.bloomRadius;
    this.bloom.threshold = art.bloomThreshold;
    const u = this.grade.uniforms;
    u.uShadow.value.set(art.gradeShadow);
    u.uHighlight.value.set(art.gradeHighlight);
    u.uGrade.value = art.gradeStrength;
    u.uVignette.value = art.vignette;
    u.uGrain.value = art.grain;
  }

  render(dt, speedPct, vanishing) {
    const u = this.grade.uniforms;
    u.uTime.value += dt;
    // Only in the top half of the speed range, or it reads as a smear.
    u.uBlur.value = THREE.MathUtils.smoothstep(speedPct, 0.55, 1.0) * 0.055;
    if (vanishing) u.uCenter.value.copy(vanishing);
    this.composer.render(dt);
  }
}
