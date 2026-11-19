import { createDefaultTransition, createSlideNode, generateId } from '../../domain/defaults';
import {
  MediaAsset,
  PresentationProject,
  PresentationSettings,
  ProjectAiSourceMeta,
  SlideNode,
  TransitionSpec,
} from '../../domain/types';
import { StagePlaybackEngine } from '../../engine/StagePlaybackEngine';
import { AppLanguage, t } from '../../i18n';
import { ProjectSerializer } from '../../services/ProjectSerializer';
import { SmartPairer } from '../../services/SmartPairer';
import { ProjectDiagnostics, StoreChangeType } from '../types';
import { HistorySlice } from './HistorySlice';
import { SelectionSlice } from './SelectionSlice';

export interface StoreSliceContext {
  getProject: () => PresentationProject;
  history: HistorySlice;
  selection: SelectionSlice;
  emit: (changeType?: StoreChangeType) => void;
  notify: (
    message: string,
    kind?: 'info' | 'success' | 'warning' | 'error',
    autoClearMs?: number
  ) => void;
  setProjectToken: (token: string | null) => void;
}

export function setProjectTitleInDeck(ctx: StoreSliceContext, title: string): void {
  const project = ctx.getProject();
  const nextTitle = title.trim() || t('app.titleUntitled');
  if (nextTitle === project.title) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'project/setTitle');
  project.title = nextTitle;
  ctx.emit('metadata');
}

export function syncDefaultTitlesInDeck(
  ctx: StoreSliceContext,
  prevLang: AppLanguage,
  nextLang: AppLanguage
): void {
  const project = ctx.getProject();
  let changed = false;
  const prevDefault = t('app.titleDefault', undefined, prevLang);
  const prevDemo = t('app.titleDemo', undefined, prevLang);
  const prevUntitled = t('app.titleUntitled', undefined, prevLang);

  if (
    project.title === prevDefault ||
    project.title === 'عرض Motion Graphics التفاعلي' ||
    project.title === 'عرض تقديمي حركي جديد'
  ) {
    project.title = t('app.titleDefault', undefined, nextLang);
    changed = true;
  } else if (
    project.title === prevDemo ||
    project.title === 'عرض تجريبي — Motion Studio'
  ) {
    project.title = t('app.titleDemo', undefined, nextLang);
    changed = true;
  } else if (project.title === prevUntitled) {
    project.title = t('app.titleUntitled', undefined, nextLang);
    changed = true;
  }

  for (const slide of project.slides) {
    const cueMatch = slide.title.match(/^(?:مرحلة توقف|Hold Cue)\s+(\d+)\s*\(([^)]+)\)$/);
    if (cueMatch) {
      slide.title = t(
        'slide.cueTitle',
        { index: Number(cueMatch[1]), time: cueMatch[2].replace(/s$/i, '') },
        nextLang
      );
      changed = true;
      continue;
    }
    const holdMatch = slide.title.match(/^(?:مرحلة توقف|Hold Cue)\s*\(([^)]+)\)$/);
    if (holdMatch) {
      slide.title = t(
        'slide.holdTitle',
        { time: holdMatch[1].replace(/s$/i, '') },
        nextLang
      );
      changed = true;
      continue;
    }
    const defMatch = slide.title.match(/^(?:شريحة|Slide)\s+(\d+)$/);
    if (defMatch) {
      slide.title = t('slide.defaultTitle', { index: Number(defMatch[1]) }, nextLang);
      changed = true;
    }
  }

  if (changed) {
    ctx.emit('metadata');
  }
}

export function addSlideFromImageInDeck(
  ctx: StoreSliceContext,
  imageAsset: MediaAsset,
  insertAfterIndex?: number
): SlideNode {
  const project = ctx.getProject();
  ctx.history.recordSnapshot(project, ctx.selection, 'slide/add');
  const newSlide = createSlideNode(
    imageAsset,
    project.slides.length,
    project.settings.defaultFallbackStyle,
    project.settings.defaultFallbackDurationMs
  );

  if (
    typeof insertAfterIndex === 'number' &&
    insertAfterIndex >= 0 &&
    insertAfterIndex < project.slides.length
  ) {
    project.slides.splice(insertAfterIndex + 1, 0, newSlide);
    ctx.selection.setActivePreviewIndexRaw(insertAfterIndex + 1);
  } else {
    project.slides.push(newSlide);
    ctx.selection.setActivePreviewIndexRaw(project.slides.length - 1);
  }

  ctx.selection.applySingleSelection({ type: 'slide', slideId: newSlide.id });
  ctx.emit('structural');
  return newSlide;
}

