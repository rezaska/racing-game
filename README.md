# Hill Racer

A 2D side-scrolling hill-climb racer: drive left-to-right over procedurally
generated terrain against three AI opponents. Vanilla JavaScript and Canvas 2D —
no dependencies, no build step.

## Run

ES modules require http; opening `index.html` from `file://` will fail the CORS check.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Action | Keys |
| --- | --- |
| Accelerate | `→` / `D` / `W`, or the right on-screen button |
| Brake / reverse | `←` / `A` / `S`, or the left on-screen button |
| New track | `R` |

In the air the pedals become pitch controls: gas rotates the nose up, brake
rotates it down. Land level. Put the driver's head into the ground and you crash
back to the last checkpoint.

Holding full throttle the whole way will not win — the car wheelies on climbs and
over-rotates off jumps. Modulating is the game.

## Tracks

Every track comes from a seed in the URL: `#seed=1234`. The same seed always
generates the same terrain, so a track can be shared by copying the link. `R`
picks a new random seed.

## Layout

| File | Contents |
| --- | --- |
| `src/config.js` | Every tunable number. Start here; the constants are interdependent and the comments say how. |
| `src/mathx.js` | Pure helpers: clamping, smoothing, seeded PRNG, Catmull-Rom |
| `src/terrain.js` | Seeded terrain baked into a heightmap; sampling; parallax layers |
| `src/vehicle.js` | The physics: rigid chassis on two spring-damper suspension probes |
| `src/ai.js` | Opponent controller: terrain lookahead, landing prediction, reaction lag |
| `src/race.js` | Race state machine, standings, particles |
| `src/camera.js` | Follow, zoom, shake, parallax transform |
| `src/render.js` | All drawing, back to front |
| `src/input.js` | Keyboard and touch |
| `src/main.js` | Bootstrap and the fixed-timestep loop |

## Notes on the physics

Physics runs at a fixed 120 Hz with an accumulator, independent of frame rate.
The chassis is a rigid body; the wheels are kinematic probes that apply spring,
damper and drive forces at the contact patch. Because drive force is applied at
the contact patch — below the centre of mass — wheelies fall out of the torque
math rather than being scripted.

The constants in `config.js` are a coupled set. Two conditions in particular are
easy to violate and produce a car that backflips on flat ground or cannot climb
at all; both are derived in the comments next to `ENGINE_FORCE` and
`MAX_SLOPE_DEG`. Re-derive them before raising engine force, grip, or the terrain
slope limit.
