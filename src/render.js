import { CFG } from './config.js';
import { project, CAMERA_DEPTH, PLAYER_Z } from './track.js';
import { drawText, drawTextShadow, textWidth } from './pixelfont.js';
import { clamp, lerp } from './mathx.js';

export { PLAYER_Z };

const R = CFG.road;

// The vanishing point. As z grows, scale -> 0 and screen.y -> height/2, so the
// horizon is always exactly half way down whatever the camera height.
const horizonY = (ih) => Math.round(ih / 2);

// --- background -----------------------------------------------------------

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return { c, x };
}

// Ordered-dither between adjacent palette entries instead of a smooth gradient.
// The visible cross-hatched banding is the whole look of a 16-bit sky.
function ditherGradient(x, w, h, colors) {
  const n = colors.length - 1;
  for (let y = 0; y < h; y++) {
    const u = (y / Math.max(1, h - 1)) * n;
    const i = Math.min(n - 1, Math.floor(u));
    const f = u - i;
    for (let px = 0; px < w; px++) {
      const t = (BAYER[y & 3][px & 3] + 0.5) / 16;
      x.fillStyle = f > t ? colors[i + 1] : colors[i];
      x.fillRect(px, y, 1, 1);
    }
  }
}

export function buildBackground(theme, iw, ih, rng) {
  const W = iw * 2; // twice the screen so it can wrap horizontally
  const hz = horizonY(ih);

  const sky = surface(iw, ih);
  ditherGradient(sky.x, iw, hz + 8, theme.sky);
  if (theme.stars) {
    sky.x.fillStyle = '#ffffff';
    for (let i = 0; i < 90; i++) {
      const sx = Math.floor(rng() * iw);
      const sy = Math.floor(rng() * (hz - 20));
      sky.x.fillRect(sx, sy, 1, 1);
    }
  }

  // Clouds: soft blobs with a flat shaded underside.
  const CH = 40;
  const clouds = surface(W, CH);
  for (let i = 0; i < 14; i++) {
    const cx = rng() * W;
    const cy = 8 + rng() * 18;
    const r = 4 + rng() * 7;
    for (let k = 0; k < 5; k++) {
      const ox = cx + (k - 2) * r * 0.72;
      const oy = cy + Math.abs(k - 2) * 1.6;
      const rr = r * (1 - Math.abs(k - 2) * 0.16);
      clouds.x.fillStyle = theme.cloudShade;
      clouds.x.beginPath();
      clouds.x.arc(ox, oy + 1.5, rr, 0, Math.PI * 2);
      clouds.x.fill();
      clouds.x.fillStyle = theme.cloud;
      clouds.x.beginPath();
      clouds.x.arc(ox, oy, rr, 0, Math.PI * 2);
      clouds.x.fill();
    }
  }

  // Horizon strip: sea, shoreline and distant hills, drawn bottom-aligned to
  // the vanishing point so the road appears to meet it.
  const SH = 52;
  const strip = surface(W, SH);
  const seaTop = 18;
  strip.x.fillStyle = theme.sea;
  strip.x.fillRect(0, seaTop, W, SH - seaTop);
  strip.x.fillStyle = theme.seaLight;
  for (let y = seaTop + 2; y < SH; y += 3) {
    for (let px = Math.floor(rng() * 8); px < W; px += 6 + Math.floor(rng() * 10)) {
      strip.x.fillRect(px, y, 2 + Math.floor(rng() * 3), 1);
    }
  }
  strip.x.fillStyle = theme.seaFoam;
  strip.x.fillRect(0, SH - 5, W, 2);
  strip.x.fillStyle = theme.sand;
  strip.x.fillRect(0, SH - 3, W, 3);

  if (theme.skyline) {
    // Buildings, lit windows and the odd antenna, with a dark treeline in front.
    const base = seaTop + 20;
    let px = -4;
    while (px < W) {
      const bw = 8 + Math.floor(rng() * 15);
      const bh = 10 + Math.floor(rng() * 24);
      strip.x.fillStyle = theme.building[Math.floor(rng() * theme.building.length)];
      strip.x.fillRect(px, base - bh, bw, bh);
      if (rng() < 0.18) {
        const ah = 5 + Math.floor(rng() * 9);
        strip.x.fillRect(px + (bw >> 1), base - bh - ah, 1, ah);
      }
      strip.x.fillStyle = theme.window;
      for (let wy = base - bh + 3; wy < base - 3; wy += 4) {
        for (let wx = px + 2; wx < px + bw - 2; wx += 3) {
          if (rng() < 0.28) strip.x.fillRect(wx, wy, 1, 2);
        }
      }
      px += bw + (rng() < 0.35 ? 1 : 0);
    }
    strip.x.fillStyle = theme.trees[1];
    for (let x = 0; x < W; x += 3) {
      const h = 5 + Math.floor(rng() * 6);
      strip.x.fillRect(x, base - h + 2, 4, SH - (base - h + 2));
    }
  } else {
    // Two silhouette ridges above the water.
    for (const [color, amp, base, step] of [
      [theme.hillFar, 9, seaTop + 9, 34],
      [theme.hillNear, 6, seaTop + 15, 21],
    ]) {
      strip.x.fillStyle = color;
      let prev = base;
      for (let px2 = 0; px2 <= W; px2 += step) {
        const next = base - Math.floor(rng() * amp);
        for (let k = 0; k < step && px2 + k <= W; k++) {
          const y = Math.round(lerp(prev, next, k / step));
          strip.x.fillRect(px2 + k, y, 1, SH - y);
        }
        prev = next;
      }
    }
  }

  return { sky: sky.c, clouds: clouds.c, strip: strip.c, W, CH, SH, hz };
}

