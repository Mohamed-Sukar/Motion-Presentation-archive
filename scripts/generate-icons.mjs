import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const buildDir = path.join(appDir, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
const APP_VERSION = String(pkg.version || '1.2.1').trim();

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const outDist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inDist = Math.min(Math.max(dx, dy), 0);
  return outDist + inDist - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay;
  const e1x = cx - bx, e1y = cy - by;
  const e2x = ax - cx, e2y = ay - cy;
  const v0x = px - ax, v0y = py - ay;
  const v1x = px - bx, v1y = py - by;
  const v2x = px - cx, v2y = py - cy;

  const pq0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y || 1));
  const pq1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y || 1));
  const pq2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y || 1));

  const d0x = v0x - e0x * pq0, d0y = v0y - e0y * pq0;
  const d1x = v1x - e1x * pq1, d1y = v1y - e1y * pq1;
  const d2x = v2x - e2x * pq2, d2y = v2y - e2y * pq2;

  const s = Math.sign(e0x * e2y - e0y * e2x) || 1;
  const d0 = d0x * d0x + d0y * d0y;
  const d1 = d1x * d1x + d1y * d1y;
  const d2 = d2x * d2x + d2y * d2y;

  const c0 = s * (v0x * e0y - v0y * e0x);
  const c1 = s * (v1x * e1y - v1y * e1x);
  const c2 = s * (v2x * e2y - v2y * e2x);

  return -Math.sqrt(Math.min(d0, d1, d2)) * Math.sign(Math.min(c0, c1, c2));
}

function blendOver(dst, r, g, b, a) {
  const srcA = clamp(a);
  if (srcA <= 0) return;
  const outA = srcA + dst[3] * (1 - srcA);
  if (outA <= 0) return;
  dst[0] = (r * srcA + dst[0] * dst[3] * (1 - srcA)) / outA;
  dst[1] = (g * srcA + dst[1] * dst[3] * (1 - srcA)) / outA;
  dst[2] = (b * srcA + dst[2] * dst[3] * (1 - srcA)) / outA;
  dst[3] = outA;
}

const TAN_SKEW_M = Math.tan((-14 * Math.PI) / 180);
const DIAG_LEN = Math.hypot(24, 20); // ~31.2409987

// Exact analytical mitered polygon for <path d="M44 66V14L68 34L92 14V66" stroke-linejoin="miter"/>
function buildKineticMPoly(strokeWidth = 12) {
  const hw = strokeWidth * 0.5;
  const yOuterShoulder = 14 - hw * ((DIAG_LEN + 20) / 24);
  const yInnerShoulder = 14 + hw * ((DIAG_LEN + 20) / 24);
  const yOuterPeak = 34 - hw * (DIAG_LEN / 24);
  const yInnerTrough = 34 + hw * (DIAG_LEN / 24);
  return [
    [44 - hw, 66],
    [44 - hw, yOuterShoulder],
    [68, yOuterPeak],
    [92 + hw, yOuterShoulder],
    [92 + hw, 66],
    [92 - hw, 66],
    [92 - hw, yInnerShoulder],
    [68, yInnerTrough],
    [44 + hw, yInnerShoulder],
    [44 + hw, 66],
  ];
}

