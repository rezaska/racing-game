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

    // --- handling ---
    STEER_MAX: 0.55,        // rad at the road wheel (31 deg)
    STEER_TAU: 0.14,        // steering lag; instant steering feels twitchy
    A_FRONT: 1.30,          // CoM to front axle, m
    B_REAR: 1.30,
    MU_ROAD: 1.45,
    MU_OFFROAD: 0.50,
    OFFROAD_DRAG: 1.1,
    // Opening the throttle unloads the rear laterally, so a slide can be
    // provoked on purpose rather than only suffered.
    POWER_OVERSTEER: 0.35,
    // Yaw-rate assist: firm when planted so the car goes where it is pointed,
    // slack once sliding so a drift is the driver's to hold. Also the
    // difficulty dial -- raise ASSIST_FIRM and the car is effectively on rails.
    ASSIST_FIRM: 7.0,
    ASSIST_LOOSE: 2.4,
    // The tyre curve peaks near 0.19 rad, so a threshold of 0.15 dropped the
    // assist to slack the instant the rear was worked at all.
    SLIDE_THRESHOLD: 0.28,
    STEER_HEADROOM: 1.12,   // steer angle allowed above the grip limit. Above ~1.3,
                            // sustained full lock (which is all a keyboard can
                            // give) always exceeds grip and the car just spins.
    BARRIER: 2.4,           // half-widths before the soft barrier pushes back
    // Hard limit on how far off-track the car may get, in half-widths. This is
    // not tidiness: the road surface is parameterised as C(s) + right(s)*n, and
    // that mapping is SINGULAR once |n| reaches the radius of curvature (93 m
    // at the tightest). Past it the projection folds, returns garbage, and the
    // car teleports across the map. 4.5 half-widths is 31 m, comfortably clear.
    OFF_LIMIT: 4.5,
    V_LAT_MAX: 26,          // m/s of sideways slide; nothing physical exceeds it

    // Collision half-width in road half-widths. At the old 0.55 this fired with
    // a visible 1.4 m gap between cars once the world had a real scale:
    //   0.85 * 0.32 * 7 m = 1.90 m, exactly two car widths touching.
    HALF_WIDTH: 0.32,

    // --- physical dimensions, metres ---
    LENGTH: 4.40,
    WIDTH_M: 1.90,
    HEIGHT: 1.22,
    WHEELBASE: 2.60,
    WHEEL_RADIUS: 0.34,
    MASS: 1200,
    INERTIA: 1600,
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

    roadColor: '#514a5e',
    rumbleLight: '#c8bfae',
    rumbleDark: '#7a2f34',
    lineColor: '#e8dcc0',
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
    FOV_MIN: 62,
    FOV_MAX: 78,
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

  camera: {
    TAU_ANCHOR: 0.08,
    TAU_YAW: 0.22,          // the single most important camera number
    TAU_POS: 0.10,
    TAU_LOOK: 0.18,
    TAU_FOV: 0.35,
    TAU_ROLL: 0.25,
    BACK: 6.2,
    BACK_SPEED: 2.0,
    UP: 2.1,
    UP_SPEED: 0.35,
    LOOKAHEAD_S: 1.15,      // seconds of travel to look ahead
    LOOKAHEAD_MIN: 12,
    LOOKAHEAD_MAX: 55,
    ROLL_MAX: 0.045,
  },
};
