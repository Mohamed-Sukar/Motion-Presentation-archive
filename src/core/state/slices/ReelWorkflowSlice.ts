import { inferAspectRatioFromDimensions } from '../../domain/defaults';
import {
  MediaAsset,
  SegmentEasing,
  SlideNode,
  TransitionSpec,
} from '../../domain/types';
import { StagePlaybackEngine } from '../../engine/StagePlaybackEngine';
import { t } from '../../i18n';
import { DemoGenerator } from '../../services/DemoGenerator';
import { FrameExtractor } from '../../services/FrameExtractor';
import { MediaValidator } from '../../services/MediaValidator';
import { ProjectSerializer } from '../../services/ProjectSerializer';
import { SmartPairer } from '../../services/SmartPairer';
import {
  ApplyCuePointsOptions,
  MissingVideoAssetGroup,
  ReelContext,
} from '../types';
import { addSlideFromImageInDeck, StoreSliceContext } from './DeckSlice';

export interface ReelSliceContext extends StoreSliceContext {
  batchUpdate: (fn: () => void) => void;
}

const DEFAULT_CUE_TITLE_RE = /^(?:مرحلة توقف \d+|توقف_\d+_|Hold Cue \d+|cue_\d+_)/i;

interface MetadataSnapshot {
  timeSec: number | null;
  title: string;
  notes: string;
  holdDurationSec: number | null;
  fallbackStyle: TransitionSpec['fallbackStyle'];
  fallbackDurationMs: number;
  playbackSpeed: number;
  muted: boolean;
  easing?: SegmentEasing;
  used: boolean;
}

