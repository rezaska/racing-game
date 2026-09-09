import * as THREE from 'three';
import { CFG } from '../config.js';

// A hand-authored gradient sky rather than a physical model.
//
// Preetham (three's Sky.js) is physically based and therefore NOT
// art-directable: you get the sky the atmosphere gives you. A four-stop
// gradient plus a sun disc is fully tunable, ties straight to the palette, and
// is what makes the art panel meaningful.

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // force to the far plane
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uZenith, uMid, uHorizon, uGround, uSunColor, uSunDir;
  uniform float uMidPoint, uSunSize, uSunGlow;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float t = clamp(h, 0.0, 1.0);

    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, uMidPoint, t));
    col = mix(col, uZenith, smoothstep(uMidPoint, 1.0, t));
    // Below the horizon fades to ground haze so the fog has something to sit on.
    col = mix(col, uGround, smoothstep(0.0, -0.09, h));

    float c = dot(d, normalize(uSunDir));
    // Broad glow, then the disc itself.
    col += uSunColor * pow(max(c, 0.0), 260.0) * uSunGlow * 6.0;
    col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, c) * 2.2;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function sunDirection(art) {
  const el = (art.sunElevation * Math.PI) / 180;
  const az = (art.sunAzimuth * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    -Math.cos(el) * Math.cos(az),
  ).normalize();
}

export class Sky {
  constructor() {
    const art = CFG.art;
    this.uniforms = {
      uZenith: { value: new THREE.Color(art.skyZenith) },
      uMid: { value: new THREE.Color(art.skyMid) },
      uHorizon: { value: new THREE.Color(art.skyHorizon) },
      uGround: { value: new THREE.Color(art.terrainFar) },
      uSunColor: { value: new THREE.Color(art.sunColor) },
      uSunDir: { value: sunDirection(art) },
      uMidPoint: { value: art.skyMidPoint },
      uSunSize: { value: art.sunSize },
      uSunGlow: { value: art.sunGlow },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(CFG.render.FAR * 0.9);
  }

  sync(art) {
    const u = this.uniforms;
    u.uZenith.value.set(art.skyZenith);
    u.uMid.value.set(art.skyMid);
    u.uHorizon.value.set(art.skyHorizon);
    u.uGround.value.set(art.terrainFar);
    u.uSunColor.value.set(art.sunColor);
    u.uSunDir.value.copy(sunDirection(art));
    u.uMidPoint.value = art.skyMidPoint;
    u.uSunSize.value = art.sunSize;
    u.uSunGlow.value = art.sunGlow;
  }

  // Image-based lighting from the same gradient. Without this, every material
  // in the scene reads as unpainted plastic; with it they pick up the sky.
  environment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    const probe = this.mesh.clone();
    probe.scale.setScalar(50);
    scene.add(probe);
    const rt = pmrem.fromScene(scene, 0, 1, 200);
    pmrem.dispose();
    return rt.texture;
  }
}