function tile(ctx, img, w, offsetX, y) {
  const ox = -((offsetX % w) + w) % w;
  ctx.drawImage(img, Math.round(ox), Math.round(y));
  ctx.drawImage(img, Math.round(ox + w), Math.round(y));
}

export function drawBackground(ctx, bg, iw, ih, offsetX, playerY) {
  // A little vertical drift with elevation fakes the pitch the projection does
  // not model.
  const lift = clamp(playerY * 0.0008, -14, 14);
  ctx.drawImage(bg.sky, 0, Math.round(lift * 0.3));
  ctx.fillStyle = ctx.fillStyle;
  tile(ctx, bg.clouds, bg.W, offsetX * 0.5, bg.hz - bg.SH - bg.CH * 0.55 + lift * 0.5);
  tile(ctx, bg.strip, bg.W, offsetX, bg.hz - bg.SH + 3 + lift);
}

// --- road -----------------------------------------------------------------

function polygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

const rumbleW = (w, lanes) => w / Math.max(6, 2 * lanes);
const laneW = (w, lanes) => w / Math.max(32, 8 * lanes);

function drawSegment(ctx, iw, seg, theme) {
  const { p1, p2 } = seg;
  const dark = seg.dark ? 1 : 0;
  const grass = theme.grass[dark];
  const rumble = theme.rumble[dark];
  const road = theme.road[dark];

  const r1 = rumbleW(p1.screen.w, R.LANES);
  const r2 = rumbleW(p2.screen.w, R.LANES);

  ctx.fillStyle = grass;
  ctx.fillRect(0, p2.screen.y, iw, p1.screen.y - p2.screen.y);

  polygon(ctx, p1.screen.x - p1.screen.w - r1, p1.screen.y, p1.screen.x - p1.screen.w, p1.screen.y,
          p2.screen.x - p2.screen.w, p2.screen.y, p2.screen.x - p2.screen.w - r2, p2.screen.y, rumble);
  polygon(ctx, p1.screen.x + p1.screen.w + r1, p1.screen.y, p1.screen.x + p1.screen.w, p1.screen.y,
          p2.screen.x + p2.screen.w, p2.screen.y, p2.screen.x + p2.screen.w + r2, p2.screen.y, rumble);
  polygon(ctx, p1.screen.x - p1.screen.w, p1.screen.y, p1.screen.x + p1.screen.w, p1.screen.y,
          p2.screen.x + p2.screen.w, p2.screen.y, p2.screen.x - p2.screen.w, p2.screen.y, road);

  if (!seg.dark) {
    const l1 = laneW(p1.screen.w, R.LANES);
    const l2 = laneW(p2.screen.w, R.LANES);
    if (theme.laneDouble) {
      // Two solid centre lines, continuous rather than dashed.
      for (const s of [-1, 1]) {
        const o1 = s * l1 * 2.2;
        const o2 = s * l2 * 2.2;
        polygon(ctx, p1.screen.x + o1 - l1, p1.screen.y, p1.screen.x + o1 + l1, p1.screen.y,
                p2.screen.x + o2 + l2, p2.screen.y, p2.screen.x + o2 - l2, p2.screen.y, theme.lane);
      }
    } else {
      const lw1 = (p1.screen.w * 2) / R.LANES;
      const lw2 = (p2.screen.w * 2) / R.LANES;
      let lx1 = p1.screen.x - p1.screen.w + lw1;
      let lx2 = p2.screen.x - p2.screen.w + lw2;
      for (let lane = 1; lane < R.LANES; lane++) {
        polygon(ctx, lx1 - l1, p1.screen.y, lx1 + l1, p1.screen.y,
                lx2 + l2, p2.screen.y, lx2 - l2, p2.screen.y, theme.lane);
        lx1 += lw1;
        lx2 += lw2;
      }
    }
  }

  // Distance haze. Cheap, and it stops the far road reading as a hard edge.
  if (seg.fog < 1) {
    ctx.globalAlpha = 1 - seg.fog;
    ctx.fillStyle = theme.sky[theme.sky.length - 1];
    ctx.fillRect(0, p2.screen.y, iw, p1.screen.y - p2.screen.y);
    ctx.globalAlpha = 1;
  }
}

