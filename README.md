# VANISHING POINT

A 3D racing game that runs in a browser tab. No engine and no build step. The
road, sky, terrain and scenery are all generated in code at load; the only
downloaded asset is the car model.

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
| `?play=1` | skip the menu and start a race |
| `?shot=menu` | strip the overlays without starting a race, to photograph the title |
| `?car=<url>` | re-skin the whole field, player included, from any glTF/GLB |
| `?playercar=<url>` | change only the player's car |
| `?car=none` | force the built-in procedural car |
| `?fps=0` | remove the 60 fps cap and present at the display's refresh rate |
| `?play=1` | skip the title screen |
| `?warp=20` | run the simulation forward before the first frame (for stills) |
| `?shadow=512` | smaller shadow map, for software rendering |
| `?post=0` | disable post-processing |

## Car models

The cars use a downloaded model by default, set by `carModel` in `config.js`.
`?car=<url>` swaps it for another, `?car=none` falls back to the procedural car
that ships in `src/gfx/carmodel.js`.

```
?car=cars/mycar.glb
```

Applies to every car on the grid. The loader scales the model to the length the
simulation assumes, sits it on the ground, centres it, clones its materials so a
livery on one car does not repaint the field, and binds the wheels for spin and
steering.

What a model needs:

- **Wheels that can be separated.** Named `*_fl/_fr/_rl/_rr` ideally; failing
  that they are found geometrically, and failing *that* a single merged mesh is
  split by connected component — most merged models are merged but not welded,
  so the wheels survive as separate islands of geometry. Only a model whose
  wheel vertices are genuinely welded to the body defeats it.
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

### What the speed blur is for

The radial blur stands in for the world rushing past the camera. The car is not
rushing past the camera — it is bolted to it, so its true motion blur is zero,
and it is also the one thing the driver has to be able to read. It used to be
smeared along with everything else, because the blur radiated from the middle of
the screen and the car sits well below that.

The blur is now centred on the **focus of expansion** — the point the camera is
travelling toward, where optical flow is zero and the smear must have no length.
The middle of the screen is only the same thing on a straight; through a corner
the camera moves one way and looks another. The car is masked out with a radius
taken from its own projected size, so it stays sharp at any camera distance.

### A camera that sits where you put it

Exponential smoothing chasing a target that is moving at a constant velocity
does not converge on it. It settles a fixed distance behind, `v * tau`, and the
chase camera runs two of these in series — the anchor chasing the car, then the
camera chasing a point offset from the anchor. At 126 km/h they together parked
it **14.85 m** back against the 9.25 m `BACK` and `BACK_SPEED` ask for.

So the camera numbers described a stationary car and nothing else, and every
value tuned through them was wrong at racing speed. Feeding the target's own
velocity forward by its tau cancels the error; `LEAD` is deliberately short of
1, because some fall-back under acceleration is a good speed cue and this keeps
it bounded rather than growing with speed.

The test for it drives a synthetic car at a constant speed straight into the
real `ChaseCam`, because a real race never holds a steady speed — the field is
bumping constantly and frame-to-frame acceleration never drops below about
2 m/s². It runs the same stations twice, with the compensation off and on, so
track curvature cancels: **+67% uncompensated, +11% with it**. The first of
those two numbers is asserted as well, so the check cannot quietly stop testing
anything.

### The title screen is a landscape

The menu sits over the game, but not over a demo lap: no cars are drawn, the
traffic is not even simulated, and the camera is a separate one composed around
the road rather than around a car that is not there. It runs a long lens, so the
sun sits large and the road compresses into a band heading for the vanishing
point the piece is named after. Height, lateral offset, look-ahead and roll all
drift on periods that share no common multiple, so the move never visibly
repeats while someone reads the menu. `?shot=menu` photographs it.

### Finishing

The race is not over when your race is over. Opponents that crossed after the
player used to be stamped with the player's own frozen finishing time, so a
whole field shared one time — there are two clocks now, one that stops when you
cross and one that does not.

