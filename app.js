/* Flipbook Studio - frame-by-frame animation editor.
 * Written in ES2015-ish JS (no optional chaining, no pointer events) so it runs on iOS 12 Safari. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function copyCv(src) { var c = mk(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }

  // ---------- colour helpers ----------
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { var s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { var v = Math.round(l * 255); return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  // ---------- state ----------
  var view = $('view'), vctx = view.getContext('2d'), stage = $('stage');
  var S = { w: 640, h: 360, fps: 12, bg: '#ffffff', transparent: false, layers: [], frames: [], cur: 0, li: 0, nid: 1, loop: true, onion: 1, grid: false };
  var T = { tool: 'pen', size: 8, opacity: 100, color: '#222222', tol: 32, fillAll: false, shapeFill: false, stab: 0, sizes: {}, sym: 'off', symMirror: false, symGuides: true };
  var V = { zoom: 1, px: 0, py: 0 };
  var undoStack = [], redoStack = [];
  var strokeCv = mk(1, 1), tmpCv = mk(1, 1), onionCv = mk(1, 1);
  var checkCv = mk(16, 16);
  (function () {
    var c = checkCv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#d0d0d4'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8);
  })();
  var fl = null, selRect = null, clip = null, st = { active: false };
  var playing = false, playTimer = null, dirty = false, saveTimer = null, rafPending = false;

  var canDownload = ('download' in document.createElement('a'));

  // ---------- toast ----------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 1700);
  }

  // ---------- project ----------
  function curFrame() { return S.frames[S.cur]; }
  function curLayer() { return S.layers[S.li]; }
  function curCv() { return curFrame().cvs[curLayer().id]; }
  function newLayerObj(name) { return { id: S.nid++, name: name, visible: true, locked: false, opacity: 1 }; }
  function newFrame() {
    var f = { id: S.nid++, hold: 1, cvs: {} };
    S.layers.forEach(function (l) { f.cvs[l.id] = mk(S.w, S.h); });
    return f;
  }
  function setupSurfaces() {
    view.width = S.w; view.height = S.h;
    strokeCv.width = S.w; strokeCv.height = S.h;
    tmpCv.width = S.w; tmpCv.height = S.h;
    onionCv.width = S.w; onionCv.height = S.h;
  }
  function finishInit() {
    setupSurfaces();
    $('fps').value = S.fps;
    $('loop').checked = S.loop;
    $('onion').value = String(S.onion);
    S.cur = 0;
    S.li = S.layers.length - 1;
    undoStack = []; redoStack = [];
    fl = null; selRect = null; st = { active: false };
    fitView();
    rebuildStrip();
    rebuildLayers();
    updateFrameInfo();
    render();
  }
  function initProject(w, h, fps, bg, transp) {
    stopPlay();
    S.w = w; S.h = h; S.fps = fps; S.bg = bg; S.transparent = transp;
    S.nid = 1; S.layers = []; S.frames = [];
    S.layers.push(newLayerObj('Layer 1'));
    S.frames.push(newFrame());
    finishInit();
    markDirty();
  }

  // ---------- render ----------
  function requestRender() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(render); }
  }
  function drawLayersOf(ctx, f, live) {
    for (var i = 0; i < S.layers.length; i++) {
      var l = S.layers[i];
      if (!l.visible) continue;
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(f.cvs[l.id], 0, 0);
      if (live && i === S.li) {
        if (st.active && st.overlay) {
          ctx.globalAlpha = l.opacity * st.alpha;
          ctx.drawImage(strokeCv, 0, 0);
          ctx.globalAlpha = l.opacity;
        }
        if (fl) {
          ctx.save();
          ctx.translate(fl.cx, fl.cy);
          ctx.rotate(fl.rot);
          ctx.scale(fl.sx * fl.sc, fl.sy * fl.sc);
          ctx.drawImage(fl.cv, -fl.w / 2, -fl.h / 2);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawOnion(idx, color, alpha) {
    if (idx < 0 || idx >= S.frames.length) return;
    var o = onionCv.getContext('2d');
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, S.w, S.h);
    drawLayersOf(o, S.frames[idx], false);
    o.globalCompositeOperation = 'source-atop';
    o.globalAlpha = 0.65;
    o.fillStyle = color;
    o.fillRect(0, 0, S.w, S.h);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    vctx.globalAlpha = alpha;
    vctx.drawImage(onionCv, 0, 0);
    vctx.globalAlpha = 1;
  }
  function render() {
    rafPending = false;
    if (!S.frames.length) return;
    var c = vctx, k;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S.w, S.h);
    if (S.transparent) { c.fillStyle = c.createPattern(checkCv, 'repeat'); }
    else { c.fillStyle = S.bg; }
    c.fillRect(0, 0, S.w, S.h);
    if (S.onion > 0 && !playing) {
      for (k = S.onion; k >= 1; k--) drawOnion(S.cur - k, '#ff3b30', 0.34 / k);
      for (k = 1; k <= S.onion; k++) drawOnion(S.cur + k, '#34c759', 0.28 / k);
    }
    drawLayersOf(c, curFrame(), !playing);
    if (S.grid) {
      c.save();
      c.strokeStyle = 'rgba(120,120,130,0.55)';
      c.lineWidth = 1 / V.zoom;
      var gs = 40;
      c.beginPath();
      for (var x = gs; x < S.w; x += gs) { c.moveTo(x, 0); c.lineTo(x, S.h); }
      for (var y = gs; y < S.h; y += gs) { c.moveTo(0, y); c.lineTo(S.w, y); }
      c.stroke();
      c.restore();
    }
    if (!playing) {
      drawSymGuides(c);
      if (selRect) {
        c.save();
        c.lineWidth = 1.5 / V.zoom;
        c.setLineDash([5 / V.zoom, 4 / V.zoom]);
        c.strokeStyle = '#0a84ff';
        c.strokeRect(selRect.x, selRect.y, selRect.w, selRect.h);
        c.restore();
      }
      drawFloatUI(c);
      drawLassoUI(c);
    }
  }

  // ---------- overlays: symmetry guides, lasso path, transform handles ----------
  var HANDLE_PX = 16, ROT_OFF_PX = 30;
  function floatGeom() {
    var z = V.zoom;
    var g = { hw: Math.abs(fl.sx * fl.sc) * fl.w / 2, hh: Math.abs(fl.sy * fl.sc) * fl.h / 2, hr: HANDLE_PX / z, off: ROT_OFF_PX / z };
    g.edgeH = g.hw > g.hr * 1.6; // top/bottom edge handles fit
    g.edgeV = g.hh > g.hr * 1.6; // left/right edge handles fit
    return g;
  }
  function drawFloatUI(c) {
    if (!fl) return;
    var g = floatGeom(), z = V.zoom, hs = 5 / z;
    c.save();
    c.translate(fl.cx, fl.cy);
    c.rotate(fl.rot);
    c.lineWidth = 1.5 / z;
    c.setLineDash([5 / z, 4 / z]);
    c.strokeStyle = '#0a84ff';
    c.strokeRect(-g.hw, -g.hh, g.hw * 2, g.hh * 2);
    c.setLineDash([]);
    c.beginPath(); c.moveTo(0, -g.hh); c.lineTo(0, -g.hh - g.off); c.stroke();
    c.fillStyle = '#ffffff';
    var pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    if (g.edgeH) pts.push([0, -1], [0, 1]);
    if (g.edgeV) pts.push([-1, 0], [1, 0]);
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i][0] * g.hw, py = pts[i][1] * g.hh;
      c.beginPath(); c.rect(px - hs, py - hs, hs * 2, hs * 2); c.fill(); c.stroke();
    }
    c.fillStyle = '#0a84ff';
    c.beginPath(); c.arc(0, -g.hh - g.off, 6 / z, 0, 6.2832); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.5 / z; c.stroke();
    c.restore();
  }
  function drawLassoUI(c) {
    if (!(st.active && st.kind === 'lasso' && st.pts.length > 1)) return;
    c.save();
    c.beginPath();
    c.moveTo(st.pts[0][0], st.pts[0][1]);
    for (var i = 1; i < st.pts.length; i++) c.lineTo(st.pts[i][0], st.pts[i][1]);
    c.closePath();
    c.fillStyle = 'rgba(10,132,255,0.12)';
    c.fill();
    c.lineWidth = 1.5 / V.zoom;
    c.setLineDash([5 / V.zoom, 4 / V.zoom]);
    c.strokeStyle = '#0a84ff';
    c.stroke();
    c.restore();
  }
  function drawSymGuides(c) {
    if (T.sym === 'off' || !T.symGuides) return;
    var W = S.w, H = S.h, cx = W / 2, cy = H / 2;
    c.save();
    c.lineWidth = 1.5 / V.zoom;
    c.setLineDash([6 / V.zoom, 5 / V.zoom]);
    c.strokeStyle = 'rgba(255,45,85,0.75)';
    c.beginPath();
    if (T.sym === 'v' || T.sym === 'both') { c.moveTo(cx, 0); c.lineTo(cx, H); }
    if (T.sym === 'h' || T.sym === 'both') { c.moveTo(0, cy); c.lineTo(W, cy); }
    if (T.sym.charAt(0) === 'r') {
      var n = parseInt(T.sym.slice(1), 10), R = Math.sqrt(W * W + H * H);
      for (var k = 0; k < n; k++) {
        var a = Math.PI * 2 * k / n;
        c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
    }
    c.stroke();
    c.restore();
  }

  // ---------- symmetry ----------
  function matMul(A, B) { // apply B first, then A
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  }
  function symMats() {
    var m = T.sym, W = S.w, H = S.h, cx = W / 2, cy = H / 2, I = [1, 0, 0, 1, 0, 0];
    var FX = [-1, 0, 0, 1, W, 0], FY = [1, 0, 0, -1, 0, H];
    if (m === 'off') return [I];
    if (m === 'v') return [I, FX];
    if (m === 'h') return [I, FY];
    if (m === 'both') return [I, FX, FY, [-1, 0, 0, -1, W, H]];
    var n = parseInt(m.slice(1), 10) || 4, out = [];
    for (var k = 0; k < n; k++) {
      var a = Math.PI * 2 * k / n, co = Math.cos(a), si = Math.sin(a);
      var R = [co, si, -si, co, cx - co * cx + si * cy, cy - si * cx - co * cy];
      out.push(R);
      if (T.symMirror) out.push(matMul(R, FX));
    }
    return out;
  }
  // Runs fn once per symmetry copy, with the context transformed for that copy.
  function eachSym(ctx, fn) {
    if (T.sym === 'off') { fn(); return; }
    var ms = symMats();
    for (var i = 0; i < ms.length; i++) {
      ctx.save();
      ctx.transform(ms[i][0], ms[i][1], ms[i][2], ms[i][3], ms[i][4], ms[i][5]);
      fn();
      ctx.restore();
    }
  }

  // ---------- view (zoom / pan) ----------
  function applyView() {
    view.style.width = (S.w * V.zoom) + 'px';
    view.style.height = (S.h * V.zoom) + 'px';
    view.style.left = V.px + 'px';
    view.style.top = V.py + 'px';
    $('zoomLabel').textContent = Math.round(V.zoom * 100) + '%';
    requestRender();
  }
  function fitView() {
    var sw = stage.clientWidth || 600, sh = stage.clientHeight || 400;
    V.zoom = clamp(Math.min((sw - 24) / S.w, (sh - 24) / S.h), 0.05, 16);
    V.px = (sw - S.w * V.zoom) / 2;
    V.py = (sh - S.h * V.zoom) / 2;
    applyView();
  }
  function zoomAtStage(sx, sy, nz) {
    nz = clamp(nz, 0.1, 16);
    var cx = (sx - V.px) / V.zoom, cy = (sy - V.py) / V.zoom;
    V.zoom = nz;
    V.px = sx - cx * nz;
    V.py = sy - cy * nz;
    applyView();
  }
  function toCanvas(cx, cy) {
    var r = view.getBoundingClientRect();
    return [(cx - r.left) * S.w / r.width, (cy - r.top) * S.h / r.height];
  }

  // ---------- undo ----------
  function pushUndo() {
    var f = curFrame(), l = curLayer();
    undoStack.push({ fid: f.id, lid: l.id, cv: copyCv(f.cvs[l.id]) });
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
  }
  function findFrame(id) {
    for (var i = 0; i < S.frames.length; i++) if (S.frames[i].id === id) return i;
    return -1;
  }
  function findLayer(id) {
    for (var i = 0; i < S.layers.length; i++) if (S.layers[i].id === id) return i;
    return -1;
  }
  function doUndo(redo) {
    var from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    fl = null; selRect = null;
    while (from.length) {
      var e = from.pop();
      var fi = findFrame(e.fid), li = findLayer(e.lid);
      if (fi < 0 || li < 0) continue;
      var cv = S.frames[fi].cvs[e.lid];
      to.push({ fid: e.fid, lid: e.lid, cv: copyCv(cv) });
      var c = cv.getContext('2d');
      c.clearRect(0, 0, S.w, S.h);
      c.drawImage(e.cv, 0, 0);
      S.cur = fi; S.li = li;
      updateStripActive(true);
      rebuildLayers();
      updateFrameInfo();
      drawThumb(fi);
      markDirty();
      break;
    }
    render();
  }

  // ---------- drawing tools ----------
  // Each drawing tool remembers its own size.
  var SIZE_DEFAULTS = { pen: 8, pencil: 8, marker: 20, airbrush: 30, charcoal: 16, eraser: 20, line: 4, rect: 4, oval: 4 };
  function setSize(v) {
    T.size = clamp(Math.round(v), 1, 80);
    if (SIZE_DEFAULTS[T.tool] !== undefined) T.sizes[T.tool] = T.size;
    $('size').value = T.size;
    $('sizeVal').textContent = T.size;
  }
  function setTool(t) {
    if (t !== 'select' && t !== 'lasso') commitFloat();
    T.tool = t;
    if (SIZE_DEFAULTS[t] !== undefined) {
      setSize(T.sizes[t] !== undefined ? T.sizes[t] : SIZE_DEFAULTS[t]);
    }
    var bs = document.querySelectorAll('#toolbar .tool');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-tool') === t);
    $('optFill').style.display = t === 'fill' ? 'block' : 'none';
    $('optShape').style.display = (t === 'rect' || t === 'oval') ? 'block' : 'none';
    stage.className = t === 'hand' ? 'hand' : '';
  }

  function pencilStamp(ctx, x, y) {
    var r = T.size / 2;
    var n = Math.min(150, Math.max(3, Math.round(T.size * T.size * 0.25)));
    var grow = T.size / 40;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * r;
      var s = 0.55 + Math.random() * 0.8 + grow;
      ctx.globalAlpha = 0.22 + Math.random() * 0.5;
      ctx.fillRect(x + Math.cos(a) * d - s / 2, y + Math.sin(a) * d - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
  function charcoalStamp(ctx, x, y) {
    var r = T.size * 0.6;
    var n = Math.min(160, Math.max(6, Math.round(T.size * T.size * 0.35)));
    ctx.globalAlpha = 0.04;
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, 6.2832); ctx.fill();
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * r;
      var s = 1 + Math.random() * 2.6;
      ctx.globalAlpha = 0.12 + Math.random() * 0.55;
      ctx.fillRect(x + Math.cos(a) * d - s / 2, y + Math.sin(a) * d - s / 2, s, s * (0.5 + Math.random()));
    }
    ctx.globalAlpha = 1;
  }
  function markerStamp(ctx, x, y) { // flat chisel tip held at 40 degrees
    var th = Math.max(2, T.size * 0.3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.7);
    ctx.fillRect(-T.size / 2, -th / 2, T.size, th);
    ctx.restore();
  }
  function makeSoftTip(color, r) {
    var d = Math.ceil(r) * 2, c = mk(d, d), x = c.getContext('2d'), rgb = hexToRgb(color);
    var rc = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
    var gr = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
    gr.addColorStop(0, rc + '1)');
    gr.addColorStop(0.5, rc + '0.4)');
    gr.addColorStop(1, rc + '0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, d, d);
    return c;
  }
  function airbrushStamp(ctx, x, y) {
    var d = st.tip.width;
    ctx.globalAlpha = 0.12;
    ctx.drawImage(st.tip, x - d / 2, y - d / 2);
    ctx.globalAlpha = 1;
  }
  // Stamp-based brushes: spacing = distance between stamps, alphaMul = stroke translucency.
  var BRUSHES = {
    pencil: { stamp: pencilStamp, spacing: function () { return Math.max(1, T.size * 0.18); }, alphaMul: 1 },
    marker: { stamp: markerStamp, spacing: function () { return Math.max(0.8, Math.max(2, T.size * 0.3) * 0.35); }, alphaMul: 0.8 },
    airbrush: { stamp: airbrushStamp, spacing: function () { return Math.max(1, T.size * 0.07); }, alphaMul: 1,
      prep: function () { return makeSoftTip(T.color, Math.max(2, T.size * 0.75)); } },
    charcoal: { stamp: charcoalStamp, spacing: function () { return Math.max(1, T.size * 0.15); }, alphaMul: 1 }
  };
  function stampLine(ctx, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) return;
    var sp = st.spacing, start = st.carry, endCarry = start, stamp = st.stamp;
    eachSym(ctx, function () {
      var pos = start;
      while (pos <= d) {
        stamp(ctx, a[0] + dx * pos / d, a[1] + dy * pos / d);
        pos += sp;
      }
      endCarry = pos - d;
    });
    st.carry = endCarry;
  }
  function drawShape(ctx, x0, y0, x1, y1) {
    ctx.clearRect(0, 0, S.w, S.h);
    eachSym(ctx, function () { drawShapeOnce(ctx, x0, y0, x1, y1); });
  }
  function drawShapeOnce(ctx, x0, y0, x1, y1) {
    ctx.save();
    ctx.lineWidth = T.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = T.color;
    if (T.tool === 'line') {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    } else if (T.tool === 'rect') {
      if (T.shapeFill) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      else ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, 6.2832);
      if (T.shapeFill) ctx.fill(); else ctx.stroke();
    }
    ctx.restore();
  }
  function commitStroke(alpha) {
    var lctx = curCv().getContext('2d');
    lctx.globalAlpha = alpha;
    lctx.drawImage(strokeCv, 0, 0);
    lctx.globalAlpha = 1;
    strokeCv.getContext('2d').clearRect(0, 0, S.w, S.h);
  }
  function cancelStroke() {
    if (!st.active) return;
    if (st.kind === 'stroke' || st.kind === 'stamp' || st.kind === 'shape') {
      if (st.ctx) st.ctx.restore();
      strokeCv.getContext('2d').clearRect(0, 0, S.w, S.h);
      if (st.erase) doUndo(false); else undoStack.pop();
    }
    st = { active: false };
    requestRender();
  }
  function afterEdit() {
    markDirty();
    drawThumb(S.cur);
    requestRender();
  }

  function pickColor(x, y) {
    var c = tmpCv.getContext('2d');
    c.clearRect(0, 0, S.w, S.h);
    drawLayersOf(c, curFrame(), false);
    var d = c.getImageData(clamp(Math.round(x), 0, S.w - 1), clamp(Math.round(y), 0, S.h - 1), 1, 1).data;
    var rgb = d[3] === 0 ? hexToRgb(S.transparent ? '#ffffff' : S.bg) : [d[0], d[1], d[2]];
    setColor(rgbToHex(rgb[0], rgb[1], rgb[2]), false);
  }

  function floodFill(src, dst, w, h, sx, sy, col, tol) {
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    var i0 = (sy * w + sx) * 4;
    var tr = src[i0], tg = src[i0 + 1], tb = src[i0 + 2], ta = src[i0 + 3];
    var seen = new Uint8Array(w * h);
    function ok(p) {
      var i = p * 4;
      return Math.abs(src[i] - tr) <= tol && Math.abs(src[i + 1] - tg) <= tol && Math.abs(src[i + 2] - tb) <= tol && Math.abs(src[i + 3] - ta) <= tol;
    }
    var stack = [sx, sy];
    while (stack.length) {
      var y = stack.pop(), x = stack.pop();
      var p = y * w + x;
      if (seen[p] || !ok(p)) continue;
      var l = x, r = x;
      while (l > 0 && !seen[y * w + l - 1] && ok(y * w + l - 1)) l--;
      while (r < w - 1 && !seen[y * w + r + 1] && ok(y * w + r + 1)) r++;
      for (var xx = l; xx <= r; xx++) {
        var pp = y * w + xx;
        seen[pp] = 1;
        var i = pp * 4;
        dst[i] = col[0]; dst[i + 1] = col[1]; dst[i + 2] = col[2]; dst[i + 3] = col[3];
      }
      for (var dy = -1; dy <= 1; dy += 2) {
        var ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        var inRun = false;
        for (xx = l; xx <= r; xx++) {
          var q = ny * w + xx;
          var good = !seen[q] && ok(q);
          if (good && !inRun) { stack.push(xx, ny); inRun = true; }
          else if (!good) inRun = false;
        }
      }
    }
  }
  function doFill(x, y) {
    var rgb = hexToRgb(T.color);
    var col = [rgb[0], rgb[1], rgb[2], Math.round(255 * T.opacity / 100)];
    var dctx = curCv().getContext('2d');
    var dimg = dctx.getImageData(0, 0, S.w, S.h);
    var simg = dimg;
    if (T.fillAll) {
      var tc = tmpCv.getContext('2d');
      tc.clearRect(0, 0, S.w, S.h);
      drawLayersOf(tc, curFrame(), false);
      simg = tc.getImageData(0, 0, S.w, S.h);
    }
    floodFill(simg.data, dimg.data, S.w, S.h, Math.round(x), Math.round(y), col, T.tol);
    dctx.putImageData(dimg, 0, 0);
  }

  // ----- selection / floating pixels -----
  function polyPath(ctx, poly, ox, oy) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0] - ox, poly[0][1] - oy);
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0] - ox, poly[i][1] - oy);
    ctx.closePath();
  }
  function liftRect(r, poly) {
    var l = curLayer();
    if (l.locked || !l.visible) { toast(l.locked ? 'Layer is locked' : 'Layer is hidden'); return false; }
    var x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    if (w < 1 || h < 1) return false;
    pushUndo();
    var c = mk(w, h), cc = c.getContext('2d'), lc = curCv().getContext('2d');
    if (poly) {
      cc.save();
      polyPath(cc, poly, x, y);
      cc.clip();
      cc.drawImage(curCv(), x, y, w, h, 0, 0, w, h);
      cc.restore();
      lc.save();
      polyPath(lc, poly, 0, 0);
      lc.clip();
      lc.clearRect(x, y, w, h);
      lc.restore();
    } else {
      cc.drawImage(curCv(), x, y, w, h, 0, 0, w, h);
      lc.clearRect(x, y, w, h);
    }
    fl = { cv: c, cx: x + w / 2, cy: y + h / 2, sc: 1, sx: 1, sy: 1, rot: 0, w: w, h: h };
    return true;
  }
  function ensureFloat() {
    if (fl) return true;
    return liftRect({ x: 0, y: 0, w: S.w, h: S.h });
  }
  function commitFloat() {
    if (!fl) return;
    var c = curCv().getContext('2d');
    c.save();
    c.translate(fl.cx, fl.cy);
    c.rotate(fl.rot);
    c.scale(fl.sx * fl.sc, fl.sy * fl.sc);
    c.drawImage(fl.cv, -fl.w / 2, -fl.h / 2);
    c.restore();
    fl = null; selRect = null;
    afterEdit();
  }
  // What is under the pointer: a scale handle, the rotate handle/ring, the body (move) or nothing.
  function floatHit(x, y) {
    var g = floatGeom(), cs = Math.cos(fl.rot), sn = Math.sin(fl.rot);
    var dx = x - fl.cx, dy = y - fl.cy;
    var lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    function near(ax, ay, r) { var ex = lx - ax, ey = ly - ay; return ex * ex + ey * ey <= r * r; }
    var i, sx, sy, cn = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    if (near(0, -g.hh - g.off, g.hr * 1.2)) return { type: 'rotate' };
    for (i = 0; i < 4; i++) if (near(cn[i][0] * g.hw, cn[i][1] * g.hh, g.hr)) return { type: 'scale', hx: cn[i][0], hy: cn[i][1] };
    if (g.edgeH) {
      if (near(0, -g.hh, g.hr)) return { type: 'scale', hx: 0, hy: -1 };
      if (near(0, g.hh, g.hr)) return { type: 'scale', hx: 0, hy: 1 };
    }
    if (g.edgeV) {
      if (near(-g.hw, 0, g.hr)) return { type: 'scale', hx: -1, hy: 0 };
      if (near(g.hw, 0, g.hr)) return { type: 'scale', hx: 1, hy: 0 };
    }
    if (Math.abs(lx) <= g.hw && Math.abs(ly) <= g.hh) return { type: 'move' };
    for (i = 0; i < 4; i++) if (near(cn[i][0] * g.hw, cn[i][1] * g.hh, g.hr * 2.6)) return { type: 'rotate' };
    return null;
  }
  function beginFloatDrag(h, x, y) {
    if (h.type === 'move') {
      st = { active: true, kind: 'moveFloat', dx: x - fl.cx, dy: y - fl.cy };
    } else if (h.type === 'rotate') {
      st = { active: true, kind: 'rotFloat', a0: Math.atan2(y - fl.cy, x - fl.cx), r0: fl.rot };
    } else {
      var g = floatGeom();
      st = { active: true, kind: 'scaleFloat', hx: h.hx, hy: h.hy, hw0: g.hw, hh0: g.hh, c0x: fl.cx, c0y: fl.cy, rot0: fl.rot,
        ax: -h.hx * g.hw, ay: -h.hy * g.hh, sgx: fl.sx < 0 ? -1 : 1, sgy: fl.sy < 0 ? -1 : 1 };
    }
  }
  function updateFloatScale(x, y) {
    var cs = Math.cos(st.rot0), sn = Math.sin(st.rot0);
    var dx = x - st.c0x, dy = y - st.c0y;
    var px = dx * cs + dy * sn, py = -dx * sn + dy * cs;
    var W0 = Math.max(1, st.hw0 * 2), H0 = Math.max(1, st.hh0 * 2), MIN = 4;
    var nW = W0, nH = H0, ncx = 0, ncy = 0;
    var dirx = (px - st.ax) >= 0 ? 1 : -1, diry = (py - st.ay) >= 0 ? 1 : -1;
    if (st.hx !== 0 && st.hy !== 0) { // corner: keep proportions
      var k = Math.max(Math.abs(px - st.ax) / W0, Math.abs(py - st.ay) / H0, MIN / Math.min(W0, H0));
      nW = W0 * k; nH = H0 * k;
      ncx = st.ax + dirx * nW / 2; ncy = st.ay + diry * nH / 2;
    } else if (st.hx !== 0) { // left/right edge: stretch width only
      nW = Math.max(MIN, Math.abs(px - st.ax));
      ncx = st.ax + dirx * nW / 2;
    } else { // top/bottom edge: stretch height only
      nH = Math.max(MIN, Math.abs(py - st.ay));
      ncy = st.ay + diry * nH / 2;
    }
    fl.cx = st.c0x + ncx * cs - ncy * sn;
    fl.cy = st.c0y + ncx * sn + ncy * cs;
    fl.sc = 1;
    fl.sx = st.sgx * nW / fl.w;
    fl.sy = st.sgy * nH / fl.h;
  }
  function xform(fn) {
    var l = curLayer();
    if (l.locked || !l.visible) { toast(l.locked ? 'Layer is locked' : 'Layer is hidden'); return; }
    setTool('select');
    if (!ensureFloat()) return;
    fn();
    requestRender();
  }
  function copySel() {
    if (fl) clip = copyCv(fl.cv); else clip = copyCv(curCv());
    toast(fl ? 'Selection copied' : 'Layer copied');
  }
  function pasteFloat(cv) {
    var l = curLayer();
    if (l.locked || !l.visible) { toast(l.locked ? 'Layer is locked' : 'Layer is hidden'); return; }
    commitFloat();
    pushUndo();
    fl = { cv: cv, cx: S.w / 2, cy: S.h / 2, sc: 1, sx: 1, sy: 1, rot: 0, w: cv.width, h: cv.height };
    setTool('select');
    requestRender();
  }
  function pasteClip() {
    if (!clip) { toast('Nothing copied yet'); return; }
    pasteFloat(copyCv(clip));
  }
  function deleteSel() {
    var l = curLayer();
    if (l.locked) { toast('Layer is locked'); return; }
    if (fl) { fl = null; selRect = null; afterEdit(); return; }
    pushUndo();
    curCv().getContext('2d').clearRect(0, 0, S.w, S.h);
    afterEdit();
    toast('Layer cleared');
  }
  function importImage(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var im = new Image();
      im.onload = function () {
        var sc = Math.min(1, S.w / im.width, S.h / im.height);
        var c = mk(Math.max(1, Math.round(im.width * sc)), Math.max(1, Math.round(im.height * sc)));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        pasteFloat(c);
      };
      im.onerror = function () { toast('Could not read that image'); };
      im.src = rd.result;
    };
    rd.readAsDataURL(file);
  }

  // ----- input dispatch -----
  function toolBegin(x, y, cx, cy) {
    var t = T.tool;
    if (t === 'hand') { st = { active: true, kind: 'pan', sx: cx, sy: cy, px: V.px, py: V.py }; return; }
    if (t === 'pick') { pickColor(x, y); return; }
    var l = curLayer();
    if (l.locked || !l.visible) { toast(l.locked ? 'Layer is locked' : 'Layer is hidden'); return; }
    if (t === 'select' || t === 'lasso') {
      if (fl) {
        var hit = floatHit(x, y);
        if (hit) { beginFloatDrag(hit, x, y); return; }
        commitFloat();
      }
      if (t === 'select') {
        st = { active: true, kind: 'selRect', x0: x, y0: y };
        selRect = { x: x, y: y, w: 0, h: 0 };
      } else {
        st = { active: true, kind: 'lasso', pts: [[x, y]] };
      }
      requestRender();
      return;
    }
    if (fl) commitFloat();
    if (t === 'fill') { pushUndo(); doFill(x, y); afterEdit(); return; }
    pushUndo();
    if (t === 'pen' || t === 'eraser') {
      var erase = t === 'eraser';
      var ctx = erase ? curCv().getContext('2d') : strokeCv.getContext('2d');
      if (!erase) ctx.clearRect(0, 0, S.w, S.h);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = T.size;
      if (erase) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = T.opacity / 100;
        ctx.strokeStyle = ctx.fillStyle = '#000';
      } else {
        ctx.strokeStyle = ctx.fillStyle = T.color;
      }
      eachSym(ctx, function () { ctx.beginPath(); ctx.arc(x, y, T.size / 2, 0, 6.2832); ctx.fill(); });
      st = { active: true, kind: 'stroke', erase: erase, ctx: ctx, pts: [[x, y]], overlay: !erase, alpha: T.opacity / 100 };
    } else if (BRUSHES[t]) {
      var def = BRUSHES[t], pc = strokeCv.getContext('2d');
      pc.clearRect(0, 0, S.w, S.h);
      pc.save();
      pc.fillStyle = T.color;
      var sp = def.spacing();
      st = { active: true, kind: 'stamp', ctx: pc, last: [x, y], carry: sp, spacing: sp, stamp: def.stamp,
        tip: def.prep ? def.prep() : null, overlay: true, alpha: T.opacity / 100 * def.alphaMul };
      eachSym(pc, function () { def.stamp(pc, x, y); });
    } else {
      strokeCv.getContext('2d').clearRect(0, 0, S.w, S.h);
      st = { active: true, kind: 'shape', x0: x, y0: y, overlay: true, alpha: T.opacity / 100 };
    }
    requestRender();
  }
  function toolMove(x, y, cx, cy) {
    var k = st.kind;
    if (k === 'pan') { V.px = st.px + (cx - st.sx); V.py = st.py + (cy - st.sy); applyView(); return; }
    if (k === 'stroke') {
      var p = st.pts, c = st.ctx;
      p.push([x, y]);
      var n = p.length;
      eachSym(c, function () {
        c.beginPath();
        if (n === 2) {
          var m = mid(p[0], p[1]);
          c.moveTo(p[0][0], p[0][1]); c.lineTo(m[0], m[1]);
        } else {
          var a = mid(p[n - 3], p[n - 2]), b = mid(p[n - 2], p[n - 1]);
          c.moveTo(a[0], a[1]); c.quadraticCurveTo(p[n - 2][0], p[n - 2][1], b[0], b[1]);
        }
        c.stroke();
      });
      requestRender();
    } else if (k === 'stamp') {
      stampLine(st.ctx, st.last, [x, y]);
      st.last = [x, y];
      requestRender();
    } else if (k === 'shape') {
      drawShape(strokeCv.getContext('2d'), st.x0, st.y0, x, y);
      requestRender();
    } else if (k === 'selRect') {
      var x0 = clamp(Math.min(st.x0, x), 0, S.w), y0 = clamp(Math.min(st.y0, y), 0, S.h);
      var x1 = clamp(Math.max(st.x0, x), 0, S.w), y1 = clamp(Math.max(st.y0, y), 0, S.h);
      selRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      requestRender();
    } else if (k === 'lasso') {
      var lp = st.pts[st.pts.length - 1], ddx = x - lp[0], ddy = y - lp[1];
      if (ddx * ddx + ddy * ddy >= 1.5 / V.zoom) st.pts.push([clamp(x, 0, S.w), clamp(y, 0, S.h)]);
      requestRender();
    } else if (k === 'moveFloat') {
      fl.cx = x - st.dx; fl.cy = y - st.dy;
      requestRender();
    } else if (k === 'scaleFloat') {
      updateFloatScale(x, y);
      requestRender();
    } else if (k === 'rotFloat') {
      fl.rot = st.r0 + (Math.atan2(y - fl.cy, x - fl.cx) - st.a0);
      requestRender();
    }
  }
  function toolEnd() {
    var k = st.kind;
    if (k === 'stroke') {
      var p = st.pts, n = p.length;
      if (n >= 2) {
        var m = mid(p[n - 2], p[n - 1]), sc2 = st.ctx;
        eachSym(sc2, function () { sc2.beginPath(); sc2.moveTo(m[0], m[1]); sc2.lineTo(p[n - 1][0], p[n - 1][1]); sc2.stroke(); });
      }
      st.ctx.restore();
      if (!st.erase) commitStroke(st.alpha);
      afterEdit();
    } else if (k === 'stamp') {
      st.ctx.restore();
      commitStroke(st.alpha);
      afterEdit();
    } else if (k === 'shape') {
      commitStroke(st.alpha);
      afterEdit();
    } else if (k === 'lasso') {
      var lpts = st.pts;
      if (lpts.length >= 3) {
        var bx0 = S.w, by0 = S.h, bx1 = 0, by1 = 0;
        for (var li = 0; li < lpts.length; li++) {
          bx0 = Math.min(bx0, lpts[li][0]); by0 = Math.min(by0, lpts[li][1]);
          bx1 = Math.max(bx1, lpts[li][0]); by1 = Math.max(by1, lpts[li][1]);
        }
        var lx = Math.floor(bx0), ly = Math.floor(by0);
        var lw = Math.min(S.w, Math.ceil(bx1)) - lx, lh = Math.min(S.h, Math.ceil(by1)) - ly;
        if (lw >= 3 && lh >= 3) liftRect({ x: lx, y: ly, w: lw, h: lh }, lpts);
      }
      requestRender();
    } else if (k === 'selRect') {
      var r = selRect;
      selRect = null;
      if (r && r.w >= 3 && r.h >= 3) liftRect(r);
      requestRender();
    } else {
      requestRender();
    }
    st = { active: false };
  }
  // Stabilizer: the drawn point trails the pointer (exponential smoothing); higher amount = more lag and smoother lines.
  function stabFollow() { return 1 - Math.min(0.92, T.stab / 100 * 0.92); }
  function stabActive() { return T.stab > 0 && st.sm && (st.kind === 'stroke' || st.kind === 'stamp'); }
  function inputDown(cx, cy) {
    if (playing) { stopPlay(); return; }
    var p = toCanvas(cx, cy);
    toolBegin(p[0], p[1], cx, cy);
    if (st.active) { st.sm = [p[0], p[1]]; st.raw = [p[0], p[1]]; }
  }
  function inputMove(cx, cy) {
    if (!st.active) return;
    var p = toCanvas(cx, cy);
    if (stabActive()) {
      var f = stabFollow();
      st.raw = p;
      st.sm = [st.sm[0] + (p[0] - st.sm[0]) * f, st.sm[1] + (p[1] - st.sm[1]) * f];
      toolMove(st.sm[0], st.sm[1], cx, cy);
    } else {
      toolMove(p[0], p[1], cx, cy);
    }
  }
  function inputUp() {
    if (!st.active) return;
    if (stabActive() && st.raw) { // let the line catch up with where the finger actually ended
      var f = stabFollow(), n = 0;
      while (n++ < 40) {
        var dx = st.raw[0] - st.sm[0], dy = st.raw[1] - st.sm[1];
        if (dx * dx + dy * dy < 0.36) break;
        st.sm = [st.sm[0] + dx * f, st.sm[1] + dy * f];
        toolMove(st.sm[0], st.sm[1], 0, 0);
      }
      toolMove(st.raw[0], st.raw[1], 0, 0);
    }
    toolEnd();
  }

  // ---------- frames ----------
  function updateFrameInfo() {
    var f = curFrame();
    $('frameInfo').textContent = 'Frame ' + (S.cur + 1) + '/' + S.frames.length + (f.hold > 1 ? ' \u00b7 hold ' + f.hold : '') + ' \u00b7 ' + S.w + '\u00d7' + S.h;
  }
  function afterStruct() {
    rebuildStrip();
    updateFrameInfo();
    requestRender();
    markDirty();
  }
  function gotoFrame(i) {
    i = clamp(i, 0, S.frames.length - 1);
    if (i === S.cur) return;
    commitFloat();
    S.cur = i;
    updateStripActive(true);
    updateFrameInfo();
    render();
  }
  function addFrame() {
    commitFloat();
    S.frames.splice(S.cur + 1, 0, newFrame());
    S.cur++;
    afterStruct();
  }
  function dupFrame() {
    commitFloat();
    var o = curFrame(), f = newFrame();
    S.layers.forEach(function (l) { f.cvs[l.id].getContext('2d').drawImage(o.cvs[l.id], 0, 0); });
    f.hold = o.hold;
    S.frames.splice(S.cur + 1, 0, f);
    S.cur++;
    afterStruct();
  }
  function delFrame() {
    commitFloat();
    if (S.frames.length < 2) { toast('Need at least one frame'); return; }
    if (!confirm('Delete frame ' + (S.cur + 1) + '? This cannot be undone.')) return;
    S.frames.splice(S.cur, 1);
    S.cur = clamp(S.cur, 0, S.frames.length - 1);
    afterStruct();
  }
  function moveFrame(d) {
    commitFloat();
    var i = S.cur, j = i + d;
    if (j < 0 || j >= S.frames.length) return;
    var t = S.frames[i]; S.frames[i] = S.frames[j]; S.frames[j] = t;
    S.cur = j;
    afterStruct();
  }
  function changeHold(d) {
    var f = curFrame();
    f.hold = clamp(f.hold + d, 1, 24);
    afterStruct();
  }

  var thumbH = 48;
  function rebuildStrip() {
    var strip = $('strip');
    strip.innerHTML = '';
    var tw = clamp(Math.round(thumbH * S.w / S.h), 24, 110);
    S.frames.forEach(function (f, i) {
      var d = el('div', 'thumb' + (i === S.cur ? ' on' : ''));
      var c = mk(tw, thumbH);
      c.style.width = Math.round(62 * tw / thumbH) + 'px';
      d.appendChild(c);
      d.appendChild(el('span', 'num', (i + 1) + (f.hold > 1 ? ' \u00d7' + f.hold : '')));
      d.addEventListener('click', function () { if (playing) stopPlay(); gotoFrame(i); });
      strip.appendChild(d);
      f._t = c;
      drawThumb(i);
    });
    updateStripActive(true);
  }
  function drawThumb(i) {
    var f = S.frames[i];
    if (!f || !f._t) return;
    var c = f._t, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = S.transparent ? x.createPattern(checkCv, 'repeat') : S.bg;
    x.fillRect(0, 0, c.width, c.height);
    x.save();
    x.scale(c.width / S.w, c.height / S.h);
    drawLayersOf(x, f, false);
    x.restore();
  }
  function updateStripActive(scroll) {
    var strip = $('strip'), kids = strip.children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i === S.cur);
    if (scroll && kids[S.cur]) {
      var e = kids[S.cur];
      if (e.offsetLeft < strip.scrollLeft) strip.scrollLeft = e.offsetLeft - 6;
      else if (e.offsetLeft + e.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = e.offsetLeft + e.offsetWidth - strip.clientWidth + 6;
    }
    var f = curFrame();
    if (f) updateFrameInfo();
  }

  // ---------- layers ----------
  function rebuildLayers() {
    var box = $('layers');
    box.innerHTML = '';
    for (var i = S.layers.length - 1; i >= 0; i--) {
      (function (i) {
        var l = S.layers[i];
        var row = el('div', 'lrow' + (i === S.li ? ' on' : ''));
        var eye = el('button', '', l.visible ? '\u25c9' : '\u25cb');
        eye.addEventListener('click', function (e) {
          e.stopPropagation();
          l.visible = !l.visible;
          rebuildLayers(); refreshThumbs(); requestRender(); markDirty();
        });
        var nm = el('span', 'lname', l.name);
        var lock = el('button', '', l.locked ? '\uD83D\uDD12' : '\uD83D\uDD13');
        lock.addEventListener('click', function (e) {
          e.stopPropagation();
          l.locked = !l.locked;
          rebuildLayers(); markDirty();
        });
        row.appendChild(eye); row.appendChild(nm); row.appendChild(lock);
        row.addEventListener('click', function () { selectLayer(i); });
        box.appendChild(row);
      })(i);
    }
    $('lopacity').value = Math.round(curLayer().opacity * 100);
  }
  function refreshThumbs() { for (var i = 0; i < S.frames.length; i++) drawThumb(i); }
  function selectLayer(i) {
    if (i === S.li) return;
    commitFloat();
    S.li = i;
    rebuildLayers();
  }
  function addLayer() {
    commitFloat();
    var l = newLayerObj('Layer ' + (S.layers.length + 1));
    S.layers.splice(S.li + 1, 0, l);
    S.frames.forEach(function (f) { f.cvs[l.id] = mk(S.w, S.h); });
    S.li++;
    rebuildLayers(); requestRender(); markDirty();
  }
  function dupLayer() {
    commitFloat();
    var o = curLayer();
    var l = newLayerObj(o.name + ' copy');
    l.opacity = o.opacity;
    S.layers.splice(S.li + 1, 0, l);
    S.frames.forEach(function (f) {
      var c = mk(S.w, S.h);
      c.getContext('2d').drawImage(f.cvs[o.id], 0, 0);
      f.cvs[l.id] = c;
    });
    S.li++;
    rebuildLayers(); refreshThumbs(); requestRender(); markDirty();
  }
  function delLayer() {
    commitFloat();
    if (S.layers.length < 2) { toast('Need at least one layer'); return; }
    if (!confirm('Delete layer "' + curLayer().name + '" from ALL frames?')) return;
    var l = curLayer();
    S.frames.forEach(function (f) { delete f.cvs[l.id]; });
    S.layers.splice(S.li, 1);
    S.li = clamp(S.li, 0, S.layers.length - 1);
    rebuildLayers(); refreshThumbs(); requestRender(); markDirty();
  }
  function moveLayer(d) {
    commitFloat();
    var i = S.li, j = i + d;
    if (j < 0 || j >= S.layers.length) return;
    var t = S.layers[i]; S.layers[i] = S.layers[j]; S.layers[j] = t;
    S.li = j;
    rebuildLayers(); refreshThumbs(); requestRender(); markDirty();
  }
  function renameLayer() {
    var n = prompt('Layer name', curLayer().name);
    if (n && n.trim()) { curLayer().name = n.trim().slice(0, 24); rebuildLayers(); markDirty(); }
  }

  // ---------- playback ----------
  function startPlay() {
    commitFloat();
    if (S.frames.length < 2) { toast('Add more frames first'); return; }
    playing = true;
    $('btnPlay').textContent = '\u275a\u275a';
    $('btnPlay').classList.add('on');
    var idx = S.cur;
    (function tick() {
      if (!playing) return;
      S.cur = idx;
      updateStripActive(true);
      render();
      var delay = 1000 / S.fps * S.frames[idx].hold;
      idx++;
      if (idx >= S.frames.length) {
        if (S.loop) idx = 0;
        else { playTimer = setTimeout(stopPlay, delay); return; }
      }
      playTimer = setTimeout(tick, delay);
    })();
  }
  function stopPlay() {
    playing = false;
    clearTimeout(playTimer);
    $('btnPlay').textContent = '\u25b6';
    $('btnPlay').classList.remove('on');
    if (S.frames.length && S.frames[S.cur]) { updateStripActive(true); render(); }
  }
  function togglePlay() { if (playing) stopPlay(); else startPlay(); }

  // ---------- tween ----------
  var EASE = {
    linear: function (t) { return t; },
    easein: function (t) { return t * t; },
    easeout: function (t) { return 1 - (1 - t) * (1 - t); },
    easeinout: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  };
  function bboxOf(cv) {
    var w = cv.width, h = cv.height;
    var d = cv.getContext('2d').getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function makeTween(n, dx, dy, rot, scaleEnd, ease) {
    commitFloat();
    var src = curFrame(), lay = curLayer();
    var bb = bboxOf(src.cvs[lay.id]);
    if (!bb) { toast('The active layer is empty on this frame'); return; }
    var cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    var out = [];
    for (var i = 1; i <= n; i++) {
      var t = EASE[ease](i / n);
      var f = newFrame();
      f.hold = src.hold;
      for (var k = 0; k < S.layers.length; k++) {
        var l = S.layers[k], dst = f.cvs[l.id].getContext('2d');
        if (l.id !== lay.id) {
          dst.drawImage(src.cvs[l.id], 0, 0);
        } else {
          var sc = 1 + (scaleEnd / 100 - 1) * t;
          dst.save();
          dst.translate(cx + dx * t, cy + dy * t);
          dst.rotate(rot * t * Math.PI / 180);
          dst.scale(sc, sc);
          dst.translate(-cx, -cy);
          dst.drawImage(src.cvs[l.id], 0, 0);
          dst.restore();
        }
      }
      out.push(f);
    }
    S.frames.splice.apply(S.frames, [S.cur + 1, 0].concat(out));
    S.cur++;
    afterStruct();
    toast(n + ' frames added');
  }
  function tweenDialog() {
    commitFloat();
    var html =
      '<p style="margin:0 0 8px;color:#bbb;font-size:13px">Moves, rotates and scales the <b>active layer</b> of this frame over new in-between frames. Other layers stay where they are.</p>' +
      '<label>New frames <input id="twN" type="number" min="1" max="60" value="8"></label>' +
      '<label>Move X (px) <input id="twX" type="number" value="120"></label>' +
      '<label>Move Y (px) <input id="twY" type="number" value="0"></label>' +
      '<label>Rotate (deg) <input id="twR" type="number" value="0"></label>' +
      '<label>End size (%) <input id="twS" type="number" min="5" max="500" value="100"></label>' +
      '<label>Easing <select id="twE"><option value="linear">Linear</option><option value="easein">Ease in</option><option value="easeout">Ease out</option><option value="easeinout">Ease in-out</option></select></label>';
    modal('Motion tween', html, [
      { label: 'Cancel' },
      { label: 'Create', primary: true, fn: function () {
        var n = clamp(parseInt($('twN').value, 10) || 8, 1, 60);
        makeTween(n, parseFloat($('twX').value) || 0, parseFloat($('twY').value) || 0, parseFloat($('twR').value) || 0,
          clamp(parseFloat($('twS').value) || 100, 5, 500), $('twE').value);
      } }
    ]);
  }

  // ---------- modal ----------
  function modal(title, html, buttons, onOpen) {
    $('mTitle').textContent = title;
    $('mBody').innerHTML = html;
    var bar = $('mBtns');
    bar.innerHTML = '';
    (buttons || []).forEach(function (b) {
      var e = el('button', b.primary ? 'primary' : '', b.label);
      e.addEventListener('click', function () { if (!b.fn || b.fn() !== false) closeModal(); });
      bar.appendChild(e);
    });
    $('modal').className = 'show';
    if (onOpen) onOpen();
  }
  function closeModal() { $('modal').className = ''; }
  function modalOpen() { return $('modal').className === 'show'; }

  // ---------- new project dialog ----------
  var ARS = [
    { k: '16:9', a: 16, b: 9, n: 'YouTube, widescreen video' },
    { k: '9:16', a: 9, b: 16, n: 'Reels, Shorts, TikTok, Stories' },
    { k: '1:1', a: 1, b: 1, n: 'Instagram post, square' },
    { k: '4:5', a: 4, b: 5, n: 'Instagram portrait post' },
    { k: '4:3', a: 4, b: 3, n: 'Classic TV, tablet screens' },
    { k: '3:4', a: 3, b: 4, n: 'Portrait, poster' },
    { k: '21:9', a: 21, b: 9, n: 'Cinematic, ultra-wide' },
    { k: 'Custom', a: 0, b: 0, n: 'Set your own width and height' }
  ];
  var SIZES = [
    { n: 'Small', L: 640, note: 'fastest, best for iPad mini 3' },
    { n: 'Medium', L: 960, note: 'balanced' },
    { n: 'Large', L: 1280, note: 'sharpest, uses the most memory' }
  ];
  function even(v) { return Math.max(16, Math.round(v / 2) * 2); }
  function dimsFor(ar, L) {
    if (ar.a >= ar.b) return [L, even(L * ar.b / ar.a)];
    return [even(L * ar.a / ar.b), L];
  }
  function newDialog(first) {
    var nd = { ar: 0, sz: 0 };
    var html =
      '<div class="row"><b>Aspect ratio</b><div class="chips" id="arChips"></div></div>' +
      '<div class="row" id="szRow"><b>Quality</b><div class="chips" id="szChips"></div></div>' +
      '<div class="row" id="customRow" style="display:none"><b>Custom size</b>' +
      '<input id="cw" type="number" min="64" max="1920" value="640"> &times; <input id="chh" type="number" min="64" max="1920" value="360"> px</div>' +
      '<div class="info" id="arInfo"></div>' +
      '<div class="row"><b>Frame rate</b><input id="nfps" type="number" min="1" max="30" value="12"> frames per second</div>' +
      '<div class="row"><b>Background</b><select id="nbg"><option value="#ffffff">White</option><option value="#fdf6e3">Paper</option>' +
      '<option value="#111111">Black</option><option value="transparent">Transparent</option></select></div>';
    function curDims() {
      var ar = ARS[nd.ar];
      if (!ar.a) return [clamp(parseInt($('cw').value, 10) || 640, 64, 1920), clamp(parseInt($('chh').value, 10) || 360, 64, 1920)];
      return dimsFor(ar, SIZES[nd.sz].L);
    }
    function refresh() {
      var ar = ARS[nd.ar], d = curDims();
      var chips = $('arChips').children, i;
      for (i = 0; i < chips.length; i++) chips[i].className = i === nd.ar ? 'on' : '';
      chips = $('szChips').children;
      for (i = 0; i < chips.length; i++) chips[i].className = i === nd.sz ? 'on' : '';
      $('szRow').style.display = ar.a ? 'block' : 'none';
      $('customRow').style.display = ar.a ? 'none' : 'block';
      var mb = (d[0] * d[1] * 4 / 1048576).toFixed(1);
      var g = (function (a, b) { while (b) { var t = b; b = a % b; a = t; } return a; })(d[0], d[1]);
      var ratio = ar.a ? ar.k : (d[0] / g) + ':' + (d[1] / g);
      var warn = (d[0] * d[1] > 1000000) ? '<br><small>Big canvas: each layer of each frame takes ' + mb + ' MB. On iPad mini 3 keep it to Small or Medium.</small>'
        : '<br><small>About ' + mb + ' MB per layer per frame.</small>';
      $('arInfo').innerHTML = '<b>' + ratio + '</b> &middot; <b>' + d[0] + ' &times; ' + d[1] + ' px</b><br>' +
        (ar.a ? ar.n + ' &middot; ' + SIZES[nd.sz].n + ' (' + SIZES[nd.sz].note + ')' : ar.n) + warn;
    }
    modal(first ? 'Choose your canvas' : 'New animation', html, [
      { label: first ? 'Use default' : 'Cancel' },
      { label: 'Create', primary: true, fn: function () {
        if (!first && !confirm('Start a new animation? Your current one will be replaced.')) return false;
        var d = curDims();
        var bg = $('nbg').value;
        initProject(d[0], d[1], clamp(parseInt($('nfps').value, 10) || 12, 1, 30), bg === 'transparent' ? '#ffffff' : bg, bg === 'transparent');
      } }
    ], function () {
      ARS.forEach(function (ar, i) {
        var b = el('button', '', ar.k);
        b.addEventListener('click', function () { nd.ar = i; refresh(); });
        $('arChips').appendChild(b);
      });
      SIZES.forEach(function (s, i) {
        var b = el('button', '', s.n + ' ' + s.L);
        b.addEventListener('click', function () { nd.sz = i; refresh(); });
        $('szChips').appendChild(b);
      });
      $('cw').addEventListener('input', refresh);
      $('chh').addEventListener('input', refresh);
      refresh();
    });
  }

  // ---------- export ----------
  function flat(f, scale, keepAlpha) {
    var c = mk(Math.round(S.w * scale), Math.round(S.h * scale));
    var x = c.getContext('2d');
    if (!(S.transparent && keepAlpha)) {
      x.fillStyle = S.transparent ? '#ffffff' : S.bg;
      x.fillRect(0, 0, c.width, c.height);
    }
    x.save();
    x.scale(scale, scale);
    drawLayersOf(x, f, false);
    x.restore();
    return c;
  }
  function dataUrlBytes(u) {
    var b = atob(u.split(',')[1]), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function deliver(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    if (canDownload) {
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      closeModal();
      toast('Saved ' + name);
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } else {
      var isImg = /^image\//.test(blob.type);
      modal('Export ready',
        '<p>Tap <b>Open</b>, then ' + (isImg ? 'press and hold the image and choose <b>Add to Photos</b> (or Save Image).' : 'choose where to open or save the file.') + '</p>' +
        (isImg ? '<img class="prev" src="' + url + '">' : ''),
        [{ label: 'Close' }, { label: 'Open', primary: true, fn: function () { window.open(url, '_blank'); return false; } }]);
    }
  }
  function progressModal(title) {
    modal(title, '<div id="pbar"><div id="pfill"></div></div><p id="ptxt" style="color:#aaa;font-size:13px">Working&hellip;</p>', []);
    return function (p, txt) { $('pfill').style.width = Math.round(p * 100) + '%'; if (txt) $('ptxt').textContent = txt; };
  }
  function exportDialog() {
    commitFloat(); stopPlay();
    var html =
      '<div class="row"><b>Format</b><select id="exFmt">' +
      '<option value="gif">Animated GIF</option>' +
      '<option value="zip">PNG sequence (.zip)</option>' +
      '<option value="sheet">Sprite sheet (PNG)</option>' +
      '<option value="png">Current frame (PNG)</option></select></div>' +
      '<div class="row"><b>Size</b><select id="exScale"><option value="1">1&times; (' + S.w + ' &times; ' + S.h + ')</option>' +
      '<option value="0.5">0.5&times; (' + Math.round(S.w / 2) + ' &times; ' + Math.round(S.h / 2) + ')</option>' +
      '<option value="2">2&times; (' + S.w * 2 + ' &times; ' + S.h * 2 + ')</option></select></div>' +
      '<div class="info">GIF uses your FPS and per-frame holds' + (S.transparent ? ' and keeps transparency' : '') + '. On iPad, files open in a new tab to save from.</div>';
    modal('Export', html, [
      { label: 'Cancel' },
      { label: 'Export', primary: true, fn: function () {
        var fmt = $('exFmt').value, sc = parseFloat($('exScale').value);
        setTimeout(function () { runExport(fmt, sc); }, 30);
      } }
    ]);
  }
  function runExport(fmt, sc) {
    var w = Math.round(S.w * sc), h = Math.round(S.h * sc), n = S.frames.length, i;
    if (w * h > 16000000) { toast('That size is too large'); return; }
    var prog;
    if (fmt === 'png') {
      flat(curFrame(), sc, true).toBlob(function (b) { deliver(b, 'frame-' + (S.cur + 1) + '.png'); }, 'image/png');
      return;
    }
    if (fmt === 'gif') {
      prog = progressModal('Encoding GIF');
      GifTools.encodeGif({
        w: w, h: h, count: n, transparent: S.transparent, loop: S.loop ? 0 : 1,
        get: function (k) {
          var c = flat(S.frames[k], sc, true);
          return { data: c.getContext('2d').getImageData(0, 0, w, h).data, delay: Math.max(2, Math.round(100 / S.fps * S.frames[k].hold)) };
        }
      }, function (p) { prog(p, 'Frame ' + Math.min(n, Math.ceil(p * 2 * n) % (n + 1)) + ' of ' + n); },
      function (bytes) { deliver(new Blob([bytes], { type: 'image/gif' }), 'animation.gif'); });
      return;
    }
    if (fmt === 'zip') {
      prog = progressModal('Building ZIP');
      var files = [];
      i = 0;
      (function step() {
        if (i >= n) {
          var z = GifTools.makeZip(files);
          return deliver(new Blob([z], { type: 'application/zip' }), 'frames.zip');
        }
        var c = flat(S.frames[i], sc, true);
        var num = String(i + 1); while (num.length < 3) num = '0' + num;
        files.push({ name: 'frame_' + num + '.png', data: dataUrlBytes(c.toDataURL('image/png')) });
        i++;
        prog(i / n, 'Frame ' + i + ' of ' + n);
        setTimeout(step, 0);
      })();
      return;
    }
    if (fmt === 'sheet') {
      var cols = n <= 6 ? n : Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      if (cols * w * rows * h > 16000000) { toast('Sheet would be too large; pick a smaller size'); return; }
      var sheet = mk(cols * w, rows * h), sx = sheet.getContext('2d');
      for (i = 0; i < n; i++) sx.drawImage(flat(S.frames[i], sc, true), (i % cols) * w, Math.floor(i / cols) * h);
      sheet.toBlob(function (b) { deliver(b, 'spritesheet-' + cols + 'x' + rows + '.png'); }, 'image/png');
    }
  }

  // ---------- save / load / autosave ----------
  function serialize() {
    return JSON.stringify({
      v: 1, w: S.w, h: S.h, fps: S.fps, bg: S.bg, transparent: S.transparent, loop: S.loop,
      layers: S.layers.map(function (l) { return { name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity }; }),
      frames: S.frames.map(function (f) {
        return { hold: f.hold, data: S.layers.map(function (l) { return f.cvs[l.id].toDataURL('image/png'); }) };
      })
    });
  }
  function loadProject(text) {
    return new Promise(function (resolve, reject) {
      var o;
      try { o = JSON.parse(text); } catch (e) { return reject(e); }
      if (!o || !o.frames || !o.layers || !o.w || !o.h) return reject(new Error('bad file'));
      stopPlay();
      S.w = o.w; S.h = o.h; S.fps = o.fps || 12; S.bg = o.bg || '#ffffff'; S.transparent = !!o.transparent; S.loop = o.loop !== false;
      S.nid = 1; S.frames = [];
      S.layers = o.layers.map(function (l) {
        return { id: S.nid++, name: l.name || 'Layer', visible: l.visible !== false, locked: !!l.locked, opacity: typeof l.opacity === 'number' ? l.opacity : 1 };
      });
      var jobs = [];
      o.frames.forEach(function (fo) {
        var f = { id: S.nid++, hold: fo.hold || 1, cvs: {} };
        S.layers.forEach(function (l, i) {
          var c = mk(S.w, S.h);
          f.cvs[l.id] = c;
          var src = fo.data && fo.data[i];
          if (src) jobs.push(new Promise(function (r) {
            var im = new Image();
            im.onload = function () { c.getContext('2d').drawImage(im, 0, 0); r(); };
            im.onerror = function () { r(); };
            im.src = src;
          }));
        });
        S.frames.push(f);
      });
      if (!S.frames.length) S.frames.push(newFrame());
      Promise.all(jobs).then(function () { finishInit(); resolve(); });
    });
  }
  function saveProjectFile() {
    commitFloat(); stopPlay();
    deliver(new Blob([serialize()], { type: 'application/json' }), 'animation.flipbook.json');
  }

  var dbHandle = null;
  function idb(cb) {
    if (dbHandle) return cb(null, dbHandle);
    try {
      var rq = indexedDB.open('flipbook-studio', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { dbHandle = rq.result; cb(null, dbHandle); };
      rq.onerror = function () { cb(rq.error); };
    } catch (e) { cb(e); }
  }
  function idbSet(k, v) {
    idb(function (err, db) {
      if (err) return;
      try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { /* ignore */ }
    });
  }
  function idbGet(k, cb) {
    idb(function (err, db) {
      if (err) return cb(null);
      try {
        var r = db.transaction('kv').objectStore('kv').get(k);
        r.onsuccess = function () { cb(r.result || null); };
        r.onerror = function () { cb(null); };
      } catch (e) { cb(null); }
    });
  }
  function markDirty() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 2500);
  }
  function autosave() {
    if (!dirty) return;
    if (playing || st.active || fl) { saveTimer = setTimeout(autosave, 2500); return; }
    try { idbSet('autosave', serialize()); dirty = false; } catch (e) { /* ignore */ }
  }

  // ---------- colour UI ----------
  var SWATCHES = ['#000000', '#444444', '#888888', '#cccccc', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#32ade6', '#007aff',
    '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#7f1d1d', '#14532d', '#1e3a8a', '#78350f', '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
  function setColor(hex, fromSliders) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    T.color = hex.toLowerCase();
    $('colorPrev').style.background = T.color;
    $('hex').value = T.color;
    if (!fromSliders) {
      var rgb = hexToRgb(T.color), hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      $('hH').value = hsl[0]; $('hS').value = hsl[1]; $('hL').value = hsl[2];
    }
  }
  function slidersToColor() {
    var rgb = hslToRgb(+$('hH').value, +$('hS').value, +$('hL').value);
    setColor(rgbToHex(rgb[0], rgb[1], rgb[2]), true);
  }

  // ---------- UI wiring ----------
  var TOOLS = [
    ['pen', '\u2712', 'Pen'], ['pencil', '\u270F', 'Pencil'], ['marker', '\uD83D\uDD8D', 'Marker'], ['airbrush', '\u2601', 'Airbrush'],
    ['charcoal', '\u2592', 'Charcoal'], ['eraser', '\u232B', 'Erase'], ['fill', '\u25E7', 'Fill'],
    ['line', '\u2571', 'Line'], ['rect', '\u25AD', 'Rect'], ['oval', '\u25EF', 'Oval'], ['select', '\u2610', 'Select'],
    ['lasso', '\u25CC', 'Lasso'], ['pick', '\uD83D\uDCA7', 'Pick'], ['hand', '\u270B', 'Hand']
  ];
  function buildUI() {
    var tb = $('toolbar');
    TOOLS.forEach(function (t) {
      var b = el('button', 'tool');
      b.setAttribute('data-tool', t[0]);
      b.innerHTML = '<b>' + t[1] + '</b>' + t[2];
      b.addEventListener('click', function () { setTool(t[0]); });
      tb.appendChild(b);
    });
    var sw = $('swatches');
    SWATCHES.forEach(function (c) {
      var d = el('div', 'sw');
      d.style.background = c;
      d.addEventListener('click', function () { setColor(c, false); });
      sw.appendChild(d);
    });
    setTool('pen');
    setColor('#222222', false);

    $('hex').addEventListener('input', function () {
      var v = this.value;
      if (v.charAt(0) !== '#') v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v, false);
    });
    ['hH', 'hS', 'hL'].forEach(function (id) { $(id).addEventListener('input', slidersToColor); });
    $('size').addEventListener('input', function () { setSize(+this.value); });
    $('opacity').addEventListener('input', function () { T.opacity = +this.value; $('opVal').textContent = this.value; });
    $('stab').addEventListener('input', function () { T.stab = +this.value; $('stabVal').textContent = this.value; });
    $('symMode').addEventListener('change', function () {
      T.sym = this.value;
      $('symMirrorRow').style.display = T.sym.charAt(0) === 'r' ? 'block' : 'none';
      requestRender();
    });
    $('symMirror').addEventListener('change', function () { T.symMirror = this.checked; });
    $('symGuides').addEventListener('change', function () { T.symGuides = this.checked; requestRender(); });
    $('tol').addEventListener('input', function () { T.tol = +this.value; });
    $('fillAll').addEventListener('change', function () { T.fillAll = this.checked; });
    $('shapeFill').addEventListener('change', function () { T.shapeFill = this.checked; });

    $('btnNew').addEventListener('click', function () { commitFloat(); stopPlay(); newDialog(false); });
    $('btnOpen').addEventListener('click', function () { $('fileOpen').click(); });
    $('fileOpen').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { loadProject(rd.result).then(function () { toast('Opened ' + f.name); }).catch(function () { toast('That file could not be opened'); }); };
      rd.readAsText(f);
      this.value = '';
    });
    $('btnSave').addEventListener('click', saveProjectFile);
    $('btnExport').addEventListener('click', exportDialog);
    $('btnUndo').addEventListener('click', function () { doUndo(false); });
    $('btnRedo').addEventListener('click', function () { doUndo(true); });
    $('btnZoomIn').addEventListener('click', function () { zoomAtStage(stage.clientWidth / 2, stage.clientHeight / 2, V.zoom * 1.25); });
    $('btnZoomOut').addEventListener('click', function () { zoomAtStage(stage.clientWidth / 2, stage.clientHeight / 2, V.zoom / 1.25); });
    $('btnFit').addEventListener('click', fitView);
    $('btnGrid').addEventListener('click', function () { S.grid = !S.grid; this.classList.toggle('on', S.grid); requestRender(); });
    $('btnPanel').addEventListener('click', function () {
      var s = $('side');
      s.classList.toggle('hidden');
      setTimeout(fitView, 30);
    });

    $('btnRotL').addEventListener('click', function () { xform(function () { fl.rot -= Math.PI / 12; }); });
    $('btnRotR').addEventListener('click', function () { xform(function () { fl.rot += Math.PI / 12; }); });
    $('btnScaleDn').addEventListener('click', function () { xform(function () { fl.sc = Math.max(0.05, fl.sc / 1.1); }); });
    $('btnScaleUp').addEventListener('click', function () { xform(function () { fl.sc = Math.min(20, fl.sc * 1.1); }); });
    $('btnFlipH').addEventListener('click', function () { xform(function () { fl.rot = -fl.rot; fl.sx = -fl.sx; }); });
    $('btnFlipV').addEventListener('click', function () { xform(function () { fl.rot = -fl.rot; fl.sy = -fl.sy; }); });
    $('btnCopy').addEventListener('click', copySel);
    $('btnPaste').addEventListener('click', pasteClip);
    $('btnImport').addEventListener('click', function () { $('fileImg').click(); });
    $('fileImg').addEventListener('change', function () { if (this.files && this.files[0]) importImage(this.files[0]); this.value = ''; });
    $('btnCommit').addEventListener('click', commitFloat);
    $('btnDelSel').addEventListener('click', deleteSel);

    $('btnLAdd').addEventListener('click', addLayer);
    $('btnLDup').addEventListener('click', dupLayer);
    $('btnLDel').addEventListener('click', delLayer);
    $('btnLUp').addEventListener('click', function () { moveLayer(1); });
    $('btnLDown').addEventListener('click', function () { moveLayer(-1); });
    $('btnLRename').addEventListener('click', renameLayer);
    $('lopacity').addEventListener('input', function () { curLayer().opacity = +this.value / 100; requestRender(); });
    $('lopacity').addEventListener('change', function () { refreshThumbs(); markDirty(); });

    $('btnPrev').addEventListener('click', function () { if (playing) stopPlay(); gotoFrame(S.cur - 1); });
    $('btnNext').addEventListener('click', function () { if (playing) stopPlay(); gotoFrame(S.cur + 1); });
    $('btnPlay').addEventListener('click', togglePlay);
    $('fps').addEventListener('change', function () { S.fps = clamp(parseInt(this.value, 10) || 12, 1, 30); this.value = S.fps; markDirty(); });
    $('loop').addEventListener('change', function () { S.loop = this.checked; markDirty(); });
    $('onion').addEventListener('change', function () { S.onion = +this.value; requestRender(); });
    $('btnFAdd').addEventListener('click', addFrame);
    $('btnFDup').addEventListener('click', dupFrame);
    $('btnFDel').addEventListener('click', delFrame);
    $('btnFLeft').addEventListener('click', function () { moveFrame(-1); });
    $('btnFRight').addEventListener('click', function () { moveFrame(1); });
    $('btnHoldDn').addEventListener('click', function () { changeHold(-1); });
    $('btnHoldUp').addEventListener('click', function () { changeHold(1); });
    $('btnTween').addEventListener('click', tweenDialog);

    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && (t.type === 'range' || t.type === 'checkbox' || t.tagName === 'SELECT')) t.blur();
    });
  }

  // ----- touch + mouse on the stage -----
  var touchMode = null, g = {};
  function stagePt(cx, cy) { var r = stage.getBoundingClientRect(); return [cx - r.left, cy - r.top]; }
  function startGesture(e) {
    var a = e.touches[0], b = e.touches[1];
    var m = stagePt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    g.d0 = Math.max(1, Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2)));
    g.z0 = V.zoom;
    g.cp = [(m[0] - V.px) / V.zoom, (m[1] - V.py) / V.zoom];
  }
  stage.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length === 1 && touchMode === null) {
      touchMode = 'draw';
      inputDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length >= 2) {
      if (touchMode === 'draw') cancelStroke();
      touchMode = 'gesture';
      startGesture(e);
    }
  }, { passive: false });
  stage.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (touchMode === 'gesture' && e.touches.length >= 2) {
      var a = e.touches[0], b = e.touches[1];
      var d = Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2));
      var m = stagePt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      V.zoom = clamp(g.z0 * d / g.d0, 0.1, 16);
      V.px = m[0] - g.cp[0] * V.zoom;
      V.py = m[1] - g.cp[1] * V.zoom;
      applyView();
    } else if (touchMode === 'draw' && e.touches.length === 1) {
      inputMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  function touchEnd(e) {
    e.preventDefault();
    if (e.touches.length === 0) {
      if (touchMode === 'draw') inputUp();
      touchMode = null;
    } else if (touchMode === 'gesture' && e.touches.length < 2) {
      touchMode = 'ignore';
    }
  }
  stage.addEventListener('touchend', touchEnd, { passive: false });
  stage.addEventListener('touchcancel', function (e) {
    e.preventDefault();
    if (touchMode === 'draw') cancelStroke();
    if (e.touches.length === 0) touchMode = null;
  }, { passive: false });

  var mouseDown = false;
  stage.addEventListener('mousedown', function (e) {
    e.preventDefault();
    if (e.button === 1) {
      st = { active: true, kind: 'pan', sx: e.clientX, sy: e.clientY, px: V.px, py: V.py };
      mouseDown = true;
      return;
    }
    if (e.button !== 0) return;
    mouseDown = true;
    inputDown(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', function (e) { if (mouseDown) inputMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', function () { if (mouseDown) { mouseDown = false; inputUp(); } });
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = stagePt(e.clientX, e.clientY);
    zoomAtStage(p[0], p[1], V.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  // ----- keyboard -----
  document.addEventListener('keydown', function (e) {
    var tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
    if (modalOpen()) return;
    var k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      if (k === 'z' || k === 'Z') { e.preventDefault(); doUndo(e.shiftKey); }
      else if (k === 'y') { e.preventDefault(); doUndo(true); }
      else if (k === 'c') { e.preventDefault(); copySel(); }
      else if (k === 'v') { e.preventDefault(); pasteClip(); }
      else if (k === 's') { e.preventDefault(); saveProjectFile(); }
      return;
    }
    switch (k) {
      case 'b': setTool('pen'); break;
      case 'p': setTool('pencil'); break;
      case 'm': setTool('marker'); break;
      case 'a': setTool('airbrush'); break;
      case 'c': setTool('charcoal'); break;
      case 'q': setTool('lasso'); break;
      case 'e': setTool('eraser'); break;
      case 'g': setTool('fill'); break;
      case 'l': setTool('line'); break;
      case 'r': setTool('rect'); break;
      case 'o': setTool('oval'); break;
      case 'v': setTool('select'); break;
      case 'i': setTool('pick'); break;
      case 'h': setTool('hand'); break;
      case '[': setSize(T.size - 2); break;
      case ']': setSize(T.size + 2); break;
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); if (playing) stopPlay(); gotoFrame(S.cur - 1); break;
      case 'ArrowRight': e.preventDefault(); if (playing) stopPlay(); gotoFrame(S.cur + 1); break;
      case 'n': addFrame(); break;
      case 'd': dupFrame(); break;
      case 'Enter': commitFloat(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSel(); break;
      case '+': case '=': zoomAtStage(stage.clientWidth / 2, stage.clientHeight / 2, V.zoom * 1.25); break;
      case '-': zoomAtStage(stage.clientWidth / 2, stage.clientHeight / 2, V.zoom / 1.25); break;
      case '0': fitView(); break;
    }
  });

  var resizeTimer = null;
  function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitView, 200); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', function () { if (document.hidden && !fl && !st.active) { dirty = true; autosave(); } });

  // ---------- start ----------
  buildUI();
  if (window.innerWidth < 700) $('side').classList.add('hidden');
  function startDefault() {
    initProject(640, 360, 12, '#ffffff', false);
    newDialog(true);
  }
  idbGet('autosave', function (txt) {
    if (txt) {
      loadProject(txt).then(function () { toast('Restored your last session'); }).catch(startDefault);
    } else {
      startDefault();
    }
  });
})();