const POLY_CACHE = new Map();
function getKineticMPoly(strokeWidth) {
  if (!POLY_CACHE.has(strokeWidth)) {
    POLY_CACHE.set(strokeWidth, buildKineticMPoly(strokeWidth));
  }
  return POLY_CACHE.get(strokeWidth);
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Sample Concept 10 "Kinetic M with play inside" in its native 120x80 coordinates.
 * Options: { includeStreaks: boolean, strokeWidth: number, bigPlay: boolean }
 */
function sampleKineticMark(lx, ly, mRgb, accentRgb, options = {}) {
  const includeStreaks = options.includeStreaks !== false;
  const strokeWidth = options.strokeWidth ?? 12;
  const bigPlay = Boolean(options.bigPlay);

  let r = 0, g = 0, b = 0, a = 0;

  if (includeStreaks) {
    const streaks = [
      { cx: 21, cy: 24.5, hw: 15, hh: 2.5, rad: 2.5, alpha: 1.0 },
      { cx: 25, cy: 39.5, hw: 11, hh: 2.5, rad: 2.5, alpha: 0.7 },
      { cx: 18, cy: 54.5, hw: 18, hh: 2.5, rad: 2.5, alpha: 0.45 },
    ];
    for (const s of streaks) {
      if (sdRoundedBox(lx, ly, s.cx, s.cy, s.hw, s.hh, s.rad) <= 0) {
        const sa = s.alpha;
        const outA = sa + a * (1 - sa);
        if (outA > 0) {
          r = (accentRgb[0] * sa + r * a * (1 - sa)) / outA;
          g = (accentRgb[1] * sa + g * a * (1 - sa)) / outA;
          b = (accentRgb[2] * sa + b * a * (1 - sa)) / outA;
          a = outA;
        }
      }
    }
  }

  // Group: translate(22, 2) skewX(-14deg)
  const gx = lx - 22;
  const gy = ly - 2;
  const ux = gx - TAN_SKEW_M * gy;
  const uy = gy;

  if (pointInPolygon(ux, uy, getKineticMPoly(strokeWidth))) {
    r = mRgb[0];
    g = mRgb[1];
    b = mRgb[2];
    a = 1;
  }

  // Play triangle (61,46)-(61,64)-(81,55) or big (60,44)-(60,66)-(84,55)
  const triDist = bigPlay
    ? sdTriangle(ux, uy, 60, 44, 60, 66, 84, 55)
    : sdTriangle(ux, uy, 61, 46, 61, 64, 81, 55);
  if (triDist <= 1.5) {
    r = accentRgb[0];
    g = accentRgb[1];
    b = accentRgb[2];
    a = 1;
  }

  return [r, g, b, a];
}

// =========================================================================
// CRISP VECTOR STROKE GLYPH RENDERER (for .MPRES, MOTION, PRESENTATION STUDIO, vX.Y.Z)
// Coordinates normalized in [0..1] glyph box (aspect width ~ 0.65 of height).
// =========================================================================
const GLYPH_SEGMENTS = {
  A: [[0.08, 0.96, 0.48, 0.04], [0.48, 0.04, 0.88, 0.96], [0.22, 0.64, 0.74, 0.64]],
  D: [[0.14, 0.04, 0.14, 0.96], [0.14, 0.04, 0.56, 0.04], [0.56, 0.04, 0.84, 0.24], [0.84, 0.24, 0.84, 0.76], [0.84, 0.76, 0.56, 0.96], [0.56, 0.96, 0.14, 0.96]],
  E: [[0.16, 0.04, 0.16, 0.96], [0.16, 0.04, 0.84, 0.04], [0.16, 0.49, 0.72, 0.49], [0.16, 0.96, 0.84, 0.96]],
  I: [[0.50, 0.04, 0.50, 0.96], [0.22, 0.04, 0.78, 0.04], [0.22, 0.96, 0.78, 0.96]],
  M: [[0.10, 0.96, 0.10, 0.04], [0.10, 0.04, 0.49, 0.58], [0.49, 0.58, 0.88, 0.04], [0.88, 0.04, 0.88, 0.96]],
  N: [[0.14, 0.96, 0.14, 0.04], [0.14, 0.04, 0.84, 0.96], [0.84, 0.96, 0.84, 0.04]],
  O: [[0.28, 0.04, 0.70, 0.04], [0.70, 0.04, 0.88, 0.22], [0.88, 0.22, 0.88, 0.78], [0.88, 0.78, 0.70, 0.96], [0.70, 0.96, 0.28, 0.96], [0.28, 0.96, 0.10, 0.78], [0.10, 0.78, 0.10, 0.22], [0.10, 0.22, 0.28, 0.04]],
  P: [[0.16, 0.96, 0.16, 0.04], [0.16, 0.04, 0.66, 0.04], [0.66, 0.04, 0.84, 0.18], [0.84, 0.18, 0.84, 0.40], [0.84, 0.40, 0.66, 0.54], [0.66, 0.54, 0.16, 0.54]],
  R: [[0.16, 0.96, 0.16, 0.04], [0.16, 0.04, 0.66, 0.04], [0.66, 0.04, 0.84, 0.18], [0.84, 0.18, 0.84, 0.38], [0.84, 0.38, 0.66, 0.52], [0.66, 0.52, 0.16, 0.52], [0.50, 0.52, 0.86, 0.96]],
  S: [[0.82, 0.14, 0.66, 0.04], [0.66, 0.04, 0.28, 0.04], [0.28, 0.04, 0.14, 0.18], [0.14, 0.18, 0.14, 0.36], [0.14, 0.36, 0.28, 0.48], [0.28, 0.48, 0.70, 0.54], [0.70, 0.54, 0.84, 0.66], [0.84, 0.66, 0.84, 0.82], [0.84, 0.82, 0.68, 0.96], [0.68, 0.96, 0.26, 0.96], [0.26, 0.96, 0.12, 0.84]],
  T: [[0.50, 0.04, 0.50, 0.96], [0.08, 0.04, 0.92, 0.04]],
  U: [[0.14, 0.04, 0.14, 0.76], [0.14, 0.76, 0.32, 0.96], [0.32, 0.96, 0.66, 0.96], [0.66, 0.96, 0.84, 0.76], [0.84, 0.76, 0.84, 0.04]],
  V: [[0.12, 0.04, 0.50, 0.96], [0.50, 0.96, 0.88, 0.04]],
  v: [[0.18, 0.28, 0.50, 0.96], [0.50, 0.96, 0.82, 0.28]],
  '.': [[0.46, 0.88, 0.54, 0.96], [0.54, 0.88, 0.46, 0.96]],
  '0': [[0.28, 0.04, 0.68, 0.04], [0.68, 0.04, 0.82, 0.20], [0.82, 0.20, 0.82, 0.80], [0.82, 0.80, 0.68, 0.96], [0.68, 0.96, 0.28, 0.96], [0.28, 0.96, 0.14, 0.80], [0.14, 0.80, 0.14, 0.20], [0.14, 0.20, 0.28, 0.04]],
  '1': [[0.24, 0.22, 0.52, 0.04], [0.52, 0.04, 0.52, 0.96], [0.22, 0.96, 0.82, 0.96]],
  '2': [[0.16, 0.22, 0.32, 0.04], [0.32, 0.04, 0.68, 0.04], [0.68, 0.04, 0.84, 0.20], [0.84, 0.20, 0.84, 0.38], [0.84, 0.38, 0.14, 0.96], [0.14, 0.96, 0.86, 0.96]],
  '3': [[0.16, 0.16, 0.34, 0.04], [0.34, 0.04, 0.68, 0.04], [0.68, 0.04, 0.84, 0.20], [0.84, 0.20, 0.84, 0.34], [0.84, 0.34, 0.64, 0.48], [0.40, 0.48, 0.64, 0.48], [0.64, 0.48, 0.86, 0.64], [0.86, 0.64, 0.86, 0.80], [0.86, 0.80, 0.68, 0.96], [0.68, 0.96, 0.32, 0.96], [0.32, 0.96, 0.14, 0.82]],
  '4': [[0.68, 0.96, 0.68, 0.04], [0.68, 0.04, 0.12, 0.68], [0.12, 0.68, 0.88, 0.68]],
  '5': [[0.82, 0.04, 0.20, 0.04], [0.20, 0.04, 0.18, 0.44], [0.18, 0.44, 0.66, 0.44], [0.66, 0.44, 0.84, 0.60], [0.84, 0.60, 0.84, 0.80], [0.84, 0.80, 0.66, 0.96], [0.66, 0.96, 0.28, 0.96], [0.28, 0.96, 0.14, 0.84]],
  '6': [[0.76, 0.12, 0.58, 0.04], [0.58, 0.04, 0.32, 0.04], [0.32, 0.04, 0.16, 0.24], [0.16, 0.24, 0.16, 0.80], [0.16, 0.80, 0.32, 0.96], [0.32, 0.96, 0.68, 0.96], [0.68, 0.96, 0.84, 0.80], [0.84, 0.80, 0.84, 0.60], [0.84, 0.60, 0.68, 0.46], [0.68, 0.46, 0.16, 0.46]],
  '7': [[0.14, 0.04, 0.86, 0.04], [0.86, 0.04, 0.38, 0.96]],
  '8': [[0.30, 0.04, 0.68, 0.04], [0.68, 0.04, 0.82, 0.18], [0.82, 0.18, 0.82, 0.34], [0.82, 0.34, 0.68, 0.48], [0.68, 0.48, 0.30, 0.48], [0.30, 0.48, 0.16, 0.34], [0.16, 0.34, 0.16, 0.18], [0.16, 0.18, 0.30, 0.04], [0.30, 0.48, 0.14, 0.62], [0.14, 0.62, 0.14, 0.82], [0.14, 0.82, 0.30, 0.96], [0.30, 0.96, 0.70, 0.96], [0.70, 0.96, 0.84, 0.82], [0.84, 0.82, 0.84, 0.62], [0.84, 0.62, 0.68, 0.48]],
  '9': [[0.22, 0.88, 0.40, 0.96], [0.40, 0.96, 0.68, 0.96], [0.68, 0.96, 0.84, 0.76], [0.84, 0.76, 0.84, 0.20], [0.84, 0.20, 0.68, 0.04], [0.68, 0.04, 0.32, 0.04], [0.32, 0.04, 0.16, 0.20], [0.16, 0.20, 0.16, 0.38], [0.16, 0.38, 0.32, 0.52], [0.32, 0.52, 0.84, 0.52]],
};

function drawVectorText(buf, channels, imgW, imgH, text, opts) {
  const {
    cx,
    yTop,
    height,
    glyphWidth,
    advance,
    strokeRadius,
    skewTan = 0,
    rgb,
    alpha = 1,
    align = 'center',
  } = opts;

  const chars = [...text];
  const totalW =
    chars.reduce((acc, ch) => {
      const wFactor = ch === '.' ? 0.42 : ch === ' ' ? 0.55 : ch === 'I' ? 0.65 : 1;
      return acc + advance * wFactor;
    }, 0) -
    advance * 0.2;

  let cursorX =
    align === 'center' ? cx - totalW / 2 : align === 'right' ? cx - totalW : cx;

  // Rasterize with 3x3 SSAA over tight bounding box of the string
  const pad = Math.ceil(strokeRadius * 2 + height * Math.abs(skewTan) + 4);
  const xMin = Math.max(0, Math.floor(cursorX - pad));
  const xMax = Math.min(imgW - 1, Math.ceil(cursorX + totalW + pad));
  const yMin = Math.max(0, Math.floor(yTop - strokeRadius - 2));
  const yMax = Math.min(imgH - 1, Math.ceil(yTop + height + strokeRadius + 2));

  // Precompute all transformed segments & circular dots in pixel space
  const segs = [];
  const dots = [];
  for (const ch of chars) {
    const wFactor = ch === '.' ? 0.42 : ch === ' ' ? 0.55 : ch === 'I' ? 0.65 : 1;
    if (ch === '.') {
      const cyDot = yTop + height * 0.90;
      const cxDot = cursorX + glyphWidth * 0.28 + (cyDot - (yTop + height * 0.5)) * skewTan;
      dots.push([cxDot, cyDot, Math.max(strokeRadius * 1.15, height * 0.095)]);
      cursorX += advance * wFactor;
      continue;
    }
    const rawSegs = GLYPH_SEGMENTS[ch];
    if (rawSegs) {
      for (const s of rawSegs) {
        const ax0 = cursorX + s[0] * glyphWidth;
        const ay0 = yTop + s[1] * height;
        const bx0 = cursorX + s[2] * glyphWidth;
        const by0 = yTop + s[3] * height;
        const cyMid = yTop + height * 0.5;
        segs.push([
          ax0 + (ay0 - cyMid) * skewTan,
          ay0,
          bx0 + (by0 - cyMid) * skewTan,
          by0,
        ]);
      }
    }
    cursorX += advance * wFactor;
  }

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      let minDist = Infinity;
      const px = x + 0.5;
      const py = y + 0.5;
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        const d = sdSegment(px, py, sg[0], sg[1], sg[2], sg[3]);
        if (d < minDist) minDist = d;
      }
      let cov = (1 - smoothstep(strokeRadius - 0.65, strokeRadius + 0.65, minDist)) * alpha;
      for (let i = 0; i < dots.length; i++) {
        const dt = dots[i];
        const dd = Math.hypot(px - dt[0], py - dt[1]);
        const dCov = (1 - smoothstep(dt[2] - 0.65, dt[2] + 0.65, dd)) * alpha;
        if (dCov > cov) cov = dCov;
      }
      if (cov > 0.002) {
        const idx = (y * imgW + x) * channels;
        if (channels === 4) {
          const dst = [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3] / 255];
          blendOver(dst, rgb[0], rgb[1], rgb[2], cov);
          buf[idx] = Math.round(clamp(dst[0], 0, 255));
          buf[idx + 1] = Math.round(clamp(dst[1], 0, 255));
          buf[idx + 2] = Math.round(clamp(dst[2], 0, 255));
          buf[idx + 3] = Math.round(clamp(dst[3] * 255, 0, 255));
        } else {
          buf[idx] = Math.round(lerp(buf[idx], rgb[0], cov));
          buf[idx + 1] = Math.round(lerp(buf[idx + 1], rgb[1], cov));
          buf[idx + 2] = Math.round(lerp(buf[idx + 2], rgb[2], cov));
        }
      }
    }
  }
}

