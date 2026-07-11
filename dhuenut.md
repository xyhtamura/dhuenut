# DHuenut

DHuenut is a hue-vs-hue curve editor where hue transforms are treated as
circle maps:

```text
f : S^1 -> S^1
```

The graph of such a map lives on the torus `S^1 x S^1`: input hue around one
circle, output hue around the other. The first MVP is now implemented as a
static web app in this folder.

Sibling project: [GaHueMa](../gahuema/) remains the simpler anchor/formula
tool. DHuenut imports GaHueMa-style transforms as editable curves.

Status: MVP implemented on 2026-07-11.

---

## Current App

```text
dhuenut/
  index.html      app shell, layout, controls, styling
  dhuenut.svg     app icon / favicon
  dhuenut.js      curve model, renderer, media handling, export/import
  torus-view.js   read-only projected torus visualization
  dhuenut.md      this living documentation document
```

Open `index.html` directly in a browser, or serve the folder with any static
file server. No build step is required.

---

## What Is Completed

### Curve Instrument

- [x] Lifted curve model with explicit integer degree.
- [x] 1024-entry hue LUT generated from the curve.
- [x] LUT iteration by composition before render.
- [x] Preset dropdown for identity, invert, collapse, double, sine, complement,
      triple, ripple, and foldback curves.
- [x] Hue rotate process with signed degree offset.
- [x] Hue invert process that flips output hue and winding degree.
- [x] Degree input.
- [x] Local slope readout.
- [x] Input/output hue readouts and swatches.
- [x] Click to add control point.
- [x] Drag to move control point.
- [x] Double-click to delete a nonessential control point.
- [x] Identity diagonal.
- [x] Ghost/lift copies of the curve for wrap awareness.
- [x] Hue axes around the editor.
- [x] Drag hue axes to pan the flat torus viewport.
- [x] Read-only projected torus view of the current curve.
- [x] Continuous filled torus shell with overlaid hue guide grid.
- [x] Torus opacity slider.
- [x] Drag-to-rotate torus view.

### Media Shell

- [x] Image upload.
- [x] Video upload.
- [x] Extension fallback for image/video imports with missing MIME types.
- [x] Drag/drop zone for images and videos.
- [x] Original and processed preview canvases.
- [x] Video play/pause, seek, loop, and time display.
- [x] Pixel hover inspection on original and processed canvases.
- [x] PNG export for still images.
- [x] WebM export for videos through `MediaRecorder`.

### Color And Rendering

- [x] HSL hue remapping.
- [x] OKLCH hue remapping.
- [x] CPU fallback renderer.
- [x] WebGL renderer with a 1D hue LUT texture.
- [x] Backend selector: auto, GPU, CPU.
- [x] GPU LUT wrap correction for hue continuity at 0/360.

### Import / Export

- [x] Curve JSON export.
- [x] Curve JSON import.
- [x] `.cube` 3D LUT export.
- [x] Cube size selector.
- [x] GaHueMa-style import panel.
- [x] GaHueMa add, multiply, and binomial modes.
- [x] Anchor hue.
- [x] Factor / M / P / A controls.
- [x] Prevent-crossing option.

---

## MVP Notes

The MVP keeps most behavior in `dhuenut.js`, with a small `torus-view.js`
renderer split out for the read-only torus display. The curve model remains the
single source of truth; the torus view receives only a small adapter around
`sampleLift` and the current control points.

The curve is stored as a lift: control points carry an `x` input hue and a
lifted `y` output hue. The visible hue is `y mod 360`, while the full lifted
value preserves the map degree. The degree is currently edited directly with
the degree input. Dragging a point past the top or bottom of the editor keeps
that point on the appropriate lifted branch, but changing degree by edge
crossing is still future work.

The flat curve editor is now a pannable 360-by-360 viewport into the torus
space. Dragging the bottom hue bar pans input hue. Dragging the left hue bar
pans output hue. The viewport wraps around both axes; the curve data itself
stays in the same lifted model.

Rendering follows the GaHueMa shell idea:

- media loading, video frame scheduling, canvas export, and backend selection
  are carried over conceptually from GaHueMa;
- the old formula transform is replaced by a sampled curve LUT;
- the GPU path uploads that LUT as a texture;
- the CPU path uses the same LUT with interpolation.

---

## Why This Is Interesting

