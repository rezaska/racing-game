import { CFG } from './config.js';
import { clamp, mulberry32 } from './mathx.js';

const P = CFG.palette;

// Cached gradients/patterns. Building a CanvasGradient every frame is a real
// cost, so these are rebuilt only on resize.
let skyGrad = null;
let dirtPattern = null;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function buildCache(ctx, cam) {
  skyGrad = ctx.createLinearGradient(0, 0, 0, cam.H);
  skyGrad.addColorStop(0, P.skyTop);
  skyGrad.addColorStop(1, P.skyBottom);

  const off = document.createElement('canvas');
  off.width = off.height = 64;
  const o = off.getContext('2d');
  o.fillStyle = P.dirt;
  o.fillRect(0, 0, 64, 64);
  const rng = mulberry32(0x51ed270b);
  for (let i = 0; i < 90; i++) {
    o.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
    o.beginPath();
    o.arc(rng() * 64, rng() * 64, 0.8 + rng() * 2.2, 0, Math.PI * 2);
    o.fill();
  }
  dirtPattern = ctx.createPattern(off, 'repeat');
}

export function drawSky(ctx, cam) {
  cam.screenSpace(ctx);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, cam.W, cam.H);
}

export function drawParallax(ctx, cam, terrain) {
  for (const layer of terrain.layers) {
    cam.applyTransform(ctx, layer.parallax, layer.parallaxY);
    const { left, right } = cam.visibleRange(layer.parallax, 120);
    const i0 = clamp(Math.floor(left / layer.dx), 0, layer.n - 1);
    const i1 = clamp(Math.ceil(right / layer.dx), 0, layer.n - 1);
    if (i1 <= i0) continue;

    const bottom = cam.y * layer.parallaxY + 3000;
    // Extend past the generated range so the layer never shows a vertical cut
    // at its own start/end.
    ctx.beginPath();
    ctx.moveTo(left, layer.h[i0]);
    for (let i = i0; i <= i1; i++) ctx.lineTo(i * layer.dx, layer.h[i]);
    ctx.lineTo(right, layer.h[i1]);
    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
  }
}

export function drawTerrain(ctx, cam, terrain) {
  cam.applyTransform(ctx, 1);
  const { left, right } = cam.visibleRange(1, 80);
  const dx = terrain.dx;
  const h = terrain.h;
  const i0 = clamp(Math.floor(left / dx), 0, terrain.n - 1);
  const i1 = clamp(Math.ceil(right / dx), 0, terrain.n - 1);
  if (i1 <= i0) return;

  // Never emit more than roughly one point per 1.5 device pixels.
  const stride = Math.max(1, Math.floor((i1 - i0) / (cam.W * 0.66)));
  const bottom = cam.worldBottom() + 600;

  // Run the surface out to the screen edges. Before x=0 and past the end of the
  // track the heightmap has no samples, and stopping at i0/i1 left a hard
  // vertical cut through the ground at the start line.
  const trace = () => {
    ctx.moveTo(left, h[i0]);
    for (let i = i0; i <= i1; i += stride) ctx.lineTo(i * dx, h[i]);
    ctx.lineTo(i1 * dx, h[i1]);
    ctx.lineTo(right, h[i1]);
  };

  // Pass 1: the dirt body, as one closed polygon.
  ctx.beginPath();
  trace();
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = dirtPattern || P.dirt;
  ctx.fill();

  // Pass 2: the grass cap, as a thick round-joined polyline over the same points.
  ctx.beginPath();
  trace();
  ctx.lineWidth = 9 / cam.zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = P.grass;
  ctx.stroke();
}