// =========================================================================
// 1. APP ICON (Size-dependent Concept 10 spec: streaks >= 64px, crisp M+Play <= 48px)
// =========================================================================
function renderAppIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const aa = 1.15 / size;
  const sub = size <= 48 ? 5 : 4;
  const invSub = 1 / sub;
  const accent = [255, 61, 46];
  const mCol = [255, 255, 255];

  const isCompact = size <= 48;
  const rxNorm = size <= 16 ? 20 / 96 : 24 / 96;
  const strokeW =
    size <= 16 ? 16 : size <= 24 ? 15 : size <= 32 ? 14 : size <= 48 ? 13 : 12;
  const bigPlay = size <= 16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const px = [0, 0, 0, 0];

      const dBody = sdRoundedBox(u, v, 0.5, 0.5, 0.458, 0.458, rxNorm * 0.92);
      const bodyMask = 1 - smoothstep(-aa, aa, dBody);

      if (bodyMask > 0) {
        blendOver(px, 10, 10, 10, bodyMask);

        const rimDist = Math.abs(dBody + 0.008);
        const rimAlpha = (1 - smoothstep(0, 0.012 + aa, rimDist)) * 0.14 * (1 - v * 0.5);
        blendOver(px, 255, 255, 255, rimAlpha * bodyMask);

        let mr = 0, mg = 0, mb = 0, ma = 0;
        for (let sy = 0; sy < sub; sy++) {
          for (let sx = 0; sx < sub; sx++) {
            const su = ((x + (sx + 0.5) * invSub) / size) * 96;
            const sv = ((y + (sy + 0.5) * invSub) / size) * 96;
            let lx, ly;
            if (isCompact) {
              // Compact spec (<=48px): centered no-streak M+Play scaled for balanced squircle padding
              lx = (su - 48) / 0.82 + 80;
              ly = (sv - 49) / 0.82 + 37;
            } else {
              // Full detail spec (>=64px): translate(48 48) scale(0.66) translate(-58 -35)
              lx = (su - 48) / 0.66 + 58;
              ly = (sv - 48) / 0.66 + 35;
            }
            const s = sampleKineticMark(lx, ly, mCol, accent, {
              includeStreaks: !isCompact,
              strokeWidth: strokeW,
              bigPlay,
            });
            mr += s[0] * s[3];
            mg += s[1] * s[3];
            mb += s[2] * s[3];
            ma += s[3];
          }
        }
        const cov = ma / (sub * sub);
        if (cov > 0 && ma > 0) {
          blendOver(px, mr / ma, mg / ma, mb / ma, cov * bodyMask);
        }
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(clamp(px[0], 0, 255));
      rgba[idx + 1] = Math.round(clamp(px[1], 0, 255));
      rgba[idx + 2] = Math.round(clamp(px[2], 0, 255));
      rgba[idx + 3] = Math.round(clamp(px[3] * 255, 0, 255));
    }
  }
  return rgba;
}

