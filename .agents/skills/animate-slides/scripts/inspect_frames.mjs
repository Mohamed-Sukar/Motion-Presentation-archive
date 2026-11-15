#!/usr/bin/env node
/**
 * Inspects a frames directory (or list of frame paths) for /create-new:
 * - Filters supported image files (.png, .jpg, .jpeg, .webp, .avif, .svg)
 * - Validates that every filename has an unambiguous ordering number
 * - Checks for missing numbers, ambiguous multiple numbers, duplicates, and < 2 frames
 * - Reads image dimensions and recommends the closest motion-reel format
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg']);

function stripTechnicalTokens(stem) {
  return stem
    .replace(/([_\-\s.]|^)\d{3,4}x\d{3,4}(?=[_\-\s.]|$)/gi, '$1')
    .replace(/([_\-\s.]|^)(?:2160|1440|1080|720|540|480|360|240)p(?=[_\-\s.]|$)/gi, '$1')
    .replace(/([_\-\s.]|^)(?:24|25|30|48|50|60|120|240)fps(?=[_\-\s.]|$)/gi, '$1')
    .replace(/([_\-\s.]|^)(?:2k|4k|8k)(?=[_\-\s.]|$)/gi, '$1');
}

function extractOrderInfo(filename) {
  const stem = path.basename(filename, path.extname(filename));
  const sanitized = stripTechnicalTokens(stem);
  const allMatches = [...sanitized.matchAll(/\d+/g)].map((m) => ({
    raw: m[0],
    value: parseInt(m[0], 10),
    index: m.index ?? 0,
  }));

  if (allMatches.length === 0) {
    return { status: 'unnumbered', order: null, source: 'none', candidates: [] };
  }

  if (allMatches.length === 1) {
    return {
      status: 'ok',
      order: allMatches[0].value,
      source: 'single-number',
      candidates: allMatches.map((m) => m.value),
    };
  }

  // Multiple digit groups exist: check for clear leading number or explicit frame/slide prefix
  const leading = sanitized.match(/^\s*(\d+)(?:[_\-\s.]|$)/);
  if (leading) {
    return {
      status: 'ok',
      order: parseInt(leading[1], 10),
      source: 'leading-number',
      candidates: allMatches.map((m) => m.value),
    };
  }

  const prefixRegex =
    /(?:^|[_\-\s.])(?:frame|slide|shot|scene|step|page|img|pic|فريم|شريحة|مشهد)[_\-\s.]?(\d+)(?=$|[_\-\s.])/gi;
  const prefixMatches = [...sanitized.matchAll(prefixRegex)].map((m) => parseInt(m[1], 10));
  if (prefixMatches.length === 1) {
    return {
      status: 'ok',
      order: prefixMatches[0],
      source: 'explicit-prefix',
      candidates: allMatches.map((m) => m.value),
    };
  }

  return {
    status: 'ambiguous',
    order: null,
    source: 'multiple-numbers',
    candidates: allMatches.map((m) => m.value),
  };
}

function readImageDimensions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.svg') {
      const text = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
      const vb = text.match(/viewBox\s*=\s*["'][\s,]*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
      const wm = text.match(/\bwidth\s*=\s*["']([\d.]+)/i);
      const hm = text.match(/\bheight\s*=\s*["']([\d.]+)/i);
      if (wm && hm) return { width: Math.round(Number(wm[1])), height: Math.round(Number(hm[1])) };
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);

      // PNG
      if (
        bytesRead >= 24 &&
        slice[0] === 0x89 &&
        slice[1] === 0x50 &&
        slice[2] === 0x4e &&
        slice[3] === 0x47
      ) {
        return { width: slice.readUInt32BE(16), height: slice.readUInt32BE(20) };
      }

      // JPEG
      if (bytesRead >= 4 && slice[0] === 0xff && slice[1] === 0xd8) {
        let offset = 2;
        while (offset + 4 < bytesRead) {
          if (slice[offset] !== 0xff) {
            offset++;
            continue;
          }
          const marker = slice[offset + 1];
          if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
            offset += 2;
            continue;
          }
          const segLen = slice.readUInt16BE(offset + 2);
          const isSof =
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf);
          if (isSof && offset + 9 <= bytesRead) {
            return {
              height: slice.readUInt16BE(offset + 5),
              width: slice.readUInt16BE(offset + 7),
            };
          }
          offset += 2 + segLen;
        }
      }

      // WEBP
      if (
        bytesRead >= 30 &&
        slice.toString('ascii', 0, 4) === 'RIFF' &&
        slice.toString('ascii', 8, 12) === 'WEBP'
      ) {
        const chunk = slice.toString('ascii', 12, 16);
        if (chunk === 'VP8 ' && bytesRead >= 30) {
          return {
            width: slice.readUInt16LE(26) & 0x3fff,
            height: slice.readUInt16LE(28) & 0x3fff,
          };
        }
        if (chunk === 'VP8L' && bytesRead >= 25 && slice[20] === 0x2f) {
          const bits = slice.readUInt32LE(21);
          return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1,
          };
        }
        if (chunk === 'VP8X' && bytesRead >= 30) {
          const w = (slice[24] | (slice[25] << 8) | (slice[26] << 16)) + 1;
          const h = (slice[27] | (slice[28] << 8) | (slice[29] << 16)) + 1;
          return { width: w, height: h };
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Fall through to ffprobe
  }

  try {
    const res = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath],
      { encoding: 'utf8' }
    );
    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout);
      const stream = parsed?.streams?.[0];
      if (stream?.width && stream?.height) {
        return { width: Number(stream.width), height: Number(stream.height) };
      }
    }
  } catch {
    // Ignore ffprobe fallback failure
  }

  return { width: null, height: null };
}

function classifyFormat(width, height) {
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.08) return '16x9';
  if (Math.abs(ratio - 9 / 16) < 0.08) return '9x16';
  if (Math.abs(ratio - 1) < 0.08) return '1x1';
  return `${width}x${height}`;
}

function main() {
  const inputArgs = process.argv.slice(2).filter(Boolean);
  if (inputArgs.length === 0) {
    console.error('Usage: node inspect_frames.mjs <frames_directory_or_files...>');
    process.exit(1);
  }

  const resolvedTargets = inputArgs.map((p) => path.resolve(p));
  const candidateFiles = [];
  const invalidPaths = [];

  for (const target of resolvedTargets) {
    if (!fs.existsSync(target)) {
      invalidPaths.push(target);
      continue;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          candidateFiles.push(path.join(target, entry.name));
        }
      }
    } else if (stat.isFile()) {
      const ext = path.extname(target).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        candidateFiles.push(target);
      }
    }
  }

  const clarificationReasons = [];
  const warnings = [];

  if (invalidPaths.length > 0) {
    clarificationReasons.push({
      code: 'PATH_NOT_FOUND',
      message: `Path does not exist: ${invalidPaths.join(', ')}`,
    });
  }

  if (candidateFiles.length === 0) {
    clarificationReasons.push({
      code: 'NO_FRAMES_FOUND',
      message: 'No supported image frames (.png, .jpg, .jpeg, .webp, .avif, .svg) were found.',
    });
  } else if (candidateFiles.length === 1) {
    clarificationReasons.push({
      code: 'FEWER_THAN_TWO_FRAMES',
      message: 'At least 2 frames are required to build a transition between consecutive frames.',
    });
  }

  const parsedFrames = [];
  const unnumberedFiles = [];
  const ambiguousFiles = [];

  for (const filePath of candidateFiles) {
    const filename = path.basename(filePath);
    const info = extractOrderInfo(filename);
    const dims = readImageDimensions(filePath);

    if (info.status === 'unnumbered') {
      unnumberedFiles.push(filename);
      continue;
    }
    if (info.status === 'ambiguous') {
      ambiguousFiles.push({ filename, numbersFound: info.candidates });
      continue;
    }

    parsedFrames.push({
      order: info.order,
      filename,
      fullPath: filePath,
      ext: path.extname(filename).toLowerCase(),
      width: dims.width,
      height: dims.height,
      orderSource: info.source,
    });
  }

  if (unnumberedFiles.length > 0) {
    clarificationReasons.push({
      code: 'UNNUMBERED_FRAMES',
      message: `Some frame filenames do not contain an ordering number: ${unnumberedFiles.join(', ')}`,
    });
  }

  if (ambiguousFiles.length > 0) {
    clarificationReasons.push({
      code: 'AMBIGUOUS_FRAME_NUMBERS',
      message: `Some frame filenames contain multiple numbers without a clear ordering prefix: ${ambiguousFiles
        .map((a) => `${a.filename} [${a.numbersFound.join(', ')}]`)
        .join('; ')}`,
    });
  }

  const byOrder = new Map();
  for (const frame of parsedFrames) {
    if (!byOrder.has(frame.order)) byOrder.set(frame.order, []);
    byOrder.get(frame.order).push(frame);
  }

  const duplicateGroups = [];
  for (const [order, group] of byOrder.entries()) {
    if (group.length > 1) {
      duplicateGroups.push({
        order,
        files: group.map((g) => g.filename),
      });
    }
  }

  if (duplicateGroups.length > 0) {
    clarificationReasons.push({
      code: 'DUPLICATE_ORDER_NUMBERS',
      message: `Multiple frames share the same order number: ${duplicateGroups
        .map((d) => `#${d.order} (${d.files.join(', ')})`)
        .join('; ')}`,
    });
  }

  parsedFrames.sort((a, b) => a.order - b.order || a.filename.localeCompare(b.filename));

  // Check resolution consistency & non-contiguous gaps as non-blocking warnings
  const dimSet = new Set(
    parsedFrames
      .filter((f) => f.width && f.height)
      .map((f) => `${f.width}x${f.height}`)
  );
  if (dimSet.size > 1) {
    warnings.push({
      code: 'MIXED_DIMENSIONS',
      message: `Frames have mixed dimensions: ${[...dimSet].join(', ')}`,
    });
  }

  if (parsedFrames.length >= 2) {
    const diffs = new Set();
    for (let i = 1; i < parsedFrames.length; i++) {
      diffs.add(parsedFrames[i].order - parsedFrames[i - 1].order);
    }
    if (diffs.size > 1) {
      warnings.push({
        code: 'IRREGULAR_NUMBER_GAPS',
        message: `Order numbers have irregular gaps (${parsedFrames.map((f) => f.order).join(', ')}); verify no intermediate frame is missing.`,
      });
    }
  }

  const firstDims = parsedFrames.find((f) => f.width && f.height);
  const detectedFormat = firstDims ? classifyFormat(firstDims.width, firstDims.height) : 'unknown';

  const result = {
    targets: resolvedTargets,
    totalImages: candidateFiles.length,
    needsClarification: clarificationReasons.length > 0,
    clarificationReasons,
    warnings,
    detectedFormat,
    resolution: firstDims ? `${firstDims.width}x${firstDims.height}` : null,
    frames: parsedFrames,
    unnumberedFiles,
    ambiguousFiles,
    duplicateGroups,
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