// A guardrail ribbon standing on the verge, drawn as a quad from the road edge
// up to rail height. Must be drawn back-to-front AFTER all road segments: it
// extends upward into the band where farther segments get drawn, so doing it
// inline would let distant road paint over near rails.
const RAIL_HEIGHT = 190;

function drawRails(ctx, ih, seg, theme) {
  const { p1, p2 } = seg;
  const h1 = (RAIL_HEIGHT * p1.screen.scale * ih) / 2;
  const h2 = (RAIL_HEIGHT * p2.screen.scale * ih) / 2;
  if (h1 < 0.8) return;

  const r1 = rumbleW(p1.screen.w, R.LANES) * 1.5;
  const r2 = rumbleW(p2.screen.w, R.LANES) * 1.5;

  for (const side of [-1, 1]) {
    const x1 = p1.screen.x + side * (p1.screen.w + r1);
    const x2 = p2.screen.x + side * (p2.screen.w + r2);
    const y1 = p1.screen.y;
    const y2 = p2.screen.y;

    if (seg.index % 4 === 0 && h1 > 2) {
      ctx.fillStyle = theme.rail[2];
      ctx.fillRect(Math.round(x1 - Math.max(1, h1 * 0.07)), Math.round(y1 - h1),
                   Math.max(1, Math.round(h1 * 0.14)), Math.round(h1));
    }
    polygon(ctx, x1, y1 - h1, x2, y2 - h2, x2, y2 - h2 * 0.35, x1, y1 - h1 * 0.35, theme.rail[1]);
    polygon(ctx, x1, y1 - h1, x2, y2 - h2, x2, y2 - h2 * 0.72, x1, y1 - h1 * 0.72, theme.rail[0]);
  }
}

function drawSprite(ctx, iw, sprite, scale, roadX, roadY, offset, clipY, flip = false) {
  const destW = sprite.worldW * scale * (iw / 2);
  const destH = destW * (sprite.h / sprite.w);
  if (destW < 0.6 || destH < 0.6) return;

  const destX = Math.round(roadX + offset - destW / 2);
  const destY = Math.round(roadY - destH);
  const clipH = clipY ? Math.max(0, destY + destH - clipY) : 0;
  if (clipH >= destH) return;

  const srcH = sprite.h - (sprite.h * clipH) / destH;
  ctx.save();
  if (flip) {
    ctx.translate(destX + destW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.canvas, 0, 0, sprite.w, srcH, 0, destY, Math.round(destW), Math.round(destH - clipH));
  } else {
    ctx.drawImage(sprite.canvas, 0, 0, sprite.w, srcH, destX, destY, Math.round(destW), Math.round(destH - clipH));
  }
  ctx.restore();
}

