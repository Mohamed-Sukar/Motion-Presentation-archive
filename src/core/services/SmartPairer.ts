import { createSlideNode } from '../domain/defaults';
import {
  BatchImportReport,
  FallbackTransitionStyle,
  MediaAsset,
  SegmentEasing,
  SlideNode,
} from '../domain/types';
import { FrameExtractor } from './FrameExtractor';
import { MediaValidator } from './MediaValidator';
import { t } from '../i18n';

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const COMMON_RESOLUTION_DIMS = new Set([
  240, 320, 360, 480, 540, 640, 720, 800, 854, 960, 1024, 1080, 1280, 1440, 1600, 1920,
  2160, 2560, 3840,
]);

export type CueDetectionSensitivity = 'low' | 'medium' | 'high';

export interface CueDetectionOptions {
  sensitivity?: CueDetectionSensitivity;
  minGapSec?: number;
  maxCues?: number;
  onProgress?: (progress01: number) => void;
  signal?: AbortSignal;
}

export interface DetectedCueCandidate {
  timeSec: number;
  confidence: number;
  kind: 'start' | 'pause-settle' | 'velocity-valley' | 'scene-cut' | 'end';
  plateauStartSec?: number;
  plateauEndSec?: number;
  sharpnessScore?: number;
}

export interface CueDetectionResult {
  cueTimesSec: number[];
  candidates: DetectedCueCandidate[];
  durationSec: number;
  method: 'pause-plateaus' | 'scene-cuts' | 'hybrid' | 'uniform-fallback';
  samplesAnalyzed: number;
  recommendedEasings?: SegmentEasing[];
  motionProfile?: {
    sampleTimes: number[];
    motionScores: number[];
    cutScores: number[];
    stillThreshold: number;
  };
}

export interface FrameSignature {
  width: number;
  height: number;
  luma: Uint8Array;
  edgeMag: Uint8Array;
  meanEdgeSharpness: number;
  blockLumaMean: Float32Array;
  blockLumaVar: Float32Array;
  blockChromaU: Float32Array;
  blockChromaV: Float32Array;
  blockEdgeMean: Float32Array;
  hist: Float32Array;
}

export interface FrameComparisonMetrics {
  globalLumaMad: number;
  activeBlockScore: number;
  edgeChangeScore: number;
  ssimDissimilarity: number;
  histDistance: number;
  motionVelocity: number;
  cutScore: number;
  contentDisplacement: number;
}

export interface MotionSignalInput {
  sampleTimes: number[];
  rawVelocity?: number[];
  effectiveMotion: number[];
  cutScores: number[];
  durationSec: number;
  signatures?: FrameSignature[];
  sensitivity?: CueDetectionSensitivity;
  minGapSec?: number;
  maxCues?: number;
}

export interface BuildCueSlidesOptions {
  defaultFallback?: FallbackTransitionStyle;
  defaultFallbackDurationMs?: number;
  muted?: boolean;
  playbackSpeed?: number;
  segmentEasings?: SegmentEasing[];
  cueLabels?: string[];
  onProgress?: (done: number, total: number, timeSec: number) => void;
  signal?: AbortSignal;
}

export interface BatchMediaDescriptor {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
}

export interface BatchProcessOptions {
  onProgress?: (done: number, total: number, fileName: string) => void;
  signal?: AbortSignal;
  resolveMediaSource?: (file: File) => { path: string; url: string; size?: number } | null;
}

/**
 * SmartPairer handles batch media pairing, video-to-presentation conversion,
 * smart pause/scene cue detection, and cue-point slide reconstruction.
 */
export class SmartPairer {
  static async processBatchFiles(
    files: File[],
    existingSlidesCount: number,
    defaultFallback: FallbackTransitionStyle = 'crossfade',
    options: BatchProcessOptions = {}
  ): Promise<{
    newSlides: SlideNode[];
    unpairedVideos: MediaAsset[];
    report: BatchImportReport;
  }> {
    MediaValidator.throwIfAborted(options.signal);

    const sortedFiles = [...files].sort((a, b) =>
      naturalCollator.compare(a.name, b.name)
    );

    const imageAssets: MediaAsset[] = [];
    const videoAssets: MediaAsset[] = [];
    const rejectedFiles: Array<{ name: string; reason: string }> = [];
    const totalFiles = sortedFiles.length;

    const cleanupOnAbort = () => {
      for (const a of imageAssets) MediaValidator.revokeAssetUrls(a);
      for (const a of videoAssets) MediaValidator.revokeAssetUrls(a);
    };

    try {
      for (let idx = 0; idx < sortedFiles.length; idx++) {
        MediaValidator.throwIfAborted(options.signal);
        const file = sortedFiles[idx];
        options.onProgress?.(idx, totalFiles, file.name);

        const check = MediaValidator.validateFile(file);
        if (!check.valid || !check.kind) {
          rejectedFiles.push({
            name: file.name,
            reason: check.errorReason || t('core.invalidFile'),
          });
          continue;
        }

        try {
          const resolved = options.resolveMediaSource?.(file) || null;
          const asset = resolved
            ? await MediaValidator.ingestFromUrl(
                resolved.url,
                check.kind,
                {
                  fileName: file.name,
                  mimeType: file.type || '',
                  size: resolved.size ?? file.size,
                  source: { kind: 'file', path: resolved.path },
                },
                options.signal
              )
            : await MediaValidator.ingestFile(file, undefined, options.signal);
          if (asset.kind === 'image') {
            imageAssets.push(asset);
          } else {
            videoAssets.push(asset);
          }
        } catch (err) {
          if (MediaValidator.isAbortError(err)) throw err;
          rejectedFiles.push({
            name: file.name,
            reason: err instanceof Error ? err.message : t('core.fileReadError'),
          });
        }
      }

      options.onProgress?.(totalFiles, totalFiles, '');

      return await this.pairIngestedAssets(
        imageAssets,
        videoAssets,
        rejectedFiles,
        existingSlidesCount,
        defaultFallback,
        options
      );
    } catch (err) {
      cleanupOnAbort();
      throw err;
    }
  }

  /**
   * Desktop path-based batch import: ingests registered `mpres://file/...` URLs
   * without reading media bytes into JS memory.
   */
  static async processBatchMediaDescriptors(
    descriptors: BatchMediaDescriptor[],
    existingSlidesCount: number,
    defaultFallback: FallbackTransitionStyle = 'crossfade',
    options: BatchProcessOptions = {}
  ): Promise<{
    newSlides: SlideNode[];
    unpairedVideos: MediaAsset[];
    report: BatchImportReport;
  }> {
    MediaValidator.throwIfAborted(options.signal);

    const sorted = [...descriptors].sort((a, b) =>
      naturalCollator.compare(a.fileName, b.fileName)
    );

    const imageAssets: MediaAsset[] = [];
    const videoAssets: MediaAsset[] = [];
    const rejectedFiles: Array<{ name: string; reason: string }> = [];
    const totalFiles = sorted.length;

    const cleanupOnAbort = () => {
      for (const a of imageAssets) MediaValidator.revokeAssetUrls(a);
      for (const a of videoAssets) MediaValidator.revokeAssetUrls(a);
    };

    try {
      for (let idx = 0; idx < sorted.length; idx++) {
        MediaValidator.throwIfAborted(options.signal);
        const desc = sorted[idx];
        options.onProgress?.(idx, totalFiles, desc.fileName);

        const check = MediaValidator.validateDescriptor(desc.fileName, desc.mimeType, desc.size);
        if (!check.valid || !check.kind) {
          rejectedFiles.push({
            name: desc.fileName,
            reason: check.errorReason || t('core.invalidFile'),
          });
          continue;
        }

        try {
          const asset = await MediaValidator.ingestFromUrl(
            desc.url,
            check.kind,
            {
              fileName: desc.fileName,
              mimeType: desc.mimeType,
              size: desc.size,
              source: { kind: 'file', path: desc.path },
            },
            options.signal
          );
          if (asset.kind === 'image') {
            imageAssets.push(asset);
          } else {
            videoAssets.push(asset);
          }
        } catch (err) {
          if (MediaValidator.isAbortError(err)) throw err;
          rejectedFiles.push({
            name: desc.fileName,
            reason: err instanceof Error ? err.message : t('core.fileReadError'),
          });
        }
      }

      options.onProgress?.(totalFiles, totalFiles, '');

      return await this.pairIngestedAssets(
        imageAssets,
        videoAssets,
        rejectedFiles,
        existingSlidesCount,
        defaultFallback,
        options
      );
    } catch (err) {
      cleanupOnAbort();
      throw err;
    }
  }

