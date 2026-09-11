# VANISHING POINT

A 3D racing game that runs in a browser tab. No engine, no art assets, no build
step — every texture, model, road and sky is generated in code at load.

**Live:** https://rezaska.github.io/racing-game/

## Run it locally

ES modules need http; `file://` fails the CORS check.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| | |
| --- | --- |
| Steer | `←` `→` |
| Throttle / brake | `↑` `↓` |
| Boost | `Shift` |
| Drift (handbrake) | `Space` |
| New road | `R` |
| Mute | `M` |
| Back to the title | `Esc` |

You start at the back of a fifteen-car grid. The handling is arcade, not
simulation: the car goes where you point it, you can hold the throttle through
most corners, and nothing will spin you out against your will. Throw it into a
bend hard, or pull the handbrake, and it drifts — which fills the boost meter,
as does passing close to another car. Spend the boost on the straights.

Each course comes from the seed in the URL (`#seed=1234`), so a road can be
shared by copying the link.

## URL parameters

| | |
| --- | --- |
| `#seed=1234` | pick a course; the same seed always builds the same road |
| `?art=1` | live art-direction panel, with copy-to-clipboard config |
| `?car=<url>` | load the cars from any glTF/GLB instead of the built-in model |
| `?play=1` | skip the title screen |
| `?warp=20` | run the simulation forward before the first frame (for stills) |
| `?shadow=512` | smaller shadow map, for software rendering |
| `?post=0` | disable post-processing |

## Using your own car model

```
?car=cars/mycar.glb
```

Applies to every car on the grid. The loader scales the model to the length the
simulation assumes, sits it on the ground, centres it, clones its materials so a
livery on one car does not repaint the field, and binds the wheels for spin and
steering.

What a model needs:

- **Wheels as separate meshes.** Named `*_fl/_fr/_rl/_rr` ideally, but failing
  that they are found geometrically — low to the ground, outboard, small and
  roundish — so unhelpful names like `Circle.003` are fine. Wheels *merged into
  the body mesh* cannot be found by anything and will not turn.
- **Under ~30k triangles** if every car uses it; a hero model for the player
  alone can be much heavier.
- **A body material** to recolour per livery. Matched by name (`body`, `paint`,
  `chassis`) or, failing that, the largest material that is not glass, rubber,
  lights or trim.

Set `credits.car` in `config.js` for anything requiring attribution; it renders
in the page footer.

```sh
node test/model.test.mjs
```

## How it is put together

```
src/sim/     simulation. Never imports three.js, never touches the DOM.
src/world/   geometry and materials built from the track
src/gfx/     renderer, camera, car model, HUD, art panel
src/site/    landing page styling
vendor/      three.js, vendored so it runs offline
```

That first line is the load-bearing one. Because `src/sim` is renderer-agnostic,
`test/sim.test.mjs` runs in plain Node with no canvas stub — a rendering change
cannot silently break race logic without a test failing.

```sh
node test/sim.test.mjs
```

### The road is a number

A course is a seeded shuffle of straights, sweepers and S-bends. That list
becomes a heading, integrated along the ground into a 3D centreline, then swept
into a mesh with banking, a cambered crown and rumble strips.

Two constants in `config.js` were measured against the real generator rather
than guessed, and both would have quietly wrecked the 3D version:

- **Elevation** at 1:1 gives **125.7% grades** and 294 m of relief. The 2D
  renderer hid it by only ever drawing height relative to the draw distance.
  Scaling, grade-limiting and box-filtering brings it to 13% — and the 90 m
  crest radius that falls out means the car gets real air above 107 km/h on
  every seed.
- **Curvature**, converted literally, gives a 31 m corner radius and coils the
  track through itself on **55 of 120 seeds**. Pinning the radius at 93 m gives
  0/200, and matches the throttle the handling model already implied.

### The handling is deliberately not a simulation

An earlier version used a bicycle model with slip-curve tyres. It was more
correct and much less fun: it understeered at the limit, demanded the entry
speed be managed for every corner, and punished mistakes. The arcade model that
replaced it is three lines of idea —

```
heading  turns directly from the steering input
velocity chases the heading at a rate called GRIP
drift    is simply GRIP dropping for a while
```

— and the angle between heading and velocity *is* the drift: always visible,
always recoverable on the steering, and capped so the car can never swap ends.

### One low sun

The scene is lit by a single sun 5° above the horizon, which makes a shadow 11.4×
the height of whatever casts it — a line of trees stripes the entire road. It
also means the sun contributes almost nothing to the tarmac, which sits at 85° to
the light. The road is lit by sky ambient, and that ambient is deliberately
**cool**: tint it with the amber horizon and every surface floods orange and the
picture loses its warm/cold separation.

## Re-vendoring three.js

Pinned to 0.180.0. The build is split, and both files must sit side by side.

```sh
V=0.180.0
curl -sfL -o vendor/three/three.module.js "https://cdn.jsdelivr.net/npm/three@$V/build/three.module.js"
curl -sfL -o vendor/three/three.core.js   "https://cdn.jsdelivr.net/npm/three@$V/build/three.core.js"
for f in postprocessing/EffectComposer postprocessing/RenderPass postprocessing/ShaderPass \
         postprocessing/OutputPass postprocessing/UnrealBloomPass postprocessing/Pass \
         postprocessing/MaskPass shaders/CopyShader shaders/LuminosityHighPassShader \
         shaders/OutputShader utils/BufferGeometryUtils; do
  curl -sfL -o "vendor/three/addons/$f.js" "https://cdn.jsdelivr.net/npm/three@$V/examples/jsm/$f.js"
done
```

## Earlier versions

Two previous takes on the same repo, both playable:

- `pixel-outrun` — pixel-art pseudo-3D racer, Canvas 2D, zero dependencies
- `hill-climb` — 2D side-scrolling hill-climb racer with spring suspension

## Credits

Built by one person with Claude as a collaborator. The design decisions, art
direction and judgement about what was worth building are mine; much of the
typing, measuring and debugging is not.