// Draws the road and everything standing on it. Returns the camera-space data
// the player sprite needs so it is not computed twice.
export function renderRoad(ctx, iw, ih, track, player, theme, sprites) {
  const base = track.findSegment(player.z);
  const basePercent = (player.z % R.SEGMENT_LENGTH) / R.SEGMENT_LENGTH;
  const playerSeg = track.findSegment(player.z + PLAYER_Z);
  const playerPercent = ((player.z + PLAYER_Z) % R.SEGMENT_LENGTH) / R.SEGMENT_LENGTH;
  const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);

  let maxy = ih;
  let x = 0;
  let dx = -(base.curve * basePercent);
  const drawn = [];

  for (let n = 0; n < R.DRAW_DISTANCE; n++) {
    const seg = track.segments[base.index + n];
    if (!seg) break;
    seg.fog = 1 / Math.exp(((n / R.DRAW_DISTANCE) ** 2) * R.FOG_DENSITY);
    seg.clip = maxy;

    project(seg.p1, player.x * R.WIDTH - x, playerY + R.CAMERA_HEIGHT, player.z, CAMERA_DEPTH, iw, ih, R.WIDTH);
    project(seg.p2, player.x * R.WIDTH - x - dx, playerY + R.CAMERA_HEIGHT, player.z, CAMERA_DEPTH, iw, ih, R.WIDTH);

    x += dx;
    dx += seg.curve;

    // Behind the camera, back-facing, or hidden behind a crest already drawn.
    if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) {
      continue;
    }
    drawSegment(ctx, iw, seg, theme);
    drawn.push(seg);
    maxy = seg.p2.screen.y;
  }

  // Sprites and cars back to front, so nearer things overlap farther ones.
  for (let i = drawn.length - 1; i >= 0; i--) {
    const seg = drawn[i];
    const sc = seg.p1.screen;
    drawRails(ctx, ih, seg, theme);
    for (const s of seg.sprites) {
      let sp = null;
      // Themes without palms get lamp posts, not a second sign on every pole.
      if (s.kind === 'palm') {
        sp = theme.palms ? sprites.palms[seg.index % sprites.palms.length] : sprites.lamp;
      }
      else if (s.kind === 'tree') sp = sprites.trees[seg.index % sprites.trees.length];
      else if (s.kind === 'billboard') sp = sprites.billboards[seg.index % sprites.billboards.length];
      else if (s.kind === 'sign') sp = sprites.sign;
      else if (s.kind === 'finish') sp = sprites.finish;
      if (!sp) continue;
      drawSprite(ctx, iw, sp, sc.scale, sc.x, sc.y, sc.w * s.offset, seg.clip, s.offset < 0);
    }
    for (const car of seg.cars) {
      drawSprite(ctx, iw, sprites.opponents[car.sprite], sc.scale, sc.x, sc.y, sc.w * car.offset, seg.clip);
    }
  }

  return { playerY, playerSeg, playerPercent };
}

// The projection puts the player sprite's base exactly on the bottom edge, so
// lift it enough to leave road visible underneath.
const PLAYER_LIFT = 14;

export function drawPlayer(ctx, iw, ih, player, sprites, info) {
  const scale = CAMERA_DEPTH / PLAYER_Z;
  const camY = lerp(info.playerSeg.p1.camera.y ?? 0, info.playerSeg.p2.camera.y ?? 0, info.playerPercent);
  // Lean with the steering, or harder with the slide when drifting.
  const lean = player.slip > 0.25 ? -Math.sign(player.slipDir || player.steer) : player.steer;
  const frame = lean < 0 ? 0 : lean > 0 ? 2 : 1;
  const sprite = sprites.player[frame];

  const destW = sprite.worldW * scale * (iw / 2);
  const destH = destW * (sprite.h / sprite.w);
  const x = Math.round(iw / 2 - destW / 2);
  const y = Math.round(ih / 2 - (scale * camY * ih) / 2 - destH + player.bounce - PLAYER_LIFT);

  // Tyre smoke: off road, or whenever the tyres are past the grip limit.
  if ((player.offroad || player.slip > 0.22) && player.speed > 800) {
    const puff = player.offroad ? 'rgba(214,196,160,0.8)' : 'rgba(240,240,240,0.8)';
    ctx.fillStyle = puff;
    const t = Math.floor(player.z / 40) % 3;
    const n = player.offroad ? 4 : 3 + Math.round(player.slip * 4);
    for (let i = 0; i < n; i++) {
      const r = 2 + ((i + t) % 3);
      ctx.fillRect(x - 3 - i * 3, y + destH - 4 + ((i + t) % 3), r, r);
      ctx.fillRect(x + destW + 1 + i * 3, y + destH - 4 + ((i + t + 1) % 3), r, r);
    }
  }

  ctx.drawImage(sprite.canvas, x, y, Math.round(destW), Math.round(destH));
}

