import * as THREE from 'three';
import { CFG } from '../config.js';
import { Sky, sunDirection } from '../world/sky.js';
import { Post } from './post.js';

const R = CFG.render;

// Dev overrides. Software rendering (headless screenshots) chokes on a 2048
// soft-shadow map; on a real GPU it is free. These let tooling trade quality
// for turnaround without touching the shipped defaults.
const DEV = new URLSearchParams(location.search);
const devNum = (k, d) => (DEV.has(k) ? Number(DEV.get(k)) : d);

export class Renderer3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, R.PIXEL_RATIO_MAX));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CFG.art.exposure;
    this.renderer.shadowMap.enabled = devNum('shadow', 1) !== 0;
    this.renderer.shadowMap.type = devNum('shadow', 1) < 1024
      ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(R.FOV_MIN, 1, R.NEAR, R.FAR);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.scene.environment = this.sky.environment(this.renderer);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(CFG.art.fogColor), CFG.art.fogDensity);

    this.#lights();
    this.materials = this.#materials();
    this.post = devNum('post', 1) !== 0 ? new Post(this.renderer, this.scene, this.camera) : null;
    this.pixelRatio = Math.min(window.devicePixelRatio, R.PIXEL_RATIO_MAX);
    this.frameAvg = 16;
    this.resize();
  }

  #lights() {
    const art = CFG.art;
    this.sun = new THREE.DirectionalLight(new THREE.Color(art.sunColor), art.sunIntensity);
    this.sun.castShadow = true;
    const sm = devNum('shadow', R.SHADOW_MAP) || R.SHADOW_MAP;
    this.sun.shadow.mapSize.set(sm, sm);
    const cam = this.sun.shadow.camera;
    cam.near = R.SHADOW_NEAR;
    cam.far = R.SHADOW_FAR;
    cam.left = -R.SHADOW_EXTENT; cam.right = R.SHADOW_EXTENT;
    cam.top = R.SHADOW_EXTENT; cam.bottom = -R.SHADOW_EXTENT;
    this.sun.shadow.bias = R.SHADOW_BIAS;
    // A 5-degree sun grazes every surface, which makes acne and peter-panning
    // far worse than an overhead sun would. Normal bias is what fixes it.
    this.sun.shadow.normalBias = R.SHADOW_NORMAL_BIAS;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(art.ambientSky), new THREE.Color(art.ambientGround), art.ambient,
    );
    this.scene.add(this.hemi);
  }

  #materials() {
    const art = CFG.art;
    return {
      road: new THREE.MeshStandardMaterial({ color: art.roadColor, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.55 }),
      rumble: new THREE.MeshStandardMaterial({ color: art.rumbleLight, roughness: 0.75 }),
      shoulder: new THREE.MeshStandardMaterial({ color: art.terrainNear, roughness: 0.95 }),
      terrain: new THREE.MeshStandardMaterial({ color: art.terrainFar, roughness: 1.0, envMapIntensity: 0.4 }),
      scenery: new THREE.MeshStandardMaterial({ color: art.sceneryColor, roughness: 0.95, envMapIntensity: 0.5 }),
    };
  }

  // Follow the car, and SNAP the frustum to whole shadow texels in light space.
  // Without the snap the shadow edges crawl visibly at 42 m/s.
  updateSun(focus) {
    const dir = sunDirection(CFG.art);
    const dist = 180;
    const texel = (2 * R.SHADOW_EXTENT) / R.SHADOW_MAP;

    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const inv = q.clone().invert();
    const local = focus.clone().applyQuaternion(inv);
    local.x = Math.round(local.x / texel) * texel;
    local.y = Math.round(local.y / texel) * texel;
    const snapped = local.applyQuaternion(q);

    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, dist);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  syncArt() {
    const art = CFG.art;
    this.sky.sync(art);
    this.renderer.toneMappingExposure = art.exposure;
    this.scene.fog.color.set(art.fogColor);
    this.scene.fog.density = art.fogDensity;
    this.sun.color.set(art.sunColor);
    this.sun.intensity = art.sunIntensity;
    this.hemi.intensity = art.ambient;
    this.hemi.color.set(art.ambientSky);
    this.hemi.groundColor.set(art.ambientGround);
    this.materials.road.color.set(art.roadColor);
    this.materials.rumble.color.set(art.rumbleLight);
    this.materials.shoulder.color.set(art.terrainNear);
    this.materials.terrain.color.set(art.terrainFar);
    this.materials.scenery.color.set(art.sceneryColor);
    if (this.post) this.post.syncArt();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
  }

  // Rolling average, dropping resolution before dropping frames.
  adapt(ms) {
    this.frameAvg += (ms - this.frameAvg) / 30;
    if (this.frameAvg > R.FRAME_BUDGET_MS && this.pixelRatio > R.PIXEL_RATIO_MIN) {
      this.pixelRatio = Math.max(R.PIXEL_RATIO_MIN, this.pixelRatio - 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.frameAvg = 16;
    }
  }

  render(dt = 1 / 60, speedPct = 0) {
    this.sky.mesh.position.copy(this.camera.position);
    if (this.post) this.post.render(dt, speedPct);
    else this.renderer.render(this.scene, this.camera);
  }
}
