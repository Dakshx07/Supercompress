/**
 * SuperCompress dither shaders — Bayer 8×8 stipple + pixelated image dither.
 * Mirrors supermemory-style dotted fields without WebGL dependency.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var BLUE = [5, 98, 239];
  var INK = [11, 16, 21];

  // Bayer 8×8 ordered dither thresholds (0..1)
  var BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ].map(function (t) {
    return (t + 0.5) / 64;
  });

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /* ——— Hero side stipple field (animated) ——— */
  function mountHeroDots() {
    var host = document.querySelector(".sc-hero-dots");
    if (!host) return;

    var canvas = document.createElement("canvas");
    canvas.className = "sc-dots-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.innerHTML = "";
    host.appendChild(canvas);

    var ctx = canvas.getContext("2d", { alpha: true });
    var cell = 5;
    var buf = null;
    var w = 0;
    var h = 0;
    var t = 0;
    var raf = 0;
    var visible = true;

    function resize() {
      var r = host.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width / cell));
      h = Math.max(1, Math.round(r.height / cell));
      buf = document.createElement("canvas");
      buf.width = w;
      buf.height = h;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    function paint() {
      if (!buf) return;
      var bctx = buf.getContext("2d");
      var img = bctx.createImageData(w, h);
      var data = img.data;
      var pulse = 0.82 + 0.18 * Math.sin(t * 0.55);

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var nx = x / w;
          var ny = y / h;
          // Side lobes — clear center for copy
          var left = clamp01(1 - nx / 0.28);
          var right = clamp01((nx - 0.72) / 0.28);
          var side = Math.max(left, right);
          var vert = 1 - Math.abs(ny - 0.42) * 1.4;
          vert = clamp01(vert);
          var wave = 0.5 + 0.5 * Math.sin(nx * 9 + t * 0.7) * Math.sin(ny * 7 - t * 0.45);
          var a = side * vert * (0.35 + 0.65 * wave) * pulse;
          a = clamp01(a);
          var thr = BAYER[(y & 7) * 8 + (x & 7)];
          var i = (y * w + x) * 4;
          if (a > thr) {
            data[i] = BLUE[0];
            data[i + 1] = BLUE[1];
            data[i + 2] = BLUE[2];
            data[i + 3] = Math.round(90 + 130 * a);
          } else {
            data[i + 3] = 0;
          }
        }
      }
      bctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buf, 0, 0, canvas.clientWidth, canvas.clientHeight);
    }

    function loop() {
      if (!visible || reduce) {
        paint();
        return;
      }
      t += 0.016;
      paint();
      raf = requestAnimationFrame(loop);
    }

    resize();
    paint();
    if (!reduce) raf = requestAnimationFrame(loop);

    new ResizeObserver(function () {
      resize();
      paint();
    }).observe(host);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            visible = e.isIntersecting;
            if (visible && !reduce && !raf) raf = requestAnimationFrame(loop);
            if (!visible) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
          });
        },
        { threshold: 0.05 }
      ).observe(host);
    }
  }

  /* ——— Pixel Bayer dither from <img> ——— */
  function ditherImage(img, opts) {
    opts = opts || {};
    var scale = opts.scale || 3; // pixel block size
    var invert = !!opts.invert;
    var color = opts.color || BLUE;
    var bg = opts.bg || null; // null = transparent

    var canvas = document.createElement("canvas");
    canvas.className = "sc-dither-canvas";
    canvas.setAttribute("aria-hidden", "true");

    function render() {
      var nw = img.naturalWidth || img.width;
      var nh = img.naturalHeight || img.height;
      if (!nw || !nh) return;

      var cw = Math.max(1, Math.floor(nw / scale));
      var ch = Math.max(1, Math.floor(nh / scale));
      var src = document.createElement("canvas");
      src.width = cw;
      src.height = ch;
      var sctx = src.getContext("2d");
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(img, 0, 0, cw, ch);
      var pixels = sctx.getImageData(0, 0, cw, ch);
      var d = pixels.data;

      for (var y = 0; y < ch; y++) {
        for (var x = 0; x < cw; x++) {
          var i = (y * cw + x) * 4;
          var lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          if (invert) lum = 1 - lum;
          lum = Math.pow(lum, 0.9);
          var thr = BAYER[(y & 7) * 8 + (x & 7)];
          if (lum < thr + 0.08) {
            d[i] = color[0];
            d[i + 1] = color[1];
            d[i + 2] = color[2];
            d[i + 3] = 255;
          } else if (bg) {
            d[i] = bg[0];
            d[i + 1] = bg[1];
            d[i + 2] = bg[2];
            d[i + 3] = 255;
          } else {
            d[i + 3] = 0;
          }
        }
      }
      sctx.putImageData(pixels, 0, 0);

      var parent = img.parentElement;
      var parentW = parent ? parent.clientWidth : 0;
      var displayW = Math.max(
        160,
        Math.round((parentW || img.clientWidth || Math.min(nw, 720)) * (opts.fill ? 1 : 0.86))
      );
      if (opts.maxW) displayW = Math.min(displayW, opts.maxW);
      var displayH = Math.round(displayW * (nh / nw));
      if (opts.fill && parent) {
        displayW = parent.clientWidth || displayW;
        displayH = parent.clientHeight || Math.round(displayW * (nh / nw));
      }
      canvas.width = displayW;
      canvas.height = displayH;
      var ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, displayW, displayH);
      if (opts.cover && parent) {
        var scaleX = displayW / cw;
        var scaleY = displayH / ch;
        var s = Math.max(scaleX, scaleY);
        var dw = cw * s;
        var dh = ch * s;
        ctx.drawImage(src, (displayW - dw) / 2, (displayH - dh) / 2, dw, dh);
      } else {
        ctx.drawImage(src, 0, 0, displayW, displayH);
      }
    }

    function mount() {
      if (!img.parentNode) return;
      // Measure while still visible, then hide source
      render();
      img.classList.add("sc-dither-hidden");
      if (!canvas.parentNode) img.parentNode.insertBefore(canvas, img.nextSibling);
      // Re-render after layout settles
      requestAnimationFrame(function () {
        render();
      });
    }

    if (img.complete && img.naturalWidth) mount();
    else img.addEventListener("load", mount, { once: true });

    window.addEventListener(
      "resize",
      function () {
        if (canvas.parentNode) render();
      },
      { passive: true }
    );

    return canvas;
  }

  /* ——— Animated dither wash (install / final) ——— */
  function mountWash(el, opts) {
    if (!el) return;
    opts = opts || {};
    var canvas = document.createElement("canvas");
    canvas.className = "sc-dither-wash";
    canvas.setAttribute("aria-hidden", "true");
    el.appendChild(canvas);

    var ctx = canvas.getContext("2d");
    var cell = opts.cell || 4;
    var color = opts.color || BLUE;
    var t = 0;
    var raf = 0;
    var w = 0;
    var h = 0;
    var buf = null;
    var visible = false;

    function resize() {
      var r = el.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width / cell));
      h = Math.max(1, Math.round(r.height / cell));
      buf = document.createElement("canvas");
      buf.width = w;
      buf.height = h;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    function paint() {
      if (!buf) return;
      var bctx = buf.getContext("2d");
      var img = bctx.createImageData(w, h);
      var data = img.data;
      var pulse = 0.75 + 0.25 * Math.sin(t * 0.6);

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var nx = x / w;
          var ny = y / h;
          var edge = Math.max(Math.abs(nx - 0.5) * 2, Math.abs(ny - 0.5) * 2);
          edge = clamp01((edge - 0.35) / 0.65);
          edge = edge * edge * (3 - 2 * edge);
          var drift = 0.5 + 0.5 * Math.sin(nx * 8 + t * 0.7) * Math.sin(ny * 6 - t * 0.5);
          var a = edge * (0.45 + 0.55 * drift) * pulse;
          var thr = BAYER[(y & 7) * 8 + (x & 7)];
          var i = (y * w + x) * 4;
          if (a > thr) {
            data[i] = color[0];
            data[i + 1] = color[1];
            data[i + 2] = color[2];
            data[i + 3] = Math.round(70 + 110 * a);
          } else {
            data[i + 3] = 0;
          }
        }
      }
      bctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buf, 0, 0, canvas.clientWidth || el.clientWidth, canvas.clientHeight || el.clientHeight);
    }

    function loop() {
      if (!visible || reduce) return;
      t += 0.016;
      paint();
      raf = requestAnimationFrame(loop);
    }

    resize();
    paint();
    new ResizeObserver(function () {
      resize();
      paint();
    }).observe(el);

    new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          visible = e.isIntersecting;
          if (visible && !reduce) {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(loop);
          } else {
            cancelAnimationFrame(raf);
            raf = 0;
            paint();
          }
        });
      },
      { threshold: 0.08 }
    ).observe(el);
  }

  function boot() {
    mountHeroDots();

    document.querySelectorAll("img[data-dither]").forEach(function (img) {
      var mode = img.getAttribute("data-dither") || "blue";
      if (mode === "hands") {
        ditherImage(img, { scale: 2.5, invert: true, color: [245, 249, 255], bg: [7, 34, 79], fill: true });
      } else if (mode === "ink") {
        ditherImage(img, { scale: 3, invert: false, color: INK, bg: [228, 239, 253], fill: true });
      } else if (mode === "blue-on-light") {
        ditherImage(img, { scale: 2.6, invert: false, color: BLUE, bg: [228, 239, 253], fill: true, cover: true });
      } else {
        ditherImage(img, { scale: 3, invert: false, color: BLUE });
      }
    });

    document.querySelectorAll("[data-dither-wash]").forEach(function (el) {
      var tone = el.getAttribute("data-dither-wash");
      mountWash(el, {
        color: tone === "light" ? BLUE : [245, 249, 255],
        cell: tone === "light" ? 5 : 4,
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