Existing hue-vs-hue tools usually present a bounded hue-shift curve:

```text
input hue -> Delta hue
```

That representation is naturally a cylinder: circle times bounded interval.
It keeps users near the identity map and makes nonstandard winding behavior
awkward or discontinuous.

DHuenut instead edits:

```text
input hue -> output hue
```

on the torus. That makes the topological degree visible and editable.

Useful degrees:

- `d = 1`: ordinary grading and hue correction.
- `d = 0`: collapse many hues toward one or a few target hues.
- `d = -1`: hue inversion / complement mapping.
- `d = 2`: hue doubling, where output hue winds twice per input cycle.

Local slope is also exposed. This gives the editor a vocabulary that ordinary
tools hide:

- slope near `0`: hue compression / controlled collapse;
- slope near `1`: ordinary hue preservation;
- slope greater than `1`: hue expansion;
- negative slope: local hue reversal.

Iteration is the other research hook. Applying the curve repeatedly turns the
tool into a small circle-map dynamics playground: fixed points, cycles,
mode-locking looks, and sine-family experiments become visual effects rather
than only equations.

---

## Paper / Submission Angle

The likely paper-shaped claim:

> Hue remapping tools can be modeled as circle maps. Existing production UIs
> mostly expose a local, bounded, degree-1 offset representation. A torus-native
> editor exposes degree, derivative, and iteration directly, enabling hue
> transforms that are difficult or impossible to express in conventional
> hue-vs-hue interfaces while remaining exportable as standard 3D LUTs.

Possible contributions:

- formalize hue-vs-hue editing as maps `S^1 -> S^1`;
- distinguish bounded offset curves from torus-native output curves;
- expose degree as a creative control;
- expose local slope as hue compression / expansion / reversal;
- add iteration as a grading operation;
- demonstrate web-native image/video interaction;
- export results as `.cube` LUTs for existing pro tools.

Good demo figures:

- degree `1`, `0`, `-1`, and `2` curves in the flat editor;
- the same curves shown as torus windings once the torus view exists;
- source image/video frames plus processed outputs;
- GaHueMa formula import becoming an editable DHuenut curve;
- iteration sequence for a sine-like curve.

---

## Validation Log

Last checked after the Hue Histogram Underlay implementation on 2026-07-11:

- `node --check dhuenut\dhuenut.js` passed.
- Static DOM ID wiring check passed: every JS `$("id")` reference exists in
  `index.html`.
- Live browser smoke test was run in this pass (real-time histogram and visual space mapping verified).
- No persistent local dev server is required or currently running.

---

## Remaining Work

### Near-Term Product Work

- [ ] Browser smoke test in a normal browser.
- [ ] Add a visible app version/date in the UI.
- [ ] Add example images or bundled sample media.
- [ ] Add better error display for unsupported video codecs.
- [x] Add reset/undo for curve edits.
- [ ] Add keyboard controls for selected points.
- [ ] Improve mobile/touch ergonomics for point editing.
- [ ] Add URL-encoded curve sharing.

### Curve And Math Work

- [x] Edge-crossing degree edits (solved by Dehn twist).
- [ ] Optional tangent handles for slope control.
- [ ] Monotone spline mode for users who want no local hue reversal.
- [ ] Better point constraints around near-duplicate input hues.
- [ ] Better GaHueMa faithful import around clamp kinks and plateaus.
- [ ] Optional smoothing for imported prevent-crossing curves.
- [ ] Fractional iteration experiments.

### Visualization Work

- [x] Hue histogram underlay from loaded media.
- [x] Read-only projected torus curve display with filled shell and guide grid.
- [x] Read-only torus view rotation and opacity controls.
- [ ] Optional 3D torus view using Three.js.
- [ ] Later: editable torus interaction, if it earns its complexity.
- [ ] Compare HSL and OKLCH curves visually.

### Export / Interop Work

- [ ] More `.cube` metadata in exported files.
- [ ] LUT preview stress tests on saturated and low-chroma colors.
- [ ] Preset library.
- [ ] Import/export compatibility notes for Resolve, Premiere, Photoshop, and
      other LUT consumers.

---

## Open Questions

- Should a curve be stored per color space, or should the same abstract curve
  apply in both HSL and OKLCH?
- Should DHuenut prioritize exact mathematical curves, hand-drawn artistic
  curves, or a hybrid preset-plus-edit workflow?