  private static async pairIngestedAssets(
    imageAssets: MediaAsset[],
    videoAssets: MediaAsset[],
    rejectedFiles: Array<{ name: string; reason: string }>,
    existingSlidesCount: number,
    defaultFallback: FallbackTransitionStyle,
    options: BatchProcessOptions
  ): Promise<{
    newSlides: SlideNode[];
    unpairedVideos: MediaAsset[];
    report: BatchImportReport;
  }> {

      const newSlides: SlideNode[] = [];
      const unpairedVideos: MediaAsset[] = [];
      let transitionsMatched = 0;

      // Case A: Mixed Images + Videos, or Images only
      if (imageAssets.length > 0) {
        const idleLoopVideos = videoAssets.filter((v) =>
          SmartPairer.isIdleLoopFilename(v.name)
        );
        const transitionVideos = videoAssets.filter(
          (v) => !SmartPairer.isIdleLoopFilename(v.name)
        );
        const usedTransIndices = new Set<number>();
        const usedLoopIndices = new Set<number>();

        for (let i = 0; i < imageAssets.length; i++) {
          MediaValidator.throwIfAborted(options.signal);
          const slideNode = createSlideNode(
            imageAssets[i],
            existingSlidesCount + i,
            defaultFallback
          );

          const imageParsedIdx = SmartPairer.extractSlideIndexFromFilename(imageAssets[i].name);

          // Match Idle Loop video (e.g., 01_loop.mp4, 02_idle.mp4)
          let matchedLoopIdx = -1;
          for (let l = 0; l < idleLoopVideos.length; l++) {
            if (usedLoopIndices.has(l)) continue;
            const loopTarget = SmartPairer.extractIdleLoopSlideIndex(idleLoopVideos[l].name);
            if (
              loopTarget !== null &&
              (loopTarget === imageParsedIdx ||
                loopTarget === i ||
                loopTarget === existingSlidesCount + i)
            ) {
              matchedLoopIdx = l;
              break;
            }
          }
          if (matchedLoopIdx !== -1) {
            usedLoopIndices.add(matchedLoopIdx);
            slideNode.idleLoopAsset = idleLoopVideos[matchedLoopIdx];
          }

          // Match Slide-to-Slide Transition video (e.g., 01-02_transition.mp4)
          let matchedVidIdx = -1;
          for (let v = 0; v < transitionVideos.length; v++) {
            if (usedTransIndices.has(v)) continue;
            const vidTarget = SmartPairer.extractSlideIndexFromFilename(transitionVideos[v].name);
            if (
              vidTarget !== null &&
              (vidTarget === imageParsedIdx ||
                vidTarget === i ||
                vidTarget === existingSlidesCount + i)
            ) {
              matchedVidIdx = v;
              break;
            }
          }

          if (matchedVidIdx === -1) {
            for (let v = 0; v < transitionVideos.length; v++) {
              if (!usedTransIndices.has(v)) {
                matchedVidIdx = v;
                break;
              }
            }
          }

          if (matchedVidIdx !== -1) {
            usedTransIndices.add(matchedVidIdx);
            slideNode.transitionToNext.videoAsset = transitionVideos[matchedVidIdx];
            transitionsMatched++;
          }

          newSlides.push(slideNode);
        }

        for (let v = 0; v < transitionVideos.length; v++) {
          if (!usedTransIndices.has(v)) {
            unpairedVideos.push(transitionVideos[v]);
          }
        }
        for (let l = 0; l < idleLoopVideos.length; l++) {
          if (!usedLoopIndices.has(l)) {
            unpairedVideos.push(idleLoopVideos[l]);
          }
        }
      }
      // Case B: Pure Motion Transition Videos on an empty project
      else if (videoAssets.length > 0 && existingSlidesCount === 0) {
        let prevSlide: SlideNode | null = null;
        let slideNum = 1;

        for (let i = 0; i < videoAssets.length; i++) {
          MediaValidator.throwIfAborted(options.signal);
          const currentVid = videoAssets[i];
          const baseName = currentVid.name.replace(/\.[^/.]+$/, '');

          try {
            if (!prevSlide) {
              // Single decoder session extracts both first & last frame cleanly
              const [introImage, endFrameImage] = await FrameExtractor.extractFramesAtTimes(
                currentVid,
                [0, -1],
                {
                  labels: [
                    `${t('slide.filePrefixIntro')}_${baseName}.png`,
                    `${t('slide.filePrefixSlide')}_${slideNum + 1}.png`,
                  ],
                  signal: options.signal,
                }
              );

              const introSlide = createSlideNode(introImage, 0, defaultFallback);
              introSlide.title = t('slide.introExtracted');
              introSlide.transitionToNext.videoAsset = currentVid;
              transitionsMatched++;
              newSlides.push(introSlide);
              slideNum++;

              const landingSlide = createSlideNode(endFrameImage, newSlides.length, defaultFallback);
              landingSlide.title = t('slide.defaultTitle', { index: slideNum });
              newSlides.push(landingSlide);
              prevSlide = landingSlide;
              slideNum++;
            } else {
              const endFrameImage = await FrameExtractor.extractFrameAsSlideAsset(
                currentVid,
                'last',
                `${t('slide.filePrefixSlide')}_${slideNum}.png`,
                options.signal
              );
              prevSlide.transitionToNext.videoAsset = currentVid;
              transitionsMatched++;

              const landingSlide = createSlideNode(endFrameImage, newSlides.length, defaultFallback);
              landingSlide.title = t('slide.defaultTitle', { index: slideNum });
              newSlides.push(landingSlide);
              prevSlide = landingSlide;
              slideNum++;
            }
          } catch (err) {
            if (MediaValidator.isAbortError(err)) throw err;
            MediaValidator.revokeAssetUrls(currentVid);
            rejectedFiles.push({
              name: currentVid.name,
              reason:
                err instanceof Error
                  ? err.message
                  : t('core.videoFramesExtractError', { name: currentVid.name }),
            });
          }
        }
      }
      // Case C: Additional videos dropped onto an existing project
      else if (videoAssets.length > 0 && existingSlidesCount > 0) {
        let totalSlides = existingSlidesCount;
        const createdSlideByLogicalIdx = new Map<number, SlideNode>();

        for (let i = 0; i < videoAssets.length; i++) {
          MediaValidator.throwIfAborted(options.signal);
          const vid = videoAssets[i];
          const baseName = vid.name.replace(/\.[^/.]+$/, '');
          const parsed = SmartPairer.parseIndicesFromFilename(vid.name);

          let fromIdx: number;
          let toIdx: number;

          if (parsed !== null) {
            fromIdx = parsed.fromIndex;
            toIdx = parsed.toIndex ?? fromIdx + 1;
          } else {
            fromIdx = totalSlides;
            toIdx = fromIdx + 1;
          }

          const needStart = fromIdx >= totalSlides && !createdSlideByLogicalIdx.has(fromIdx);
          const needEnd = toIdx >= totalSlides && toIdx !== fromIdx && !createdSlideByLogicalIdx.has(toIdx);

          const timesToExtract: number[] = [];
          const labelsToExtract: string[] = [];
          if (needStart) {
            timesToExtract.push(0);
            labelsToExtract.push(
              `${t('slide.filePrefixSlide')}_${fromIdx + 1}_${t('slide.filePrefixStart')}_${baseName}.png`
            );
          }
          if (needEnd) {
            timesToExtract.push(-1);
            labelsToExtract.push(
              `${t('slide.filePrefixSlide')}_${toIdx + 1}_${t('slide.filePrefixEnd')}_${baseName}.png`
            );
          }

          try {
            let extracted: MediaAsset[] = [];
            if (timesToExtract.length > 0) {
              extracted = await FrameExtractor.extractFramesAtTimes(vid, timesToExtract, {
                labels: labelsToExtract,
                signal: options.signal,
              });
            }

            let cursor = 0;
            if (needStart) {
              const startFrame = extracted[cursor++];
              const startSlide = createSlideNode(startFrame, totalSlides, defaultFallback);
              startSlide.title = t('slide.startOf', { index: totalSlides + 1, name: baseName });
              newSlides.push(startSlide);
              createdSlideByLogicalIdx.set(fromIdx, startSlide);
              totalSlides++;
            }

            if (needEnd) {
              const endFrame = extracted[cursor++];
              const landingSlide = createSlideNode(endFrame, totalSlides, defaultFallback);
              landingSlide.title = t('slide.endOf', { index: totalSlides + 1, name: baseName });
              newSlides.push(landingSlide);
              createdSlideByLogicalIdx.set(toIdx, landingSlide);
              totalSlides++;
            }

            const createdSource = createdSlideByLogicalIdx.get(fromIdx);
            if (createdSource) {
              createdSource.transitionToNext.videoAsset = vid;
              transitionsMatched++;
            } else {
              unpairedVideos.push(vid);
            }
          } catch (err) {
            if (MediaValidator.isAbortError(err)) throw err;
            MediaValidator.revokeAssetUrls(vid);
            rejectedFiles.push({
              name: vid.name,
              reason:
                err instanceof Error
                  ? err.message
                  : t('core.videoProcessError', { name: vid.name }),
            });
          }
        }
      }

      return {
        newSlides,
        unpairedVideos,
        report: {
          slidesAdded: newSlides.length,
          transitionsMatched,
          rejectedFiles,
        },
      };
  }

