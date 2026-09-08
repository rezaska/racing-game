// Every tunable number lives here. Zero imports, zero logic.
//
// The car constants are internally consistent -- change them as a SET and
// re-check these four numbers:
//   rest compression   = M*GRAVITY/(2*SPRING_K)      = 9.5 px   (~half MAX_TRAVEL)
//   suspension freq    = sqrt(2*SPRING_K/M)/(2*PI)   = 2.2 Hz   (sporty; real cars 1-2)
//   damping ratio      = 2*D/(2*sqrt(2*K*M))         = 0.51     (0.35 bouncy, 0.8 planted)
//   stability          = SPRING_K*DT*DT/M            = 0.0066   (must be << 1)

export const CFG = {
  DT: 1 / 120,
  GRAVITY: 1800, // px/s^2. Exaggerated vs real scale for arcade snap.

  car: {
    M: 1,
    // Physical box inertia would be (120^2 + 32^2)/12 = 1285. We ship 0.62x that:
    // real cars carry mass low and central, and lower inertia makes the car
    // flippier, which is exactly what this genre wants.
    I: 800,
    bodyW: 120,
    bodyH: 32,
    headLocal: { x: 26, y: -30 },
    // Geometry is the anti-flip lever. What matters is ry/wheelbaseRear, where
    // ry is the centre-of-mass height above the contact patch:
    //   ry = local.y + (REST - restCompression) + RADIUS = -10 + 14.5 + 17 = 21.5
    //   ratio = 21.5/50 = 0.43  (a real car is ~0.36)
    // At the original -40/+42 and local.y 10 the ratio was 1.04 -- the car was as
    // tall as its wheelbase was long, and it backflipped under its own drive
    // torque on flat ground. Lengthen the wheelbase or lower local.y before ever
    // raising ENGINE_FORCE.
    wheels: [
      { local: { x: -50, y: -10 }, drive: 1.00 }, // rear, driven
      { local: { x: 50, y: -10 }, drive: 0.35 },  // front, mild AWD helps climbing
    ],
    RADIUS: 17,
    REST: 24,
    MAX_TRAVEL: 20,
    SPRING_K: 95,
    SPRING_D: 7,
    SPRING_MAX: 26000, // ~14 g. Absorbs big landings without exploding.
    // Bump stop. Past MAX_TRAVEL the main spring saturates at K*travel = 1900,
    // barely 1 g, so hard landings just sank to the backstop depth and the
    // "never fires in normal play" safety net was carrying the game. This ramps
    // in steeply beyond full travel, the way a real bump stop does.
    BUMP_STOP_K: 1800,
    MU: 1.5,           // arcade grip
    // Bounded above by two anti-flip conditions and below by the need to climb:
    //   flat:        F < wheelbaseRear*M*G/ry             = 50*1800/21.5   = 4186
    //   32deg climb: F < wheelbaseRear*M*G*cos/ry - M*G*sin = 3550 - 954   = 2596
    //   climbs 32deg at all:  F > M*G*sin(32) = 954
    // Total drive at full grip is ~2350, inside all three. The climb condition is
    // the binding one and it tightens as MAX_SLOPE_DEG rises.
    ENGINE_FORCE: 2000,
    BRAKE_FORCE: 2400,
    REVERSE_FORCE: 1300,
    ROLL_RESIST: 0.55,
    AIR_DRAG: 0.0007,  // terminal speed ~ sqrt(2000/0.0007) ~= 1690 px/s
    // Terminal spin in flight is AIR_TORQUE/ANG_DAMP_AIR = 0.75 rad/s, enough to
    // swing ~45 deg during a typical hang time -- plenty to set up a landing,
    // not enough to loop. The damping also bleeds off the nose-up rotation the
    // car picks up launching off a ramp; at 7.0/0.6 that rotation ran away and
    // every jump taken with the gas held ended inverted.
    AIR_TORQUE: 3.0,
    ANG_DAMP_AIR: 4.0,
    // Small: the physical drive torque already sits near the anti-flip limit,
    // so a big value here eats the whole margin and pitches the car past 80 deg.
    WHEELIE_TORQUE: 1.2,
    // Soft anti-loop assist, measured RELATIVE to the ground angle so it never
    // fights an ordinary climb and never touches airborne flips. Below the limit
    // the wheelie is fully emergent; past it the chassis is pushed back down in
    // proportion to the excess. Without this, full throttle into a steep face
    // loops the car and traps the player in a crash-respawn cycle.
    WHEELIE_LIMIT: 0.55,  // rad (~31 deg) of nose-up above the surface
    ANTI_LOOP: 14,
    MAX_SPEED: 2400,
    MAX_OMEGA: 14,

    // Crash detection
    TURTLE_ANGLE: 2.3,
    TURTLE_SPEED: 60,
    TURTLE_TIME: 0.6,

    // Safety nets, neither of which should fire in normal play.
    BACKSTOP_DEPTH: 40,  // wheel buried this deep -> push out along the strut
    CHASSIS_FLOOR: 45,   // chassis centre this far below the surface -> hard stop
  },

  terrain: {
    DX: 6,
    LENGTH: 24000,   // ~30s at racing pace
    BASE_Y: 500,
    // Must stay CLIMBABLE FROM A STANDSTILL, or cars grind against a wall
    // forever. Needed force is M*G*sin(a); available is grip-limited to
    // MU*M*G*cos(a). At 40 deg that inverted and every car -- player and AI --
    // stalled permanently at the first steep face.
    MAX_SLOPE_DEG: 32,
    // Catmull-Rom octaves: [control spacing, amplitude]
    OCTAVES: [
      { spacing: 900, amp: 230 },
      { spacing: 260, amp: 75 },
      { spacing: 90, amp: 18 },
    ],
    START_FLAT: 1200,
    FINISH_FLAT: 700,
    BLEND: 900,   // wide: a short blend into the plateaus makes a steep face
    RAMP_IN: 2500,
    CHECKPOINT_SPACING: 2600,
  },

  camera: {
    LEAD: 0.35,
    LEAD_MIN: -150,
    LEAD_MAX: 350,
    LAMBDA_X: 6.0,
    LAMBDA_Y: 3.5,
    LAMBDA_ZOOM: 2.5,
    ZOOM_MIN: 0.68,
    ZOOM_MAX: 1.0,
    SPEED_ZOOM: 6000,
    AIR_ZOOM: 0.10,
    SHAKE_THRESHOLD: 18000,
    SHAKE_DECAY: 9,
    ANCHOR_Y: 0.62,
  },

  ai: {
    COUNT: 3,
    // Scale ENGINE_FORCE only -- never velocity or position. Force is mediated
    // through the physics and is invisible; velocity-scaling reads as a surge.
    BAND_MIN: 0.88,
    BAND_MAX: 1.12,
    BAND_RANGE: 4000,
    BAND_OFF_AT: 0.85, // last 15% of track: no assistance, results are honest
    PERSONALITIES: [
      { name: 'Dusty', color: '#e8543f', aggression: 0.95, caution: 0.6, pitchLimit: 0.95, cruiseSpeed: 900, reactionFrames: 12 },
      { name: 'Mo', color: '#3fa9e8', aggression: 0.82, caution: 1.0, pitchLimit: 0.70, cruiseSpeed: 750, reactionFrames: 20 },
      { name: 'Rev', color: '#b45ee8', aggression: 1.00, caution: 0.3, pitchLimit: 1.25, cruiseSpeed: 1050, reactionFrames: 9 },
    ],
  },

  race: {
    COUNTDOWN: 3.5,
    START_SPACING: 130,
    RESPAWN_HEIGHT: 60,
    CRASH_FREEZE: 1.4,
  },

  palette: {
    playerColor: '#f5c542',
    skyTop: '#4a86c4',
    skyBottom: '#bfe0f0',
    far: '#7d9ab5',
    mid: '#5f7f68',
    near: '#3b5545',
    dirt: '#6b4a2f',
    dirtDark: '#573b25',
    grass: '#4caf50',
  },
};