- What is the best readable representation of degree changes for nontechnical
  users?
- Is a 3D torus view pedagogically helpful enough to justify the extra UI
  surface, or should it stay as a paper/demo visualization?
- Can iteration be made legible enough for colorists, or is it mainly a
  research/art mode?

## Operations & Math Manipulations:

Read model: points carry lift `y`, degree explicit, ops mutate points then `markCurveDirty`. Current ops (rotate = `y += a`, invert = `y → −y, d → −d`) are two elements of torus affine symmetry group. Full family — graph stays graph under `(x,y) → (x, mx ± y) + (a,b)` plus transpose. That gives natural op menu:

### Exact torus symmetry ops (cheap, always valid)

1. **Input rotate** — `f(x) → f(x − a)`. All points `x = (x + a) mod 360` (keep lift branch). Dual of existing output rotate. Rotates *which* hues get treated, not where they go.
2. **Conjugate rotate (recenter)** — rotate input+output together: `f(x−a) + a`. Same curve shape, moved around wheel. Colorist meaning: "same look, centered on skin tones instead of blues". Distinct from ops 1 and existing rotate; big artistic value.
3. **Input invert** — `f(−x)`: `x → (360 − x) mod 360`, `d → −d`. Mirror across vertical.
4. **Mirror conjugate** — `−f(−x)`: both flips. Degree preserved. "Same effect, opposite side of wheel."
5. **Dehn twist (add winding)** — `y += m·x`, `d += m`. THE natural degree editor. "+1 turn / −1 turn" buttons keep all wiggle, change winding. Solves your "edge-crossing degree edits" backlog item cheaply.
6. **Functional inverse (transpose)** — swap `x↔y`, reflect graph across diagonal. Only valid when curve monotone, `d = ±1`; disable button otherwise. Meaning: "undo this grading". Very torus-native, no bounded-offset tool can do it.

### Deviation-space ops (use `g(x) = y − d·x`, periodic part)

7. **Strength / exaggerate** — `y → d·x + s·(y − d·x)`. `s∈[0,1]` attenuate toward pure winding, `s>1` exaggerate, `s=0` exact linear map. Degree-preserving for ALL degrees — correct generalization of "amount slider". Blend `y → (1−t)y + t·x` only valid when `d=1`; deviation form fixes that.
8. **Smooth / relax** — Laplacian smoothing on lifted `y` (or on `g`). Heat flow on torus, degree invariant. One-click de-kink; also helps GaHueMa clamp-kink imports (already on backlog).
9. **Blend two curves** — lift-space lerp between saved curve A and B. Valid iff degrees equal (else lift mismatch: `F_t(x+360) − F_t(x)` non-integer×360). Enforce same-`d` in UI.

### Equivariance / harmony ops (torus deck-transformation flavored)

10. **n-fold symmetrize** — project onto curves satisfying `f(x + 360/n) = f(x) + 360/n`: average `f(x + k·360/n) − k·360/n` over `k`. `n=2` preserves complement pairs; `n=3` preserves triads. Guaranteed color-harmony preservation — unique selling point, falls straight out of the geometry.

### Colorist utility ops

11. **Pin hue** — insert point at `(x, x)` on correct lift branch: fixed point, protects that hue (skin tone lock). Variant: pin to complement `(x, x+180)`. Under iteration, fixed points = attractors → doubles as dynamics tool.
12. **Bake iterations** — resample `iteratedLut` into control points, reset iteration count to 1. Makes `f∘f` editable, feeds your circle-map-dynamics angle.
13. **Quantize output** — snap `y` to `k` evenly spaced hues (staircase, slope 0 with jumps). Posterize-in-hue; degree carried by jumps.
14. **Resample / simplify** — redistribute N points evenly from current curve, or Douglas-Peucker on lift. Housekeeping after heavy op chains.

## Priority pick

Highest value/effort: **5 (twist)**, **2 (recenter)**, **7 (strength)**, **6 (inverse)**, **10 (symmetrize)**. Twist + recenter + strength are ~10 lines each in your point model. Symmetrize + inverse are paper-figure material — both impossible in bounded-offset UIs, strengthen submission claim. 

Let's allow locking of curve segments. everything else around them changes, but user can select a segment to lock it in place. Helpful for colorists etc. 