export async function applyVideoCuePointsWorkflowInDeck(
  ctx: ReelSliceContext,
  videoAsset: MediaAsset,
  cueTimesSec: number[],
  optionsOrAppend: boolean | ApplyCuePointsOptions = false
): Promise<SlideNode[]> {
  const project = ctx.getProject();
  const opts: ApplyCuePointsOptions =
    typeof optionsOrAppend === 'boolean'
      ? { mode: optionsOrAppend ? 'append' : 'replace-all' }
      : optionsOrAppend || {};

  const mode = opts.mode ?? 'replace-all';
  const targetVideoId = opts.targetVideoAssetId ?? videoAsset.id;
  const preserveMetadata =
    opts.preserveMetadata ??
    (mode === 'replace-reel' ||
      project.slides.some(
        (s) => s.transitionToNext.videoAsset?.id === targetVideoId
      ));

  if (opts.signal?.aborted) {
    throw MediaValidator.createAbortError(t('core.extractSlidesCancelled'));
  }

  const snapshots: MetadataSnapshot[] = [];
  const reelBlockIndices: number[] = [];

  if (preserveMetadata || mode === 'replace-reel') {
    for (let i = 0; i < project.slides.length; i++) {
      const s = project.slides[i];
      const prev = i > 0 ? project.slides[i - 1] : null;
      const belongsToTarget =
        s.transitionToNext.videoAsset?.id === targetVideoId ||
        s.imageAsset.sourceVideoId === targetVideoId ||
        (prev?.transitionToNext.videoAsset?.id === targetVideoId &&
          typeof prev.transitionToNext.endTimeSec === 'number' &&
          !s.transitionToNext.videoAsset);

      if (belongsToTarget) {
        reelBlockIndices.push(i);
        const timeSec =
          typeof s.imageAsset.sourceTimeSec === 'number'
            ? s.imageAsset.sourceTimeSec
            : typeof s.transitionToNext.startTimeSec === 'number'
              ? s.transitionToNext.startTimeSec
              : prev?.transitionToNext.videoAsset?.id === targetVideoId &&
                  typeof prev.transitionToNext.endTimeSec === 'number'
                ? prev.transitionToNext.endTimeSec
                : null;
        snapshots.push({
          timeSec,
          title: s.title,
          notes: s.notes,
          holdDurationSec: s.holdDurationSec,
          fallbackStyle: s.transitionToNext.fallbackStyle,
          fallbackDurationMs: s.transitionToNext.fallbackDurationMs,
          playbackSpeed: s.transitionToNext.playbackSpeed,
          muted: s.transitionToNext.muted,
          easing: s.transitionToNext.easing,
          used: false,
        });
      }
    }
  }

  const newSlides = await SmartPairer.buildSlidesFromVideoCuePoints(
    videoAsset,
    cueTimesSec,
    {
      defaultFallback: project.settings.defaultFallbackStyle,
      segmentEasings: opts.segmentEasings,
      cueLabels: opts.cueLabels,
      onProgress: opts.onProgress
        ? (done, total, timeSec) => opts.onProgress?.(done, total, timeSec)
        : undefined,
      signal: opts.signal,
    }
  );

  if (newSlides.length === 0) {
    return [];
  }

  const effectiveDur =
    videoAsset.durationSec > 0
      ? videoAsset.durationSec
      : Math.max(
          ...newSlides.map(
            (s) => s.transitionToNext.endTimeSec ?? s.imageAsset.sourceTimeSec ?? 0
          ),
          1
        );
  const normalizedCues = SmartPairer.normalizeCuePoints(cueTimesSec, effectiveDur);

  newSlides.forEach((slide, i) => {
    slide.transitionToNext.fallbackDurationMs =
      project.settings.defaultFallbackDurationMs;
    const cueTime = normalizedCues[i];
    if (typeof slide.imageAsset.sourceVideoId !== 'string') {
      slide.imageAsset.sourceVideoId = videoAsset.id;
    }
    if (typeof slide.imageAsset.sourceTimeSec !== 'number' && typeof cueTime === 'number') {
      slide.imageAsset.sourceTimeSec = cueTime;
    }

    if (preserveMetadata && snapshots.length > 0 && typeof cueTime === 'number') {
      let bestSnap: MetadataSnapshot | null = null;
      let bestDiff = 0.16;
      for (const snap of snapshots) {
        if (snap.used || snap.timeSec === null) continue;
        const diff = Math.abs(snap.timeSec - cueTime);
        if (diff <= bestDiff) {
          bestDiff = diff;
          bestSnap = snap;
        }
      }
      if (bestSnap) {
        bestSnap.used = true;
        if (bestSnap.title && !DEFAULT_CUE_TITLE_RE.test(bestSnap.title)) {
          slide.title = bestSnap.title;
        }
        slide.notes = bestSnap.notes;
        slide.holdDurationSec = bestSnap.holdDurationSec;
        slide.transitionToNext.fallbackStyle = bestSnap.fallbackStyle;
        slide.transitionToNext.fallbackDurationMs = bestSnap.fallbackDurationMs;
        slide.transitionToNext.playbackSpeed = bestSnap.playbackSpeed;
        slide.transitionToNext.muted = bestSnap.muted;
        if (bestSnap.easing) {
          slide.transitionToNext.easing = bestSnap.easing;
        }
      }
    }
  });

  ctx.history.recordSnapshot(project, ctx.selection, 'reel/applyCuePoints');
  ctx.batchUpdate(() => {
    const candidateRevokeUrls: Array<string | undefined> = [];
    const staleReverseKeys: string[] = [];
    let insertIndex: number;

    if (mode === 'replace-all') {
      for (const slide of project.slides) {
        candidateRevokeUrls.push(slide.imageAsset?.objectUrl);
        candidateRevokeUrls.push(slide.transitionToNext?.videoAsset?.objectUrl);
        staleReverseKeys.push(slide.transitionToNext.id);
        if (slide.transitionToNext.videoAsset?.id) {
          staleReverseKeys.push(slide.transitionToNext.videoAsset.id);
        }
      }
      project.slides = [...newSlides];
      insertIndex = 0;
    } else if (mode === 'replace-reel' && reelBlockIndices.length > 0) {
      const firstIdx = reelBlockIndices[0];
      const removeSet = new Set(reelBlockIndices);
      const keptSlides: SlideNode[] = [];
      for (let i = 0; i < project.slides.length; i++) {
        const slide = project.slides[i];
        if (removeSet.has(i)) {
          candidateRevokeUrls.push(slide.imageAsset?.objectUrl);
          candidateRevokeUrls.push(slide.transitionToNext?.videoAsset?.objectUrl);
          staleReverseKeys.push(slide.transitionToNext.id);
        } else {
          keptSlides.push(slide);
        }
      }
      const safeInsert = Math.max(0, Math.min(firstIdx, keptSlides.length));
      keptSlides.splice(safeInsert, 0, ...newSlides);
      project.slides = keptSlides;
      insertIndex = safeInsert;
    } else {
      insertIndex = project.slides.length;
      project.slides.push(...newSlides);
    }

    if (opts.matchAspectRatio) {
      const inferred =
        videoAsset.suggestedAspectRatio ??
        inferAspectRatioFromDimensions(videoAsset.width, videoAsset.height);
      project.settings = {
        ...project.settings,
        aspectRatio: inferred,
      };
      ProjectSerializer.saveSettingsToLocal(project.settings);
    }

    if (mode !== 'append' || !project.reelMetadata) {
      project.reelMetadata = {
        sourceVideoId: videoAsset.id,
        sourceVideoName: videoAsset.name,
        durationSec: effectiveDur,
        cueTimesSec: normalizedCues,
        segmentEasings: opts.segmentEasings,
      };
    }

    ctx.history.revokeUrlsIfUnused(project.slides, candidateRevokeUrls);
    if (staleReverseKeys.length > 0) {
      StagePlaybackEngine.invalidateReverseFrames(staleReverseKeys);
    }

    ctx.selection.setActivePreviewIndexRaw(insertIndex);
    ctx.selection.applySingleSelection({ type: 'slide', slideId: newSlides[0].id });
    ctx.notify(t('notify.reelCreated'), 'success');
  });

  return newSlides;
}

