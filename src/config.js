// Every tunable number and both colour themes. Zero imports, zero logic.

export const CFG = {
  DT: 1 / 60,

  // Internal pixel-art resolution. The canvas backing store is exactly this
  // size and CSS scales it up by an integer factor with image-rendering:
  // pixelated, so every pixel stays square and crisp. Height is fixed; width
  // follows the window aspect so widescreen fills without letterboxing.
  res: { H: 240, W_MIN: 320, W_MAX: 600 },

  road: {
    SEGMENT_LENGTH: 200,   // world units per segment
    RUMBLE_LENGTH: 3,      // segments per rumble/lane stripe
    WIDTH: 2000,           // half-width of the road surface
    LANES: 3,
    DRAW_DISTANCE: 260,    // segments drawn ahead
    FIELD_OF_VIEW: 100,    // degrees
    CAMERA_HEIGHT: 1000,
    // How far ahead of the camera the player car sits. Derived from camera
    // height so the car stays put on screen if the camera moves.
    FOG_DENSITY: 5,
  },

  car: {
    MAX_SPEED: 12000,        // world units per second
    ACCEL_TIME: 5.0,         // seconds from rest to MAX_SPEED
    BRAKE_TIME: 1.0,
    DECEL_TIME: 5.0,         // engine braking when coasting
    OFFROAD_DECEL_TIME: 0.5,
    OFFROAD_MAX_SPEED: 3000,
    // Steering authority and centrifugal drift both scale with STEER_SPEED, so
    // it cancels: whether a bend is holdable depends only on
    //   speedPercent * curve * CENTRIFUGAL < 1
    // At 0.35 the hardest bend needed under 48% throttle and the car spent the
    // race on the grass. At 0.22 it needs about 76%: lift, do not crawl.
    CENTRIFUGAL: 0.22,
    STEER_SPEED: 2.8,        // road-widths per second at full speed
    // Contact with another car scuffs you down to this fraction of their speed.
    BUMP_SPEED_FACTOR: 0.5,
    BUMP_PUSH: 0.9,
  },

  ai: {
    COUNT: 14,
    MIN_SPEED: 7600,
    MAX_SPEED: 10600,
    // Opponents drift toward a target lane and hold it.
    LANE_CHANGE_CHANCE: 0.004,
    STEER: 1.1,
    // Opponents shed speed in bends like the player does. Without this they
    // rounded every corner flat out and simply could not be caught.
    CURVE_SLOWDOWN: 0.055,
    MIN_CURVE_FACTOR: 0.62,
  },

  race: {
    COUNTDOWN: 3.6,
    LAPS_DISTANCE: 0,   // filled from the track length at build time
  },

  track: {
    // Built from these pieces, in order. `curve` is per-segment horizontal
    // shift; `hill` is the elevation change across the section.
    LENGTH_SCALE: 1,
  },

  // Two themes over the same engine: the coastal OutRun look and the
  // night-city arcade look. Only colours and background layers differ.
  themes: {
    coast: {
      name: 'coast',
      sky: ['#1b6fd6', '#2f8ce4', '#4aa8ee', '#6cc4f4', '#93dbf8', '#b8ecfb'],
      cloud: '#ffffff',
      cloudShade: '#cfe9fb',
      sea: '#1f6ecb',
      seaLight: '#3f97e2',
      seaFoam: '#bfe6ff',
      sand: '#e8d49a',
      hillFar: '#2f9c58',
      hillNear: '#24803f',
      grass: ['#54bf46', '#48ab3c'],
      rumble: ['#f2f2f2', '#c9302c'],
      road: ['#6d717c', '#666a75'],
      lane: '#f5c542',
      laneDouble: true,
      palms: true,
      stars: false,
    },
    night: {
      name: 'night',
      sky: ['#0a1230', '#0e1a3e', '#13224d', '#182a5c', '#1d326b', '#24407f'],
      cloud: '#1d2c58',
      cloudShade: '#16224a',
      sea: '#101c40',
      seaLight: '#16264f',
      seaFoam: '#22376b',
      sand: '#1a2547',
      hillFar: '#16224a',
      hillNear: '#101a3a',
      grass: ['#16402c', '#123724'],
      rumble: ['#e8e8f0', '#d63b3b'],
      road: ['#4a4a52', '#43434b'],
      lane: '#e8e8f0',
      laneDouble: false,
      palms: false,
      stars: true,
    },
  },
};