  static parseIndicesFromFilename(name: string): { fromIndex: number; toIndex?: number } | null {
    const stem = name.replace(/\.[^/.]+$/, '');
    // Strip known technical tokens like 1920x1080, 1080p, 60fps, 4k before parsing indices
    let sanitized = stem
      .replace(/([_\-\s.]|^)\d{3,4}x\d{3,4}(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:2160|1440|1080|720|540|480|360|240)p(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:24|25|30|48|50|60|120|240)fps(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:4k|8k|2k)(?=[_\-\s.]|$)/gi, '$1');

    // 1. Matches "01_to_02", "1_to_2", "01-to-02", "1-2", "01_02"
    const pairRegex = /(?:^|[^\d])(\d+)\s*(?:_to_|-to-|\s+to\s+|_|-)\s*(\d+)(?:$|[^\d])/i;
    const pairMatch = sanitized.match(pairRegex);
    if (pairMatch) {
      const fromNum = parseInt(pairMatch[1], 10);
      const toNum = parseInt(pairMatch[2], 10);

      if (isResolutionPair(fromNum, toNum)) {
        sanitized = sanitized.replace(pairMatch[0], ' ');
      } else if (fromNum > 0 && fromNum <= 999 && toNum > 0 && toNum <= 999) {
        return {
          fromIndex: fromNum - 1,
          toIndex: toNum - 1,
        };
      }
    }

    // 2. Matches "slide_01", "01_intro", "transition_2", "انتقال_1", "scene_03", "clip_04"
    const prefixMatch = sanitized.match(
      /^(?:slide_?|شريحة_?|transition_?|انتقال_?|scene_?|clip_?|part_?|مقطع_?)?(\d+)/i
    );
    if (prefixMatch) {
      const num = parseInt(prefixMatch[1], 10);
      if (num > 0 && num <= 999) {
        return { fromIndex: num - 1, toIndex: num };
      }
    }

    // 3. First delimited standalone number (works across spaces, dashes, and underscores)
    const standaloneMatch = sanitized.match(/(?:^|[^a-z\d])(\d+)(?=$|[^a-z\d])/i);
    if (standaloneMatch) {
      const num = parseInt(standaloneMatch[1], 10);
      if (num > 0 && num <= 999) {
        return { fromIndex: num - 1, toIndex: num };
      }
    }

    return null;
  }

  static extractSlideIndexFromFilename(name: string): number | null {
    const parsed = SmartPairer.parseIndicesFromFilename(name);
    return parsed ? parsed.fromIndex : null;
  }

  static isIdleLoopFilename(name: string): boolean {
    const stem = name.replace(/\.[^/.]+$/, '');
    if (!/(?:^|[_\-\s.])(?:loop|idle)(?:[_\-\s.]|$)/i.test(stem)) {
      return false;
    }
    if (/(?:_to_|-to-|\s+to\s+)/i.test(stem)) {
      return false;
    }
    const sanitized = stem
      .replace(/([_\-\s.]|^)\d{3,4}x\d{3,4}(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:2160|1440|1080|720|540|480|360|240)p(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:24|25|30|48|50|60|120|240)fps(?=[_\-\s.]|$)/gi, '$1')
      .replace(/([_\-\s.]|^)(?:4k|8k|2k)(?=[_\-\s.]|$)/gi, '$1');
    const pairMatch = sanitized.match(/(?:^|[^\d])(\d+)\s*[-_]\s*(\d+)(?:$|[^\d])/);
    if (pairMatch) {
      const a = parseInt(pairMatch[1], 10);
      const b = parseInt(pairMatch[2], 10);
      if (!isResolutionPair(a, b)) return false;
    }
    return true;
  }

  static extractIdleLoopSlideIndex(name: string): number | null {
    if (!SmartPairer.isIdleLoopFilename(name)) return null;
    return SmartPairer.extractSlideIndexFromFilename(name);
  }

  static normalizeCuePoints(cueTimesSec: number[], durationSec: number): number[] {
    const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;

    const filtered = (Array.isArray(cueTimesSec) ? cueTimesSec : [])
      .filter((t) => typeof t === 'number' && Number.isFinite(t))
      .map((t) => Math.min(duration, Math.max(0, t)))
      .sort((a, b) => a - b);

    const deduplicated: number[] = [];
    for (const t of filtered) {
      const last = deduplicated[deduplicated.length - 1];
      if (last === undefined || Math.abs(t - last) >= 0.08) {
        deduplicated.push(t);
      }
    }

    if (deduplicated.length === 0) {
      return [0, duration];
    }
    if (deduplicated.length === 1) {
      const t = deduplicated[0];
      if (t < duration * 0.5) {
        return [t, duration];
      }
      return [0, t];
    }

    return deduplicated;
  }

