(() => {
  "use strict";

  const TAU = Math.PI * 2;

  function createDhuenutTorusView(canvas, adapter) {
    if (!canvas || !adapter) return { draw() {} };

    const ctx = canvas.getContext("2d");
    const view = {
      tilt: -0.82,
      spin: -0.54,
      R: 1.18,
      r: 0.42,
      dragging: false,
      dragX: 0,
      dragY: 0
    };

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function getOpacity() {
      const opacity = adapter.getOpacity ? Number(adapter.getOpacity()) : 0.74;
      return clamp(Number.isFinite(opacity) ? opacity : 0.74, 0, 1);
    }

    function normalizeAngle(angle) {
      if (adapter.normalizeAngle) return adapter.normalizeAngle(angle);
      angle %= 360;
      return angle < 0 ? angle + 360 : angle;
    }

    function hueCss(hue, alpha = 1) {
      const h = normalizeAngle(hue);
      return `hsl(${h} 92% 64% / ${alpha})`;
    }

    function torusPoint(inputHue, outputLift) {
      const u = (inputHue / 360) * TAU;
      const v = (outputLift / 360) * TAU;
      const radial = view.R + view.r * Math.cos(v);
      return {
        x: radial * Math.cos(u),
        y: radial * Math.sin(u),
        z: view.r * Math.sin(v)
      };
    }

    function project(point, w, h) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const cosX = Math.cos(view.tilt);
      const sinX = Math.sin(view.tilt);
      const y1 = point.y * cosX - point.z * sinX;
      const z1 = point.y * sinX + point.z * cosX;
      const cosZ = Math.cos(view.spin);
      const sinZ = Math.sin(view.spin);
      const x2 = point.x * cosZ - y1 * sinZ;
      const y2 = point.x * sinZ + y1 * cosZ;
      const scale = Math.min(w / 3.55, h / 2.52);
      const perspective = 1 / (1.18 - z1 * 0.11);
      return {
        x: cx + x2 * scale * perspective,
        y: cy + y2 * scale * perspective,
        z: z1
      };
    }

    function projected(inputHue, outputLift, w, h) {
      return project(torusPoint(inputHue, outputLift), w, h);
    }

    function drawPath(points, options) {
      if (!points.length) return;
      ctx.save();
      ctx.globalAlpha = options.alpha ?? 1;
      ctx.strokeStyle = options.stroke;
      ctx.lineWidth = options.width ?? 1;
      ctx.lineCap = options.cap || "round";
      ctx.lineJoin = "round";
      if (options.shadow) {
        ctx.shadowColor = options.shadow;
        ctx.shadowBlur = options.blur ?? 12;
      }
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (options.close) ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    function fillCell(points, hue, shade, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${normalizeAngle(hue)} 86% ${shade}% / 1)`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    function drawSolidShell(w, h, opacity) {
      if (opacity <= 0.001) return;
      const uStep = 8;
      const vStep = 8;
      const cells = [];

      for (let u = 0; u < 360; u += uStep) {
        for (let v = 0; v < 360; v += vStep) {
          const p1 = projected(u, v, w, h);
          const p2 = projected(u + uStep, v, w, h);
          const p3 = projected(u + uStep, v + vStep, w, h);
          const p4 = projected(u, v + vStep, w, h);
          const depth = (p1.z + p2.z + p3.z + p4.z) / 4;
          const tubeHue = normalizeAngle(u + v * 0.18);
          const light = clamp(58 + depth * 18 + Math.cos((v / 360) * TAU) * 8, 38, 78);
          cells.push({
            points: [p1, p2, p3, p4],
            depth,
            hue: tubeHue,
            light
          });
        }
      }

      cells
        .sort((a, b) => a.depth - b.depth)
        .forEach((cell) => {
          const frontBoost = cell.depth > 0 ? 0.1 : 0;
          fillCell(cell.points, cell.hue, cell.light, opacity * (0.34 + frontBoost));
        });
    }

    function ringPoints(kind, fixed, w, h) {
      const points = [];
      for (let i = 0; i <= 180; i += 1) {
        const t = (i / 180) * 360;
        const input = kind === "longitude" ? fixed : t;
        const output = kind === "longitude" ? t : fixed;
        points.push(projected(input, output, w, h));
      }
      return points;
    }

    function drawShell(w, h, opacity) {
      const rings = [];
      for (let v = 0; v < 360; v += 30) {
        rings.push({
          points: ringPoints("latitude", v, w, h),
          hue: v,
          kind: "latitude"
        });
      }
      for (let u = 0; u < 360; u += 30) {
        rings.push({
          points: ringPoints("longitude", u, w, h),
          hue: u,
          kind: "longitude"
        });
      }

      rings
        .map((ring) => ({
          ...ring,
          depth: ring.points.reduce((sum, point) => sum + point.z, 0) / ring.points.length
        }))
        .sort((a, b) => a.depth - b.depth)
        .forEach((ring) => {
          const front = ring.depth > 0.02;
          drawPath(ring.points, {
            stroke: ring.kind === "latitude" ? hueCss(ring.hue, (front ? 0.34 : 0.18) * opacity) : "#fff3bf",
            alpha: ring.kind === "latitude" ? 1 : (front ? 0.18 : 0.1) * opacity,
            width: ring.kind === "latitude" ? front ? 1.35 : 0.8 : 0.75,
            close: true
          });
        });
    }

    function drawCurve(w, h) {
      const samples = [];
      for (let x = 0; x <= 360; x += 1.5) {
        samples.push(projected(x, adapter.sampleLift(x), w, h));
      }

      drawPath(samples, {
        stroke: "#3d1748",
        alpha: 0.7,
        width: 8.5,
        shadow: "#ff65b8",
        blur: 10
      });

      for (let i = 1; i < samples.length; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        const hue = ((i - 1) / (samples.length - 1)) * 360;
        drawPath([a, b], {
          stroke: hueCss(hue, 0.96),
          width: 4.2 + Math.max(a.z, b.z) * 1.6,
          shadow: hueCss(hue, 0.78),
          blur: 13
        });
      }
    }

    function drawControlPoints(w, h) {
      const points = (adapter.getPoints ? adapter.getPoints() : [])
        .map((point) => ({
          ...projected(point.x, point.y, w, h),
          hue: point.x
        }))
        .sort((a, b) => a.z - b.z);

      points.forEach((point) => {
        const radius = 4.5 + Math.max(0, point.z) * 2.2;
        ctx.save();
        ctx.fillStyle = hueCss(point.hue, 1);
        ctx.strokeStyle = "#fff3bf";
        ctx.lineWidth = 1.4;
        ctx.shadowColor = hueCss(point.hue, 0.85);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    function drawCenterGlow(w, h, opacity) {
      const gradient = ctx.createRadialGradient(w * 0.5, h * 0.48, 10, w * 0.5, h * 0.5, Math.min(w, h) * 0.5);
      gradient.addColorStop(0, "#fff3bf22");
      gradient.addColorStop(0.34, "#ff65b815");
      gradient.addColorStop(0.68, "#44e4d20e");
      gradient.addColorStop(1, "#13091e00");
      ctx.save();
      ctx.globalAlpha = 0.35 + opacity * 0.65;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      const opacity = getOpacity();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#13091e";
      ctx.fillRect(0, 0, w, h);
      drawCenterGlow(w, h, opacity);
      drawSolidShell(w, h, opacity);
      drawShell(w, h, opacity);
      drawCurve(w, h);
      drawControlPoints(w, h);
    }

    function handlePointerDown(event) {
      view.dragging = true;
      view.dragX = event.clientX;
      view.dragY = event.clientY;
      canvas.classList.add("dragging");
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (!view.dragging) return;
      const dx = event.clientX - view.dragX;
      const dy = event.clientY - view.dragY;
      view.dragX = event.clientX;
      view.dragY = event.clientY;
      view.spin += dx * 0.009;
      view.tilt = clamp(view.tilt + dy * 0.007, -1.38, 0.18);
      draw();
      event.preventDefault();
    }

    function handlePointerUp(event) {
      if (!view.dragging) return;
      view.dragging = false;
      canvas.classList.remove("dragging");
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* pointer may already be released */
      }
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);

    return { draw };
  }

  window.createDhuenutTorusView = createDhuenutTorusView;
})();