// =========================================================================
// 2. MONOCHROME SYSTEM TRAY ICON (16px / 32px white-on-transparent)
// =========================================================================
function renderTrayIcon(size = 16) {
  const rgba = new Uint8Array(size * size * 4);
  const sub = 5;
  const invSub = 1 / sub;
  const white = [255, 255, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ma = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const su = ((x + (sx + 0.5) * invSub) / size) * 96;
          const sv = ((y + (sy + 0.5) * invSub) / size) * 96;
          const lx = su + 32;
          const ly = sv - 13;
          const s = sampleKineticMark(lx, ly, white, white, {
            includeStreaks: false,
            strokeWidth: 16,
            bigPlay: true,
          });
          ma += s[3];
        }
      }
      const cov = ma / (sub * sub);
      const idx = (y * size + x) * 4;
      rgba[idx] = 255;
      rgba[idx + 1] = 255;
      rgba[idx + 2] = 255;
      rgba[idx + 3] = Math.round(clamp(cov * 255, 0, 255));
    }
  }
  return rgba;
}

// =========================================================================
// 3. .MPRES DOCUMENT FILE ICON (Folded dark sheet per file_icon_mpres board)
// =========================================================================
const DOC_PAGE_POLY = [
  [6, 2],
  [40, 2],
  [58, 20],
  [58, 78],
  [6, 78],
];
const DOC_FOLD_TRI = [
  [40, 2],
  [40, 20],
  [58, 20],
];