export function drawDecorations(ctx, cam, terrain) {
  cam.applyTransform(ctx, 1);
  const { left, right } = cam.visibleRange(1, 120);
  for (const d of terrain.decorations) {
    if (d.x < left) continue;
    if (d.x > right) break;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.flip ? -d.scale : d.scale, d.scale);
    if (d.kind === 'tree') {
      ctx.fillStyle = '#6b4f31';
      ctx.fillRect(-3, -26, 6, 26);
      ctx.fillStyle = '#2f7a3f';
      ctx.beginPath();
      ctx.arc(0, -36, 17, 0, Math.PI * 2);
      ctx.arc(-12, -26, 12, 0, Math.PI * 2);
      ctx.arc(12, -27, 13, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#8a8f96';
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.lineTo(-6, -12);
      ctx.lineTo(6, -14);
      ctx.lineTo(14, 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

export function drawTrackObjects(ctx, cam, terrain) {
  cam.applyTransform(ctx, 1);
  const { left, right } = cam.visibleRange(1, 120);

  for (const cp of terrain.checkpoints) {
    if (cp.x < left || cp.x > right) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cp.x, cp.y);
    ctx.lineTo(cp.x, cp.y - 54);
    ctx.stroke();
    ctx.fillStyle = '#f0f0f0';
    ctx.beginPath();
    ctx.moveTo(cp.x, cp.y - 54);
    ctx.lineTo(cp.x + 26, cp.y - 46);
    ctx.lineTo(cp.x, cp.y - 38);
    ctx.closePath();
    ctx.fill();
  }

  const fx = terrain.finishX;
  if (fx > left && fx < right) {
    const fy = terrain.heightAt(fx);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(fx - 4, fy - 150, 8, 150);
    ctx.fillRect(fx + 96, fy - 150, 8, 150);
    ctx.fillRect(fx - 4, fy - 158, 108, 22);
    const sq = 11;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 10; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#1a1a1a' : '#f2f2f2';
        ctx.fillRect(fx - 4 + c * sq, fy - 158 + r * sq, sq, sq);
      }
    }
  }
}

export function drawVehicle(ctx, cam, car, alpha = 1) {
  const C = CFG.car;
  cam.applyTransform(ctx, 1);
  ctx.globalAlpha = alpha;

  const ca = Math.cos(car.angle);
  const sa = Math.sin(car.angle);

  // Struts first (they read as being behind the body), then the chassis, then
  // the wheels ON TOP. The wheel centre sits ~4px below the chassis centre and
  // the body is 32 tall, so drawing wheels first hid all but a 5px sliver.
  ctx.strokeStyle = 'rgba(30,30,30,0.85)';
  ctx.lineWidth = 5;
  for (const w of car.wheels) {
    ctx.beginPath();
    ctx.moveTo(car.x + w.local.x * ca - w.local.y * sa,
               car.y + w.local.x * sa + w.local.y * ca);
    ctx.lineTo(w.worldX, w.worldY);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  ctx.fillStyle = car.color;
  roundRect(ctx, -C.bodyW / 2, -C.bodyH / 2, C.bodyW, C.bodyH, 9);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cabin
  ctx.fillStyle = car.color;
  roundRect(ctx, -8, -C.bodyH / 2 - 20, 48, 22, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(180,225,255,0.85)';
  roundRect(ctx, 0, -C.bodyH / 2 - 16, 27, 13, 4);
  ctx.fill();

  // Driver head, drawn exactly at the head-collision point so the fail state is
  // legible.
  ctx.fillStyle = car.crashed ? '#e0483a' : '#f0c9a0';
  ctx.beginPath();
  ctx.arc(C.headLocal.x, C.headLocal.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Wheels last, at their real compressed world positions -- that is what makes
  // the suspension readable.
  for (const w of car.wheels) {
    ctx.save();
    ctx.translate(w.worldX, w.worldY);
    ctx.rotate(w.spin);
    ctx.fillStyle = '#232323';
    ctx.beginPath();
    ctx.arc(0, 0, C.RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9ccd1';
    ctx.beginPath();
    ctx.arc(0, 0, C.RADIUS * 0.44, 0, Math.PI * 2);
    ctx.fill();
    // Spokes: these are what make speed readable.
    ctx.strokeStyle = '#c9ccd1';
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * C.RADIUS * 0.8, Math.sin(a) * C.RADIUS * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}

export function drawParticles(ctx, cam, particles) {
  cam.applyTransform(ctx, 1);
  for (const q of particles) {
    const t = 1 - q.age / q.life;
    ctx.fillStyle = `rgba(150,125,95,${0.45 * t})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.r * (0.6 + t * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export function drawHUD(ctx, cam, race) {
  cam.screenSpace(ctx);
  const car = race.player;
  const W = cam.W;

  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(15,20,28,0.55)';
  roundRect(ctx, 14, 14, 214, 92, 10);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`${Math.round(Math.abs(car.vx) / 10)} km/h`, 28, 24);

  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const pct = clamp(car.distance / race.terrain.finishX, 0, 1);
  ctx.fillText(`${(pct * 100).toFixed(1)}%  ·  P${race.playerPlace()}/${race.cars.length}`, 28, 58);
  ctx.fillText(race.state === 'countdown' ? '0:00.00' : fmtTime(race.elapsed), 28, 78);

  // Progress bar with a marker per car.
  const barX = 250;
  const barW = W - 270;
  if (barW > 120) {
    ctx.fillStyle = 'rgba(15,20,28,0.5)';
    roundRect(ctx, barX, 26, barW, 12, 6);
    ctx.fill();
    for (const c of race.cars) {
      const p = clamp(c.distance / race.terrain.finishX, 0, 1);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(barX + 6 + p * (barW - 12), 32, c.isPlayer ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (c.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  if (race.state === 'countdown') {
    const n = Math.ceil(race.countdown - 0.5);
    const label = n > 0 ? String(n) : 'GO!';
    ctx.textAlign = 'center';
    ctx.font = 'bold 92px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(label, W / 2 + 3, cam.H * 0.28 + 3);
    ctx.fillStyle = n > 0 ? '#fff' : '#8fe36b';
    ctx.fillText(label, W / 2, cam.H * 0.28);
    ctx.textAlign = 'left';
  }

  if (car.crashed) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillStyle = '#ff6b5a';
    ctx.fillText('CRASHED', W / 2, cam.H * 0.3);
    ctx.textAlign = 'left';
  }

  if (race.state === 'finished' && race.results) {
    const panelW = 340;
    const panelH = 90 + race.results.length * 34;
    const px = (W - panelW) / 2;
    const py = (cam.H - panelH) / 2;
    ctx.fillStyle = 'rgba(15,20,28,0.88)';
    roundRect(ctx, px, py, panelW, panelH, 14);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('FINISH', W / 2, py + 18);

    ctx.textAlign = 'left';
    ctx.font = '16px system-ui, sans-serif';
    race.results.forEach((r, i) => {
      const y = py + 62 + i * 34;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(px + 30, y + 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = r.isPlayer ? '#ffd964' : 'rgba(255,255,255,0.85)';
      ctx.fillText(`${r.place}.  ${r.name}`, px + 48, y);
      ctx.textAlign = 'right';
      ctx.fillText(r.time !== null ? fmtTime(r.time) : `${(r.progress * 100).toFixed(0)}%`, px + panelW - 26, y);
      ctx.textAlign = 'left';
    });

    ctx.textAlign = 'center';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Press R for a new track', W / 2, py + panelH - 26);
    ctx.textAlign = 'left';
  }
}

export function render(ctx, cam, race) {
  drawSky(ctx, cam);
  drawParallax(ctx, cam, race.terrain);
  drawTerrain(ctx, cam, race.terrain);
  drawDecorations(ctx, cam, race.terrain);
  drawTrackObjects(ctx, cam, race.terrain);

  // AI sorted by x so overlaps read consistently, player always last.
  const ais = race.cars.filter((c) => !c.isPlayer).sort((a, b) => a.x - b.x);
  for (const c of ais) drawVehicle(ctx, cam, c, 0.85);
  drawVehicle(ctx, cam, race.player, 1);

  drawParticles(ctx, cam, race.particles);
  drawHUD(ctx, cam, race);
}