// --- HUD ------------------------------------------------------------------

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}'${sec.toFixed(2).padStart(5, '0')}`;
}

export function drawHUD(ctx, iw, ih, race) {
  const p = race.player;
  const W = '#ffffff';
  const SH = '#101828';

  if (race.state === 'attract') {
    drawTextShadow(ctx, 'COAST RACER', iw / 2, ih * 0.22, '#f5c542', SH, 3, 'center');
    if (Math.floor(race.attractT * 1.6) % 2 === 0) {
      drawTextShadow(ctx, 'PRESS START', iw / 2, ih * 0.42, W, SH, 2, 'center');
    }
    drawText(ctx, 'ARROWS STEER   UP GAS   DOWN BRAKE', iw / 2, ih - 26, '#8fd8ff', 1, 'center');
    drawText(ctx, 'R NEW TRACK    T THEME', iw / 2, ih - 16, '#8fd8ff', 1, 'center');
    return;
  }

  drawTextShadow(ctx, 'SPEED', 4, 4, '#8fd8ff', SH, 1);
  const kph = `${Math.round(p.speed / 40)}`;
  drawTextShadow(ctx, kph, 4, 13, W, SH, 2);
  drawText(ctx, 'KM/H', 4 + textWidth(kph, 2) + 8, 20, '#8fd8ff', 1);

  drawTextShadow(ctx, 'TIME', iw - 4, 4, '#8fd8ff', SH, 1, 'right');
  drawTextShadow(ctx, fmtTime(race.elapsed), iw - 4, 13, W, SH, 2, 'right');

  drawTextShadow(ctx, `POS ${p.place}/${race.fieldSize}`, iw / 2, 4, '#f5c542', SH, 1, 'center');
  const pct = clamp(p.z / race.track.finishZ, 0, 1);
  drawText(ctx, `${Math.round(pct * 100)}%`, iw / 2, 13, '#ffffff', 1, 'center');

  if (race.state === 'countdown') {
    const n = Math.ceil(race.countdown - 0.6);
    const label = n > 0 ? String(n) : 'GO!';
    drawTextShadow(ctx, label, iw / 2, ih * 0.34, n > 0 ? '#ffffff' : '#6ede5a', SH, 5, 'center');
  }

  if (race.state === 'finished' && race.results) {
    const rows = race.results.slice(0, 6);
    const boxW = 122;
    const boxH = 22 + rows.length * 10;
    const bx = Math.round(iw / 2 - boxW / 2);
    const by = Math.round(ih / 2 - boxH / 2);
    ctx.fillStyle = 'rgba(8,14,32,0.86)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(bx, by, boxW, 1);
    ctx.fillRect(bx, by + boxH - 1, boxW, 1);
    drawText(ctx, 'FINISH', iw / 2, by + 4, '#f5c542', 1, 'center');
    rows.forEach((r, i) => {
      const y = by + 15 + i * 10;
      const col = r.isPlayer ? '#ffffff' : '#9fb0cc';
      drawText(ctx, `${r.place}`, bx + 6, y, col, 1);
      drawText(ctx, r.name, bx + 20, y, col, 1);
      drawText(ctx, r.time !== null ? fmtTime(r.time) : '--', bx + boxW - 6, y, col, 1, 'right');
    });
    drawText(ctx, 'PRESS R FOR A NEW RACE', iw / 2, by + boxH + 6, '#8fd8ff', 1, 'center');
  }
}

// Player elevation, needed by the background before the road is drawn.
export function playerElevation(track, player) {
  const seg = track.findSegment(player.z + PLAYER_Z);
  const pct = ((player.z + PLAYER_Z) % R.SEGMENT_LENGTH) / R.SEGMENT_LENGTH;
  return lerp(seg.p1.world.y, seg.p2.world.y, pct);
}