  /**
   * Automatically scans a video for pause/settlement stages, velocity valleys,
   * and adaptive hard scene cuts using a two-pass multi-metric computer vision pipeline.
   */
  static async detectCuePointsFromVideo(
    videoAsset: MediaAsset,
    options: CueDetectionOptions = {}
  ): Promise<CueDetectionResult> {
    MediaValidator.throwIfAborted(options.signal);

    const sensitivity: CueDetectionSensitivity = options.sensitivity ?? 'medium';
    const maxCues = Math.max(2, Math.min(48, options.maxCues ?? 24));
    const defaultMinGapBySensitivity: Record<CueDetectionSensitivity, number> = {
      low: 0.9,
      medium: 0.55,
      high: 0.35,
    };
    const minGapSec = Math.max(
      0.15,
      options.minGapSec ?? defaultMinGapBySensitivity[sensitivity]
    );

    const session = await FrameExtractor.createSession(videoAsset, options.signal);
    const analysisCanvas = document.createElement('canvas');

    try {
      const durationSec = session.durationSec;
      if (durationSec <= 0.3) {
        const cues = this.normalizeCuePoints([0, durationSec], durationSec);
        options.onProgress?.(1);
        return {
          cueTimesSec: cues,
          candidates: [
            { timeSec: cues[0], confidence: 1, kind: 'start' },
            { timeSec: cues[cues.length - 1], confidence: 1, kind: 'end' },
          ],
          durationSec,
          method: 'uniform-fallback',
          samplesAnalyzed: 0,
          recommendedEasings: ['linear'],
        };
      }

      const { width, height } = MediaValidator.computeBoundedSize(
        session.width,
        session.height,
        160
      );
      analysisCanvas.width = width;
      analysisCanvas.height = height;
      const ctx = analysisCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error(t('core.motionAnalyzeCtxFailed'));
      }

      const targetSampleCount = Math.min(600, Math.max(24, Math.round(durationSec * 14)));
      const stepSec = Math.max(0.05, durationSec / targetSampleCount);
      const sampleTimes: number[] = [];
      const maxProbeTime = Math.max(0, durationSec - 0.01);

      for (let t = 0; t < maxProbeTime; t += stepSec) {
        sampleTimes.push(Number(t.toFixed(3)));
      }
      if (
        sampleTimes.length === 0 ||
        maxProbeTime - sampleTimes[sampleTimes.length - 1] > 0.02
      ) {
        sampleTimes.push(Number(maxProbeTime.toFixed(3)));
      }

      const n = sampleTimes.length;
      const signatures: FrameSignature[] = new Array(n);

      for (let i = 0; i < n; i++) {
        MediaValidator.throwIfAborted(options.signal);
        await session.drawFrameAt(sampleTimes[i], analysisCanvas, options.signal);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        signatures[i] = extractFrameSignature(rgba, width, height);
        options.onProgress?.(Math.min(0.84, 0.04 + 0.8 * ((i + 1) / n)));
      }

      const rawVelocity: number[] = new Array(n).fill(0);
      const effectiveMotion: number[] = new Array(n).fill(0);
      const cutScores: number[] = new Array(n).fill(0);
      const winSteps = Math.max(2, Math.round(0.14 / stepSec));

      for (let i = 1; i < n; i++) {
        const stepCmp = compareFrameSignatures(signatures[i - 1], signatures[i]);
        rawVelocity[i] = stepCmp.motionVelocity;
        cutScores[i] = stepCmp.cutScore;

        const hasBackWin = i >= winSteps;
        const hasFwdWin = i - 1 + winSteps < n;
        let windowDrift = 0;

        if (hasBackWin && hasFwdWin) {
          const backVel = compareFrameSignatures(signatures[i - winSteps], signatures[i]).motionVelocity;
          const fwdVel = compareFrameSignatures(signatures[i - 1], signatures[i - 1 + winSteps]).motionVelocity;
          windowDrift = Math.min(backVel, fwdVel);
        } else if (hasFwdWin) {
          windowDrift = compareFrameSignatures(signatures[i - 1], signatures[i - 1 + winSteps]).motionVelocity;
        } else if (hasBackWin) {
          windowDrift = compareFrameSignatures(signatures[i - winSteps], signatures[i]).motionVelocity;
        }

        effectiveMotion[i] = Math.max(stepCmp.motionVelocity, windowDrift * 0.65);
      }

      const pass1 = SmartPairer.analyzeMotionSignals({
        sampleTimes,
        rawVelocity,
        effectiveMotion,
        cutScores,
        durationSec,
        signatures,
        sensitivity,
        minGapSec,
        maxCues,
      });

      const candidates = pass1.candidates.map((c) => ({ ...c }));
      let samplesAnalyzed = n;

      // Pass 2: Sub-frame local refinement around interior detected cues
      const interiorIndices: number[] = [];
      for (let k = 0; k < candidates.length; k++) {
        const c = candidates[k];
        if (
          c.kind !== 'start' &&
          c.kind !== 'end' &&
          c.timeSec > 0.03 &&
          c.timeSec < durationSec - 0.03
        ) {
          interiorIndices.push(k);
        }
      }

      if (interiorIndices.length > 0 && stepSec > 0.035) {
        const totalBudget = 48;
        const probesPerCand = interiorIndices.length <= 12
          ? 4
          : Math.max(2, Math.floor(totalBudget / interiorIndices.length));
        const maxToRefine = Math.min(interiorIndices.length, Math.floor(totalBudget / probesPerCand));

        interface ProbeRequest {
          candArrayIdx: number;
          localIdx: number;
          timeSec: number;
        }
        const probeRequests: ProbeRequest[] = [];
        const candProbeTimes = new Map<number, number[]>();

        for (let idxPos = 0; idxPos < maxToRefine; idxPos++) {
          const candArrayIdx = interiorIndices[idxPos];
          const c = candidates[candArrayIdx];
          const prevBound = candArrayIdx > 0 ? candidates[candArrayIdx - 1].timeSec + 0.09 : 0.02;
          const nextBound =
            candArrayIdx < candidates.length - 1
              ? candidates[candArrayIdx + 1].timeSec - 0.09
              : maxProbeTime;

          if (prevBound >= nextBound) continue;

          const halfSpan = Math.min(0.75 * stepSec, 0.055);
          const winStart = Math.max(prevBound, c.timeSec - halfSpan);
          const winEnd = Math.min(nextBound, c.timeSec + halfSpan);
          if (winEnd - winStart < 0.015) continue;

          const times: number[] = [];
          for (let j = 0; j < probesPerCand; j++) {
            const frac = probesPerCand === 1 ? 0.5 : j / (probesPerCand - 1);
            const t = Number((winStart + frac * (winEnd - winStart)).toFixed(3));
            times.push(t);
            probeRequests.push({ candArrayIdx, localIdx: j, timeSec: t });
          }
          candProbeTimes.set(candArrayIdx, times);
        }

        probeRequests.sort((a, b) => a.timeSec - b.timeSec);
        const refinedSigs = new Map<number, FrameSignature[]>();
        const totalProbes = probeRequests.length;

        for (let p = 0; p < totalProbes; p++) {
          MediaValidator.throwIfAborted(options.signal);
          const req = probeRequests[p];
          await session.drawFrameAt(req.timeSec, analysisCanvas, options.signal);
          const rgba = ctx.getImageData(0, 0, width, height).data;
          const sig = extractFrameSignature(rgba, width, height);
          let arr = refinedSigs.get(req.candArrayIdx);
          if (!arr) {
            arr = new Array(candProbeTimes.get(req.candArrayIdx)!.length);
            refinedSigs.set(req.candArrayIdx, arr);
          }
          arr[req.localIdx] = sig;
          samplesAnalyzed++;
          options.onProgress?.(Math.min(0.98, 0.85 + 0.13 * ((p + 1) / Math.max(1, totalProbes))));
        }

        for (const [candArrayIdx, sigs] of refinedSigs.entries()) {
          const times = candProbeTimes.get(candArrayIdx)!;
          const cand = candidates[candArrayIdx];
          if (!sigs || sigs.length < 2) continue;

          if (cand.kind === 'scene-cut') {
            let bestCutIdx = 1;
            let bestCutScore = -1;
            for (let j = 1; j < sigs.length; j++) {
              const cmp = compareFrameSignatures(sigs[j - 1], sigs[j]);
              if (cmp.cutScore > bestCutScore) {
                bestCutScore = cmp.cutScore;
                bestCutIdx = j;
              }
            }
            cand.timeSec = Number(times[bestCutIdx].toFixed(2));
            cand.sharpnessScore = Number(sigs[bestCutIdx].meanEdgeSharpness.toFixed(4));
          } else {
            let bestIdx = 0;
            let bestVel = Infinity;
            let bestSharp = -1;
            for (let j = 0; j < sigs.length; j++) {
              let vel = 0;
              if (j === 0) {
                vel = compareFrameSignatures(sigs[0], sigs[1]).motionVelocity;
              } else if (j === sigs.length - 1) {
                vel = compareFrameSignatures(sigs[j - 1], sigs[j]).motionVelocity;
              } else {
                vel =
                  0.5 *
                  (compareFrameSignatures(sigs[j - 1], sigs[j]).motionVelocity +
                    compareFrameSignatures(sigs[j], sigs[j + 1]).motionVelocity);
              }
              const sharp = sigs[j].meanEdgeSharpness;
              if (vel < bestVel - 0.002 || (Math.abs(vel - bestVel) <= 0.002 && sharp > bestSharp)) {
                bestVel = vel;
                bestSharp = sharp;
                bestIdx = j;
              }
            }
            cand.timeSec = Number(times[bestIdx].toFixed(2));
            cand.sharpnessScore = Number(sigs[bestIdx].meanEdgeSharpness.toFixed(4));
          }
        }
      }

      candidates.sort((a, b) => a.timeSec - b.timeSec);
      const normalizedCues = this.normalizeCuePoints(
        candidates.map((c) => c.timeSec),
        durationSec
      );
      const recommendedEasings = inferSegmentEasings(
        normalizedCues,
        sampleTimes,
        rawVelocity,
        candidates
      );

      options.onProgress?.(1);
      return {
        cueTimesSec: normalizedCues,
        candidates,
        durationSec,
        method: pass1.method,
        samplesAnalyzed,
        recommendedEasings,
        motionProfile: pass1.motionProfile,
      };
    } finally {
      analysisCanvas.width = 0;
      analysisCanvas.height = 0;
      session.dispose();
    }
  }

  /**
   * Pure deterministic signal analyzer exposed for direct unit testing and two-pass motion analysis.
   */
  static analyzeMotionSignals(
    input: MotionSignalInput
  ): Pick<
    CueDetectionResult,
    'cueTimesSec' | 'candidates' | 'method' | 'recommendedEasings' | 'motionProfile'
  > {
    const sensitivity: CueDetectionSensitivity = input.sensitivity ?? 'medium';
    const maxCues = Math.max(2, Math.min(48, input.maxCues ?? 24));
    const defaultMinGapBySensitivity: Record<CueDetectionSensitivity, number> = {
      low: 0.9,
      medium: 0.55,
      high: 0.35,
    };
    const minGapSec = Math.max(
      0.15,
      input.minGapSec ?? defaultMinGapBySensitivity[sensitivity]
    );

    return analyzeMotionCurve(
      input.sampleTimes,
      input.rawVelocity ?? input.effectiveMotion,
      input.effectiveMotion,
      input.cutScores,
      input.durationSec,
      sensitivity,
      minGapSec,
      maxCues,
      input.signatures
    );
  }

  /**
   * Builds SlideNodes and time-sliced TransitionSpecs from cue points using a single
   * reusable video decoder session for fast, pixel-exact frame extraction.
   */
  static async buildSlidesFromVideoCuePoints(
    videoAsset: MediaAsset,
    cueTimesSec: number[],
    defaultFallbackOrOptions: FallbackTransitionStyle | BuildCueSlidesOptions = 'crossfade'
  ): Promise<SlideNode[]> {
    const opts: BuildCueSlidesOptions =
      typeof defaultFallbackOrOptions === 'string'
        ? { defaultFallback: defaultFallbackOrOptions }
        : defaultFallbackOrOptions || {};

    MediaValidator.throwIfAborted(opts.signal);

    const defaultFallback = opts.defaultFallback ?? 'crossfade';
    let durationSec = videoAsset.durationSec;

    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      const probe = await FrameExtractor.createSession(videoAsset, opts.signal);
      durationSec = probe.durationSec;
      probe.dispose();
    }

    const normalized = this.normalizeCuePoints(cueTimesSec, durationSec);
    const labels = normalized.map(
      (timeSec, i) => `${t('slide.filePrefixHold')}_${i + 1}_${timeSec.toFixed(2)}s.png`
    );

    const frameAssets = await FrameExtractor.extractFramesAtTimes(videoAsset, normalized, {
      labels,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });

    const slides: SlideNode[] = [];
    try {
      for (let i = 0; i < normalized.length; i++) {
        const timeSec = normalized[i];
        const frameAsset = frameAssets[i];
        const slide = createSlideNode(frameAsset, i, defaultFallback);
        slide.title =
          opts.cueLabels?.[i]?.trim() ||
          t('slide.cueTitle', { index: i + 1, time: timeSec.toFixed(2) });

        if (opts.defaultFallbackDurationMs !== undefined) {
          slide.transitionToNext.fallbackDurationMs = opts.defaultFallbackDurationMs;
        }

        if (i < normalized.length - 1) {
          slide.transitionToNext.videoAsset = videoAsset;
          slide.transitionToNext.startTimeSec = normalized[i];
          slide.transitionToNext.endTimeSec = normalized[i + 1];
          if (opts.muted !== undefined) {
            slide.transitionToNext.muted = opts.muted;
          }
          if (opts.playbackSpeed !== undefined) {
            slide.transitionToNext.playbackSpeed = opts.playbackSpeed;
          }
          if (opts.segmentEasings?.[i]) {
            slide.transitionToNext.easing = opts.segmentEasings[i];
          }
        }

        slides.push(slide);
      }

      return slides;
    } catch (err) {
      for (const asset of frameAssets) {
        MediaValidator.revokeAssetUrls(asset);
      }
      throw err;
    }
  }

  /**
   * Reconstructs ordered cue timestamps from existing reel-derived slides
   * so users can re-open the Cue Modal and non-destructively adjust stops.
   */
  static extractCuePointsFromSlides(slides: SlideNode[], videoAssetId?: string): number[] {
    if (!slides.length) return [];

    let targetVideoId = videoAssetId;
    if (!targetVideoId) {
      const firstSliced = slides.find(
        (s) =>
          s.transitionToNext.videoAsset &&
          (typeof s.transitionToNext.startTimeSec === 'number' ||
            typeof s.transitionToNext.endTimeSec === 'number')
      );
      targetVideoId =
        firstSliced?.transitionToNext.videoAsset?.id ||
        slides.find((s) => s.transitionToNext.videoAsset)?.transitionToNext.videoAsset?.id;
    }

    if (!targetVideoId) return [];

    const cues: number[] = [];
    for (const slide of slides) {
      const spec = slide.transitionToNext;
      if (spec.videoAsset?.id === targetVideoId) {
        if (typeof spec.startTimeSec === 'number' && Number.isFinite(spec.startTimeSec)) {
          cues.push(spec.startTimeSec);
        } else if (
          typeof slide.imageAsset.sourceTimeSec === 'number' &&
          Number.isFinite(slide.imageAsset.sourceTimeSec)
        ) {
          cues.push(slide.imageAsset.sourceTimeSec);
        }
        if (typeof spec.endTimeSec === 'number' && Number.isFinite(spec.endTimeSec)) {
          cues.push(spec.endTimeSec);
        }
      } else if (
        slide.imageAsset.sourceVideoId === targetVideoId &&
        typeof slide.imageAsset.sourceTimeSec === 'number' &&
        Number.isFinite(slide.imageAsset.sourceTimeSec)
      ) {
        cues.push(slide.imageAsset.sourceTimeSec);
      }
    }

    const refAsset = slides.find((s) => s.transitionToNext.videoAsset?.id === targetVideoId)
      ?.transitionToNext.videoAsset;
    const duration = refAsset?.durationSec || (cues.length > 0 ? Math.max(...cues) : 1);
    return cues.length > 0 ? this.normalizeCuePoints(cues, duration) : [];
  }
}