export function appendBatchSlidesInDeck(
  ctx: StoreSliceContext,
  newSlides: SlideNode[],
  unpairedVideos: MediaAsset[] = []
): void {
  const project = ctx.getProject();
  if (newSlides.length > 0 || unpairedVideos.length > 0) {
    ctx.history.recordSnapshot(project, ctx.selection, 'slide/appendBatch');
  }
  const startIdx = project.slides.length;
  project.slides.push(...newSlides);

  let firstAttachedSlideIdx = -1;
  const remainingVideos: MediaAsset[] = [];

  for (const vid of unpairedVideos) {
    let matched = false;
    const targetIdx = SmartPairer.extractSlideIndexFromFilename(vid.name);
    if (
      targetIdx !== null &&
      targetIdx >= 0 &&
      targetIdx < project.slides.length &&
      !project.slides[targetIdx].transitionToNext.videoAsset
    ) {
      const spec = project.slides[targetIdx].transitionToNext;
      spec.videoAsset = vid;
      spec.startTimeSec = undefined;
      spec.endTimeSec = undefined;
      spec.expectedVideoFileName = undefined;
      spec.expectedVideoDurationSec = undefined;
      StagePlaybackEngine.invalidateReverseFrames([spec.id]);
      if (firstAttachedSlideIdx === -1) firstAttachedSlideIdx = targetIdx;
      matched = true;
    }
    if (!matched) {
      remainingVideos.push(vid);
    }
  }

  // For any remaining videos, fill slides without transition video sequentially
  let vidCursor = 0;
  for (let i = 0; i < project.slides.length && vidCursor < remainingVideos.length; i++) {
    if (!project.slides[i].transitionToNext.videoAsset) {
      const spec = project.slides[i].transitionToNext;
      spec.videoAsset = remainingVideos[vidCursor++];
      spec.startTimeSec = undefined;
      spec.endTimeSec = undefined;
      spec.expectedVideoFileName = undefined;
      spec.expectedVideoDurationSec = undefined;
      StagePlaybackEngine.invalidateReverseFrames([spec.id]);
      if (firstAttachedSlideIdx === -1) firstAttachedSlideIdx = i;
    }
  }

  // Release any leftover unattached videos to prevent blob URL leaks
  if (vidCursor < remainingVideos.length) {
    const unusedUrls = remainingVideos.slice(vidCursor).map((v) => v.objectUrl);
    ctx.history.revokeUrlsIfUnused(project.slides, unusedUrls);
  }

  if (project.slides.length > 0) {
    const targetSelectIdx =
      newSlides.length > 0
        ? Math.min(startIdx, project.slides.length - 1)
        : firstAttachedSlideIdx !== -1
          ? firstAttachedSlideIdx
          : 0;
    const selectSlide = project.slides[targetSelectIdx] || project.slides[0];
    ctx.selection.applySingleSelection({ type: 'slide', slideId: selectSlide.id });
    ctx.selection.setActivePreviewIndexRaw(targetSelectIdx);
  }
  ctx.emit('structural');
}

export function replaceSlideImageInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  newImageAsset: MediaAsset
): void {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'slide/replaceImage');
  const oldUrl = slide.imageAsset.objectUrl;
  slide.imageAsset = newImageAsset;
  if (oldUrl !== newImageAsset.objectUrl) {
    ctx.history.revokeUrlsIfUnused(project.slides, [oldUrl]);
  }
  ctx.emit('structural');
}

export function setProjectAiSourceMetaInDeck(
  ctx: StoreSliceContext,
  meta: ProjectAiSourceMeta | undefined
): void {
  const project = ctx.getProject();
  project.aiSourceMeta = meta ? { ...meta } : undefined;
  ctx.emit('metadata');
}

export function setSlideIdleLoopVideoInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  videoAsset: MediaAsset | null
): void {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'slide/setIdleLoopVideo');
  const oldUrl = slide.idleLoopAsset?.objectUrl;
  slide.idleLoopAsset = videoAsset;
  slide.expectedIdleLoopFileName = undefined;
  if (oldUrl && oldUrl !== videoAsset?.objectUrl) {
    ctx.history.revokeUrlsIfUnused(project.slides, [oldUrl]);
  }
  ctx.emit('structural');
}