export function resolveReelContextForSlide(
  ctx: StoreSliceContext,
  slideId?: string
): ReelContext | null {
  const project = ctx.getProject();
  const slides = project.slides;
  if (slides.length === 0) return null;

  const currentSel = ctx.selection.getSelection();
  let anchorIdx = -1;
  if (slideId) {
    anchorIdx = slides.findIndex((s) => s.id === slideId);
  } else if (currentSel.type === 'slide' || currentSel.type === 'transition') {
    const selSlideId = currentSel.slideId;
    anchorIdx = slides.findIndex((s) => s.id === selSlideId);
  }
  if (anchorIdx === -1) {
    anchorIdx = Math.max(0, Math.min(ctx.selection.getActivePreviewIndex(), slides.length - 1));
  }

  let videoAsset: MediaAsset | null = slides[anchorIdx]?.transitionToNext?.videoAsset || null;

  // If anchor is the landing slide of a reel segment, look at the preceding slide
  if (!videoAsset && anchorIdx > 0) {
    const prev = slides[anchorIdx - 1];
    if (
      prev?.transitionToNext?.videoAsset &&
      (slides[anchorIdx].imageAsset.sourceVideoId === prev.transitionToNext.videoAsset.id ||
        typeof prev.transitionToNext.endTimeSec === 'number')
    ) {
      videoAsset = prev.transitionToNext.videoAsset;
    }
  }

  const isSlicedRun = (startIdx: number, endIdx: number, id: string): boolean => {
    if (endIdx > startIdx) return true;
    if (project.reelMetadata?.sourceVideoId === id) return true;
    for (let i = startIdx; i <= endIdx; i++) {
      const spec = slides[i].transitionToNext;
      if (
        typeof spec.startTimeSec === 'number' ||
        typeof spec.endTimeSec === 'number' ||
        slides[i].imageAsset.sourceVideoId === id
      ) {
        return true;
      }
    }
    const landingSlide = slides[endIdx + 1];
    return Boolean(landingSlide && landingSlide.imageAsset.sourceVideoId === id);
  };

  // Fallback when no slideId was explicitly targeted: find first genuine sliced reel in project
  if (!videoAsset && !slideId) {
    for (let idx = 0; idx < slides.length; idx++) {
      const cand = slides[idx].transitionToNext.videoAsset;
      if (!cand) continue;
      let candEnd = idx;
      while (
        candEnd + 1 < slides.length &&
        slides[candEnd + 1].transitionToNext.videoAsset?.id === cand.id
      ) {
        candEnd++;
      }
      if (isSlicedRun(idx, candEnd, cand.id)) {
        videoAsset = cand;
        break;
      }
      idx = candEnd;
    }
  }

  if (!videoAsset) return null;
  const vidId = videoAsset.id;

  const firstSegIdx = slides.findIndex((s, i) => {
    if (s.transitionToNext.videoAsset?.id !== vidId) return false;
    return i <= anchorIdx;
  });

  // Narrow to contiguous run covering anchorIdx if anchorIdx is inside/adjacent to one
  let runStart = anchorIdx;
  while (runStart > 0 && slides[runStart - 1].transitionToNext.videoAsset?.id === vidId) {
    runStart--;
  }
  if (slides[runStart]?.transitionToNext.videoAsset?.id !== vidId) {
    if (
      anchorIdx > 0 &&
      slides[anchorIdx - 1]?.transitionToNext.videoAsset?.id === vidId
    ) {
      runStart = anchorIdx - 1;
      while (runStart > 0 && slides[runStart - 1].transitionToNext.videoAsset?.id === vidId) {
        runStart--;
      }
    } else {
      runStart =
        firstSegIdx !== -1
          ? firstSegIdx
          : slides.findIndex((s) => s.transitionToNext.videoAsset?.id === vidId);
    }
  }

  if (runStart === -1) return null;

  let runEnd = runStart;
  while (
    runEnd + 1 < slides.length &&
    slides[runEnd + 1].transitionToNext.videoAsset?.id === vidId
  ) {
    runEnd++;
  }

  // Standalone single transition videos between custom slides are not sliced reels
  if (!isSlicedRun(runStart, runEnd, vidId)) {
    return null;
  }

  const slideIds: string[] = [];
  const rawCues: number[] = [];
  for (let i = runStart; i <= runEnd; i++) {
    const spec = slides[i].transitionToNext;
    slideIds.push(slides[i].id);
    const start =
      typeof spec.startTimeSec === 'number' && Number.isFinite(spec.startTimeSec)
        ? spec.startTimeSec
        : 0;
    rawCues.push(start);
    if (i === runEnd) {
      const end =
        typeof spec.endTimeSec === 'number' && Number.isFinite(spec.endTimeSec)
          ? spec.endTimeSec
          : videoAsset.durationSec > 0
            ? videoAsset.durationSec
            : start + 1;
      rawCues.push(end);
    }
  }

  if (runEnd + 1 < slides.length) {
    const landing = slides[runEnd + 1];
    if (
      !landing.transitionToNext.videoAsset ||
      landing.imageAsset.sourceVideoId === vidId
    ) {
      slideIds.push(landing.id);
    }
  }

  const cuePointsSec = SmartPairer.normalizeCuePoints(
    rawCues,
    videoAsset.durationSec || Math.max(...rawCues, 1)
  );

  return {
    videoAsset,
    cuePointsSec,
    slideIds,
    isFullProjectReel: slideIds.length === slides.length,
  };
}