export function extractFrameSignature(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): FrameSignature {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const pixelCount = safeW * safeH;
  const luma = new Uint8Array(pixelCount);
  const edgeMag = new Uint8Array(pixelCount);

  const blockLumaMean = new Float32Array(64);
  const blockLumaVar = new Float32Array(64);
  const blockChromaU = new Float32Array(64);
  const blockChromaV = new Float32Array(64);
  const blockEdgeMean = new Float32Array(64);
  const hist = new Float32Array(48);

  const blockCount = new Uint32Array(64);
  const blockSumY = new Float64Array(64);
  const blockSumY2 = new Float64Array(64);
  const blockSumU = new Float64Array(64);
  const blockSumV = new Float64Array(64);
  const blockSumE = new Float64Array(64);

  for (let y = 0; y < safeH; y++) {
    const by = Math.min(7, ((y * 8) / safeH) | 0);
    const rowOffset = y * safeW;
    for (let x = 0; x < safeW; x++) {
      const p = rowOffset + x;
      const off = p * 4;
      const r = rgba[off];
      const g = rgba[off + 1];
      const b = rgba[off + 2];

      const yVal = (54 * r + 183 * g + 19 * b) >> 8;
      luma[p] = yVal;

      const u = b - yVal;
      const v = r - yVal;

      const bx = Math.min(7, ((x * 8) / safeW) | 0);
      const bi = (by << 3) + bx;

      blockCount[bi]++;
      blockSumY[bi] += yVal;
      blockSumY2[bi] += yVal * yVal;
      blockSumU[bi] += u;
      blockSumV[bi] += v;

      const yBin = Math.min(31, yVal >> 3);
      const uBin = 32 + Math.max(0, Math.min(7, (u + 256) >> 6));
      const vBin = 40 + Math.max(0, Math.min(7, (v + 256) >> 6));
      hist[yBin] += 1;
      hist[uBin] += 1;
      hist[vBin] += 1;
    }
  }

  let edgeSum = 0;
  let interiorCount = 0;
  if (safeW >= 3 && safeH >= 3) {
    for (let y = 1; y < safeH - 1; y++) {
      const by = Math.min(7, ((y * 8) / safeH) | 0);
      const rowOffset = y * safeW;
      for (let x = 1; x < safeW - 1; x++) {
        const p = rowOffset + x;
        const gx = Math.abs(luma[p + 1] - luma[p - 1]);
        const gy = Math.abs(luma[p + safeW] - luma[p - safeW]);
        const e = Math.min(255, gx + gy);
        edgeMag[p] = e;
        edgeSum += e;
        interiorCount++;

        const bx = Math.min(7, ((x * 8) / safeW) | 0);
        const bi = (by << 3) + bx;
        blockSumE[bi] += e;
      }
    }
  }

  for (let b = 0; b < 64; b++) {
    const cnt = blockCount[b];
    if (cnt > 0) {
      const meanY = blockSumY[b] / cnt;
      blockLumaMean[b] = meanY;
      blockLumaVar[b] = Math.max(0, blockSumY2[b] / cnt - meanY * meanY);
      blockChromaU[b] = blockSumU[b] / cnt;
      blockChromaV[b] = blockSumV[b] / cnt;
      blockEdgeMean[b] = blockSumE[b] / cnt;
    }
  }

  const histNorm = 1 / (3 * Math.max(1, pixelCount));
  for (let k = 0; k < 48; k++) {
    hist[k] *= histNorm;
  }

  const meanEdgeSharpness = interiorCount > 0 ? edgeSum / (interiorCount * 255) : 0;

  return {
    width: safeW,
    height: safeH,
    luma,
    edgeMag,
    meanEdgeSharpness,
    blockLumaMean,
    blockLumaVar,
    blockChromaU,
    blockChromaV,
    blockEdgeMean,
    hist,
  };
}

export function compareFrameSignatures(
  sigA: FrameSignature,
  sigB: FrameSignature
): FrameComparisonMetrics {
  const width = Math.min(sigA.width, sigB.width);
  const height = Math.min(sigA.height, sigB.height);
  const pixelCount = width * height;
  if (pixelCount <= 0 || sigA.luma.length !== sigB.luma.length) {
    return {
      globalLumaMad: 0,
      activeBlockScore: 0,
      edgeChangeScore: 0,
      ssimDissimilarity: 0,
      histDistance: 0,
      motionVelocity: 0,
      cutScore: 0,
      contentDisplacement: 0,
    };
  }

  let madSum = 0;
  let edgeDiffSum = 0;
  let strongA = 0;
  let strongB = 0;
  let enteringEdges = 0;
  let exitingEdges = 0;

  const blockProd = new Float64Array(64);
  const blockCnt = new Uint32Array(64);

  for (let y = 0; y < height; y++) {
    const by = Math.min(7, ((y * 8) / height) | 0);
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const p = rowOffset + x;
      const ya = sigA.luma[p];
      const yb = sigB.luma[p];
      const dy = Math.abs(ya - yb);
      if (dy > 3) {
        madSum += dy;
      }

      const ea = sigA.edgeMag[p];
      const eb = sigB.edgeMag[p];
      edgeDiffSum += Math.abs(ea - eb);

      const isStrongA = ea > 28;
      const isStrongB = eb > 28;
      if (isStrongA) strongA++;
      if (isStrongB) strongB++;
      if (!isStrongA && isStrongB) enteringEdges++;
      else if (isStrongA && !isStrongB) exitingEdges++;

      const bx = Math.min(7, ((x * 8) / width) | 0);
      const bi = (by << 3) + bx;
      blockProd[bi] += ya * yb;
      blockCnt[bi]++;
    }
  }

  const globalLumaMad = madSum / (pixelCount * 255);
  const edgeDenom = Math.max(strongA, strongB, Math.round(pixelCount * 0.015));
  const ecr = Math.max(enteringEdges, exitingEdges) / Math.max(1, edgeDenom);
  const globalEdgeDiff = edgeDiffSum / (pixelCount * 255);
  const edgeChangeScore = Math.min(1, 0.55 * ecr + 0.45 * globalEdgeDiff);

  const C1 = 6.5025; // (0.01 * 255)^2
  const C2 = 58.5225; // (0.03 * 255)^2
  const blockDeltas: number[] = [];
  let ssimDissimSum = 0;
  let activeBlocks = 0;

  for (let b = 0; b < 64; b++) {
    const cnt = blockCnt[b];
    if (cnt === 0) continue;
    activeBlocks++;

    const muA = sigA.blockLumaMean[b];
    const muB = sigB.blockLumaMean[b];
    const du = Math.abs(sigA.blockChromaU[b] - sigB.blockChromaU[b]);
    const dv = Math.abs(sigA.blockChromaV[b] - sigB.blockChromaV[b]);
    const de = Math.abs(sigA.blockEdgeMean[b] - sigB.blockEdgeMean[b]);
    const rawBlock = Math.abs(muA - muB) + 0.45 * (du + dv) + 0.35 * de;
    blockDeltas.push(Math.min(1, rawBlock / 255));

    const varA = sigA.blockLumaVar[b];
    const varB = sigB.blockLumaVar[b];
    const cov = blockProd[b] / cnt - muA * muB;
    const num = (2 * muA * muB + C1) * (2 * cov + C2);
    const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
    const ssim = den > 0 ? Math.max(-1, Math.min(1, num / den)) : 1;
    ssimDissimSum += Math.max(0, Math.min(1, 1 - ssim));
  }

  blockDeltas.sort((a, b) => b - a);
  const topK = Math.min(6, blockDeltas.length);
  let topSum = 0;
  for (let k = 0; k < topK; k++) {
    topSum += blockDeltas[k];
  }
  const activeBlockScore = topK > 0 ? topSum / topK : 0;
  const ssimDissimilarity = activeBlocks > 0 ? ssimDissimSum / activeBlocks : 0;

  let histL1 = 0;
  for (let k = 0; k < 48; k++) {
    histL1 += Math.abs(sigA.hist[k] - sigB.hist[k]);
  }
  const histDistance = Math.min(1, 0.5 * histL1);

  const motionVelocity =
    0.22 * globalLumaMad +
    0.38 * activeBlockScore +
    0.25 * edgeChangeScore +
    0.15 * ssimDissimilarity;
  const cutScore =
    0.35 * ssimDissimilarity +
    0.35 * histDistance +
    0.30 * edgeChangeScore;
  const contentDisplacement =
    0.30 * activeBlockScore +
    0.30 * ssimDissimilarity +
    0.20 * histDistance +
    0.20 * edgeChangeScore;

  return {
    globalLumaMad,
    activeBlockScore,
    edgeChangeScore,
    ssimDissimilarity,
    histDistance,
    motionVelocity,
    cutScore,
    contentDisplacement,
  };
}