function distToPolyEdges(px, py, poly) {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    minD = Math.min(minD, sdSegment(px, py, a[0], a[1], b[0], b[1]));
  }
  return minD;
}

function renderDocumentIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const sub = size <= 48 ? 5 : 4;
  const invSub = 1 / sub;
  const accent = [255, 61, 46];
  const mCol = [255, 255, 255];

  const showLabel = size >= 64;
  const markScale = size >= 64 ? 0.40 : size <= 24 ? 0.54 : 0.50;
  const markCy = size >= 64 ? 44 : 48;
  const strokeW = size >= 64 ? 12 : size <= 24 ? 15 : 13.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample document geometry in 64x80 viewBox centered in square size x size
      let rr = 0, gg = 0, bb = 0, aa = 0;
      const samples = sub * sub;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const nu = (x + (sx + 0.5) * invSub) / size;
          const nv = (y + (sy + 0.5) * invSub) / size;
          const vx = (nu - 0.5) * 80 + 32;
          const vy = nv * 80;

          if (pointInPolygon(vx, vy, DOC_PAGE_POLY)) {
            let sr = lerp(10, 26, clamp(vy / 80));
            let sg = sr;
            let sb = sr;

            if (pointInPolygon(vx, vy, DOC_FOLD_TRI)) {
              sr = 46; sg = 46; sb = 46;
            } else {
              const borderD = distToPolyEdges(vx, vy, DOC_PAGE_POLY);
              const borderHalf = size <= 32 ? 1.65 : 1.05;
              if (borderD <= borderHalf) {
                sr = 78; sg = 78; sb = 82;
              }
            }

            // Kinetic M + Play inside: translate(32, markCy) scale(markScale) translate(-80, -35)
            const lx = (vx - 32) / markScale + 80;
            const ly = (vy - markCy) / markScale + 35;
            const mSample = sampleKineticMark(lx, ly, mCol, accent, {
              includeStreaks: false,
              strokeWidth: strokeW,
              bigPlay: size <= 24,
            });
            if (mSample[3] > 0) {
              sr = lerp(sr, mSample[0], mSample[3]);
              sg = lerp(sg, mSample[1], mSample[3]);
              sb = lerp(sb, mSample[2], mSample[3]);
            }

            rr += sr; gg += sg; bb += sb; aa += 1;
          }
        }
      }

      const cov = aa / samples;
      const idx = (y * size + x) * 4;
      if (aa > 0 && cov > 0) {
        rgba[idx] = Math.round(clamp(rr / aa, 0, 255));
        rgba[idx + 1] = Math.round(clamp(gg / aa, 0, 255));
        rgba[idx + 2] = Math.round(clamp(bb / aa, 0, 255));
        rgba[idx + 3] = Math.round(clamp(cov * 255, 0, 255));
      }
    }
  }

  // Render crisp ".MPRES" label at bottom of card when size >= 64px
  if (showLabel) {
    const scalePx = size / 80;
    drawVectorText(rgba, 4, size, size, '.MPRES', {
      cx: size * 0.5,
      yTop: 61.5 * scalePx,
      height: 8.2 * scalePx,
      glyphWidth: 4.9 * scalePx,
      advance: 6.1 * scalePx,
      strokeRadius: 0.92 * scalePx,
      skewTan: -0.18,
      rgb: accent,
      align: 'center',
    });
  }

  return rgba;
}