export function setSlideTransitionVideoInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  videoAsset: MediaAsset | null
): void {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'transition/setVideo');
  const oldUrl = slide.transitionToNext.videoAsset?.objectUrl;
  const oldVidId = slide.transitionToNext.videoAsset?.id;
  slide.transitionToNext.videoAsset = videoAsset;
  slide.transitionToNext.startTimeSec = undefined;
  slide.transitionToNext.endTimeSec = undefined;
  slide.transitionToNext.expectedVideoFileName = undefined;
  slide.transitionToNext.expectedVideoDurationSec = undefined;

  StagePlaybackEngine.invalidateReverseFrames([
    slide.transitionToNext.id,
    ...(oldVidId ? [oldVidId] : []),
  ]);

  if (oldUrl && oldUrl !== videoAsset?.objectUrl) {
    ctx.history.revokeUrlsIfUnused(project.slides, [oldUrl]);
  }
  ctx.selection.applySingleSelection({ type: 'transition', slideId: slide.id });
  ctx.emit('structural');
}

export function updateTransitionRangeInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  startTimeSec: number,
  endTimeSec: number
): boolean {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return false;
  const vid = slide.transitionToNext.videoAsset;
  const maxDur =
    vid && Number.isFinite(vid.durationSec) && vid.durationSec > 0
      ? vid.durationSec
      : Math.max(startTimeSec, endTimeSec, 1);

  if (!Number.isFinite(startTimeSec) || !Number.isFinite(endTimeSec)) {
    ctx.notify(t('notify.invalidSliceTimes'), 'warning');
    return false;
  }

  const clampedStart = Math.max(0, Math.min(startTimeSec, maxDur));
  const clampedEnd = Math.max(0, Math.min(endTimeSec, maxDur));

  if (clampedEnd <= clampedStart + 0.05) {
    ctx.notify(t('notify.minSliceDelta'), 'warning');
    return false;
  }

  ctx.history.recordSnapshot(project, ctx.selection, 'transition/updateRange');
  slide.transitionToNext = {
    ...slide.transitionToNext,
    startTimeSec: Number(clampedStart.toFixed(3)),
    endTimeSec: Number(clampedEnd.toFixed(3)),
  };
  StagePlaybackEngine.invalidateReverseFrames([slide.transitionToNext.id]);
  ctx.emit('structural');
  return true;
}

export function updateSlideDetailsInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  patch: Partial<Pick<SlideNode, 'title' | 'notes' | 'holdDurationSec'>>
): void {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'slide/updateDetails');
  if (patch.title !== undefined) slide.title = patch.title;
  if (patch.notes !== undefined) slide.notes = patch.notes;
  if (patch.holdDurationSec !== undefined) slide.holdDurationSec = patch.holdDurationSec;
  ctx.emit('metadata');
}

export function updateTransitionSpecInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  patch: Partial<Omit<TransitionSpec, 'id' | 'videoAsset'>>
): void {
  const project = ctx.getProject();
  const slide = project.slides.find((s) => s.id === slideId);
  if (!slide) return;
  ctx.history.recordSnapshot(project, ctx.selection, 'transition/updateSpec');

  const rangeChanged =
    patch.startTimeSec !== undefined || patch.endTimeSec !== undefined;
  const speedChanged = patch.playbackSpeed !== undefined;

  const nextSpec: TransitionSpec = {
    ...slide.transitionToNext,
    ...patch,
  };

  if (rangeChanged && nextSpec.videoAsset) {
    const dur = nextSpec.videoAsset.durationSec;
    if (Number.isFinite(dur) && dur > 0) {
      if (typeof nextSpec.startTimeSec === 'number') {
        nextSpec.startTimeSec = Math.max(0, Math.min(nextSpec.startTimeSec, dur));
      }
      if (typeof nextSpec.endTimeSec === 'number') {
        const minEnd = typeof nextSpec.startTimeSec === 'number' ? nextSpec.startTimeSec : 0;
        nextSpec.endTimeSec = Math.max(minEnd, Math.min(nextSpec.endTimeSec, dur));
      }
    }
  }

  slide.transitionToNext = nextSpec;

  if (rangeChanged || speedChanged) {
    StagePlaybackEngine.invalidateReverseFrames([slide.transitionToNext.id]);
  }

  ctx.emit(rangeChanged ? 'structural' : 'metadata');
}