interface InternalCandidate extends DetectedCueCandidate {
  sampleIdx: number;
  coversFinalHold?: boolean;
}

function analyzeMotionCurve(
  sampleTimes: number[],
  rawVelocity: number[],
  effectiveMotion: number[],
  cutScores: number[],
  durationSec: number,
  sensitivity: CueDetectionSensitivity,
  minGapSec: number,
  maxCues: number,
  signatures?: FrameSignature[]
): Pick<
  CueDetectionResult,
  'cueTimesSec' | 'candidates' | 'method' | 'recommendedEasings' | 'motionProfile'
> {
  const n = sampleTimes.length;
  if (n < 3) {
    const cues = SmartPairer.normalizeCuePoints([0, durationSec], durationSec);
    return {
      cueTimesSec: cues,
      candidates: [
        { timeSec: cues[0], confidence: 1, kind: 'start' },
        { timeSec: cues[cues.length - 1], confidence: 1, kind: 'end' },
      ],
      method: 'uniform-fallback',
      recommendedEasings: new Array(Math.max(0, cues.length - 1)).fill('linear'),
      motionProfile: {
        sampleTimes: [...sampleTimes],
        motionScores: [...effectiveMotion],
        cutScores: [...cutScores],
        stillThreshold: 0.014,
      },
    };
  }

  const avgStepSec = Math.max(
    0.01,
    (sampleTimes[n - 1] - sampleTimes[0]) / Math.max(1, n - 1)
  );

  // 1. Adaptive noise floor calibration from lower distribution + MAD
  const nonZeroMotions = effectiveMotion.slice(1).sort((a, b) => a - b);
  const p15 = nonZeroMotions[Math.floor(nonZeroMotions.length * 0.15)] ?? 0;
  const lowSliceCount = Math.max(1, Math.floor(nonZeroMotions.length * 0.35));
  const lowDevs = nonZeroMotions
    .slice(0, lowSliceCount)
    .map((v) => Math.abs(v - p15))
    .sort((a, b) => a - b);
  const madLow = lowDevs[Math.floor(lowDevs.length * 0.5)] ?? 0;
  const noiseFloor = Math.min(0.018, p15 + 0.5 * madLow);

  const paramsBySensitivity: Record<
    CueDetectionSensitivity,
    {
      stillOffset: number;
      minHoldSec: number;
      cutMultiplier: number;
      minCutAbs: number;
      minContentDiff: number;
    }
  > = {
    high: {
      stillOffset: 0.007,
      minHoldSec: 0.14,
      cutMultiplier: 2.3,
      minCutAbs: 0.055,
      minContentDiff: 0.022,
    },
    medium: {
      stillOffset: 0.012,
      minHoldSec: 0.2,
      cutMultiplier: 2.9,
      minCutAbs: 0.085,
      minContentDiff: 0.032,
    },
    low: {
      stillOffset: 0.022,
      minHoldSec: 0.3,
      cutMultiplier: 3.6,
      minCutAbs: 0.13,
      minContentDiff: 0.048,
    },
  };

  const cfg = paramsBySensitivity[sensitivity];
  const minThresholdFloor = sensitivity === 'high' ? 0.010 : sensitivity === 'medium' ? 0.012 : 0.020;
  const stillThreshold = Math.max(minThresholdFloor, noiseFloor + cfg.stillOffset);

  const median3 = (a: number, b: number, c: number): number => {
    if (a <= b) return b <= c ? b : a <= c ? c : a;
    return a <= c ? a : b <= c ? c : b;
  };

  // Light 3-tap smoothing for continuous valley prominence & sparkline curve
  const smoothed = effectiveMotion.map((val, idx) => {
    if (idx === 0) return effectiveMotion[1] ?? val;
    const prev = effectiveMotion[idx - 1];
    const next = effectiveMotion[Math.min(n - 1, idx + 1)];
    return (prev + val * 2 + next) / 4;
  });

  // 3-tap median filter prevents active neighbors from diluting crisp short plateaus while preserving genuine motion spikes and hard scene cuts
  const stillSignal = effectiveMotion.map((val, idx) => {
    if (idx === 0) return effectiveMotion[1] ?? val;
    const prev = effectiveMotion[idx - 1];
    const next = effectiveMotion[Math.min(n - 1, idx + 1)];
    if (val > stillThreshold * 2.2 || (cutScores[idx] ?? 0) >= cfg.minCutAbs * 0.75) {
      return val;
    }
    return median3(prev, val, next);
  });

  // 2. Detect stillness plateaus with off-by-one boundary correction & endpoint drift trimming
  const rawPlateaus: Array<{
    startIdx: number;
    rawStartIdx: number;
    endIdx: number;
    startSec: number;
    endSec: number;
  }> = [];
  const inPlateau = new Uint8Array(n);
  let inStill = false;
  let runStart = 0;

  const tryPushPlateau = (rStart: number, rEnd: number) => {
    let pStartIdx = Math.max(0, rStart - 1);
    let effectiveRawStart = rStart;
    const endSec = sampleTimes[rEnd];
    if (endSec - sampleTimes[pStartIdx] < cfg.minHoldSec) return;

    if (signatures && signatures.length === n) {
      while (
        pStartIdx < rEnd - 1 &&
        endSec - sampleTimes[pStartIdx + 1] >= cfg.minHoldSec
      ) {
        const disp = compareFrameSignatures(
          signatures[pStartIdx],
          signatures[rEnd]
        ).contentDisplacement;
        if (disp <= Math.max(cfg.minContentDiff * 0.9, stillThreshold * 2.2)) {
          break;
        }
        pStartIdx++;
        effectiveRawStart = Math.max(effectiveRawStart, pStartIdx + 1);
      }
    }

    const startSec = sampleTimes[pStartIdx];
    if (endSec - startSec >= cfg.minHoldSec) {
      for (let k = pStartIdx; k <= rEnd; k++) {
        inPlateau[k] = 1;
      }
      rawPlateaus.push({
        startIdx: pStartIdx,
        rawStartIdx: effectiveRawStart,
        endIdx: rEnd,
        startSec,
        endSec,
      });
    }
  };

  for (let i = 0; i < n; i++) {
    const isStill = stillSignal[i] <= stillThreshold;
    if (isStill && !inStill) {
      inStill = true;
      runStart = i;
    } else if (!isStill && inStill) {
      inStill = false;
      tryPushPlateau(runStart, i - 1);
    }
  }
  if (inStill) {
    tryPushPlateau(runStart, n - 1);
  }

  const plateauCandidates: InternalCandidate[] = [];
  for (const plateau of rawPlateaus) {
    if (plateau.startIdx === 0) continue; // Slide 1's initial idle hold

    const span = plateau.endSec - plateau.startSec;
    const targetSettleTime = plateau.startSec + Math.min(0.12, span * 0.3);
    const searchEndIdx = Math.min(
      plateau.endIdx,
      plateau.rawStartIdx + Math.ceil(0.18 / avgStepSec)
    );

    let bestIdx = plateau.rawStartIdx;
    let bestVel = Infinity;
    let bestSharp = -1;

    for (let k = plateau.rawStartIdx; k <= searchEndIdx; k++) {
      if (sampleTimes[k] < targetSettleTime && k < searchEndIdx) continue;
      const vel = rawVelocity[k] ?? smoothed[k];
      const sharp = signatures?.[k]?.meanEdgeSharpness ?? 0;
      if (
        vel < bestVel - 0.002 ||
        (Math.abs(vel - bestVel) <= 0.002 && sharp > bestSharp)
      ) {
        bestVel = vel;
        bestSharp = sharp;
        bestIdx = k;
      }
    }

    if (bestVel === Infinity) {
      bestIdx = plateau.rawStartIdx;
    }

    const cueTime = Number(Math.min(durationSec, sampleTimes[bestIdx]).toFixed(2));
    const confidence = Math.min(
      0.99,
      Number((0.72 + Math.min(0.27, span * 0.28)).toFixed(2))
    );

    plateauCandidates.push({
      timeSec: cueTime,
      confidence,
      kind: 'pause-settle',
      plateauStartSec: Number(plateau.startSec.toFixed(2)),
      plateauEndSec: Number(plateau.endSec.toFixed(2)),
      sharpnessScore:
        signatures?.[bestIdx] !== undefined
          ? Number(signatures[bestIdx].meanEdgeSharpness.toFixed(4))
          : undefined,
      sampleIdx: bestIdx,
      coversFinalHold: durationSec - plateau.endSec <= 0.35,
    });
  }

  // 3. Prominence-based Velocity Valley detection outside plateaus
  const valleyCandidates: InternalCandidate[] = [];
  const valleyRadius = Math.max(2, Math.round(0.16 / avgStepSec));
  const peakLookSteps = Math.max(valleyRadius + 1, Math.round(0.8 / avgStepSec));

  for (let i = valleyRadius; i < n - valleyRadius; i++) {
    if (inPlateau[i]) continue;
    const val = smoothed[i];
    if (val > Math.max(0.065, stillThreshold * 3.8)) continue;

    let isLocalMin = true;
    let strictlyLowerCount = 0;
    for (let j = i - valleyRadius; j <= i + valleyRadius; j++) {
      if (j === i) continue;
      if (smoothed[j] < val - 1e-6) {
        isLocalMin = false;
        break;
      }
      if (smoothed[j] > val + 1e-6) {
        strictlyLowerCount++;
      }
    }
    if (!isLocalMin || strictlyLowerCount === 0) continue;

    // For flat ties, pick sample with lowest rawVelocity inside local neighborhood
    const rawVelI = rawVelocity[i] ?? val;
    let tiedBetterExists = false;
    for (let j = i - valleyRadius; j < i; j++) {
      if (Math.abs(smoothed[j] - val) <= 1e-6 && (rawVelocity[j] ?? smoothed[j]) <= rawVelI) {
        tiedBetterExists = true;
        break;
      }
    }
    if (tiedBetterExists) continue;

    let leftPeak = 0;
    for (let j = Math.max(0, i - peakLookSteps); j < i; j++) {
      if (smoothed[j] > leftPeak) leftPeak = smoothed[j];
    }
    let rightPeak = 0;
    for (let j = i + 1; j <= Math.min(n - 1, i + peakLookSteps); j++) {
      if (smoothed[j] > rightPeak) rightPeak = smoothed[j];
    }

    const leftOk = leftPeak >= Math.max(stillThreshold * 2.4, val * 2.6);
    const rightOk = rightPeak >= Math.max(stillThreshold * 2.0, val * 2.2);
    if (!leftOk || !rightOk) continue;

    const promRatio = Math.min(leftPeak, rightPeak) / Math.max(0.005, val);
    const confidence = Math.min(
      0.94,
      Number((0.64 + Math.min(0.3, promRatio * 0.04)).toFixed(2))
    );

    valleyCandidates.push({
      timeSec: Number(sampleTimes[i].toFixed(2)),
      confidence,
      kind: 'velocity-valley',
      sharpnessScore:
        signatures?.[i] !== undefined
          ? Number(signatures[i].meanEdgeSharpness.toFixed(4))
          : undefined,
      sampleIdx: i,
    });
  }

  // 4. Rolling-window adaptive scene cuts (PySceneDetect-style baseline)
  const cutCandidates: InternalCandidate[] = [];
  const cutWindowSteps = Math.max(4, Math.round(0.65 / avgStepSec));

  for (let i = 1; i < n - 1; i++) {
    const score = cutScores[i] ?? 0;
    if (score < cfg.minCutAbs) continue;
    if (score < (cutScores[i - 1] ?? 0) || score <= (cutScores[i + 1] ?? 0)) continue;
    if ((cutScores[i + 1] ?? 0) >= score * 0.72) continue;

    const baselineVals: number[] = [];
    const wStart = Math.max(1, i - cutWindowSteps);
    const wEnd = Math.min(n - 1, i + cutWindowSteps);
    for (let j = wStart; j <= wEnd; j++) {
      if (Math.abs(j - i) <= 1) continue;
      baselineVals.push(cutScores[j] ?? 0);
    }

    let localMean = 0;
    let localMad = 0;
    if (baselineVals.length > 0) {
      let sum = 0;
      for (const v of baselineVals) sum += v;
      localMean = sum / baselineVals.length;
      const devs = baselineVals.map((v) => Math.abs(v - localMean)).sort((a, b) => a - b);
      localMad = devs[Math.floor(devs.length * 0.5)] ?? 0;
    }

    const adaptiveCutThreshold = Math.max(
      cfg.minCutAbs,
      localMean + cfg.cutMultiplier * Math.max(0.01, localMad)
    );
    if (score < adaptiveCutThreshold) continue;

    cutCandidates.push({
      timeSec: Number(sampleTimes[i].toFixed(2)),
      confidence: Math.min(0.97, Number((0.62 + Math.min(0.35, score * 0.8)).toFixed(2))),
      kind: 'scene-cut',
      sharpnessScore:
        signatures?.[i] !== undefined
          ? Number(signatures[i].meanEdgeSharpness.toFixed(4))
          : undefined,
      sampleIdx: i,
    });
  }

  // 5. Conflict resolution between scene-cuts and nearby pause-settles
  const suppressedCutIndices = new Set<number>();
  const suppressedPlateauIndices = new Set<number>();

  for (let ci = 0; ci < cutCandidates.length; ci++) {
    const cut = cutCandidates[ci];
    for (let pi = 0; pi < plateauCandidates.length; pi++) {
      const p = plateauCandidates[pi];
      const pStart = p.plateauStartSec ?? p.timeSec;
      const nearPlateauStart =
        cut.timeSec >= pStart - 0.35 && cut.timeSec <= pStart + 0.15;
      const nearCueTime = Math.abs(cut.timeSec - p.timeSec) < minGapSec * 0.85;
      if (nearPlateauStart || nearCueTime) {
        const postCutVel =
          rawVelocity[Math.min(n - 1, cut.sampleIdx + 1)] ??
          smoothed[Math.min(n - 1, cut.sampleIdx + 1)];
        if (postCutVel <= stillThreshold) {
          // Instant hard cut directly into static slide: keep exact cut frame
          if (p.coversFinalHold) {
            cut.coversFinalHold = true;
            cut.plateauEndSec = p.plateauEndSec;
          }
          suppressedPlateauIndices.add(pi);
        } else {
          // Animated transition settle: prefer the settled frame
          suppressedCutIndices.add(ci);
        }
      }
    }
  }

  const mergedPool: InternalCandidate[] = [
    ...plateauCandidates.filter((_, idx) => !suppressedPlateauIndices.has(idx)),
    ...cutCandidates.filter((_, idx) => !suppressedCutIndices.has(idx)),
    ...valleyCandidates,
  ];

  const kindPriority: Record<DetectedCueCandidate['kind'], number> = {
    start: 0,
    'pause-settle': 1,
    'scene-cut': 2,
    'velocity-valley': 3,
    end: 4,
  };
  mergedPool.sort(
    (a, b) => a.timeSec - b.timeSec || kindPriority[a.kind] - kindPriority[b.kind]
  );

  // 6. Sequential acceptance with minGapSec & Perceptual Content Deduplication Gate
  const accepted: InternalCandidate[] = [
    {
      timeSec: 0,
      confidence: 1,
      kind: 'start',
      sharpnessScore:
        signatures?.[0] !== undefined
          ? Number(signatures[0].meanEdgeSharpness.toFixed(4))
          : undefined,
      sampleIdx: 0,
    },
  ];

  let lastAcceptedIdx = 0;
  let lastAcceptedSig = signatures?.[0];
  let hasPlateauOrValleyCues = false;
  let hasCutCues = false;

  for (const cand of mergedPool) {
    if (accepted.length >= maxCues) break;
    const prev = accepted[accepted.length - 1];

    if (cand.timeSec - prev.timeSec < minGapSec) {
      // Allow higher-priority candidate to upgrade a nearby lower-priority one (except start)
      if (
        prev.kind !== 'start' &&
        kindPriority[cand.kind] < kindPriority[prev.kind] &&
        accepted.length >= 2 &&
        cand.timeSec - accepted[accepted.length - 2].timeSec >= minGapSec
      ) {
        // Check content gate relative to the cue before prev
        const anchorIdx = accepted[accepted.length - 2].sampleIdx;
        const anchorSig = signatures?.[anchorIdx];
        if (signatures && signatures.length === n && anchorSig) {
          const disp = compareFrameSignatures(
            anchorSig,
            signatures[cand.sampleIdx]
          ).contentDisplacement;
          let peak = 0;
          for (let k = anchorIdx + 1; k <= cand.sampleIdx; k++) {
            if (smoothed[k] > peak) peak = smoothed[k];
          }
          const isIdenticalFrame =
            disp < cfg.minContentDiff * 0.45 && peak < Math.max(0.16, stillThreshold * 8.0);
          if (
            isIdenticalFrame ||
            (disp < cfg.minContentDiff && peak < Math.max(0.08, stillThreshold * 4.5))
          ) {
            continue;
          }
        }
        accepted[accepted.length - 1] = cand;
        lastAcceptedIdx = cand.sampleIdx;
        lastAcceptedSig = signatures?.[cand.sampleIdx];
      }
      continue;
    }

    if (signatures && signatures.length === n && lastAcceptedSig) {
      const disp = compareFrameSignatures(
        lastAcceptedSig,
        signatures[cand.sampleIdx]
      ).contentDisplacement;
      let peakSmoothed = 0;
      for (let k = lastAcceptedIdx + 1; k <= cand.sampleIdx; k++) {
        if (smoothed[k] > peakSmoothed) peakSmoothed = smoothed[k];
      }
      const isIdenticalFrame =
        disp < cfg.minContentDiff * 0.45 &&
        peakSmoothed < Math.max(0.16, stillThreshold * 8.0);
      if (
        isIdenticalFrame ||
        (disp < cfg.minContentDiff &&
          peakSmoothed < Math.max(0.08, stillThreshold * 4.5))
      ) {
        continue;
      }
      lastAcceptedSig = signatures[cand.sampleIdx];
    }

    lastAcceptedIdx = cand.sampleIdx;
    accepted.push(cand);
  }

  for (let i = 1; i < accepted.length; i++) {
    const k = accepted[i].kind;
    if (k === 'pause-settle' || k === 'velocity-valley') hasPlateauOrValleyCues = true;
    else if (k === 'scene-cut') hasCutCues = true;
  }

  const motionProfile = {
    sampleTimes: [...sampleTimes],
    motionScores: smoothed.map((v) => Number(v.toFixed(5))),
    cutScores: cutScores.map((v) => Number(v.toFixed(5))),
    stillThreshold: Number(stillThreshold.toFixed(5)),
  };

  if (accepted.length === 1) {
    const splitCount = durationSec < 2.2 ? 2 : durationSec < 8 ? 3 : 4;
    const fallbackCues: number[] = [];
    const fallbackCandidates: DetectedCueCandidate[] = [];
    for (let k = 0; k < splitCount; k++) {
      const t = Number(((k / (splitCount - 1)) * durationSec).toFixed(2));
      fallbackCues.push(t);
      fallbackCandidates.push({
        timeSec: t,
        confidence: 0.4,
        kind: k === 0 ? 'start' : k === splitCount - 1 ? 'end' : 'pause-settle',
      });
    }
    const normalizedFallback = SmartPairer.normalizeCuePoints(fallbackCues, durationSec);
    return {
      cueTimesSec: normalizedFallback,
      candidates: fallbackCandidates,
      method: 'uniform-fallback',
      recommendedEasings: new Array(Math.max(0, normalizedFallback.length - 1)).fill('linear'),
      motionProfile,
    };
  }

  const lastCandidate = accepted[accepted.length - 1];
  const lastCoversFinalHold =
    Boolean(lastCandidate.coversFinalHold) ||
    (lastCandidate.kind === 'pause-settle' &&
      lastCandidate.plateauEndSec !== undefined &&
      durationSec - lastCandidate.plateauEndSec <= 0.35);

  if (
    !lastCoversFinalHold &&
    durationSec - lastCandidate.timeSec >= minGapSec * 0.5 &&
    accepted.length < maxCues
  ) {
    accepted.push({
      timeSec: Number(durationSec.toFixed(2)),
      confidence: 0.9,
      kind: 'end',
      sharpnessScore:
        signatures?.[n - 1] !== undefined
          ? Number(signatures[n - 1].meanEdgeSharpness.toFixed(4))
          : undefined,
      sampleIdx: n - 1,
    });
  }

  const publicCandidates: DetectedCueCandidate[] = accepted.map(
    ({ sampleIdx: _s, coversFinalHold: _c, ...rest }) => rest
  );

  const normalized = SmartPairer.normalizeCuePoints(
    publicCandidates.map((c) => c.timeSec),
    durationSec
  );

  const method: CueDetectionResult['method'] =
    hasPlateauOrValleyCues && hasCutCues
      ? 'hybrid'
      : hasPlateauOrValleyCues
        ? 'pause-plateaus'
        : 'scene-cuts';

  const recommendedEasings = inferSegmentEasings(
    normalized,
    sampleTimes,
    rawVelocity,
    publicCandidates
  );

  return {
    cueTimesSec: normalized,
    candidates: publicCandidates,
    method,
    recommendedEasings,
    motionProfile,
  };
}