// =========================================================================
// 4. NSIS INSTALLER IMAGES (164x314 Sidebar & 150x57 Header 24-bit BMP)
// =========================================================================
function renderInstallerSidebarRgb() {
  const W = 164;
  const H = 314;
  const rgb = new Uint8Array(W * H * 3);
  const accent = [255, 61, 46];
  const white = [255, 255, 255];

  const sub = 3;
  const invSub = 1 / sub;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rSum = 0, gSum = 0, bSum = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const px = x + (sx + 0.5) * invSub;
          const py = y + (sy + 0.5) * invSub;
          let r = 10, g = 10, b = 10;

          // 1px dark separator on right edge (#242424)
          if (px >= W - 1) {
            r = 36; g = 36; b = 36;
          }

          // Top Kinetic M mark: transform="translate(16 48) scale(1.1)"
          const lx = (px - 16) / 1.1;
          const ly = (py - 48) / 1.1;
          if (lx >= -2 && lx <= 122 && ly >= -2 && ly <= 82) {
            const ms = sampleKineticMark(lx, ly, white, accent, {
              includeStreaks: true,
              strokeWidth: 12,
            });
            if (ms[3] > 0) {
              r = lerp(r, ms[0], ms[3]);
              g = lerp(g, ms[1], ms[3]);
              b = lerp(b, ms[2], ms[3]);
            }
          }

          // Bottom-left kinetic accent lines (y = 262, 271, 280)
          const bars = [
            { yTop: 262, w: 68, h: 4, a: 0.9 },
            { yTop: 271, w: 48, h: 4, a: 0.55 },
            { yTop: 280, w: 84, h: 4, a: 0.3 },
          ];
          for (const bar of bars) {
            if (px <= bar.w && py >= bar.yTop && py <= bar.yTop + bar.h) {
              r = lerp(r, accent[0], bar.a);
              g = lerp(g, accent[1], bar.a);
              b = lerp(b, accent[2], bar.a);
            }
          }

          rSum += r; gSum += g; bSum += b;
        }
      }
      const idx = (y * W + x) * 3;
      const samples = sub * sub;
      rgb[idx] = Math.round(rSum / samples);
      rgb[idx + 1] = Math.round(gSum / samples);
      rgb[idx + 2] = Math.round(bSum / samples);
    }
  }

  // Centered MOTION + PRESENTATION STUDIO lockup matching installer_images board
  drawVectorText(rgb, 3, W, H, 'MOTION', {
    cx: W * 0.5,
    yTop: 174,
    height: 22,
    glyphWidth: 13.5,
    advance: 17.5,
    strokeRadius: 1.95,
    skewTan: -0.22,
    rgb: white,
    align: 'center',
  });

  drawVectorText(rgb, 3, W, H, 'PRESENTATION', {
    cx: W * 0.5,
    yTop: 204,
    height: 7.4,
    glyphWidth: 4.6,
    advance: 6.4,
    strokeRadius: 0.72,
    skewTan: -0.18,
    rgb: accent,
    align: 'center',
  });

  drawVectorText(rgb, 3, W, H, 'STUDIO', {
    cx: W * 0.5,
    yTop: 215,
    height: 7.4,
    glyphWidth: 4.6,
    advance: 6.8,
    strokeRadius: 0.72,
    skewTan: -0.18,
    rgb: accent,
    align: 'center',
  });

  // Dynamic version footer on bottom-right ("v1.2.1")
  drawVectorText(rgb, 3, W, H, `v${APP_VERSION}`, {
    cx: W - 12,
    yTop: 268,
    height: 9.5,
    glyphWidth: 5.5,
    advance: 7.2,
    strokeRadius: 0.75,
    rgb: [120, 120, 120],
    align: 'right',
  });

  return { width: W, height: H, rgb };
}