export function moveSlideInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  direction: 'up' | 'down'
): void {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= project.slides.length) return;
  moveSlideToIndexInDeck(ctx, slideId, targetIdx);
}

export function moveSlideToIndexInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  targetIndex: number
): void {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1 || project.slides.length <= 1) return;
  const clampedTarget = Math.max(
    0,
    Math.min(project.slides.length - 1, Math.trunc(targetIndex))
  );
  if (idx === clampedTarget) return;

  ctx.history.recordSnapshot(project, ctx.selection, 'slide/moveToIndex');
  const [removed] = project.slides.splice(idx, 1);
  project.slides.splice(clampedTarget, 0, removed);
  ctx.selection.setActivePreviewIndexRaw(clampedTarget);
  if (!ctx.selection.hasMultiSelectedSlide(removed.id)) {
    ctx.selection.applySingleSelection({ type: 'slide', slideId: removed.id });
  } else {
    ctx.selection.setPrimaryOnly({ type: 'slide', slideId: removed.id });
  }
  ctx.emit('structural');
}

function removeSlideAt(
  project: PresentationProject,
  idx: number,
  transitionChoice: 'above' | 'below' | 'bridge' | undefined,
  candidateRevokeUrls: Array<string | undefined>,
  reverseKeysToInvalidate: string[]
): void {
  const wasLastSlide = idx === project.slides.length - 1;
  const prevSlide = idx > 0 ? project.slides[idx - 1] : null;
  const [removed] = project.slides.splice(idx, 1);

  if (!removed) return;
  if (removed.idleLoopAsset?.objectUrl) {
    candidateRevokeUrls.push(removed.idleLoopAsset.objectUrl);
  }

  if (transitionChoice === 'above') {
    if (prevSlide) {
      const evictedPrevTrans = prevSlide.transitionToNext;
      if (!wasLastSlide || removed.transitionToNext.videoAsset) {
        prevSlide.transitionToNext = {
          ...removed.transitionToNext,
        };
        reverseKeysToInvalidate.push(evictedPrevTrans.id, removed.transitionToNext.id);
        candidateRevokeUrls.push(
          removed.imageAsset?.objectUrl,
          evictedPrevTrans?.videoAsset?.objectUrl
        );
      } else {
        prevSlide.transitionToNext = createDefaultTransition(
          project.settings.defaultFallbackStyle,
          null,
          project.settings.defaultFallbackDurationMs
        );
        reverseKeysToInvalidate.push(evictedPrevTrans.id, removed.transitionToNext.id);
        candidateRevokeUrls.push(
          removed.imageAsset?.objectUrl,
          evictedPrevTrans?.videoAsset?.objectUrl
        );
      }
    } else if (
      project.slides.length > 0 &&
      removed.transitionToNext.videoAsset &&
      !project.slides[0].transitionToNext.videoAsset
    ) {
      const evictedNextTrans = project.slides[0].transitionToNext;
      project.slides[0].transitionToNext = {
        ...removed.transitionToNext,
      };
      reverseKeysToInvalidate.push(evictedNextTrans.id, removed.transitionToNext.id);
      candidateRevokeUrls.push(removed.imageAsset?.objectUrl);
    } else {
      reverseKeysToInvalidate.push(removed.transitionToNext.id);
      candidateRevokeUrls.push(
        removed.imageAsset?.objectUrl,
        removed.transitionToNext?.videoAsset?.objectUrl
      );
    }
  } else if (transitionChoice === 'below') {
    reverseKeysToInvalidate.push(removed.transitionToNext.id);
    candidateRevokeUrls.push(
      removed.imageAsset?.objectUrl,
      removed.transitionToNext?.videoAsset?.objectUrl
    );
  } else {
    // Default ('bridge' or undefined): If removing an intermediate cue stop between
    // contiguous segments of the same reel, bridge prevSlide's endTimeSec to removed's endTimeSec
    if (
      prevSlide &&
      prevSlide.transitionToNext.videoAsset &&
      removed.transitionToNext.videoAsset &&
      prevSlide.transitionToNext.videoAsset.id === removed.transitionToNext.videoAsset.id &&
      typeof prevSlide.transitionToNext.endTimeSec === 'number' &&
      typeof removed.transitionToNext.startTimeSec === 'number' &&
      Math.abs(prevSlide.transitionToNext.endTimeSec - removed.transitionToNext.startTimeSec) < 0.1 &&
      typeof removed.transitionToNext.endTimeSec === 'number' &&
      removed.transitionToNext.endTimeSec > prevSlide.transitionToNext.endTimeSec
    ) {
      prevSlide.transitionToNext.endTimeSec = removed.transitionToNext.endTimeSec;
      reverseKeysToInvalidate.push(prevSlide.transitionToNext.id);
    }

    reverseKeysToInvalidate.push(removed.transitionToNext.id);
    candidateRevokeUrls.push(
      removed.imageAsset?.objectUrl,
      removed.transitionToNext?.videoAsset?.objectUrl
    );
  }
}