export function findMissingVideoAssets(slides: SlideNode[]): MissingVideoAssetGroup[] {
  const groups = new Map<string, MissingVideoAssetGroup>();
  for (const s of slides) {
    const spec = s.transitionToNext;
    if (!spec.videoAsset && spec.expectedVideoFileName) {
      let group = groups.get(spec.expectedVideoFileName);
      if (!group) {
        group = {
          videoFileName: spec.expectedVideoFileName,
          durationSec: spec.expectedVideoDurationSec || 0,
          slideIds: [],
          cueTimesSec: [],
        };
        groups.set(spec.expectedVideoFileName, group);
      }
      group.slideIds.push(s.id);
      if (typeof spec.startTimeSec === 'number') {
        group.cueTimesSec.push(spec.startTimeSec);
      }
      if (typeof spec.endTimeSec === 'number') {
        group.cueTimesSec.push(spec.endTimeSec);
      }
      if (spec.expectedVideoDurationSec && spec.expectedVideoDurationSec > group.durationSec) {
        group.durationSec = spec.expectedVideoDurationSec;
      }
    }
  }
  return Array.from(groups.values());
}

export async function relinkReelVideoInDeck(
  ctx: ReelSliceContext,
  target: string | string[],
  newVideoAsset: MediaAsset,
  options?: {
    reextractMissingImages?: boolean;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
  }
): Promise<number> {
  const project = ctx.getProject();
  const matchedIndices: number[] = [];
  for (let i = 0; i < project.slides.length; i++) {
    const s = project.slides[i];
    const spec = s.transitionToNext;
    const matches = Array.isArray(target)
      ? target.includes(s.id)
      : spec.expectedVideoFileName === target || spec.videoAsset?.name === target;
    if (matches) {
      matchedIndices.push(i);
    }
  }

  if (matchedIndices.length === 0) return 0;

  const oldVideoUrls: Array<string | undefined> = [];
  const staleReverseKeys: string[] = [];

  for (const i of matchedIndices) {
    const spec = project.slides[i].transitionToNext;
    oldVideoUrls.push(spec.videoAsset?.objectUrl);
    staleReverseKeys.push(spec.id);
    if (spec.videoAsset?.id) staleReverseKeys.push(spec.videoAsset.id);
  }

  const reextractJobs: Array<{ slideIndex: number; timeSec: number }> = [];
  if (options?.reextractMissingImages !== false) {
    const seenIndices = new Set<number>();
    for (const i of matchedIndices) {
      const s = project.slides[i];
      const spec = s.transitionToNext;
      const needsImage =
        s.imageAsset.fileSize === 0 || s.imageAsset.objectUrl.startsWith('data:');
      if (needsImage && !seenIndices.has(i)) {
        seenIndices.add(i);
        const timeSec =
          typeof s.imageAsset.sourceTimeSec === 'number'
            ? s.imageAsset.sourceTimeSec
            : typeof spec.startTimeSec === 'number'
              ? spec.startTimeSec
              : 0;
        reextractJobs.push({ slideIndex: i, timeSec });
      }

      const nextIdx = i + 1;
      if (nextIdx < project.slides.length && !seenIndices.has(nextIdx)) {
        const nextSlide = project.slides[nextIdx];
        const nextNeeds =
          nextSlide.imageAsset.fileSize === 0 ||
          nextSlide.imageAsset.objectUrl.startsWith('data:');
        if (nextNeeds && !matchedIndices.includes(nextIdx)) {
          seenIndices.add(nextIdx);
          const endSec =
            typeof nextSlide.imageAsset.sourceTimeSec === 'number'
              ? nextSlide.imageAsset.sourceTimeSec
              : typeof spec.endTimeSec === 'number'
                ? spec.endTimeSec
                : newVideoAsset.durationSec;
          reextractJobs.push({ slideIndex: nextIdx, timeSec: endSec });
        }
      }
    }
  }

  const extractedImages = new Map<number, MediaAsset>();
  if (reextractJobs.length > 0 && typeof document !== 'undefined') {
    const sortedJobs = [...reextractJobs].sort((a, b) => a.timeSec - b.timeSec);
    const session = await FrameExtractor.createSession(newVideoAsset, options?.signal);
    try {
      for (let j = 0; j < sortedJobs.length; j++) {
        if (options?.signal?.aborted) {
          ctx.history.revokeUrlsIfUnused(
            project.slides,
            Array.from(extractedImages.values()).map((a) => a.objectUrl)
          );
          throw MediaValidator.createAbortError(t('core.relinkCancelled'));
        }
        const job = sortedJobs[j];
        try {
          const slide = project.slides[job.slideIndex];
          const asset = await session.extractFrameAsSlideAsset(
            job.timeSec,
            slide.imageAsset.name || `frame_${job.timeSec.toFixed(2)}s.png`,
            options?.signal
          );
          asset.sourceVideoId = newVideoAsset.id;
          asset.sourceTimeSec = job.timeSec;
          extractedImages.set(job.slideIndex, asset);
        } catch (err) {
          if (options?.signal?.aborted) {
            ctx.history.revokeUrlsIfUnused(
              project.slides,
              Array.from(extractedImages.values()).map((a) => a.objectUrl)
            );
            throw MediaValidator.isAbortError(err)
              ? err
              : MediaValidator.createAbortError(t('core.relinkCancelled'));
          }
        }
        options?.onProgress?.(j + 1, sortedJobs.length);
      }
    } finally {
      session.dispose();
    }
  }

  ctx.batchUpdate(() => {
    const oldImageUrls: Array<string | undefined> = [];
    const dur = newVideoAsset.durationSec > 0 ? newVideoAsset.durationSec : 1;

    for (const i of matchedIndices) {
      const spec = project.slides[i].transitionToNext;
      spec.videoAsset = newVideoAsset;
      spec.expectedVideoFileName = undefined;
      spec.expectedVideoDurationSec = undefined;

      if (typeof spec.startTimeSec === 'number') {
        spec.startTimeSec = Math.max(0, Math.min(spec.startTimeSec, dur));
      }
      if (typeof spec.endTimeSec === 'number') {
        const minEnd = typeof spec.startTimeSec === 'number' ? spec.startTimeSec : 0;
        spec.endTimeSec = Math.max(minEnd, Math.min(spec.endTimeSec, dur));
      }
    }

    for (const [slideIdx, imgAsset] of extractedImages.entries()) {
      const slide = project.slides[slideIdx];
      if (slide) {
        oldImageUrls.push(slide.imageAsset?.objectUrl);
        slide.imageAsset = imgAsset;
      }
    }

    if (project.reelMetadata) {
      project.reelMetadata = {
        ...project.reelMetadata,
        sourceVideoId: newVideoAsset.id,
        sourceVideoName: newVideoAsset.name,
        durationSec: newVideoAsset.durationSec || project.reelMetadata.durationSec,
      };
    }

    ctx.history.revokeUrlsIfUnused(project.slides, [...oldVideoUrls, ...oldImageUrls]);
    StagePlaybackEngine.invalidateReverseFrames(staleReverseKeys);
  });

  ctx.notify(t('notify.videoLinkedSuccess', { name: newVideoAsset.name }), 'success');
  return matchedIndices.length;
}

