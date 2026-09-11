// Every tunable number for VANISHING POINT. Zero imports, zero logic.
//
// The `art` block is what the ?art=1 panel writes into live; everything the
// renderer reads for look comes from there, so a look dialled in the browser can
// be pasted straight back into this file.

export const CFG = {
  DT: 1 / 60,

  world: {
    // THE conversion constant. Legacy sim units are not self-consistent (a car
    // is 1100 units wide, top speed 12000 units/s), so one scalar turns the
    // whole simulation into metres and everything else derives from it:
    //   road full width  2*2000*U = 14.0 m
    //   segment length     200*U  = 0.70 m
    //   top speed        12000*U  = 42 m/s = 151 km/h
    U: 0.0035,

    // Heading change per metre per unit of seg.curve. `curve` drives a
    // second-order accumulator in the source generator, so it is proportional
    // to heading change, NOT to lateral offset. Converting it literally gives a
    // 31 m corner radius and coils the track into itself on 55 of 120 seeds.
    // Pinning the radius at 93 m instead gives 0/120, and matches what the
    // handling model already implies: a 1.12 g corner at 76% throttle.
    KAPPA: 1 / (6 * 93),

    // Elevation reshaping. The raw generator accumulates hill * SEGMENT_LENGTH,
    // which measures out at 125.7% grades and 294 m of relief -- a cliff face.
    // The 2D renderer hid it by only ever showing relative height. Nothing in
    // the sim reads world.y, so it is free to reshape:
    //   scale by ELEV, limit the per-step change to SLEW, then box-filter.
    // Result: 13% grades, 64 m relief, 90 m minimum crest radius -- which means
    // the car gets real air over crests above 107 km/h on every seed.
    ELEV: 0.22,
    SLEW: 0.13,
    BOXR: 12,      // box-filter radius in stations, applied 3x (~Gaussian)
    BOX_PASSES: 3, // the slew limiter is C0 but not C1; its kinks show as
                   // visible creases in the road surface at speed

    BANK_MAX: 0.122,   // 7 deg at |curve| = 6
    BANK_TAU: 25,      // metres; smoothing, or every section boundary folds
    CROWN: 0.08,       // road crossfall, dy = -CROWN * x^2 (2%)
  },

  road: {
    SEGMENT_LENGTH: 200,   // legacy units per segment
    RUMBLE_LENGTH: 3,      // segments per rumble stripe (= 2.1 m, textbook)
    WIDTH: 2000,           // legacy half-width of the road surface
    LANES: 3,
    CHUNK: 256,            // segments per mesh chunk (179 m)
    TAIL: 700,             // segments of road built past the finish, so the
                           // world does not visibly end inside the fog
    HEAD: 200,             // and before the start line
  },

  car: {
    // --- arcade layer, shared by both handling models ---
    MAX_SPEED: 12000,        // legacy units/s
    ACCEL_TIME: 5.0,         // seconds from rest to MAX_SPEED
    BRAKE_TIME: 1.0,
    DECEL_TIME: 5.0,
    OFFROAD_DECEL_TIME: 0.5,
    OFFROAD_MAX_SPEED: 3000,
    BUMP_SPEED_FACTOR: 0.5,

    // How far off-track the car may get, in half-widths. Not tidiness: the road
    // surface is parameterised as C(s) + right(s)*n, and that mapping is
    // SINGULAR once |n| reaches the radius of curvature (93 m at the tightest).
    // Past it the projection folds and reports a small n for a car hundreds of
    // metres away. 4.5 half-widths is 31 m, comfortably clear.
    OFF_LIMIT: 4.5,

    // --- physical dimensions, metres ---
    LENGTH: 4.40,
    WIDTH_M: 1.90,
    HEIGHT: 1.22,
    WHEELBASE: 2.60,
    WHEEL_RADIUS: 0.34,
    MASS: 1200,
    INERTIA: 1600,
  },

  // Arcade handling. GRIP is the whole model: how fast the direction of travel
  // chases the direction the car points. High grip = goes where you point it.
  // Dropping it is what a drift IS.
  arcade: {
    TURN_MAX: 2.15,          // rad/s of yaw at a standstill
    // Turn rate at top speed is TURN_MAX * (1 - FALLOFF) = 0.82 rad/s, against
    // the 0.45 needed for the tightest corner. Generous on purpose.
    TURN_FALLOFF: 0.62,
    STEER_TAU: 0.10,

    GRIP: 7.0,
    GRIP_DRIFT: 1.7,
    GRIP_OFFROAD: 3.2,
    BETA_MAX: 0.72,          // ~41 deg of slide, and never more
    AUTO_DRIFT: true,
    DRIFT_STEER: 0.46,       // held steering past this slides the car
    DRIFT_MIN_SPEED: 0.30,
    DRIFT_SCRUB: 0.55,       // sliding costs speed, or drifting is free

    BOOST_MAX: 1,
    BOOST_SECONDS: 3.2,      // a full meter, held down
    BOOST_TOP: 1.32,
    BOOST_ACCEL: 1.9,
    BOOST_FROM_DRIFT: 0.42,
    BOOST_FROM_NEAR: 0.55,

    BARRIER: 1.30,
    OFFROAD_TOP: 0.55,
    BUMP_KEEP: 0.72,
    SIDESWIPE_KEEP: 0.93,    // a scrape costs little; it should not end a race
    PUSH_APART: 0.55,        // share of the overlap resolved per frame
  },

  ai: {
    COUNT: 14,
    LIVERIES: 8,
    MIN_SPEED: 7600,
    MAX_SPEED: 10600,
    LANE_CHANGE_CHANCE: 0.004,
    STEER: 1.1,
    CURVE_SLOWDOWN: 0.055,
    MIN_CURVE_FACTOR: 0.62,
    // Compensates for HALF_WIDTH dropping 0.55 -> 0.32 so avoidance behaviour
    // stays exactly what it was before the rescale: 2.4*0.32 ~= 1.4*0.55.
    AVOID_PCT: 2.4,
    ROW_SPACING: 14,   // segments between grid rows; at 7 the 4.4 m cars overlap
    BAND_MIN: 0.88,
    BAND_MAX: 1.12,
    BAND_RANGE: 4000,
    BAND_OFF_AT: 0.85,
  },

  race: {
    COUNTDOWN: 3.6,
  },

  // Attribution for any third-party asset in use. A CC-BY model requires
  // credit; this is where it gets discharged, and it renders in the footer.
  credits: {
    car: 'Cyberpunk car by 4d_Bob (CC BY)',
    carUrl: 'https://sketchfab.com/3d-models/cyberpunk-car-b4301ff99d214d16a7a43708a5866bf0',
  },

  // Default car model. ?car=<url> overrides it; ?car=none forces the built-in
  // procedural car. Falls back to procedural if the file will not load.
  carModel: 'cars/cyberpunk_car.glb',

  // --- look. Everything here is live-editable via ?art=1 ---
  art: {
    // One low sun, behind and slightly left, so shadows stretch toward the
    // viewer down the road. At 5 deg a shadow is 11.4x the object's height, and
    // a treeline striping the whole road is the signature image of the piece.
    sunElevation: 5.0,      // degrees
    sunAzimuth: 18,         // degrees from track-forward; near the vanishing point
    sunIntensity: 5.5,
    // Carries the road. At 5 degrees the sun strikes a horizontal surface at 85
    // degrees incidence, so the tarmac is lit by sky, not by sun -- the sun's
    // job here is rim light on vertical surfaces and the sky itself.
    // COOL, deliberately: tinting ambient with the amber horizon floods every
    // surface orange and the scene loses all tonal separation.
    ambient: 0.85,
    ambientSky: '#5566c8',
    ambientGround: '#171024',

    skyZenith: '#1b1140',
    skyMid: '#6d2a5a',
    skyHorizon: '#ff7a3d',
    skyMidPoint: 0.34,      // where mid sits between horizon and zenith
    sunColor: '#ffd9a0',
    sunSize: 0.013,
    sunGlow: 0.09,

    fogColor: '#d9683f',
    fogDensity: 0.0035,     // denser than realism, so distance dissolves

    roadColor: '#5d5568',
    rumbleLight: '#c8bfae',
    rumbleDark: '#7a2f34',
    lineColor: '#f6efe2',
    terrainNear: '#241d2e',
    terrainFar: '#0d0a14',
    sceneryColor: '#0f0c16',
    railColor: '#3a3346',

    playerColor: '#dcd3c4',

    exposure: 0.86,
    bloomStrength: 0.30,
    bloomRadius: 0.62,
    bloomThreshold: 0.92,
    vignette: 0.38,
    grain: 0.022,
    gradeShadow: '#2a3f52',   // cool shadows
    gradeHighlight: '#ffcf9e', // warm highlights
    gradeStrength: 0.45,
  },

  render: {
    // Narrower than it was (58/86). An 86 deg vertical FOV is 118 deg across a
    // 16:9 frame, and at 7 m that reads as a lens jammed against the bumper --
    // the car looms and the edges of the frame smear. Pulling the camera back
    // and narrowing the lens together keeps the car the same size on screen
    // (7.7% of frame width at speed, against 8.1% before) while removing the
    // distortion, which is what "too close" actually looks like.
    FOV_MIN: 54,
    FOV_MAX: 72,
    NEAR: 0.5,
    FAR: 1500,
    SHADOW_MAP: 2048,
    SHADOW_EXTENT: 62,      // metres, ortho half-extent around the car
    SHADOW_NEAR: 1,
    SHADOW_FAR: 340,
    SHADOW_BIAS: -0.0006,
    SHADOW_NORMAL_BIAS: 0.035,  // grazing sun makes acne much worse
    PIXEL_RATIO_MAX: 1.5,
    PIXEL_RATIO_MIN: 0.75,
    FRAME_BUDGET_MS: 18,
    DRAW_DISTANCE: 900,     // metres of track geometry kept resident
  },

  // Lower and closer than is comfortable to compose a still with, because
  // proximity to the ground is most of what makes speed legible in motion.
  camera: {
    TAU_ANCHOR: 0.08,
    TAU_YAW: 0.22,          // the single most important camera number
    TAU_POS: 0.10,
    TAU_LOOK: 0.18,
    TAU_FOV: 0.35,
    TAU_ROLL: 0.25,
    // Metres behind and above the car: BACK + BACK_SPEED * speedPct, so the
    // camera eases out as the car accelerates. 7.4 -> 9.1 m back and
    // 2.45 -> 2.85 m up. At the old 5.3/1.62 the camera sat level with the
    // roofline of a 1.22 m car about one car length behind it, so the car
    // itself hid the road you were about to drive on.
    BACK: 7.4,
    BACK_SPEED: 1.7,
    UP: 2.45,
    UP_SPEED: 0.40,
    LOOK_UP: 1.9,           // height of the look-at point above the road; it
                            // rises with the camera, or the horizon sinks
    LOOKAHEAD_S: 1.15,      // seconds of travel to look ahead
    LOOKAHEAD_MIN: 12,
    LOOKAHEAD_MAX: 55,
    ROLL_MAX: 0.045,
    GROUND_CLEAR: 1.0,      // metres the camera keeps above the road behind it
    GROUND_SOFT: 0.5,       // blend width for that floor; 0 would be a hard max
  },
};