function inferSegmentEasings(
  cueTimesSec: number[],
  sampleTimes: number[],
  rawVelocity: number[],
  candidates: DetectedCueCandidate[]
): SegmentEasing[] {
  const segCount = Math.max(0, cueTimesSec.length - 1);
  const easings: SegmentEasing[] = [];

  for (let k = 0; k < segCount; k++) {
    const tStart = cueTimesSec[k];
    const tEnd = cueTimesSec[k + 1];

    const segVelocities: number[] = [];
    for (let i = 0; i < sampleTimes.length; i++) {
      if (sampleTimes[i] > tStart + 1e-6 && sampleTimes[i] <= tEnd + 1e-6) {
        segVelocities.push(Math.max(0, rawVelocity[i] ?? 0));
      }
    }

    if (segVelocities.length === 0) {
      easings.push('linear');
      continue;
    }

    let segPeak = 0;
    for (const v of segVelocities) {
      if (v > segPeak) segPeak = v;
    }
    if (segPeak <= 0.005) {
      easings.push('linear');
      continue;
    }

    let firstActive = -1;
    let lastActive = -1;
    const activeCutoff = segPeak * 0.12;
    for (let i = 0; i < segVelocities.length; i++) {
      if (segVelocities[i] >= activeCutoff) {
        if (firstActive === -1) firstActive = i;
        lastActive = i;
      }
    }

    if (firstActive === -1 || lastActive < firstActive) {
      easings.push('linear');
      continue;
    }

    const active = segVelocities.slice(firstActive, lastActive + 1);
    let sumV = 0;
    for (const v of active) sumV += v;

    if (segPeak / Math.max(1e-6, sumV) > 0.68) {
      easings.push('step');
      continue;
    }

    if (active.length < 3) {
      const endCand = candidates.find((c) => Math.abs(c.timeSec - tEnd) < 0.06);
      easings.push(endCand?.kind === 'scene-cut' ? 'step' : 'linear');
      continue;
    }

    const half = Math.floor(active.length / 2);
    const firstSlice = active.slice(0, half);
    const secondSlice = active.slice(active.length - half);
    const firstHalfEnergy =
      firstSlice.reduce((acc, v) => acc + v, 0) / Math.max(1, firstSlice.length);
    const secondHalfEnergy =
      secondSlice.reduce((acc, v) => acc + v, 0) / Math.max(1, secondSlice.length);

    if (firstHalfEnergy > secondHalfEnergy * 1.45) {
      easings.push('ease-out');
      continue;
    }
    if (secondHalfEnergy > firstHalfEnergy * 1.45) {
      easings.push('ease-in');
      continue;
    }

    const q = Math.max(1, Math.floor(active.length * 0.25));
    const midSlice = active.slice(q, active.length - q);
    const edgeSlice = [...active.slice(0, q), ...active.slice(active.length - q)];
    if (midSlice.length > 0 && edgeSlice.length > 0) {
      const midEnergy = midSlice.reduce((acc, v) => acc + v, 0) / midSlice.length;
      const edgeEnergy = edgeSlice.reduce((acc, v) => acc + v, 0) / edgeSlice.length;
      if (midEnergy > edgeEnergy * 1.35) {
        easings.push('ease-in-out');
        continue;
      }
    }

    easings.push('linear');
  }

  return easings;
}

function isResolutionPair(a: number, b: number): boolean {
  if (a >= 720 && b >= 480) return true;
  return COMMON_RESOLUTION_DIMS.has(a) && COMMON_RESOLUTION_DIMS.has(b);
}
