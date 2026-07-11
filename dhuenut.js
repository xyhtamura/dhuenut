(() => {
  "use strict";

  const LUT_SIZE = 1024;
  const CURVE_HIT_RADIUS = 13;
  const $ = (id) => document.getElementById(id);
  const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
  const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"]);

  const state = {
    originalImageData: null,
    isVideo: false,
    debounceTimer: null,
    rafId: null,
    gpuRenderer: null,
    recording: false,
    mediaRecorder: null,
    torusView: null,
    torusOpacity: 0.74,
    curveView: {
      xOffset: 0,
      yOffset: 0
    },
    axisDrag: null,
    activePoint: null,
    dragYShift: 0,
    dragBranch: 0,
    baseLut: new Float32Array(LUT_SIZE),
    iteratedLut: new Float32Array(LUT_SIZE),
    curveDirty: true,
    curve: {
      degree: 1,
      points: [
        { x: 0, y: 0 },
        { x: 90, y: 90 },
        { x: 180, y: 180 },
        { x: 270, y: 270 }
      ]
    }
  };

  const els = {
    curveCanvas: $("curveCanvas"),
    axisX: $("axisX"),
    axisY: $("axisY"),
    torusCanvas: $("torusCanvas"),
    torusOpacityInput: $("torusOpacityInput"),
    torusOpacityValue: $("torusOpacityValue"),
    curveStatus: $("curveStatus"),
    windingBadge: $("windingBadge"),
    slopeReadout: $("slopeReadout"),
    inputReadout: $("inputReadout"),
    outputReadout: $("outputReadout"),
    inSwatch: $("inSwatch"),
    outSwatch: $("outSwatch"),
    presetSelect: $("presetSelect"),
    applyPresetBtn: $("applyPresetBtn"),
    degreeInput: $("degreeInput"),
    rotateAmountInput: $("rotateAmountInput"),
    rotateCurveBtn: $("rotateCurveBtn"),
    invertCurveBtn: $("invertCurveBtn"),
    iterationInput: $("iterationInput"),
    iterationValue: $("iterationValue"),
    colorSpace: $("colorSpace"),
    processingBackend: $("processingBackend"),
    backendStatus: $("backendStatus"),
    cubeSize: $("cubeSize"),
    uploadBtn: $("uploadBtn"),
    exportCurveBtn: $("exportCurveBtn"),
    importCurveBtn: $("importCurveBtn"),
    curveFileInput: $("curveFileInput"),
    exportCubeBtn: $("exportCubeBtn"),
    imageInput: $("imageInput"),
    sourceVideo: $("sourceVideo"),
    originalCanvas: $("originalCanvas"),
    modifiedCanvas: $("modifiedCanvas"),
    originalPixelInfo: $("originalPixelInfo"),
    modifiedPixelInfo: $("modifiedPixelInfo"),
    dropPrompt: $("dropPrompt"),
    workspace: $("workspace"),
    dropZone: $("dropZone"),
    videoControls: $("videoControls"),
    playPauseBtn: $("playPauseBtn"),
    seekBar: $("seekBar"),
    timeLabel: $("timeLabel"),
    loopBtn: $("loopBtn"),
    saveBtn: $("saveBtn"),
    extLabel: $("extLabel"),
    exportStatus: $("exportStatus"),
    filenameInput: $("filenameInput"),
    gMode: $("gMode"),
    gAnchorHue: $("gAnchorHue"),
    gFactor: $("gFactor"),
    gM: $("gM"),
    gP: $("gP"),
    gA: $("gA"),
    gPreventCrossing: $("gPreventCrossing"),
    importGahuemaBtn: $("importGahuemaBtn")
  };

  const curveCtx = els.curveCanvas.getContext("2d");
  let _origCtx = null;
  let _modCtx = null;

  function origCtx() {
    return _origCtx || (_origCtx = els.originalCanvas.getContext("2d", { willReadFrequently: true }));
  }

  function modCtx() {
    return _modCtx || (_modCtx = els.modifiedCanvas.getContext("2d", { willReadFrequently: true }));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function normalizeAngle(angle) {
    angle %= 360;
    return angle < 0 ? angle + 360 : angle;
  }

  function wrap01(value) {
    value %= 1;
    return value < 0 ? value + 1 : value;
  }

  function chooseNearestLift(visibleHue, referenceLift) {
    const hue = normalizeAngle(visibleHue);
    return hue + 360 * Math.round((referenceLift - hue) / 360);
  }

  function formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) return "n/a";
    return value.toFixed(digits);
  }

  function hueCss(hue) {
    return `hsl(${normalizeAngle(hue)} 88% 54%)`;
  }

  function toHex(data) {
    return "#" + [data[0], data[1], data[2]]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  function sortPoints() {
    state.curve.points.sort((a, b) => a.x - b.x);
  }

  function getPeriodicPoint(points, index) {
    const n = points.length;
    const cycle = Math.floor(index / n);
    const mod = ((index % n) + n) % n;
    const p = points[mod];
    return {
      x: p.x + cycle * 360,
      y: p.y + cycle * 360 * state.curve.degree,
      source: p
    };
  }

  function hermite(p0, p1, p2, p3, x) {
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 0.0001) return p1.y;
    const t = clamp((x - p1.x) / dx, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const d10 = Math.abs(p2.x - p0.x) < 0.0001 ? 0 : (p2.y - p0.y) / (p2.x - p0.x);
    const d21 = Math.abs(p3.x - p1.x) < 0.0001 ? 0 : (p3.y - p1.y) / (p3.x - p1.x);
    const m1 = d10 * dx;
    const m2 = d21 * dx;
    return (2 * t3 - 3 * t2 + 1) * p1.y
      + (t3 - 2 * t2 + t) * m1
      + (-2 * t3 + 3 * t2) * p2.y
      + (t3 - t2) * m2;
  }

  function sampleLift(inputHue) {
    const points = state.curve.points;
    if (!points.length) return inputHue;
    if (points.length === 1) return points[0].y;

    sortPoints();
    const x = normalizeAngle(inputHue);
    for (let i = -1; i < points.length; i += 1) {
      const p1 = getPeriodicPoint(points, i);
      const p2 = getPeriodicPoint(points, i + 1);
      if (x >= p1.x && x <= p2.x) {
        return hermite(
          getPeriodicPoint(points, i - 1),
          p1,
          p2,
          getPeriodicPoint(points, i + 2),
          x
        );
      }
    }

    const lastIndex = points.length - 1;
    return hermite(
      getPeriodicPoint(points, lastIndex - 1),
      getPeriodicPoint(points, lastIndex),
      getPeriodicPoint(points, lastIndex + 1),
      getPeriodicPoint(points, lastIndex + 2),
      x
    );
  }

  function sampleHue(inputHue) {
    return normalizeAngle(sampleLift(inputHue));
  }

  function estimateSlope(inputHue) {
    const dx = 0.5;
    const a = sampleLift(inputHue - dx);
    const b = sampleLift(inputHue + dx);
    return (b - a) / (2 * dx);
  }

  function lookupLut(lut, hue) {
    const u = wrap01(hue / 360) * LUT_SIZE;
    const i0 = Math.floor(u) % LUT_SIZE;
    const i1 = (i0 + 1) % LUT_SIZE;
    const t = u - Math.floor(u);
    const a = lut[i0];
    let b = lut[i1];
    if (b - a > 180) b -= 360;
    if (b - a < -180) b += 360;
    return normalizeAngle(lerp(a, b, t));
  }

  function rebuildLut() {
    if (!state.curveDirty) return;

    for (let i = 0; i < LUT_SIZE; i += 1) {
      state.baseLut[i] = sampleHue((i / LUT_SIZE) * 360);
    }

    const iterations = getIterationCount();
    for (let i = 0; i < LUT_SIZE; i += 1) {
      let hue = (i / LUT_SIZE) * 360;
      if (iterations === 0) {
        state.iteratedLut[i] = normalizeAngle(hue);
        continue;
      }
      hue = state.baseLut[i];
      for (let step = 1; step < iterations; step += 1) {
        hue = lookupLut(state.baseLut, hue);
      }
      state.iteratedLut[i] = normalizeAngle(hue);
    }

    state.curveDirty = false;
  }

  function markCurveDirty(reason = "curve updated") {
    state.curveDirty = true;
    els.curveStatus.textContent = reason;
    drawCurveEditor();
    onParamsChanged();
  }

  function setPreset(name) {
    const point = (x, y) => ({ x, y });
    const wave = (count, amplitude, cycles = 1) => {
      state.curve.points = [];
      for (let i = 0; i < count; i += 1) {
        const x = (i / count) * 360;
        state.curve.points.push(point(x, x + amplitude * Math.sin((x / 360) * Math.PI * 2 * cycles)));
      }
    };
    if (name === "identity") {
      state.curve.degree = 1;
      state.curve.points = [point(0, 0), point(90, 90), point(180, 180), point(270, 270)];
    } else if (name === "invert") {
      state.curve.degree = -1;
      state.curve.points = [point(0, 0), point(90, -90), point(180, -180), point(270, -270)];
    } else if (name === "collapse") {
      state.curve.degree = 0;
      state.curve.points = [point(0, 42), point(90, 44), point(180, 48), point(270, 44)];
    } else if (name === "double") {
      state.curve.degree = 2;
      state.curve.points = [point(0, 0), point(90, 180), point(180, 360), point(270, 540)];
    } else if (name === "sine") {
      state.curve.degree = 1;
      wave(12, 42);
    } else if (name === "complement") {
      state.curve.degree = 1;
      state.curve.points = [point(0, 180), point(90, 270), point(180, 360), point(270, 450)];
    } else if (name === "triple") {
      state.curve.degree = 3;
      state.curve.points = [point(0, 0), point(60, 180), point(120, 360), point(180, 540), point(240, 720), point(300, 900)];
    } else if (name === "ripple") {
      state.curve.degree = 1;
      wave(16, 68, 2);
    } else if (name === "foldback") {
      state.curve.degree = 1;
      state.curve.points = [point(0, 0), point(45, 80), point(90, 132), point(135, 88), point(180, 180), point(225, 272), point(270, 228), point(315, 280)];
    }
    syncCurveInputs();
    markCurveDirty(name);
  }

  function formatSignedDegrees(value) {
    const digits = Number.isInteger(value) ? 0 : 1;
    return `${value >= 0 ? "+" : ""}${formatNumber(value, digits)} deg`;
  }

  function rotateCurveHue() {
    const amount = Number(els.rotateAmountInput.value);
    if (!Number.isFinite(amount)) {
      els.curveStatus.textContent = "bad rotate amount";
      return;
    }
    state.curve.points = state.curve.points.map((curvePoint) => ({
      x: curvePoint.x,
      y: curvePoint.y + amount
    }));
    markCurveDirty(`rotate ${formatSignedDegrees(amount)}`);
  }

  function invertCurveHue() {
    state.curve.degree = -state.curve.degree;
    state.curve.points = state.curve.points.map((curvePoint) => ({
      x: curvePoint.x,
      y: -curvePoint.y
    }));
    syncCurveInputs();
    markCurveDirty("hue inverted");
  }

  function syncCurveInputs() {
    els.degreeInput.value = String(state.curve.degree);
    els.windingBadge.textContent = `d = ${state.curve.degree}`;
  }

  function getIterationCount() {
    return Math.max(0, Math.round(Number(els.iterationValue.value) || 0));
  }

  function setIteration(value) {
    const count = Math.max(0, Math.round(Number(value) || 0));
    els.iterationValue.value = String(count);
    els.iterationInput.value = String(clamp(count, Number(els.iterationInput.min), Number(els.iterationInput.max)));
    markCurveDirty(`iterate ${count}`);
  }

  function setTorusOpacity(value) {
    state.torusOpacity = clamp((Number(value) || 0) / 100, 0, 1);
    if (els.torusOpacityInput) els.torusOpacityInput.value = String(Math.round(state.torusOpacity * 100));
    if (els.torusOpacityValue) els.torusOpacityValue.textContent = `${Math.round(state.torusOpacity * 100)}%`;
    if (state.torusView) state.torusView.draw();
  }

  function sampleLiftUnwrapped(inputLift) {
    const cycle = Math.floor(inputLift / 360);
    return sampleLift(inputLift) + cycle * 360 * state.curve.degree;
  }

  function screenXToInput(px, w) {
    return state.curveView.xOffset + (px / w) * 360;
  }

  function inputToScreenX(inputLift, w) {
    return ((inputLift - state.curveView.xOffset) / 360) * w;
  }

  function screenYToOutput(py, h) {
    return state.curveView.yOffset + (1 - py / h) * 360;
  }

  function outputToScreenY(outputLift, h) {
    return h - ((outputLift - state.curveView.yOffset) / 360) * h;
  }

  function axisGradient(direction, start, step) {
    const stops = [];
    for (let i = 0; i <= 6; i += 1) {
      stops.push(`hsl(${normalizeAngle(start + step * i)} 92% 56%) ${(i / 6) * 100}%`);
    }
    return `linear-gradient(${direction}, ${stops.join(", ")})`;
  }

  function syncAxisGradients() {
    if (els.axisX) {
      els.axisX.style.background = axisGradient("to right", state.curveView.xOffset, 60);
    }
    if (els.axisY) {
      els.axisY.style.background = axisGradient("to bottom", state.curveView.yOffset + 360, -60);
    }
  }

  function drawEditorGrid(ctx, w, h) {
    const xStart = state.curveView.xOffset;
    const yStart = state.curveView.yOffset;
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let x = Math.ceil(xStart / 30) * 30; x <= xStart + 360; x += 30) {
      const px = inputToScreenX(x, w);
      ctx.strokeStyle = "#fff3bf";
      ctx.lineWidth = Math.abs(Math.round(x / 90) * 90 - x) < 0.001 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let y = Math.ceil(yStart / 30) * 30; y <= yStart + 360; y += 30) {
      const py = outputToScreenY(y, h);
      ctx.strokeStyle = "#fff3bf";
      ctx.lineWidth = Math.abs(Math.round(y / 90) * 90 - y) < 0.001 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCurveEditor(cursorHue = null) {
    rebuildLut();
    syncAxisGradients();
    const canvas = els.curveCanvas;
    const ctx = curveCtx;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#13091e";
    ctx.fillRect(0, 0, w, h);

    drawEditorGrid(ctx, w, h);
    drawIdentity(ctx, w, h);
    drawCurvePaths(ctx, w, h);
    drawControlPoints(ctx, w, h);
    if (state.torusView) state.torusView.draw();

    const hue = cursorHue == null ? 0 : normalizeAngle(cursorHue);
    const out = sampleHue(hue);
    const slope = estimateSlope(hue);
    els.slopeReadout.textContent = formatNumber(slope, 2);
    els.inputReadout.textContent = `${formatNumber(hue, 1)} deg`;
    els.outputReadout.textContent = `${formatNumber(out, 1)} deg`;
    els.inSwatch.style.background = hueCss(hue);
    els.outSwatch.style.background = hueCss(out);
    els.windingBadge.textContent = `d = ${state.curve.degree}`;
  }

  function drawIdentity(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = "#fff3bf";
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    for (let shift = -2; shift <= 2; shift += 1) {
      ctx.beginPath();
      for (let i = 0; i <= 360; i += 2) {
        const x = state.curveView.xOffset + i;
        const y = x + shift * 360;
        const px = inputToScreenX(x, w);
        const py = outputToScreenY(y, h);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCurvePaths(ctx, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    for (let yShift = -3; yShift <= 3; yShift += 1) {
      ctx.beginPath();
      let began = false;
      for (let i = 0; i <= 360; i += 1) {
        const input = state.curveView.xOffset + i;
        const lift = sampleLiftUnwrapped(input) + yShift * 360;
        const px = inputToScreenX(input, w);
        const py = outputToScreenY(lift, h);
        if (!began) {
          ctx.moveTo(px, py);
          began = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.strokeStyle = yShift === 0 ? "#44e4d2" : "#44e4d2";
      ctx.globalAlpha = yShift === 0 ? 0.95 : 0.23;
      ctx.lineWidth = yShift === 0 ? 3.2 : 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawControlPoints(ctx, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const baseCycle = Math.floor((state.curveView.xOffset - 360) / 360);
    state.curve.points.forEach((point) => {
      for (let xCycle = baseCycle; xCycle <= baseCycle + 3; xCycle += 1) {
        const input = point.x + xCycle * 360;
        const px = inputToScreenX(input, w);
        if (px < -18 || px > w + 18) continue;
        const periodLift = point.y + xCycle * 360 * state.curve.degree;
        for (let yShift = -3; yShift <= 3; yShift += 1) {
          const py = outputToScreenY(periodLift + yShift * 360, h);
          if (py < -18 || py > h + 18) continue;
          ctx.beginPath();
          ctx.arc(px, py, point === state.activePoint ? 9 : 7, 0, Math.PI * 2);
          ctx.fillStyle = point === state.activePoint ? "#ffc85f" : "#ff65b8";
          ctx.strokeStyle = "#150a21";
          ctx.lineWidth = 3;
          ctx.fill();
          ctx.stroke();
        }
      }
    });
    ctx.restore();
  }

  function canvasPoint(event) {
    const rect = els.curveCanvas.getBoundingClientRect();
    const scaleX = els.curveCanvas.width / rect.width;
    const scaleY = els.curveCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function pointToHueOutput(pos) {
    const w = els.curveCanvas.width;
    const h = els.curveCanvas.height;
    const input = screenXToInput(clamp(pos.x, 0, w), w);
    return {
      input,
      hue: normalizeAngle(input),
      output: screenYToOutput(clamp(pos.y, 0, h), h)
    };
  }

  function hitTestPoint(pos) {
    const w = els.curveCanvas.width;
    const h = els.curveCanvas.height;
    let best = null;
    let bestDist = Infinity;
    const baseCycle = Math.floor((state.curveView.xOffset - 360) / 360);
    state.curve.points.forEach((point) => {
      for (let xCycle = baseCycle; xCycle <= baseCycle + 3; xCycle += 1) {
        const input = point.x + xCycle * 360;
        const px = inputToScreenX(input, w);
        if (px < -CURVE_HIT_RADIUS || px > w + CURVE_HIT_RADIUS) continue;
        const periodLift = point.y + xCycle * 360 * state.curve.degree;
        for (let yShift = -3; yShift <= 3; yShift += 1) {
          const py = outputToScreenY(periodLift + yShift * 360, h);
          const dist = Math.hypot(pos.x - px, pos.y - py);
          if (dist < bestDist) {
            bestDist = dist;
            best = { point, xCycle, yShift };
          }
        }
      }
    });
    return bestDist <= CURVE_HIT_RADIUS ? best : null;
  }

  function addPointAt(pos) {
    const coords = pointToHueOutput(pos);
    const xCycle = Math.floor(coords.input / 360);
    const existingLift = sampleLiftUnwrapped(coords.input);
    const displayLift = chooseNearestLift(coords.output, existingLift);
    const point = { x: coords.hue, y: displayLift - xCycle * 360 * state.curve.degree };
    state.curve.points.push(point);
    sortPoints();
    state.activePoint = point;
    markCurveDirty("point added");
    return { point, xCycle, yShift: 0 };
  }

  function handleCurvePointerDown(event) {
    const pos = canvasPoint(event);
    let hit = hitTestPoint(pos);
    if (!hit) hit = addPointAt(pos);
    state.activePoint = hit.point;
    state.dragYShift = hit.yShift;
    els.curveCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleCurvePointerMove(event) {
    const pos = canvasPoint(event);
    const coords = pointToHueOutput(pos);
    if (state.activePoint) {
      const xCycle = Math.floor(coords.input / 360);
      state.activePoint.x = coords.hue;
      state.activePoint.y = coords.output
        - xCycle * 360 * state.curve.degree
        - state.dragYShift * 360;
      sortPoints();
      markCurveDirty("dragging");
    } else {
      drawCurveEditor(coords.hue);
    }
    event.preventDefault();
  }

  function handleCurvePointerUp(event) {
    if (state.activePoint) {
      state.activePoint = null;
      markCurveDirty("curve updated");
    }
    try {
      els.curveCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* pointer may have left before release */
    }
  }

  function handleCurveDoubleClick(event) {
    const hit = hitTestPoint(canvasPoint(event));
    if (hit && state.curve.points.length > 2) {
      state.curve.points = state.curve.points.filter((candidate) => candidate !== hit.point);
      state.activePoint = null;
      markCurveDirty("point deleted");
    }
  }

  function startAxisDrag(axis, event) {
    const target = axis === "x" ? els.axisX : els.axisY;
    const rect = target.getBoundingClientRect();
    state.axisDrag = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      xOffset: state.curveView.xOffset,
      yOffset: state.curveView.yOffset
    };
    target.classList.add("dragging");
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleAxisDragMove(event) {
    if (!state.axisDrag || event.pointerId !== state.axisDrag.pointerId) return;
    if (state.axisDrag.axis === "x") {
      const delta = ((event.clientX - state.axisDrag.startX) / state.axisDrag.width) * 360;
      state.curveView.xOffset = normalizeAngle(state.axisDrag.xOffset - delta);
    } else {
      const delta = ((event.clientY - state.axisDrag.startY) / state.axisDrag.height) * 360;
      state.curveView.yOffset = normalizeAngle(state.axisDrag.yOffset + delta);
    }
    els.curveStatus.textContent = "view panned";
    drawCurveEditor();
    event.preventDefault();
  }

  function endAxisDrag(event) {
    if (!state.axisDrag || event.pointerId !== state.axisDrag.pointerId) return;
    const target = state.axisDrag.axis === "x" ? els.axisX : els.axisY;
    target.classList.remove("dragging");
    try {
      target.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* pointer may already be released */
    }
    state.axisDrag = null;
    els.curveStatus.textContent = "view panned";
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToRgb(h, s, l) {
    h = normalizeAngle(h) / 360;
    s /= 100;
    l /= 100;
    let r;
    let g;
    let b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [
      clamp(Math.round(r * 255), 0, 255),
      clamp(Math.round(g * 255), 0, 255),
      clamp(Math.round(b * 255), 0, 255)
    ];
  }

  function rgbToOklch(r, g, b) {
    const toLinear = (c) => {
      c /= 255;
      return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
    };
    const lr = toLinear(r);
    const lg = toLinear(g);
    const lb = toLinear(b);
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188582 * lg + 0.6299787009 * lb;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
    const C = Math.sqrt(a * a + b_ * b_);
    const H = normalizeAngle(Math.atan2(b_, a) * 180 / Math.PI);
    return [L, C, H];
  }

  function oklchToRgb(L, C, H) {
    const hRad = normalizeAngle(H) * Math.PI / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const fromLinear = (c) => c > 0.0031308 ? 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055 : 12.92 * c;
    return [
      clamp(Math.round(fromLinear(lr) * 255), 0, 255),
      clamp(Math.round(fromLinear(lg) * 255), 0, 255),
      clamp(Math.round(fromLinear(lb) * 255), 0, 255)
    ];
  }

  function applyHueMapToRgb(r, g, b, colorSpace = els.colorSpace.value) {
    rebuildLut();
    if (colorSpace === "oklch") {
      const [L, C, H] = rgbToOklch(r, g, b);
      return oklchToRgb(L, C, lookupLut(state.iteratedLut, H));
    }
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(lookupLut(state.iteratedLut, h), s, l);
  }

  function transformImageDataCPU(src) {
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const data = out.data;
    const colorSpace = els.colorSpace.value;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = applyHueMapToRgb(data[i], data[i + 1], data[i + 2], colorSpace);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    return out;
  }

  function sizeCanvas(canvas, width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function processImageCPU() {
    if (!state.originalImageData) return;
    sizeCanvas(els.modifiedCanvas, state.originalImageData.width, state.originalImageData.height);
    modCtx().putImageData(transformImageDataCPU(state.originalImageData), 0, 0);
  }

  function shouldUseGpu() {
    return (els.processingBackend.value || "auto") !== "cpu";
  }

  function setBackendStatus(message, fallback = false) {
    els.backendStatus.textContent = message;
    els.backendStatus.style.color = fallback ? "var(--danger)" : "var(--lime)";
  }

  function createGpuRenderer(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false })
      || canvas.getContext("webgl", { premultipliedAlpha: false });
    if (!gl) return null;

    const vertexSrc = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_pos + 1.0) * 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fragmentSrc = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_image;
      uniform sampler2D u_hueLut;
      uniform int u_colorSpace;

      float lookupHue(float hue) {
        float u = mod(mod(hue, 360.0) + 360.0, 360.0) / 360.0;
        vec2 enc = texture2D(u_hueLut, vec2(u, 0.5)).rg;
        float packed = enc.r * 65280.0 + enc.g * 255.0;
        return packed / 65535.0 * 360.0;
      }

      vec3 rgb2oklch(vec3 c) {
        vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
        vec3 lo = c / 12.92;
        c = vec3(c.r > 0.04045 ? hi.r : lo.r, c.g > 0.04045 ? hi.g : lo.g, c.b > 0.04045 ? hi.b : lo.b);
        float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
        float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
        float s = 0.0883024619 * c.r + 0.2817188582 * c.g + 0.6299787009 * c.b;
        float l_ = pow(l, 1.0 / 3.0);
        float m_ = pow(m, 1.0 / 3.0);
        float s_ = pow(s, 1.0 / 3.0);
        float L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
        float a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
        float b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
        return vec3(L, sqrt(a * a + b * b), mod(degrees(atan(b, a)) + 360.0, 360.0));
      }

      vec3 oklch2rgb(vec3 lch) {
        float H = radians(lch.z);
        float a = lch.y * cos(H);
        float b = lch.y * sin(H);
        float l_ = lch.x + 0.3963377774 * a + 0.2158037573 * b;
        float m_ = lch.x - 0.1055613458 * a - 0.0638541728 * b;
        float s_ = lch.x - 0.0894841775 * a - 1.2914855480 * b;
        float l = l_ * l_ * l_;
        float m = m_ * m_ * m_;
        float s = s_ * s_ * s_;
        vec3 rgb = vec3(
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        );
        vec3 hi = 1.055 * pow(max(rgb, 0.0), vec3(1.0 / 2.4)) - 0.055;
        vec3 lo = 12.92 * rgb;
        return vec3(rgb.r > 0.0031308 ? hi.r : lo.r, rgb.g > 0.0031308 ? hi.g : lo.g, rgb.b > 0.0031308 ? hi.b : lo.b);
      }

      vec3 rgb2hsl(vec3 c) {
        float maxc = max(c.r, max(c.g, c.b));
        float minc = min(c.r, min(c.g, c.b));
        float h = 0.0;
        float s = 0.0;
        float l = (maxc + minc) * 0.5;
        if (maxc != minc) {
          float d = maxc - minc;
          s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
          if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
          else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
          else h = (c.r - c.g) / d + 4.0;
          h /= 6.0;
        }
        return vec3(h * 360.0, s * 100.0, l * 100.0);
      }

      float hue2rgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
        if (t < 1.0 / 2.0) return q;
        if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        return p;
      }

      vec3 hsl2rgb(vec3 hsl) {
        float h = hsl.x / 360.0;
        float s = hsl.y / 100.0;
        float l = hsl.z / 100.0;
        if (s == 0.0) return vec3(l);
        float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
        float p = 2.0 * l - q;
        return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
      }

      void main() {
        vec4 src = texture2D(u_image, v_uv);
        vec3 res;
        if (u_colorSpace == 1) {
          vec3 lch = rgb2oklch(src.rgb);
          res = oklch2rgb(vec3(lch.xy, lookupHue(lch.z)));
        } else {
          vec3 hsl = rgb2hsl(src.rgb);
          res = hsl2rgb(vec3(lookupHue(hsl.x), hsl.yz));
        }
        gl_FragColor = vec4(clamp(res, 0.0, 1.0), src.a);
      }
    `;

    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
      console.error(gl.getShaderInfoLog(shader));
      return null;
    };

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return null;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    setTextureParams(gl);

    const lutTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    setTextureParams(gl);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);

    return {
      canvas,
      gl,
      program,
      imageTexture,
      lutTexture,
      positionBuffer,
      positionLocation: gl.getAttribLocation(program, "a_pos"),
      uniforms: {
        image: gl.getUniformLocation(program, "u_image"),
        hueLut: gl.getUniformLocation(program, "u_hueLut"),
        colorSpace: gl.getUniformLocation(program, "u_colorSpace")
      }
    };
  }

  function setTextureParams(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  function ensureRenderer(width, height) {
    if (!state.gpuRenderer || state.gpuRenderer.canvas.width !== width || state.gpuRenderer.canvas.height !== height) {
      state.gpuRenderer = createGpuRenderer(width, height);
    }
    return !!state.gpuRenderer;
  }

  function uploadLutTexture(gl, texture) {
    rebuildLut();
    const bytes = new Uint8Array(LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i += 1) {
      const packed = Math.round(normalizeAngle(state.iteratedLut[i]) / 360 * 65535);
      const o = i * 4;
      bytes[o] = (packed >> 8) & 255;
      bytes[o + 1] = packed & 255;
      bytes[o + 2] = 0;
      bytes[o + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  function drawWithRenderer(source, width, height) {
    const renderer = state.gpuRenderer;
    const { gl, program, imageTexture, lutTexture, positionBuffer, positionLocation, uniforms } = renderer;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    uploadLutTexture(gl, lutTexture);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (source instanceof ImageData) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    gl.uniform1i(uniforms.image, 0);
    gl.uniform1i(uniforms.hueLut, 1);
    gl.uniform1i(uniforms.colorSpace, els.colorSpace.value === "oklch" ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function processImage() {
    if (!state.originalImageData) return;
    const width = state.originalImageData.width;
    const height = state.originalImageData.height;
    if (shouldUseGpu() && ensureRenderer(width, height)) {
      drawWithRenderer(state.originalImageData, width, height);
      sizeCanvas(els.modifiedCanvas, width, height);
      modCtx().drawImage(state.gpuRenderer.canvas, 0, 0, width, height);
      setBackendStatus("Backend: GPU");
      return;
    }
    setBackendStatus(shouldUseGpu() ? "Backend: CPU fallback" : "Backend: CPU", shouldUseGpu());
    processImageCPU();
  }

  function drawVideoFrame() {
    const video = els.sourceVideo;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    sizeCanvas(els.originalCanvas, width, height);
    sizeCanvas(els.modifiedCanvas, width, height);
    origCtx().drawImage(video, 0, 0, width, height);

    if (shouldUseGpu() && ensureRenderer(width, height)) {
      drawWithRenderer(video, width, height);
      modCtx().drawImage(state.gpuRenderer.canvas, 0, 0, width, height);
      setBackendStatus("Backend: GPU");
      return;
    }

    const frame = origCtx().getImageData(0, 0, width, height);
    modCtx().putImageData(transformImageDataCPU(frame), 0, 0);
    setBackendStatus(shouldUseGpu() ? "Backend: CPU fallback" : "Backend: CPU", shouldUseGpu());
  }

  const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

  function videoLoop() {
    drawVideoFrame();
    if (!els.sourceVideo.paused && !els.sourceVideo.ended) {
      state.rafId = hasRVFC
        ? els.sourceVideo.requestVideoFrameCallback(videoLoop)
        : requestAnimationFrame(videoLoop);
    }
  }

  function startVideoLoop() {
    cancelVideoLoop();
    state.rafId = hasRVFC
      ? els.sourceVideo.requestVideoFrameCallback(videoLoop)
      : requestAnimationFrame(videoLoop);
  }

  function cancelVideoLoop() {
    if (state.rafId == null) return;
    if (hasRVFC && els.sourceVideo.cancelVideoFrameCallback) {
      els.sourceVideo.cancelVideoFrameCallback(state.rafId);
    } else {
      cancelAnimationFrame(state.rafId);
    }
    state.rafId = null;
  }

  function fmtTime(time) {
    if (!Number.isFinite(time)) time = 0;
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function scheduleProcess() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(processImage, 60);
  }

  function onParamsChanged() {
    if (state.isVideo) {
      if (els.sourceVideo.paused) drawVideoFrame();
    } else if (state.originalImageData) {
      scheduleProcess();
    }
  }

  function revealWorkspace() {
    els.dropPrompt.style.display = "none";
    els.workspace.style.display = "block";
    els.dropZone.classList.add("loaded");
  }

  function handleImageFile(file) {
    state.isVideo = false;
    cancelVideoLoop();
    els.sourceVideo.pause();
    els.videoControls.style.display = "none";
    els.saveBtn.textContent = "Save PNG";
    els.extLabel.textContent = ".png";
    els.exportStatus.textContent = "";

    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => {
        sizeCanvas(els.originalCanvas, image.width, image.height);
        sizeCanvas(els.modifiedCanvas, image.width, image.height);
        origCtx().drawImage(image, 0, 0);
        state.originalImageData = origCtx().getImageData(0, 0, image.width, image.height);
        revealWorkspace();
        processImage();
      };
      image.onerror = () => {
        els.exportStatus.textContent = "image failed to load";
      };
      image.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleVideoFile(file) {
    state.isVideo = true;
    state.originalImageData = null;
    els.saveBtn.textContent = "Save WebM";
    els.extLabel.textContent = ".webm";
    els.exportStatus.textContent = "";
    els.videoControls.style.display = "flex";

    if (els.sourceVideo.src) URL.revokeObjectURL(els.sourceVideo.src);
    els.sourceVideo.src = URL.createObjectURL(file);
    els.sourceVideo.loop = true;
    els.loopBtn.classList.add("active");
    els.sourceVideo.load();
    revealWorkspace();
    els.playPauseBtn.textContent = "Play";
  }

  function fileExtension(file) {
    const name = (file && file.name ? file.name : "").toLowerCase();
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1) : "";
  }

  function isImageFile(file) {
    const type = (file.type || "").toLowerCase();
    return type.startsWith("image/") || IMAGE_EXTENSIONS.has(fileExtension(file));
  }

  function isVideoFile(file) {
    const type = (file.type || "").toLowerCase();
    return type.startsWith("video/") || VIDEO_EXTENSIONS.has(fileExtension(file));
  }

  function handleFile(file) {
    if (!file) return;
    if (isVideoFile(file)) handleVideoFile(file);
    else if (isImageFile(file)) handleImageFile(file);
    else els.exportStatus.textContent = "unsupported media file";
  }

  function savePng() {
    if (!els.modifiedCanvas.width) {
      els.exportStatus.textContent = "no media loaded";
      return;
    }
    const link = document.createElement("a");
    link.download = `${els.filenameInput.value || "dhuenut-output"}.png`;
    link.href = els.modifiedCanvas.toDataURL("image/png");
    link.click();
  }

  function pickVideoMime() {
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9", "video/webm"];
    for (const type of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
    }
    return "video/webm";
  }

  async function exportVideo() {
    if (!state.isVideo) return;
    if (!window.MediaRecorder) {
      els.exportStatus.textContent = "MediaRecorder unavailable";
      return;
    }
    if (state.recording) return;

    drawVideoFrame();
    const fps = 30;
    const stream = els.modifiedCanvas.captureStream(fps);
    try {
      const videoStream = els.sourceVideo.captureStream
        ? els.sourceVideo.captureStream()
        : els.sourceVideo.mozCaptureStream
          ? els.sourceVideo.mozCaptureStream()
          : null;
      if (videoStream) videoStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch (error) {
      /* audio is optional */
    }

    const chunks = [];
    const mimeType = pickVideoMime();
    try {
      state.mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12000000 });
    } catch (error) {
      els.exportStatus.textContent = "recorder failed";
      return;
    }

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const link = document.createElement("a");
      link.download = `${els.filenameInput.value || "dhuenut-output"}.webm`;
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      els.exportStatus.textContent = "done";
      setExportUi(false);
    };

    const previousLoop = els.sourceVideo.loop;
    state.recording = true;
    setExportUi(true);
    els.sourceVideo.loop = false;
    els.sourceVideo.pause();
    els.sourceVideo.currentTime = 0;

    const begin = () => {
      els.sourceVideo.removeEventListener("seeked", begin);
      startVideoLoop();
      state.mediaRecorder.start();
      els.sourceVideo.play();
      const onEnd = () => {
        els.sourceVideo.removeEventListener("ended", onEnd);
        if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
        state.recording = false;
        els.sourceVideo.loop = previousLoop;
      };
      els.sourceVideo.addEventListener("ended", onEnd);
    };
    els.sourceVideo.addEventListener("seeked", begin);
  }

  function setExportUi(on) {
    els.saveBtn.disabled = on;
    els.playPauseBtn.disabled = on;
    els.seekBar.disabled = on;
    els.exportStatus.textContent = on ? "recording 0%" : "";
  }

  function readPixelInfo(canvas, ctx, event, infoEl) {
    if (!canvas.width) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((event.clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    let data;
    try {
      data = ctx.getImageData(x, y, 1, 1).data;
    } catch (error) {
      return;
    }
    const [h, s, l] = rgbToHsl(data[0], data[1], data[2]);
    const hex = toHex(data);
    infoEl.innerHTML = `<span class="chip" style="background:${hex}"></span>${x},${y} ${hex} H ${Math.round(h)} S ${Math.round(s)} L ${Math.round(l)}`;
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const link = document.createElement("a");
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  }

  function exportCurveJson() {
    const data = {
      app: "DHuenut",
      version: 1,
      degree: state.curve.degree,
      iteration: getIterationCount(),
      colorSpace: els.colorSpace.value,
      points: state.curve.points.map((point) => ({ x: point.x, y: point.y }))
    };
    downloadText(`${els.filenameInput.value || "dhuenut-curve"}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  function importCurveJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!Array.isArray(data.points) || data.points.length < 2) throw new Error("missing points");
        state.curve.degree = Math.round(Number(data.degree) || 0);
        state.curve.points = data.points.map((point) => ({
          x: clamp(Number(point.x), 0, 359.999),
          y: Number(point.y)
        })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (state.curve.points.length < 2) throw new Error("bad points");
        if (Number.isFinite(Number(data.iteration))) setIteration(Number(data.iteration));
        if (data.colorSpace === "hsl" || data.colorSpace === "oklch") els.colorSpace.value = data.colorSpace;
        sortPoints();
        syncCurveInputs();
        markCurveDirty("json loaded");
      } catch (error) {
        els.curveStatus.textContent = "json failed";
      }
    };
    reader.readAsText(file);
  }

  function exportCubeLut() {
    const size = Number(els.cubeSize.value) || 17;
    const colorSpace = els.colorSpace.value;
    const lines = [
      "# Created by DHuenut",
      `TITLE "DHuenut ${colorSpace} hue map"`,
      `LUT_3D_SIZE ${size}`,
      "DOMAIN_MIN 0.0 0.0 0.0",
      "DOMAIN_MAX 1.0 1.0 1.0"
    ];

    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) {
          const rf = r / (size - 1);
          const gf = g / (size - 1);
          const bf = b / (size - 1);
          const [outR, outG, outB] = applyHueMapToRgb(rf * 255, gf * 255, bf * 255, colorSpace);
          lines.push(`${(outR / 255).toFixed(6)} ${(outG / 255).toFixed(6)} ${(outB / 255).toFixed(6)}`);
        }
      }
    }

    downloadText(`${els.filenameInput.value || "dhuenut"}.cube`, `${lines.join("\n")}\n`, "text/plain");
    els.exportStatus.textContent = `.cube ${size} saved`;
  }

  function gahuemaTransform(pixelHue, params) {
    const { mode, factor, m, p, a, preventCrossing, anchorHue } = params;
    let hueDiff = pixelHue - anchorHue;
    if (hueDiff > 180) hueDiff -= 360;
    if (hueDiff < -180) hueDiff += 360;
    if (hueDiff === 0) return anchorHue;
    const sign = Math.sign(hueDiff);
    let transformedHueDiff;
    if (mode === "add") transformedHueDiff = hueDiff + sign * factor;
    else if (mode === "multiply") transformedHueDiff = hueDiff * factor;
    else {
      const powered = sign * Math.abs(hueDiff) ** p;
      transformedHueDiff = m * powered + sign * a;
    }
    if (preventCrossing) {
      if (Math.sign(transformedHueDiff) !== sign) transformedHueDiff = 0;
      else if (Math.abs(transformedHueDiff) > 180) transformedHueDiff = 180 * sign;
    }
    return normalizeAngle(anchorHue + transformedHueDiff);
  }

  function importGahuemaCurve() {
    const params = {
      mode: els.gMode.value,
      anchorHue: normalizeAngle(Number(els.gAnchorHue.value) || 0),
      factor: Number(els.gFactor.value) || 0,
      m: Number(els.gM.value) || 0,
      p: Number(els.gP.value) || 1,
      a: Number(els.gA.value) || 0,
      preventCrossing: els.gPreventCrossing.checked
    };

    const xs = new Set([0, 360, params.anchorHue, normalizeAngle(params.anchorHue + 180)]);
    for (let x = 0; x <= 360; x += 15) xs.add(x);
    const sortedXs = Array.from(xs)
      .map((x) => x === 360 ? 360 : normalizeAngle(x))
      .sort((a, b) => a - b);

    const lifted = [];
    let previous = gahuemaTransform(sortedXs[0], params);
    lifted.push({ x: sortedXs[0], y: previous });
    for (let i = 1; i < sortedXs.length; i += 1) {
      const x = sortedXs[i];
      const visible = gahuemaTransform(x === 360 ? 0 : x, params);
      const y = chooseNearestLift(visible, previous);
      lifted.push({ x, y });
      previous = y;
    }

    const first = lifted[0];
    const end = lifted.find((point) => point.x === 360) || lifted[lifted.length - 1];
    state.curve.degree = Math.round((end.y - first.y) / 360);
    state.curve.points = lifted
      .filter((point) => point.x < 360)
      .map((point) => ({ x: point.x, y: point.y }));
    sortPoints();
    syncCurveInputs();
    markCurveDirty("gahuema imported");
  }

  function bindEvents() {
    els.curveCanvas.addEventListener("pointerdown", handleCurvePointerDown);
    els.curveCanvas.addEventListener("pointermove", handleCurvePointerMove);
    els.curveCanvas.addEventListener("pointerup", handleCurvePointerUp);
    els.curveCanvas.addEventListener("pointercancel", handleCurvePointerUp);
    els.curveCanvas.addEventListener("dblclick", handleCurveDoubleClick);
    els.curveCanvas.addEventListener("pointerleave", () => {
      if (!state.activePoint) drawCurveEditor();
    });
    if (els.axisX) {
      els.axisX.addEventListener("pointerdown", (event) => startAxisDrag("x", event));
      els.axisX.addEventListener("pointermove", handleAxisDragMove);
      els.axisX.addEventListener("pointerup", endAxisDrag);
      els.axisX.addEventListener("pointercancel", endAxisDrag);
    }
    if (els.axisY) {
      els.axisY.addEventListener("pointerdown", (event) => startAxisDrag("y", event));
      els.axisY.addEventListener("pointermove", handleAxisDragMove);
      els.axisY.addEventListener("pointerup", endAxisDrag);
      els.axisY.addEventListener("pointercancel", endAxisDrag);
    }

    els.applyPresetBtn.addEventListener("click", () => setPreset(els.presetSelect.value));

    els.rotateCurveBtn.addEventListener("click", rotateCurveHue);
    els.invertCurveBtn.addEventListener("click", invertCurveHue);

    els.degreeInput.addEventListener("input", () => {
      state.curve.degree = Math.round(Number(els.degreeInput.value) || 0);
      syncCurveInputs();
      markCurveDirty("degree changed");
    });
    els.iterationInput.addEventListener("input", () => setIteration(els.iterationInput.value));
    els.iterationValue.addEventListener("input", () => setIteration(els.iterationValue.value));
    if (els.torusOpacityInput) {
      els.torusOpacityInput.addEventListener("input", () => setTorusOpacity(els.torusOpacityInput.value));
    }
    els.colorSpace.addEventListener("change", onParamsChanged);
    els.processingBackend.addEventListener("change", onParamsChanged);

    els.uploadBtn.addEventListener("click", () => els.imageInput.click());
    els.imageInput.addEventListener("change", (event) => {
      handleFile(event.target.files[0]);
      event.target.value = "";
    });
    els.dropPrompt.addEventListener("click", () => els.imageInput.click());
    els.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.dropZone.classList.add("drag-over");
    });
    els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("drag-over"));
    els.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("drag-over");
      handleFile(event.dataTransfer.files[0]);
    });

    els.saveBtn.addEventListener("click", () => {
      if (state.isVideo) exportVideo();
      else savePng();
    });
    els.exportCurveBtn.addEventListener("click", exportCurveJson);
    els.importCurveBtn.addEventListener("click", () => els.curveFileInput.click());
    els.curveFileInput.addEventListener("change", (event) => importCurveJson(event.target.files[0]));
    els.exportCubeBtn.addEventListener("click", exportCubeLut);
    els.importGahuemaBtn.addEventListener("click", importGahuemaCurve);

    els.sourceVideo.addEventListener("loadedmetadata", () => {
      sizeCanvas(els.originalCanvas, els.sourceVideo.videoWidth, els.sourceVideo.videoHeight);
      sizeCanvas(els.modifiedCanvas, els.sourceVideo.videoWidth, els.sourceVideo.videoHeight);
      els.timeLabel.textContent = `0:00 / ${fmtTime(els.sourceVideo.duration)}`;
      drawVideoFrame();
    });
    els.sourceVideo.addEventListener("error", () => {
      if (state.isVideo) els.exportStatus.textContent = "video failed to load";
    });
    els.sourceVideo.addEventListener("play", () => {
      els.playPauseBtn.textContent = "Pause";
      startVideoLoop();
    });
    els.sourceVideo.addEventListener("pause", () => {
      els.playPauseBtn.textContent = "Play";
      cancelVideoLoop();
      drawVideoFrame();
    });
    els.sourceVideo.addEventListener("seeked", () => {
      if (els.sourceVideo.paused) drawVideoFrame();
    });
    els.sourceVideo.addEventListener("timeupdate", () => {
      if (!state.recording && Number.isFinite(els.sourceVideo.duration)) {
        els.seekBar.value = (els.sourceVideo.currentTime / els.sourceVideo.duration) * 1000;
      }
      els.timeLabel.textContent = `${fmtTime(els.sourceVideo.currentTime)} / ${fmtTime(els.sourceVideo.duration)}`;
      if (state.recording && Number.isFinite(els.sourceVideo.duration)) {
        els.exportStatus.textContent = `recording ${Math.round((els.sourceVideo.currentTime / els.sourceVideo.duration) * 100)}%`;
      }
    });

    els.playPauseBtn.addEventListener("click", () => {
      if (els.sourceVideo.paused) els.sourceVideo.play();
      else els.sourceVideo.pause();
    });
    els.loopBtn.addEventListener("click", () => {
      els.sourceVideo.loop = !els.sourceVideo.loop;
      els.loopBtn.classList.toggle("active", els.sourceVideo.loop);
    });
    els.seekBar.addEventListener("input", () => {
      if (!Number.isFinite(els.sourceVideo.duration)) return;
      els.sourceVideo.currentTime = (els.seekBar.value / 1000) * els.sourceVideo.duration;
    });

    els.originalCanvas.addEventListener("pointermove", (event) => readPixelInfo(els.originalCanvas, origCtx(), event, els.originalPixelInfo));
    els.modifiedCanvas.addEventListener("pointermove", (event) => readPixelInfo(els.modifiedCanvas, modCtx(), event, els.modifiedPixelInfo));
    els.originalCanvas.addEventListener("pointerleave", () => { els.originalPixelInfo.textContent = "hover pixel"; });
    els.modifiedCanvas.addEventListener("pointerleave", () => { els.modifiedPixelInfo.textContent = "hover pixel"; });
  }

  function init() {
    bindEvents();
    syncCurveInputs();
    if (els.torusCanvas && window.createDhuenutTorusView) {
      state.torusView = window.createDhuenutTorusView(els.torusCanvas, {
        sampleLift,
        getPoints: () => state.curve.points,
        getDegree: () => state.curve.degree,
        getOpacity: () => state.torusOpacity,
        normalizeAngle,
        hueCss
      });
    }
    setTorusOpacity((state.torusOpacity || 0.74) * 100);
    setIteration(1);
    drawCurveEditor();
    setBackendStatus("Backend: Auto");
  }

  init();
})();