function renderInstallerHeaderRgb() {
  const W = 150;
  const H = 57;
  const rgb = new Uint8Array(W * H * 3);
  const accent = [255, 61, 46];
  const darkM = [10, 10, 10];
  const sub = 4;
  const invSub = 1 / sub;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rSum = 0, gSum = 0, bSum = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const px = x + (sx + 0.5) * invSub;
          const py = y + (sy + 0.5) * invSub;
          let r = 255, g = 255, b = 255;

          // Bottom 1px #D8D8D4 divider matching light NSIS header surface
          if (y === H - 1) {
            r = 216; g = 216; b = 212;
          }

          // Right-aligned Kinetic M mark: transform="translate(88 12) scale(0.4)"
          const lx = (px - 88) / 0.4;
          const ly = (py - 12) / 0.4;
          if (lx >= -2 && lx <= 122 && ly >= -2 && ly <= 82) {
            const ms = sampleKineticMark(lx, ly, darkM, accent, {
              includeStreaks: true,
              strokeWidth: 12,
            });
            if (ms[3] > 0) {
              r = lerp(r, ms[0], ms[3]);
              g = lerp(g, ms[1], ms[3]);
              b = lerp(b, ms[2], ms[3]);
            }
          }

          rSum += r; gSum += g; bSum += b;
        }
      }
      const idx = (y * W + x) * 3;
      const samples = sub * sub;
      rgb[idx] = Math.round(rSum / samples);
      rgb[idx + 1] = Math.round(gSum / samples);
      rgb[idx + 2] = Math.round(bSum / samples);
    }
  }
  return { width: W, height: H, rgb };
}