export function deleteSlideInDeck(
  ctx: StoreSliceContext,
  slideId: string,
  transitionChoice?: 'above' | 'below' | 'bridge'
): void {
  const project = ctx.getProject();
  const idx = project.slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return;

  ctx.history.recordSnapshot(project, ctx.selection, 'slide/delete');
  const candidateRevokeUrls: Array<string | undefined> = [];
  const reverseKeysToInvalidate: string[] = [];

  removeSlideAt(project, idx, transitionChoice, candidateRevokeUrls, reverseKeysToInvalidate);

  StagePlaybackEngine.invalidateReverseFrames(reverseKeysToInvalidate);
  ctx.history.revokeUrlsIfUnused(project.slides, candidateRevokeUrls);

  if (project.slides.length === 0) {
    ctx.selection.setActivePreviewIndexRaw(0);
    project.reelMetadata = undefined;
    ctx.selection.applySingleSelection({ type: 'settings' });
  } else {
    const nextIdx = Math.max(0, Math.min(idx, project.slides.length - 1));
    ctx.selection.setActivePreviewIndexRaw(nextIdx);
    ctx.selection.applySingleSelection({
      type: 'slide',
      slideId: project.slides[nextIdx].id,
    });
  }
  ctx.emit('structural');
}

export function deleteMultipleItemsInDeck(
  ctx: StoreSliceContext,
  slideIds: string[],
  transitionSlideIds: string[],
  transitionChoice: 'above' | 'below' | 'bridge' = 'below'
): { deletedSlidesCount: number; deletedTransitionsCount: number } {
  const project = ctx.getProject();
  const slideIdSet = new Set(slideIds);
  const transSlideIdSet = new Set(transitionSlideIds);
  if (slideIdSet.size === 0 && transSlideIdSet.size === 0) {
    return { deletedSlidesCount: 0, deletedTransitionsCount: 0 };
  }

  ctx.history.recordSnapshot(project, ctx.selection, 'deck/deleteMultiple');
  const candidateRevokeUrls: Array<string | undefined> = [];
  const reverseKeysToInvalidate: string[] = [];
  const targetTransitionIds = new Set<string>();
  let deletedTransitionsCount = 0;
  let deletedSlidesCount = 0;
  let firstDeletedSlideIdx = project.slides.length;

  // 1. Clear all explicitly selected transition videos
  for (const slide of project.slides) {
    if (!transSlideIdSet.has(slide.id)) continue;
    const spec = slide.transitionToNext;
    targetTransitionIds.add(spec.id);
    if (spec.videoAsset || spec.expectedVideoFileName) {
      deletedTransitionsCount++;
    }
    if (spec.videoAsset?.objectUrl) {
      candidateRevokeUrls.push(spec.videoAsset.objectUrl);
    }
    reverseKeysToInvalidate.push(spec.id);
    if (spec.videoAsset?.id) {
      reverseKeysToInvalidate.push(spec.videoAsset.id);
    }
    spec.videoAsset = null;
    spec.startTimeSec = undefined;
    spec.endTimeSec = undefined;
    spec.expectedVideoFileName = undefined;
    spec.expectedVideoDurationSec = undefined;
  }

  // 2. Delete selected slides in descending index order, honoring explicitly selected transitions
  for (let i = project.slides.length - 1; i >= 0; i--) {
    const slide = project.slides[i];
    if (!slideIdSet.has(slide.id)) continue;

    firstDeletedSlideIdx = Math.min(firstDeletedSlideIdx, i);
    const prevSlide = i > 0 ? project.slides[i - 1] : null;
    const aboveTargeted = Boolean(prevSlide && targetTransitionIds.has(prevSlide.transitionToNext.id));
    const belowTargeted = targetTransitionIds.has(slide.transitionToNext.id);

    let effectiveChoice: 'above' | 'below' | 'bridge' = transitionChoice;
    if (aboveTargeted && !belowTargeted) {
      effectiveChoice = 'above';
    } else if (belowTargeted && !aboveTargeted) {
      effectiveChoice = 'below';
    }

    removeSlideAt(project, i, effectiveChoice, candidateRevokeUrls, reverseKeysToInvalidate);
    deletedSlidesCount++;
  }

  if (reverseKeysToInvalidate.length > 0) {
    StagePlaybackEngine.invalidateReverseFrames(reverseKeysToInvalidate);
  }
  if (candidateRevokeUrls.length > 0) {
    ctx.history.revokeUrlsIfUnused(project.slides, candidateRevokeUrls);
  }

  if (project.slides.length === 0) {
    ctx.selection.setActivePreviewIndexRaw(0);
    project.reelMetadata = undefined;
    ctx.selection.applySingleSelection({ type: 'settings' });
  } else if (deletedSlidesCount > 0) {
    const nextIdx = Math.max(0, Math.min(firstDeletedSlideIdx, project.slides.length - 1));
    ctx.selection.setActivePreviewIndexRaw(nextIdx);
    ctx.selection.applySingleSelection({
      type: 'slide',
      slideId: project.slides[nextIdx].id,
    });
  } else {
    // Only transitions were cleared: keep primary selection valid
    const firstRemainingTransId = project.slides.find((s) => transSlideIdSet.has(s.id))?.id;
    if (firstRemainingTransId) {
      ctx.selection.applySingleSelection({ type: 'transition', slideId: firstRemainingTransId });
    } else {
      ctx.selection.reconcilePrimarySelectionAfterToggle(project.slides);
    }
  }

  ctx.emit('structural');
  return { deletedSlidesCount, deletedTransitionsCount };
}

