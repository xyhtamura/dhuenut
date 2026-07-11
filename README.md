# DHuenut

DHuenut is a static hue-vs-hue curve editor for image and video color
experiments. Hue transforms are edited as circle maps, so ordinary grading,
collapse, inversion, higher winding, and iterative hue effects all live in the
same curve model.

Open `index.html` directly in a browser, or serve this folder with any static
file server. No build step is required.

## Features

- Torus-native lifted hue curve editor.
- Preset dropdown for common and experimental curve shapes.
- Hue rotate and hue invert processes for transforming the current curve.
- HSL and OKLCH rendering modes.
- CPU renderer with WebGL acceleration when available.
- Image and video import by upload or drag/drop.
- PNG export for still images and WebM export for videos.
- Curve JSON import/export and `.cube` LUT export.
- GaHueMa-style formula import.

See `dhuenut.md` for design notes, validation notes, and future work.