function encodeBmp24(width, height, rgb) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const fileSize = 54 + pixelBytes;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelBytes, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const dstRow = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const s = (srcY * width + x) * 3;
      const d = dstRow + x * 3;
      buf[d] = rgb[s + 2];     // B
      buf[d + 1] = rgb[s + 1]; // G
      buf[d + 2] = rgb[s];     // R
    }
  }

  return buf;
}

function rgbToRgba(width, height, rgb) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  return rgba;
}

// =========================================================================
// PNG & ICO ENCODERS
// =========================================================================
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIcoDib(size, rgba) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const andRowStride = Math.ceil(size / 32) * 4;
  const andSize = andRowStride * size;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);

  buf.writeUInt32LE(headerSize, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize, 20);

  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (srcY * size + x) * 4;
      const d = headerSize + (y * size + x) * 4;
      buf[d] = rgba[s + 2];
      buf[d + 1] = rgba[s + 1];
      buf[d + 2] = rgba[s];
      buf[d + 3] = rgba[s + 3];
    }
  }
  return buf;
}

function buildIco(rendererFn) {
  const sizes = [16, 24, 32, 48, 256];
  const entries = sizes.map((size) => {
    const rgba = rendererFn(size);
    const data = size === 256 ? encodePng(size, size, rgba) : encodeIcoDib(size, rgba);
    return { size, data };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dirSize = entries.length * 16;
  let offset = 6 + dirSize;
  const dirBuffers = [];
  const dataBuffers = [];

  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size === 256 ? 0 : entry.size;
    dir[1] = entry.size === 256 ? 0 : entry.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.data.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += entry.data.length;
    dirBuffers.push(dir);
    dataBuffers.push(entry.data);
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePng(256, 256, renderAppIcon(256)));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(renderAppIcon));
fs.writeFileSync(path.join(buildDir, 'tray-icon.png'), encodePng(16, 16, renderTrayIcon(16)));
fs.writeFileSync(path.join(buildDir, 'file-icon.ico'), buildIco(renderDocumentIcon));

const sidebar = renderInstallerSidebarRgb();
const headerImg = renderInstallerHeaderRgb();
fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), encodeBmp24(sidebar.width, sidebar.height, sidebar.rgb));
fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), encodeBmp24(headerImg.width, headerImg.height, headerImg.rgb));

const previewIdx = process.argv.indexOf('--preview');
if (previewIdx !== -1 && process.argv[previewIdx + 1]) {
  const previewDir = path.resolve(process.argv[previewIdx + 1]);
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, 'app-32.png'), encodePng(32, 32, renderAppIcon(32)));
  fs.writeFileSync(path.join(previewDir, 'file-256.png'), encodePng(256, 256, renderDocumentIcon(256)));
  fs.writeFileSync(path.join(previewDir, 'file-32.png'), encodePng(32, 32, renderDocumentIcon(32)));
  fs.writeFileSync(path.join(previewDir, 'sidebar.png'), encodePng(sidebar.width, sidebar.height, rgbToRgba(sidebar.width, sidebar.height, sidebar.rgb)));
  fs.writeFileSync(path.join(previewDir, 'header.png'), encodePng(headerImg.width, headerImg.height, rgbToRgba(headerImg.width, headerImg.height, headerImg.rgb)));
}

console.log(`Generated build icons & NSIS assets for v${APP_VERSION}`);