export function duplicateSlideInDeck(
  ctx: StoreSliceContext,
  slideId?: string
): SlideNode | null {
  const project = ctx.getProject();
  const sel = ctx.selection.getSelection();
  const targetId =
    slideId ??
    (sel.type === 'slide' || sel.type === 'transition'
      ? sel.slideId
      : project.slides[ctx.selection.getActivePreviewIndex()]?.id);
  if (!targetId) return null;

  const idx = project.slides.findIndex((s) => s.id === targetId);
  if (idx === -1) return null;

  ctx.history.recordSnapshot(project, ctx.selection, 'slide/duplicate');
  const source = project.slides[idx];
  const clonedSpec: TransitionSpec = {
    ...source.transitionToNext,
    id: generateId('trans'),
    videoAsset: source.transitionToNext.videoAsset
      ? { ...source.transitionToNext.videoAsset }
      : null,
  };
  const copySuffix = t('slide.duplicateSuffix');
  const clonedSlide: SlideNode = {
    ...source,
    id: generateId('slide'),
    title:
      source.title.includes('(نسخة)') || source.title.includes('(Copy)')
        ? `${source.title}`
        : `${source.title} ${copySuffix}`,
    notes: source.notes,
    holdDurationSec: source.holdDurationSec,
    imageAsset: { ...source.imageAsset },
    transitionToNext: clonedSpec,
  };

  project.slides.splice(idx + 1, 0, clonedSlide);
  ctx.selection.setActivePreviewIndexRaw(idx + 1);
  ctx.selection.applySingleSelection({ type: 'slide', slideId: clonedSlide.id });
  ctx.emit('structural');
  return clonedSlide;
}

export function applyTransitionSpecToAllInDeck(
  ctx: StoreSliceContext,
  sourceSlideId: string
): number {
  const project = ctx.getProject();
  const source = project.slides.find((s) => s.id === sourceSlideId);
  if (!source || project.slides.length === 0) return 0;

  ctx.history.recordSnapshot(project, ctx.selection, 'transition/applySpecToAll');
  const src = source.transitionToNext;
  const keysToInvalidate: string[] = [];

  for (const s of project.slides) {
    if (s.id === source.id) continue;
    if (s.transitionToNext.playbackSpeed !== src.playbackSpeed) {
      keysToInvalidate.push(s.transitionToNext.id);
    }
    s.transitionToNext = {
      ...s.transitionToNext,
      fallbackStyle: src.fallbackStyle,
      fallbackDurationMs: src.fallbackDurationMs,
      playbackSpeed: src.playbackSpeed,
      muted: src.muted,
      easing: src.easing,
    };
  }

  if (keysToInvalidate.length > 0) {
    StagePlaybackEngine.invalidateReverseFrames(keysToInvalidate);
  }

  ctx.emit('structural');
  return project.slides.length;
}

