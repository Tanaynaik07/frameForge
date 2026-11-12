/* GIF + ZIP tools. ES5-style code so it runs on iOS 12 Safari. */
(function (root) {
  'use strict';

  var CH = ['r', 'g', 'b'];

  function analyze(box) {
    var mn = [255, 255, 255], mx = [0, 0, 0];
    for (var j = 0; j < box.length; j++) {
      var it = box[j];
      if (it.r < mn[0]) mn[0] = it.r;
      if (it.r > mx[0]) mx[0] = it.r;
      if (it.g < mn[1]) mn[1] = it.g;
      if (it.g > mx[1]) mx[1] = it.g;
      if (it.b < mn[2]) mn[2] = it.b;
      if (it.b > mx[2]) mx[2] = it.b;
    }
    var best = 0, ch = 0;
    for (var c = 0; c < 3; c++) {
      var rg = mx[c] - mn[c];
      if (rg > best) { best = rg; ch = c; }
    }
    box.rg = best;
    box.ch = ch;
  }

  // hist: counts per 15-bit colour; sums: [rSum, gSum, bSum] per 15-bit colour
  function buildPalette(hist, sums, max) {
    var items = [];
    for (var k = 0; k < hist.length; k++) {
      if (hist[k]) {
        items.push({
          r: sums[0][k] / hist[k],
          g: sums[1][k] / hist[k],
          b: sums[2][k] / hist[k],
          c: hist[k]
        });
      }
    }
    if (!items.length) items.push({ r: 0, g: 0, b: 0, c: 1 });
    analyze(items);
    var boxes = [items];
    while (boxes.length < max) {
      var bi = -1, best = 0, i;
      for (i = 0; i < boxes.length; i++) {
        if (boxes[i].length > 1 && boxes[i].rg > best) { best = boxes[i].rg; bi = i; }
      }
      if (bi < 0) break;
      var box = boxes[bi], key = CH[box.ch];
      box.sort(function (p, q) { return p[key] - q[key]; });
      var total = 0, n;
      for (n = 0; n < box.length; n++) total += box[n].c;
      var acc = 0, cut = 1;
      for (n = 0; n < box.length - 1; n++) {
        acc += box[n].c;
        cut = n + 1;
        if (acc >= total / 2) break;
      }
      var a = box.slice(0, cut), b = box.slice(cut);
      analyze(a);
      analyze(b);
      boxes.splice(bi, 1, a, b);
    }
    var pal = [];
    for (var q = 0; q < boxes.length; q++) {
      var bx = boxes[q], r = 0, g = 0, bl = 0, w = 0;
      for (var z = 0; z < bx.length; z++) {
        r += bx[z].r * bx[z].c;
        g += bx[z].g * bx[z].c;
        bl += bx[z].b * bx[z].c;
        w += bx[z].c;
      }
      pal.push([Math.round(r / w), Math.round(g / w), Math.round(bl / w)]);
    }
    return pal;
  }

  function lzwEncode(idx, minSize) {
    var clear = 1 << minSize, eoi = clear + 1;
    var next = eoi + 1, size = minSize + 1;
    var dict = new Map();
    var cur = 0, curBits = 0;
    var buf = [];
    function emit(code) {
      cur |= code << curBits;
      curBits += size;
      while (curBits >= 8) {
        buf.push(cur & 255);
        cur >>= 8;
        curBits -= 8;
      }
    }
    emit(clear);
    var prefix = idx[0];
    for (var i = 1; i < idx.length; i++) {
      var k = idx[i];
      var key = prefix * 256 + k;
      var v = dict.get(key);
      if (v !== undefined) {
        prefix = v;
      } else {
        emit(prefix);
        if (next < 4096) {
          if (next >= (1 << size)) size++;
          dict.set(key, next++);
        } else {
          emit(clear);
          dict.clear();
          next = eoi + 1;
          size = minSize + 1;
        }
        prefix = k;
      }
    }
    emit(prefix);
    emit(eoi);
    if (curBits > 0) buf.push(cur & 255);
    // wrap in sub-blocks
    var out = new Uint8Array(buf.length + Math.ceil(buf.length / 255) + 1);
    var o = 0;
    for (var p = 0; p < buf.length; p += 255) {
      var len = Math.min(255, buf.length - p);
      out[o++] = len;
      for (var j = 0; j < len; j++) out[o++] = buf[p + j];
    }
    out[o++] = 0;
    return out;
  }

  function u16(v) { return [v & 255, (v >> 8) & 255]; }

  /*
   * o = { w, h, count, transparent, get(i) -> {data: RGBA array, delay: centiseconds}, loop }
   * onProgress(0..1), onDone(Uint8Array)
   */
  function encodeGif(o, onProgress, onDone) {
    var w = o.w, h = o.h, n = o.count, hasT = !!o.transparent;
    var hist = new Float64Array(32768);
    var sums = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
    var i = 0;
    var step = Math.max(1, Math.floor(w * h * n / 3000000)) * 4;

    function pass1() {
      if (i >= n) { i = 0; return start2(); }
      var d = o.get(i).data;
      for (var p = 0; p < d.length; p += step) {
        if (d[p + 3] < 128) continue;
        var key = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
        hist[key]++;
        sums[0][key] += d[p];
        sums[1][key] += d[p + 1];
        sums[2][key] += d[p + 2];
      }
      i++;
      if (onProgress) onProgress(i / (n * 2));
      setTimeout(pass1, 0);
    }

    var pal, cache, parts = [], tIdx = 255;

    function nearest(r, g, b) {
      var best = 0, bd = 1e12;
      for (var q = 0; q < pal.length; q++) {
        var dr = pal[q][0] - r, dg = pal[q][1] - g, db = pal[q][2] - b;
        var dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = q; }
      }
      return best;
    }

    function start2() {
      pal = buildPalette(hist, sums, hasT ? 255 : 256);
      cache = new Int16Array(32768);
      for (var k = 0; k < 32768; k++) cache[k] = -1;
      var head = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
      head = head.concat(u16(w), u16(h), [0xF7, 0, 0]);
      for (var c = 0; c < 256; c++) {
        var e = pal[c] || [0, 0, 0];
        head.push(e[0], e[1], e[2]);
      }
      // NETSCAPE loop extension
      head = head.concat([0x21, 0xFF, 0x0B, 0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, 0x03, 0x01],
        u16(o.loop || 0), [0x00]);
      parts.push(new Uint8Array(head));
      pass2();
    }

    function pass2() {
      if (i >= n) {
        parts.push(new Uint8Array([0x3B]));
        var total = 0, q;
        for (q = 0; q < parts.length; q++) total += parts[q].length;
        var out = new Uint8Array(total), off = 0;
        for (q = 0; q < parts.length; q++) { out.set(parts[q], off); off += parts[q].length; }
        return onDone(out);
      }
      var fr = o.get(i), d = fr.data;
      var idx = new Uint8Array(w * h);
      for (var p = 0, px = 0; p < d.length; p += 4, px++) {
        if (hasT && d[p + 3] < 128) { idx[px] = tIdx; continue; }
        var key = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
        var v = cache[key];
        if (v < 0) { v = nearest(d[p], d[p + 1], d[p + 2]); cache[key] = v; }
        idx[px] = v;
      }
      var gce = [0x21, 0xF9, 0x04, ((hasT ? 2 : 1) << 2) | (hasT ? 1 : 0)].concat(u16(fr.delay), [hasT ? tIdx : 0, 0x00]);
      var desc = [0x2C, 0, 0, 0, 0].concat(u16(w), u16(h), [0x00, 8]);
      parts.push(new Uint8Array(gce.concat(desc)));
      parts.push(lzwEncode(idx, 8));
      i++;
      if (onProgress) onProgress(0.5 + i / (n * 2));
      setTimeout(pass2, 0);
    }

    pass1();
  }

  // ---- ZIP (store only) ----
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(files) {
    var dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    var locals = [], centrals = [], offset = 0, i;
    for (i = 0; i < files.length; i++) {
      var nameBytes = [];
      var nm = files[i].name;
      for (var c = 0; c < nm.length; c++) nameBytes.push(nm.charCodeAt(c) & 255);
      var data = files[i].data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      locals.push(lh, data);
      centrals.push(ch);
      offset += lh.length + data.length;
    }
    var cdSize = 0;
    for (i = 0; i < centrals.length; i++) cdSize += centrals[i].length;
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    var all = locals.concat(centrals, [end]);
    var total = 0;
    for (i = 0; i < all.length; i++) total += all[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < all.length; i++) { out.set(all[i], off); off += all[i].length; }
    return out;
  }

  var api = { encodeGif: encodeGif, makeZip: makeZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GifTools = api;
})(typeof window !== 'undefined' ? window : this);