export async function splitTransitionAtTimeInDeck(
  ctx: ReelSliceContext,
  slideId: string,
  splitTimeSec?: number
): Promise<SlideNode | null> {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return null;
  const slide = project.slides[idx];
  const videoAsset = slide.transitionToNext.videoAsset;
  if (!videoAsset) {
    ctx.notify(t('notify.noTransVideoToSplit'), 'warning');
    return null;
  }

  const maxDur =
    Number.isFinite(videoAsset.durationSec) && videoAsset.durationSec > 0
      ? videoAsset.durationSec
      : 1;
  const start = Math.max(0, Math.min(slide.transitionToNext.startTimeSec ?? 0, maxDur));
  const end = Math.max(
    start,
    Math.min(slide.transitionToNext.endTimeSec ?? maxDur, maxDur)
  );

  if (end - start < 0.2) {
    ctx.notify(t('notify.clipTooShortToSplit'), 'warning');
    return null;
  }

  let splitAt: number;
  if (typeof splitTimeSec === 'number') {
    if (!Number.isFinite(splitTimeSec) || splitTimeSec <= start + 0.08 || splitTimeSec >= end - 0.08) {
      ctx.notify(
        t('notify.splitTimeOutOfBounds', {
          min: (start + 0.08).toFixed(2),
          max: (end - 0.08).toFixed(2),
        }),
        'warning'
      );
      return null;
    }
    splitAt = Number(splitTimeSec.toFixed(3));
  } else {
    splitAt = Number(((start + end) / 2).toFixed(2));
  }

  try {
    const extractedFrame = await FrameExtractor.extractFrameAtTimeAsSlideAsset(
      videoAsset,
      splitAt,
      `${t('slide.filePrefixHold')}_${splitAt.toFixed(2)}s.png`
    );
    extractedFrame.sourceVideoId = videoAsset.id;
    extractedFrame.sourceTimeSec = splitAt;

    let newSlide!: SlideNode;
    ctx.history.recordSnapshot(project, ctx.selection, 'transition/splitAtTime');
    ctx.batchUpdate(() => {
      ctx.history.setRecordingSuppressed(true);
      try {
        slide.transitionToNext.startTimeSec = start;
        slide.transitionToNext.endTimeSec = splitAt;
        StagePlaybackEngine.invalidateReverseFrames([slide.transitionToNext.id]);

        newSlide = addSlideFromImageInDeck(ctx, extractedFrame, idx);
        newSlide.title = t('slide.holdTitle', { time: splitAt.toFixed(2) });
        newSlide.transitionToNext.videoAsset = videoAsset;
        newSlide.transitionToNext.startTimeSec = splitAt;
        newSlide.transitionToNext.endTimeSec = end;
        newSlide.transitionToNext.playbackSpeed = slide.transitionToNext.playbackSpeed;
        newSlide.transitionToNext.muted = slide.transitionToNext.muted;
        newSlide.transitionToNext.fallbackStyle = slide.transitionToNext.fallbackStyle;
        newSlide.transitionToNext.fallbackDurationMs = slide.transitionToNext.fallbackDurationMs;
      } finally {
        ctx.history.setRecordingSuppressed(false);
      }
    });
    ctx.notify(t('notify.splitSuccess', { time: splitAt.toFixed(2) }), 'success');
    return newSlide;
  } catch (err) {
    ctx.notify(
      err instanceof Error ? err.message : t('notify.splitExtractFailed'),
      'error'
    );
    return null;
  }
}