export function computeProjectDiagnostics(project: PresentationProject): ProjectDiagnostics {
  const slides = project.slides;
  const slideCount = slides.length;
  const transitionSlides =
    slideCount <= 1
      ? []
      : project.settings.loopPresentation
        ? slides
        : slides.slice(0, -1);

  let videoTransitionCount = 0;
  let proceduralTransitionCount = 0;
  let estimatedDurationSec = 0;

  for (const s of slides) {
    estimatedDurationSec += s.holdDurationSec && s.holdDurationSec > 0 ? s.holdDurationSec : 3;
  }

  for (const s of transitionSlides) {
    const tr = s.transitionToNext;
    if (tr.videoAsset) {
      videoTransitionCount++;
      const speed = Math.max(0.25, tr.playbackSpeed || 1);
      const start = typeof tr.startTimeSec === 'number' ? tr.startTimeSec : 0;
      const end =
        typeof tr.endTimeSec === 'number' && tr.endTimeSec > start
          ? tr.endTimeSec
          : tr.videoAsset.durationSec > start
            ? tr.videoAsset.durationSec
            : start + 1.5;
      estimatedDurationSec += (end - start) / speed;
    } else {
      proceduralTransitionCount++;
      estimatedDurationSec += Math.max(0.05, (tr.fallbackDurationMs || 700) / 1000);
    }
  }

  const notesCount = slides.filter((s) => Boolean(s.notes && s.notes.trim().length > 0)).length;

  const seenAssets = new Set<string>();
  let totalMediaBytes = 0;
  for (const s of slides) {
    const img = s.imageAsset;
    const imgKey = img.id || img.objectUrl || img.name;
    if (!seenAssets.has(imgKey)) {
      seenAssets.add(imgKey);
      totalMediaBytes += img.fileSize || 0;
    }
    const vid = s.transitionToNext.videoAsset;
    if (vid) {
      const vidKey = vid.id || vid.objectUrl || vid.name;
      if (!seenAssets.has(vidKey)) {
        seenAssets.add(vidKey);
        totalMediaBytes += vid.fileSize || 0;
      }
    }
  }

  return {
    slideCount,
    videoTransitionCount,
    proceduralTransitionCount,
    notesCount,
    estimatedDurationSec: Math.round(estimatedDurationSec),
    totalMediaBytes,
  };
}

export function clearAllSlidesInDeck(ctx: StoreSliceContext): void {
  const project = ctx.getProject();
  ctx.history.clearHistory(project.slides);
  const urlsToCheck: Array<string | undefined> = [];
  const keysToInvalidate: string[] = [];
  for (const slide of project.slides) {
    urlsToCheck.push(slide.imageAsset?.objectUrl);
    urlsToCheck.push(slide.idleLoopAsset?.objectUrl);
    urlsToCheck.push(slide.transitionToNext?.videoAsset?.objectUrl);
    keysToInvalidate.push(slide.transitionToNext.id);
    if (slide.transitionToNext?.videoAsset?.id) {
      keysToInvalidate.push(slide.transitionToNext.videoAsset.id);
    }
  }
  project.slides = [];
  project.reelMetadata = undefined;
  project.aiSourceMeta = undefined;
  ctx.setProjectToken(null);
  ctx.history.revokeUrlsIfUnused(project.slides, urlsToCheck);
  StagePlaybackEngine.invalidateReverseFrames(keysToInvalidate);
  ctx.selection.setActivePreviewIndexRaw(0);
  ctx.selection.applySingleSelection({ type: 'settings' });
  ctx.emit('structural');
}

export function updateSettingsInDeck(
  ctx: StoreSliceContext,
  patch: Partial<PresentationSettings>
): void {
  const project = ctx.getProject();
  project.settings = {
    ...project.settings,
    ...patch,
  };
  ProjectSerializer.saveSettingsToLocal(project.settings);
  ctx.emit('settings');
}
