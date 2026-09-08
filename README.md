# Coast Racer

A pixel-art arcade racer in the OutRun / Pole Position mould: you sit behind the
car, the road curves away to the horizon, and you steer left and right through
traffic to the finish. Vanilla JavaScript and Canvas 2D — no dependencies, no
build step.

## Run

ES modules require http; opening `index.html` from `file://` will fail the CORS check.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Action | Keys |
| --- | --- |
| Start / any control | leaves the title screen |
| Steer | `←` `→` or `A` `D` |
| Accelerate | `↑` / `W` / `Space` |
| Brake | `↓` / `S` |
| New race | `R` |
| Switch theme | `T` |

You start at the back of a fifteen-car field. Centrifugal force pushes you to the
outside of every bend, and past a certain speed no amount of steering will hold
the corner — lifting off for the hard ones is the whole game. Push a bend harder
than the tyres will take and the car breaks traction and slides wide, smoking,
until you catch it. Two wheels on the grass caps you at a crawl, and rear-ending
a slower car drops you to their speed.

## Tracks and themes

The course comes from a seed in the URL: `#seed=1234`. The same seed always
builds the same course, so a track can be shared by copying the link. `R` picks a
new one.

Two themes render the same engine: `coast` (default) — sea, palms, dithered blue
sky — and `night` (`#seed=1234&theme=night`) — city skyline with lit windows,
starfield, lamp posts. Toggle live with `T`. They differ only in palette,
background layers and roadside props.

## Layout

| File | Contents |
| --- | --- |
| `src/config.js` | Every tunable number and both themes. Start here. |
| `src/mathx.js` | Pure helpers: easing, seeded PRNG, interval overlap |
| `src/track.js` | Seeded course building, and the projection that makes it 3D |
| `src/player.js` | Player car: throttle, steering, centrifugal drift, collisions |
| `src/ai.js` | Opponents: lane holding, look-ahead avoidance, corner speed |
| `src/race.js` | Race state machine, standings, results |
| `src/render.js` | Dithered sky, parallax layers, road, sprites, HUD |
| `src/sprites.js` | Procedural pixel-art sprites drawn at 1px granularity |
| `src/pixelfont.js` | 5x7 bitmap font |
| `src/input.js` | Keyboard and touch |
| `src/main.js` | Bootstrap and the fixed-timestep loop |

## How the 3D works

There is no 3D. The road is a list of segments, each with a curve and an
elevation. Every frame each segment is projected to the screen with

```
scale = cameraDepth / distanceAhead
```

and drawn as a flat trapezoid between its near and far edges, front to back,
clipping anything hidden behind a crest. Curves come from accumulating a
horizontal shift per segment as you walk down the list. This is the classic
pseudo-3D technique those arcade cabinets used.

The picture is drawn at a low internal resolution (240px tall, width following
the window aspect) and scaled up by a whole number with `image-rendering:
pixelated`, so every pixel stays square. Sprites are drawn procedurally at 1px
granularity rather than loaded as images.

## Notes on the road furniture

Guardrails are drawn per segment as a quad standing on the verge, in a second
back-to-front pass **after** every road segment. Drawing them inline does not
work: a rail extends upward into the band where farther segments are still to be
drawn, so distant road paints straight over near rails.

## Notes on balance

Steering authority and centrifugal drift both scale with steering speed, so it
cancels out and whether a bend is holdable reduces to

```
speedPercent * curve * CENTRIFUGAL < 1
```

which is why `CENTRIFUGAL` is the single most important number in `config.js`.
Opponents shed speed in bends by the same logic; without that they rounded every
corner flat out and could not be caught.

Drift sits on top of that. Cornering load is `|curve| * speedPercent`; past
`GRIP` the tyres let go and `DRIFT_PUSH` slides the car toward the outside of the
bend, which you catch on the steering.