export async function generateTransitionVideoForSlideInDeck(
  ctx: StoreSliceContext,
  slideId: string
): Promise<boolean> {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return false;
  const nextIdx =
    idx + 1 < project.slides.length
      ? idx + 1
      : project.settings.loopPresentation && project.slides.length > 1
        ? 0
        : -1;
  if (nextIdx === -1) {
    ctx.notify(t('notify.needNextSlideToGenerate'), 'warning');
    return false;
  }

  const slide = project.slides[idx];
  const oldVideoUrl = slide.transitionToNext.videoAsset?.objectUrl;
  const oldVideoId = slide.transitionToNext.videoAsset?.id;

  const { videoAsset, reverseFrames } = await DemoGenerator.generateTransitionVideoBetweenSlides(
    slide,
    project.slides[nextIdx],
    slide.transitionToNext.fallbackStyle,
    slide.transitionToNext.fallbackDurationMs || 900
  );

  StagePlaybackEngine.invalidateReverseFrames([
    slide.transitionToNext.id,
    ...(oldVideoId ? [oldVideoId] : []),
  ]);

  slide.transitionToNext.videoAsset = videoAsset;
  slide.transitionToNext.startTimeSec = undefined;
  slide.transitionToNext.endTimeSec = undefined;
  slide.transitionToNext.expectedVideoFileName = undefined;
  slide.transitionToNext.expectedVideoDurationSec = undefined;

  StagePlaybackEngine.cacheReverseFrames(slide.transitionToNext.id, reverseFrames);
  StagePlaybackEngine.cacheReverseFrames(videoAsset.id, reverseFrames);

  if (oldVideoUrl && oldVideoUrl !== videoAsset.objectUrl) {
    ctx.history.revokeUrlsIfUnused(project.slides, [oldVideoUrl]);
  }

  ctx.emit('structural');
  ctx.notify(t('notify.generatedTransSuccess'), 'success');
  return true;
}

export async function extractNextSlideFromTransitionEndInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  atTimeSec?: number
): Promise<SlideNode | null> {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return null;
  const slide = project.slides[idx];
  const videoAsset = slide.transitionToNext.videoAsset;
  if (!videoAsset) {
    ctx.notify(t('notify.noTransVideoToExtract'), 'warning');
    return null;
  }

  const targetTime =
    typeof atTimeSec === 'number' && Number.isFinite(atTimeSec) && atTimeSec >= 0
      ? atTimeSec
      : typeof slide.transitionToNext.endTimeSec === 'number' &&
          Number.isFinite(slide.transitionToNext.endTimeSec) &&
          slide.transitionToNext.endTimeSec >= 0
        ? slide.transitionToNext.endTimeSec
        : null;

  try {
    const extractedImage =
      targetTime !== null
        ? await FrameExtractor.extractFrameAtTimeAsSlideAsset(
            videoAsset,
            targetTime,
            `${t('slide.filePrefixExtracted')}_${idx + 2}_${targetTime.toFixed(2)}s.png`
          )
        : await FrameExtractor.extractFrameAsSlideAsset(
            videoAsset,
            'last',
            `${t('slide.filePrefixExtracted')}_${idx + 2}.png`
          );

    extractedImage.sourceVideoId = videoAsset.id;
    extractedImage.sourceTimeSec = targetTime ?? videoAsset.durationSec;

    const created = addSlideFromImageInDeck(ctx, extractedImage, idx);
    created.title =
      targetTime !== null
        ? t('slide.extractedAt', { index: idx + 2, time: targetTime.toFixed(2) })
        : t('slide.extractedEnd', { index: idx + 2 });
    ctx.notify(t('notify.extractedEndSuccess'), 'success');
    return created;
  } catch (err) {
    ctx.notify(
      err instanceof Error ? err.message : t('notify.extractFailed'),
      'error'
    );
    return null;
  }
}