Nobody wants to sit and watch the field trail in for half a minute, though, so
the moment the player takes the flag the opponents are fast-forwarded: they run
on rails, and simulating their remaining distance costs a few milliseconds once
rather than making anyone wait. The classification is complete — all fifteen,
with real times and gaps — by the time the panel has faded in.

### Models from the wild

The player and the field drive different cars, because with one shared model
the only thing separating you from fourteen opponents is a brightness
multiplier, which is not enough to find yourself at speed.

Downloaded models rarely drop straight in, and the two here failed in opposite
ways. The opponents' car came as a single merged mesh, so its wheels are
recovered by flood-filling the geometry — merged models are rarely *welded*, so
each wheel survives as its own island of triangles. The player's car had named,
separate wheels and a proper suspension hierarchy, and still needed three fixes:

- **Its materials were invisible to the loader.** Every one declared its
  colours and textures only inside `KHR_materials_pbrSpecularGlossiness`, which
  three.js removed in r165 — so the car loaded flat white. A large share of
  Sketchfab's back catalogue is authored this way.
- **A baked shadow quad drove the scale.** Models often ship a flat shadow
  plane, wider than the car by design. Measuring the whole scene measured the
  shadow — 10 units against a 4.8 unit car — and shrank the car to a quarter
  size. Nothing flat is part of a car body, so flat meshes are now excluded
  from the measurement and hidden.
- **It faced backwards**, with a 180° turn baked into its root bone. Where an
  author names the wheels, the file already answers this: the front pair has to
  end up at -z, because that is the direction of travel.

`tools/glb-specgloss.mjs` handles the first, offline and with no dependencies —
PNG is decoded and re-encoded against `zlib`, because a project with no build
step should not need one to maintain its assets either.

```sh
node tools/glb-specgloss.mjs in.glb out.glb --strip clearcoat,car_shadow
```

The conversion cannot be done with factors alone, and this is the part worth
knowing: in the specular workflow **a metal has a black diffuse and carries its
paint in the specular map**. Reading base colour off the diffuse texture — the
obvious thing — gives a black car. It walks the textures pixel by pixel with the
Khronos conversion instead, recovering base colour, metalness and roughness. One
extra rule on top: a transparent material is never a metal, or tinted glass
solves as 0.92 metallic and renders as a chrome windscreen.

### Sixty frames a second, on purpose

The simulation is fixed at 60 Hz and the presented frame rate is capped to
match, by rendering on every Nth vsync -- never by comparing elapsed time
against an interval, which beats against the display's own cadence and causes
the uneven pacing it is meant to prevent. N comes from the measured refresh
rate, so an external monitor plugged in mid-race re-paces rather than halving
the frame rate, and it is floored so the cap can never present below its
target: a 144 Hz display gets an even 72 rather than a lurching 60.

The cap is a power decision, not a smoothness one. Uncapped requestAnimationFrame
is already perfectly vsync-paced, and render interpolation already handles a
display that does not run at 60 Hz. What it buys is halved GPU work on a 120 Hz
laptop; what it costs is half the motion resolution there. `?fps=0` to compare.

### Testing the thing a screenshot cannot see

Judder only exists in the relationship between consecutive frames, so every
still of a stuttering game looks perfect. `test/smooth.test.mjs` drives the
real page in headless Chrome at display rates that do not divide the 60 Hz
simulation rate, and measures where the car lands on screen each frame. The
metric is the second difference of its pixel position: steady drift cancels,
jitter does not.

It is the only check here that can catch a class of bug this project kept
shipping — one that is invisible to the sim tests and to screenshots alike.
Without render interpolation it measures 6-8 px of jitter per frame; with it,
under a fifth of a pixel.

```sh
node test/smooth.test.mjs   # needs Chrome
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

Car model: [Cyberpunk car by 4d_Bob](https://sketchfab.com/3d-models/cyberpunk-car-b4301ff99d214d16a7a43708a5866bf0),
licensed CC BY.

Built by one person with Claude as a collaborator. The design decisions, art
direction and judgement about what was worth building are mine; much of the
typing, measuring and debugging is not.
