/**
 * Build client/public/logo-email.png: the transparent logo with a soft white
 * glow baked into the pixels, so it stands out on the coloured email headers
 * (email clients strip CSS box-shadow/filter, so the shadow must live in the
 * image itself). Also renders a test composite on the blue header gradient so
 * the result can be eyeballed (written to data/, git-ignored).
 *
 * Usage: node scripts/make-email-logo.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SCRATCH = path.join(__dirname, '..', 'data');

// ── Minimal PNG decode (8-bit RGBA only) ─────────────────────────────────────
function decodePng(buf) {
  let pos = 8; const idat = [];
  let w, h, ct;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (ct !== 6) throw new Error('expected 8-bit RGBA png');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[p + x];
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + left;
      else if (filter === 2) v = cur + up;
      else if (filter === 3) v = cur + ((left + up) >> 1);
      else {
        const pa = Math.abs(up - upLeft), pb = Math.abs(left - upLeft), pc = Math.abs(left + up - 2 * upLeft);
        v = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[y * stride + x] = v & 0xff;
    }
    p += stride;
  }
  return { w, h, px: out };
}

// ── Minimal PNG encode (filter 0 rows) ───────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Separable box blur on a float alpha map (3 passes ≈ gaussian) ────────────
function boxBlur(map, w, h, radius, passes) {
  let src = map;
  for (let pass = 0; pass < passes; pass++) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < h; y++) { // horizontal
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * radius + 1);
        const add = Math.min(w - 1, x + radius + 1), sub = Math.max(0, x - radius);
        sum += src[y * w + add] - src[y * w + sub];
      }
    }
    const dst = new Float32Array(src.length);
    for (let x = 0; x < w; x++) { // vertical
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = sum / (2 * radius + 1);
        const add = Math.min(h - 1, y + radius + 1), sub = Math.max(0, y - radius);
        sum += tmp[add * w + x] - tmp[sub * w + x];
      }
    }
    src = dst;
  }
  return src;
}

// ── Build ────────────────────────────────────────────────────────────────────
const PAD = 14;          // room for the glow to breathe
const GLOW_RADIUS = 5;   // box radius per pass
const GLOW_PASSES = 3;
const GLOW_STRENGTH = 2.2; // amplifies the blurred silhouette before clamping
const GLOW_MAX = 0.85;     // peak glow opacity

const logo = decodePng(fs.readFileSync(path.join(ROOT, 'client/public/logo.png')));
const W = logo.w + PAD * 2, H = logo.h + PAD * 2;

// Silhouette (padded alpha map, 0..1)
const sil = new Float32Array(W * H);
for (let y = 0; y < logo.h; y++)
  for (let x = 0; x < logo.w; x++)
    sil[(y + PAD) * W + (x + PAD)] = logo.px[(y * logo.w + x) * 4 + 3] / 255;

const glow = boxBlur(sil, W, H, GLOW_RADIUS, GLOW_PASSES);

// Compose: white glow underneath, logo on top (source-over)
const out = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const gi = y * W + x;
    const ga = Math.min(GLOW_MAX, glow[gi] * GLOW_STRENGTH);
    let r = 255, g = 255, b = 255, a = ga;
    const lx = x - PAD, ly = y - PAD;
    if (lx >= 0 && lx < logo.w && ly >= 0 && ly < logo.h) {
      const o = (ly * logo.w + lx) * 4;
      const la = logo.px[o + 3] / 255;
      if (la > 0) {
        const outA = la + a * (1 - la);
        r = (logo.px[o] * la + r * a * (1 - la)) / outA;
        g = (logo.px[o + 1] * la + g * a * (1 - la)) / outA;
        b = (logo.px[o + 2] * la + b * a * (1 - la)) / outA;
        a = outA;
      }
    }
    const oi = gi * 4;
    out[oi] = Math.round(r); out[oi + 1] = Math.round(g); out[oi + 2] = Math.round(b);
    out[oi + 3] = Math.round(a * 255);
  }
}
fs.writeFileSync(path.join(ROOT, 'client/public/logo-email.png'), encodePng(W, H, out));
console.log(`logo-email.png written: ${W}x${H}`);

// ── Test render on the blue fixed-quote header gradient ─────────────────────
const test = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (x / W + y / H) / 2; // approximate the 135deg #3b82f6 → #1d4ed8 gradient
    const br = Math.round(0x3b + (0x1d - 0x3b) * t);
    const bg = Math.round(0x82 + (0x4e - 0x82) * t);
    const bb = Math.round(0xf6 + (0xd8 - 0xf6) * t);
    const oi = (y * W + x) * 4;
    const a = out[oi + 3] / 255;
    test[oi] = Math.round(out[oi] * a + br * (1 - a));
    test[oi + 1] = Math.round(out[oi + 1] * a + bg * (1 - a));
    test[oi + 2] = Math.round(out[oi + 2] * a + bb * (1 - a));
    test[oi + 3] = 255;
  }
}
fs.writeFileSync(path.join(SCRATCH, 'logo-email-on-blue.png'), encodePng(W, H, test));
console.log('test composite written: logo-email-on-blue.png');
