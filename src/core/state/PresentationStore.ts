import {
  createDefaultTransition,
  createEmptyProject,
  createSlideNode,
  generateId,
  inferAspectRatioFromDimensions,
} from '../domain/defaults';
import {
  MediaAsset,
  PresentationProject,
  PresentationSettings,
  ProjectAiSourceMeta,
  ReelMetadata,
  SegmentEasing,
  SlideNode,
  TransitionSpec,
} from '../domain/types';
import { StagePlaybackEngine } from '../engine/StagePlaybackEngine';
import { DemoGenerator } from '../services/DemoGenerator';
import { FrameExtractor } from '../services/FrameExtractor';
import { MediaValidator } from '../services/MediaValidator';
import {
  DeserializedProjectData,
  LoadedProjectBundle,
  ProjectSerializer,
} from '../services/ProjectSerializer';
import { SmartPairer } from '../services/SmartPairer';
import { AppLanguage, t } from '../i18n';

export type SelectionTarget =
  | { type: 'slide'; slideId: string }
  | { type: 'transition'; slideId: string }
  | { type: 'settings' };

export type StoreChangeType =
  | 'structural'
  | 'settings'
  | 'metadata'
  | 'selection'
  | 'notification';

export type StoreListener = (changeType?: StoreChangeType) => void;

export interface ApplyCuePointsOptions {
  mode?: 'replace-all' | 'append' | 'replace-reel';
  targetVideoAssetId?: string;
  matchAspectRatio?: boolean;
  preserveMetadata?: boolean;
  segmentEasings?: SegmentEasing[];
  cueLabels?: string[];
  onProgress?: (done: number, total: number, timeSec?: number) => void;
  signal?: AbortSignal;
}

export interface ReelContext {
  videoAsset: MediaAsset;
  cuePointsSec: number[];
  slideIds: string[];
  isFullProjectReel: boolean;
}

export interface MissingVideoAssetGroup {
  videoFileName: string;
  durationSec: number;
  slideIds: string[];
  cueTimesSec: number[];
}

export interface ProjectDiagnostics {
  slideCount: number;
  videoTransitionCount: number;
  proceduralTransitionCount: number;
  notesCount: number;
  estimatedDurationSec: number;
  totalMediaBytes: number;
}

interface StudioHistorySnapshot {
  title: string;
  slides: SlideNode[];
  reelMetadata: ReelMetadata | undefined;
  activePreviewIndex: number;
  selection: SelectionTarget;
  selectedSlideIds: string[];
  selectedTransitionSlideIds: string[];
}

const DEFAULT_CUE_TITLE_RE = /^(?:مرحلة توقف \d+|توقف_\d+_|Hold Cue \d+|cue_\d+_)/i;

export class PresentationStore {
  private project: PresentationProject;
  private selection: SelectionTarget = { type: 'settings' };
  private selectedSlideIds = new Set<string>();
  private selectedTransitionSlideIds = new Set<string>();
  private activePreviewIndex = 0;
  private listeners = new Set<StoreListener>();
  private notification: { message: string; kind: 'info' | 'success' | 'warning' | 'error' } | null =
    null;
  private isBatching = false;
  private undoStack: StudioHistorySnapshot[] = [];
  private redoStack: StudioHistorySnapshot[] = [];
  private readonly maxHistoryDepth = 40;
  private isRecordingSuppressed = false;
  private revokedBlobUrls = new Set<string>();

  constructor() {
    this.project = createEmptyProject();
    const savedSettings = ProjectSerializer.loadSettingsFromLocal();
    if (savedSettings) {
      this.project.settings = { ...this.project.settings, ...savedSettings };
    }
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(changeType: StoreChangeType = 'structural'): void {
    if (this.isBatching) return;
    this.project.updatedAt = new Date().toISOString();
    for (const listener of this.listeners) {
      listener(changeType);
    }
  }

  batchUpdate(fn: () => void): void {
    this.isBatching = true;
    try {
      fn();
    } finally {
      this.isBatching = false;
      this.emit('structural');
    }
  }

  getProject(): PresentationProject {
    return this.project;
  }

  getSlides(): SlideNode[] {
    return this.project.slides;
  }

  getSlideByIndex(index: number): SlideNode | undefined {
    if (index < 0 || index >= this.project.slides.length) return undefined;
    return this.project.slides[index];
  }

  getSettings(): PresentationSettings {
    return this.project.settings;
  }

  getSelection(): SelectionTarget {
    return this.selection;
  }

  getActivePreviewIndex(): number {
    return this.activePreviewIndex;
  }

  getNotification() {
    return this.notification;
  }

  notify(
    message: string,
    kind: 'info' | 'success' | 'warning' | 'error' = 'info',
    autoClearMs = 4500
  ): void {
    this.notification = { message, kind };
    this.emit('notification');
    if (autoClearMs > 0) {
      setTimeout(() => {
        if (this.notification?.message === message) {
          this.notification = null;
          this.emit('notification');
        }
      }, autoClearMs);
    }
  }

  private collectLiveBlobUrls(): Set<string> {
    const live = new Set<string>();
    const addFromSlides = (slides: SlideNode[]) => {
      for (const s of slides) {
        if (s.imageAsset?.objectUrl?.startsWith('blob:')) {
          live.add(s.imageAsset.objectUrl);
        }
        const vidUrl = s.transitionToNext?.videoAsset?.objectUrl;
        if (vidUrl?.startsWith('blob:')) {
          live.add(vidUrl);
        }
        const loopUrl = s.idleLoopAsset?.objectUrl;
        if (loopUrl?.startsWith('blob:')) {
          live.add(loopUrl);
        }
      }
    };
    addFromSlides(this.project.slides);
    return live;
  }

  private revokeUrlsIfUnused(candidateUrls: Array<string | undefined | null>): void {
    const live = this.collectLiveBlobUrls();
    for (const url of candidateUrls) {
      if (url && typeof url === 'string' && url.startsWith('blob:') && !live.has(url)) {
        safeRevokeUrl(url);
        this.revokedBlobUrls.add(url);
      }
    }
  }

  private reviveBlobUrlIfRevoked(asset: { objectUrl?: string; file?: File } | null | undefined): void {
    if (!asset?.objectUrl || !this.revokedBlobUrls.has(asset.objectUrl)) return;
    if (
      asset.file &&
      typeof Blob !== 'undefined' &&
      asset.file instanceof Blob &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      asset.objectUrl = URL.createObjectURL(asset.file);
    }
  }

  private cloneSlideForHistory(s: SlideNode): SlideNode {
    return {
      ...s,
      imageAsset: { ...s.imageAsset },
      idleLoopAsset: s.idleLoopAsset ? { ...s.idleLoopAsset } : null,
      sourceMeta: s.sourceMeta ? { ...s.sourceMeta } : undefined,
      transitionToNext: {
        ...s.transitionToNext,
        videoAsset: s.transitionToNext.videoAsset ? { ...s.transitionToNext.videoAsset } : null,
      },
    };
  }

  private createHistorySnapshot(): StudioHistorySnapshot {
    return {
      title: this.project.title,
      slides: this.project.slides.map((s) => this.cloneSlideForHistory(s)),
      reelMetadata: this.project.reelMetadata
        ? {
            ...this.project.reelMetadata,
            cueTimesSec: [...this.project.reelMetadata.cueTimesSec],
            segmentEasings: this.project.reelMetadata.segmentEasings
              ? [...this.project.reelMetadata.segmentEasings]
              : undefined,
          }
        : undefined,
      activePreviewIndex: this.activePreviewIndex,
      selection: { ...this.selection },
      selectedSlideIds: Array.from(this.selectedSlideIds),
      selectedTransitionSlideIds: Array.from(this.selectedTransitionSlideIds),
    };
  }

  private applyHistorySnapshot(snap: StudioHistorySnapshot): void {
    this.project.title = snap.title;
    this.project.slides = snap.slides.map((s) => {
      const restored = this.cloneSlideForHistory(s);
      this.reviveBlobUrlIfRevoked(restored.imageAsset);
      this.reviveBlobUrlIfRevoked(restored.idleLoopAsset);
      this.reviveBlobUrlIfRevoked(restored.transitionToNext.videoAsset);
      return restored;
    });
    this.project.reelMetadata = snap.reelMetadata
      ? {
          ...snap.reelMetadata,
          cueTimesSec: [...snap.reelMetadata.cueTimesSec],
          segmentEasings: snap.reelMetadata.segmentEasings
            ? [...snap.reelMetadata.segmentEasings]
            : undefined,
        }
      : undefined;
    this.activePreviewIndex =
      this.project.slides.length === 0
        ? 0
        : Math.max(0, Math.min(snap.activePreviewIndex, this.project.slides.length - 1));
    this.selection = { ...snap.selection };
    this.selectedSlideIds = new Set(snap.selectedSlideIds);
    this.selectedTransitionSlideIds = new Set(snap.selectedTransitionSlideIds);
    this.reconcilePrimarySelectionAfterToggle();
    this.emit('structural');
  }

  private recordHistorySnapshot(): void {
    if (this.isRecordingSuppressed) return;
    this.undoStack.push(this.createHistorySnapshot());
    if (this.undoStack.length > this.maxHistoryDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.createHistorySnapshot());
    this.applyHistorySnapshot(prev);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.createHistorySnapshot());
    this.applyHistorySnapshot(next);
    return true;
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.revokedBlobUrls.clear();
  }

  setProjectTitle(title: string): void {
    const nextTitle = title.trim() || t('app.titleUntitled');
    if (nextTitle === this.project.title) return;
    this.recordHistorySnapshot();
    this.project.title = nextTitle;
    this.emit('metadata');
  }

  syncDefaultTitlesForLanguage(prevLang: AppLanguage, nextLang: AppLanguage): void {
    let changed = false;
    const prevDefault = t('app.titleDefault', undefined, prevLang);
    const prevDemo = t('app.titleDemo', undefined, prevLang);
    const prevUntitled = t('app.titleUntitled', undefined, prevLang);

    if (
      this.project.title === prevDefault ||
      this.project.title === 'عرض Motion Graphics التفاعلي' ||
      this.project.title === 'عرض تقديمي حركي جديد'
    ) {
      this.project.title = t('app.titleDefault', undefined, nextLang);
      changed = true;
    } else if (
      this.project.title === prevDemo ||
      this.project.title === 'عرض تجريبي — Motion Studio'
    ) {
      this.project.title = t('app.titleDemo', undefined, nextLang);
      changed = true;
    } else if (this.project.title === prevUntitled) {
      this.project.title = t('app.titleUntitled', undefined, nextLang);
      changed = true;
    }

    for (const slide of this.project.slides) {
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
      this.emit('metadata');
    }
  }

  private applySingleSelection(target: SelectionTarget): void {
    this.selection = target;
    this.selectedSlideIds.clear();
    this.selectedTransitionSlideIds.clear();
    if (target.type === 'slide') {
      this.selectedSlideIds.add(target.slideId);
    } else if (target.type === 'transition') {
      this.selectedTransitionSlideIds.add(target.slideId);
    }
  }

  private reconcilePrimarySelectionAfterToggle(): void {
    const validSlideIds = new Set(this.project.slides.map((s) => s.id));
    for (const id of Array.from(this.selectedSlideIds)) {
      if (!validSlideIds.has(id)) this.selectedSlideIds.delete(id);
    }
    for (const id of Array.from(this.selectedTransitionSlideIds)) {
      if (!validSlideIds.has(id)) this.selectedTransitionSlideIds.delete(id);
    }

    if (
      this.selection.type === 'slide' &&
      this.selectedSlideIds.has(this.selection.slideId)
    ) {
      return;
    }
    if (
      this.selection.type === 'transition' &&
      this.selectedTransitionSlideIds.has(this.selection.slideId)
    ) {
      return;
    }

    const lastSlideId = Array.from(this.selectedSlideIds).pop();
    if (lastSlideId) {
      this.selection = { type: 'slide', slideId: lastSlideId };
      const idx = this.project.slides.findIndex((s) => s.id === lastSlideId);
      if (idx !== -1) this.activePreviewIndex = idx;
      return;
    }

    const lastTransId = Array.from(this.selectedTransitionSlideIds).pop();
    if (lastTransId) {
      this.selection = { type: 'transition', slideId: lastTransId };
      const idx = this.project.slides.findIndex((s) => s.id === lastTransId);
      if (idx !== -1) this.activePreviewIndex = idx;
      return;
    }

    this.selection = { type: 'settings' };
  }

  getSelectedSlideIds(): string[] {
    return this.project.slides
      .filter((s) => this.selectedSlideIds.has(s.id))
      .map((s) => s.id);
  }

  getSelectedTransitionSlideIds(): string[] {
    return this.project.slides
      .filter((s) => this.selectedTransitionSlideIds.has(s.id))
      .map((s) => s.id);
  }

  isSlideSelected(slideId: string): boolean {
    return this.selectedSlideIds.has(slideId);
  }

  isTransitionSelected(slideId: string): boolean {
    return this.selectedTransitionSlideIds.has(slideId);
  }

  getMultiSelectionSummary(): {
    slideIds: string[];
    transitionSlideIds: string[];
    totalCount: number;
  } {
    const slideIds = this.getSelectedSlideIds();
    const transitionSlideIds = this.getSelectedTransitionSlideIds();
    return {
      slideIds,
      transitionSlideIds,
      totalCount: slideIds.length + transitionSlideIds.length,
    };
  }

  setSelection(target: SelectionTarget): void {
    this.applySingleSelection(target);
    if (target.type === 'slide' || target.type === 'transition') {
      const idx = this.project.slides.findIndex((s) => s.id === target.slideId);
      if (idx !== -1) {
        this.activePreviewIndex = idx;
      }
    }
    this.emit('selection');
  }

  toggleSlideSelection(slideId: string): void {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    if (this.selectedSlideIds.has(slideId)) {
      this.selectedSlideIds.delete(slideId);
      this.reconcilePrimarySelectionAfterToggle();
    } else {
      this.selectedSlideIds.add(slideId);
      this.selection = { type: 'slide', slideId };
      this.activePreviewIndex = idx;
    }
    this.emit('selection');
  }

  toggleTransitionSelection(slideId: string): void {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    if (this.selectedTransitionSlideIds.has(slideId)) {
      this.selectedTransitionSlideIds.delete(slideId);
      this.reconcilePrimarySelectionAfterToggle();
    } else {
      this.selectedTransitionSlideIds.add(slideId);
      this.selection = { type: 'transition', slideId };
      this.activePreviewIndex = idx;
    }
    this.emit('selection');
  }

  selectSlideRange(targetSlideId: string): void {
    const targetIdx = this.project.slides.findIndex((s) => s.id === targetSlideId);
    if (targetIdx === -1) return;

    let anchorIdx = this.activePreviewIndex;
    if (this.selection.type === 'slide' || this.selection.type === 'transition') {
      const found = this.project.slides.findIndex(
        (s) => s.id === (this.selection as { slideId: string }).slideId
      );
      if (found !== -1) anchorIdx = found;
    }
    anchorIdx = Math.max(0, Math.min(anchorIdx, this.project.slides.length - 1));

    const [low, high] = [Math.min(anchorIdx, targetIdx), Math.max(anchorIdx, targetIdx)];
    for (let i = low; i <= high; i++) {
      this.selectedSlideIds.add(this.project.slides[i].id);
    }
    this.selection = { type: 'slide', slideId: targetSlideId };
    this.activePreviewIndex = targetIdx;
    this.emit('selection');
  }

  selectAllSlides(): void {
    if (this.project.slides.length === 0) return;
    this.selectedSlideIds.clear();
    for (const s of this.project.slides) {
      this.selectedSlideIds.add(s.id);
    }
    if (this.selection.type !== 'slide') {
      const firstId = this.project.slides[0].id;
      this.selection = { type: 'slide', slideId: firstId };
      this.activePreviewIndex = 0;
    }
    this.emit('selection');
  }

  clearMultiSelection(): void {
    if (this.selection.type === 'slide') {
      this.applySingleSelection({ type: 'slide', slideId: this.selection.slideId });
    } else if (this.selection.type === 'transition') {
      this.applySingleSelection({ type: 'transition', slideId: this.selection.slideId });
    } else {
      this.applySingleSelection({ type: 'settings' });
    }
    this.emit('selection');
  }

  setActivePreviewIndex(index: number): void {
    if (this.project.slides.length === 0) {
      this.activePreviewIndex = 0;
    } else {
      this.activePreviewIndex = Math.max(
        0,
        Math.min(index, this.project.slides.length - 1)
      );
    }
    this.emit('selection');
  }

  addSlideFromImage(imageAsset: MediaAsset, insertAfterIndex?: number): SlideNode {
    this.recordHistorySnapshot();
    const newSlide = createSlideNode(
      imageAsset,
      this.project.slides.length,
      this.project.settings.defaultFallbackStyle,
      this.project.settings.defaultFallbackDurationMs
    );

    if (
      typeof insertAfterIndex === 'number' &&
      insertAfterIndex >= 0 &&
      insertAfterIndex < this.project.slides.length
    ) {
      this.project.slides.splice(insertAfterIndex + 1, 0, newSlide);
      this.activePreviewIndex = insertAfterIndex + 1;
    } else {
      this.project.slides.push(newSlide);
      this.activePreviewIndex = this.project.slides.length - 1;
    }

    this.applySingleSelection({ type: 'slide', slideId: newSlide.id });
    this.emit('structural');
    return newSlide;
  }

  appendBatchSlides(newSlides: SlideNode[], unpairedVideos: MediaAsset[] = []): void {
    if (newSlides.length > 0 || unpairedVideos.length > 0) {
      this.recordHistorySnapshot();
    }
    const startIdx = this.project.slides.length;
    this.project.slides.push(...newSlides);

    let firstAttachedSlideIdx = -1;
    const remainingVideos: MediaAsset[] = [];

    for (const vid of unpairedVideos) {
      let matched = false;
      const targetIdx = SmartPairer.extractSlideIndexFromFilename(vid.name);
      if (
        targetIdx !== null &&
        targetIdx >= 0 &&
        targetIdx < this.project.slides.length &&
        !this.project.slides[targetIdx].transitionToNext.videoAsset
      ) {
        const spec = this.project.slides[targetIdx].transitionToNext;
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
    for (let i = 0; i < this.project.slides.length && vidCursor < remainingVideos.length; i++) {
      if (!this.project.slides[i].transitionToNext.videoAsset) {
        const spec = this.project.slides[i].transitionToNext;
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
      this.revokeUrlsIfUnused(unusedUrls);
    }

    if (this.project.slides.length > 0) {
      const targetSelectIdx =
        newSlides.length > 0
          ? Math.min(startIdx, this.project.slides.length - 1)
          : (firstAttachedSlideIdx !== -1 ? firstAttachedSlideIdx : 0);
      const selectSlide = this.project.slides[targetSelectIdx] || this.project.slides[0];
      this.applySingleSelection({ type: 'slide', slideId: selectSlide.id });
      this.activePreviewIndex = targetSelectIdx;
    }
    this.emit('structural');
  }

  async applyVideoCuePointsWorkflow(
    videoAsset: MediaAsset,
    cueTimesSec: number[],
    optionsOrAppend: boolean | ApplyCuePointsOptions = false
  ): Promise<SlideNode[]> {
    const opts: ApplyCuePointsOptions =
      typeof optionsOrAppend === 'boolean'
        ? { mode: optionsOrAppend ? 'append' : 'replace-all' }
        : optionsOrAppend || {};

    const mode = opts.mode ?? 'replace-all';
    const targetVideoId = opts.targetVideoAssetId ?? videoAsset.id;
    const preserveMetadata =
      opts.preserveMetadata ??
      (mode === 'replace-reel' ||
        this.project.slides.some(
          (s) => s.transitionToNext.videoAsset?.id === targetVideoId
        ));

    if (opts.signal?.aborted) {
      throw MediaValidator.createAbortError(t('core.extractSlidesCancelled'));
    }

    // Snapshot previous slide metadata from the same reel for non-destructive re-slicing
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
    const snapshots: MetadataSnapshot[] = [];
    const reelBlockIndices: number[] = [];

    if (preserveMetadata || mode === 'replace-reel') {
      for (let i = 0; i < this.project.slides.length; i++) {
        const s = this.project.slides[i];
        const prev = i > 0 ? this.project.slides[i - 1] : null;
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
        defaultFallback: this.project.settings.defaultFallbackStyle,
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

    // Apply project fallback duration and preserve user-edited titles/notes/timing if matching
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
        this.project.settings.defaultFallbackDurationMs;
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

    this.recordHistorySnapshot();
    this.batchUpdate(() => {
      const candidateRevokeUrls: Array<string | undefined> = [];
      const staleReverseKeys: string[] = [];
      let insertIndex: number;

      if (mode === 'replace-all') {
        for (const slide of this.project.slides) {
          candidateRevokeUrls.push(slide.imageAsset?.objectUrl);
          candidateRevokeUrls.push(slide.transitionToNext?.videoAsset?.objectUrl);
          staleReverseKeys.push(slide.transitionToNext.id);
          if (slide.transitionToNext.videoAsset?.id) {
            staleReverseKeys.push(slide.transitionToNext.videoAsset.id);
          }
        }
        this.project.slides = [...newSlides];
        insertIndex = 0;
      } else if (mode === 'replace-reel' && reelBlockIndices.length > 0) {
        const firstIdx = reelBlockIndices[0];
        const removeSet = new Set(reelBlockIndices);
        const keptSlides: SlideNode[] = [];
        for (let i = 0; i < this.project.slides.length; i++) {
          const slide = this.project.slides[i];
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
        this.project.slides = keptSlides;
        insertIndex = safeInsert;
      } else {
        insertIndex = this.project.slides.length;
        this.project.slides.push(...newSlides);
      }

      if (opts.matchAspectRatio) {
        const inferred =
          videoAsset.suggestedAspectRatio ??
          inferAspectRatioFromDimensions(videoAsset.width, videoAsset.height);
        this.project.settings = {
          ...this.project.settings,
          aspectRatio: inferred,
        };
        ProjectSerializer.saveSettingsToLocal(this.project.settings);
      }

      if (mode !== 'append' || !this.project.reelMetadata) {
        this.project.reelMetadata = {
          sourceVideoId: videoAsset.id,
          sourceVideoName: videoAsset.name,
          durationSec: effectiveDur,
          cueTimesSec: normalizedCues,
          segmentEasings: opts.segmentEasings,
        };
      }

      this.revokeUrlsIfUnused(candidateRevokeUrls);
      if (staleReverseKeys.length > 0) {
        StagePlaybackEngine.invalidateReverseFrames(staleReverseKeys);
      }

      this.activePreviewIndex = insertIndex;
      this.applySingleSelection({ type: 'slide', slideId: newSlides[0].id });
      this.notify(t('notify.reelCreated'), 'success');
    });

    return newSlides;
  }

  getReelContextForSlide(slideId?: string): ReelContext | null {
    const slides = this.project.slides;
    if (slides.length === 0) return null;

    let anchorIdx = -1;
    if (slideId) {
      anchorIdx = slides.findIndex((s) => s.id === slideId);
    } else if (this.selection.type === 'slide' || this.selection.type === 'transition') {
      anchorIdx = slides.findIndex((s) => s.id === (this.selection as { slideId: string }).slideId);
    }
    if (anchorIdx === -1) {
      anchorIdx = Math.max(0, Math.min(this.activePreviewIndex, slides.length - 1));
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
      if (this.project.reelMetadata?.sourceVideoId === id) return true;
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

    // Find contiguous segment block for this video around anchorIdx (or first occurrence)
    let firstSegIdx = slides.findIndex((s, i) => {
      if (s.transitionToNext.videoAsset?.id !== vidId) return false;
      return i <= anchorIdx ? true : false;
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
        runStart = firstSegIdx !== -1 ? firstSegIdx : slides.findIndex((s) => s.transitionToNext.videoAsset?.id === vidId);
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
            : (videoAsset.durationSec > 0 ? videoAsset.durationSec : start + 1);
        rawCues.push(end);
      }
    }

    // Include the landing slide immediately following the final segment if present
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

  getMissingVideoAssets(): MissingVideoAssetGroup[] {
    const groups = new Map<string, MissingVideoAssetGroup>();
    for (const s of this.project.slides) {
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

  async relinkReelVideo(
    target: string | string[],
    newVideoAsset: MediaAsset,
    options?: {
      reextractMissingImages?: boolean;
      onProgress?: (done: number, total: number) => void;
      signal?: AbortSignal;
    }
  ): Promise<number> {
    const matchedIndices: number[] = [];
    for (let i = 0; i < this.project.slides.length; i++) {
      const s = this.project.slides[i];
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
      const spec = this.project.slides[i].transitionToNext;
      oldVideoUrls.push(spec.videoAsset?.objectUrl);
      staleReverseKeys.push(spec.id);
      if (spec.videoAsset?.id) staleReverseKeys.push(spec.videoAsset.id);
    }

    // Identify slides needing crisp full-res image re-extraction
    const reextractJobs: Array<{ slideIndex: number; timeSec: number }> = [];
    if (options?.reextractMissingImages !== false) {
      const seenIndices = new Set<number>();
      for (const i of matchedIndices) {
        const s = this.project.slides[i];
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

        // Also re-extract landing slide following final segment if needed
        const nextIdx = i + 1;
        if (nextIdx < this.project.slides.length && !seenIndices.has(nextIdx)) {
          const nextSlide = this.project.slides[nextIdx];
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
            this.revokeUrlsIfUnused(Array.from(extractedImages.values()).map((a) => a.objectUrl));
            throw MediaValidator.createAbortError(t('core.relinkCancelled'));
          }
          const job = sortedJobs[j];
          try {
            const slide = this.project.slides[job.slideIndex];
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
              this.revokeUrlsIfUnused(Array.from(extractedImages.values()).map((a) => a.objectUrl));
              throw MediaValidator.isAbortError(err)
                ? err
                : MediaValidator.createAbortError(t('core.relinkCancelled'));
            }
            // Keep existing thumbnail/placeholder if single frame fails
          }
          options?.onProgress?.(j + 1, sortedJobs.length);
        }
      } finally {
        session.dispose();
      }
    }

    this.batchUpdate(() => {
      const oldImageUrls: Array<string | undefined> = [];
      const dur = newVideoAsset.durationSec > 0 ? newVideoAsset.durationSec : 1;

      for (const i of matchedIndices) {
        const spec = this.project.slides[i].transitionToNext;
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
        const slide = this.project.slides[slideIdx];
        if (slide) {
          oldImageUrls.push(slide.imageAsset?.objectUrl);
          slide.imageAsset = imgAsset;
        }
      }

      if (this.project.reelMetadata) {
        this.project.reelMetadata = {
          ...this.project.reelMetadata,
          sourceVideoId: newVideoAsset.id,
          sourceVideoName: newVideoAsset.name,
          durationSec: newVideoAsset.durationSec || this.project.reelMetadata.durationSec,
        };
      }

      this.revokeUrlsIfUnused([...oldVideoUrls, ...oldImageUrls]);
      StagePlaybackEngine.invalidateReverseFrames(staleReverseKeys);
    });

    this.notify(t('notify.videoLinkedSuccess', { name: newVideoAsset.name }), 'success');
    return matchedIndices.length;
  }

  replaceSlideImage(slideId: string, newImageAsset: MediaAsset): void {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return;
    this.recordHistorySnapshot();
    const oldUrl = slide.imageAsset.objectUrl;
    slide.imageAsset = newImageAsset;
    if (oldUrl !== newImageAsset.objectUrl) {
      this.revokeUrlsIfUnused([oldUrl]);
    }
    this.emit('structural');
  }

  setProjectAiSourceMeta(meta: ProjectAiSourceMeta | undefined): void {
    this.project.aiSourceMeta = meta ? { ...meta } : undefined;
    this.emit('metadata');
  }

  getProjectAiSourceMeta(): ProjectAiSourceMeta | undefined {
    return this.project.aiSourceMeta;
  }

  setSlideIdleLoopVideo(slideId: string, videoAsset: MediaAsset | null): void {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return;
    this.recordHistorySnapshot();
    const oldUrl = slide.idleLoopAsset?.objectUrl;
    slide.idleLoopAsset = videoAsset;
    slide.expectedIdleLoopFileName = undefined;
    if (oldUrl && oldUrl !== videoAsset?.objectUrl) {
      this.revokeUrlsIfUnused([oldUrl]);
    }
    this.emit('structural');
  }

  setSlideTransitionVideo(slideId: string, videoAsset: MediaAsset | null): void {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return;
    this.recordHistorySnapshot();
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
      this.revokeUrlsIfUnused([oldUrl]);
    }
    this.applySingleSelection({ type: 'transition', slideId: slide.id });
    this.emit('structural');
  }

  updateTransitionRange(slideId: string, startTimeSec: number, endTimeSec: number): boolean {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return false;
    const vid = slide.transitionToNext.videoAsset;
    const maxDur =
      vid && Number.isFinite(vid.durationSec) && vid.durationSec > 0
        ? vid.durationSec
        : Math.max(startTimeSec, endTimeSec, 1);

    if (!Number.isFinite(startTimeSec) || !Number.isFinite(endTimeSec)) {
      this.notify(t('notify.invalidSliceTimes'), 'warning');
      return false;
    }

    const clampedStart = Math.max(0, Math.min(startTimeSec, maxDur));
    const clampedEnd = Math.max(0, Math.min(endTimeSec, maxDur));

    if (clampedEnd <= clampedStart + 0.05) {
      this.notify(t('notify.minSliceDelta'), 'warning');
      return false;
    }

    this.recordHistorySnapshot();
    slide.transitionToNext = {
      ...slide.transitionToNext,
      startTimeSec: Number(clampedStart.toFixed(3)),
      endTimeSec: Number(clampedEnd.toFixed(3)),
    };
    StagePlaybackEngine.invalidateReverseFrames([slide.transitionToNext.id]);
    this.emit('structural');
    return true;
  }

  async splitTransitionAtTime(slideId: string, splitTimeSec?: number): Promise<SlideNode | null> {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return null;
    const slide = this.project.slides[idx];
    const videoAsset = slide.transitionToNext.videoAsset;
    if (!videoAsset) {
      this.notify(t('notify.noTransVideoToSplit'), 'warning');
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
      this.notify(t('notify.clipTooShortToSplit'), 'warning');
      return null;
    }

    let splitAt: number;
    if (typeof splitTimeSec === 'number') {
      if (!Number.isFinite(splitTimeSec) || splitTimeSec <= start + 0.08 || splitTimeSec >= end - 0.08) {
        this.notify(
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
      this.recordHistorySnapshot();
      this.batchUpdate(() => {
        this.isRecordingSuppressed = true;
        try {
          slide.transitionToNext.startTimeSec = start;
          slide.transitionToNext.endTimeSec = splitAt;
          StagePlaybackEngine.invalidateReverseFrames([slide.transitionToNext.id]);

          newSlide = this.addSlideFromImage(extractedFrame, idx);
          newSlide.title = t('slide.holdTitle', { time: splitAt.toFixed(2) });
          newSlide.transitionToNext.videoAsset = videoAsset;
          newSlide.transitionToNext.startTimeSec = splitAt;
          newSlide.transitionToNext.endTimeSec = end;
          newSlide.transitionToNext.playbackSpeed = slide.transitionToNext.playbackSpeed;
          newSlide.transitionToNext.muted = slide.transitionToNext.muted;
          newSlide.transitionToNext.fallbackStyle = slide.transitionToNext.fallbackStyle;
          newSlide.transitionToNext.fallbackDurationMs = slide.transitionToNext.fallbackDurationMs;
        } finally {
          this.isRecordingSuppressed = false;
        }
      });
      this.notify(t('notify.splitSuccess', { time: splitAt.toFixed(2) }), 'success');
      return newSlide;
    } catch (err) {
      this.notify(
        err instanceof Error ? err.message : t('notify.splitExtractFailed'),
        'error'
      );
      return null;
    }
  }

  async generateTransitionVideoForSlide(slideId: string): Promise<boolean> {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return false;
    const nextIdx =
      idx + 1 < this.project.slides.length
        ? idx + 1
        : this.project.settings.loopPresentation && this.project.slides.length > 1
          ? 0
          : -1;
    if (nextIdx === -1) {
      this.notify(t('notify.needNextSlideToGenerate'), 'warning');
      return false;
    }

    const slide = this.project.slides[idx];
    const oldVideoUrl = slide.transitionToNext.videoAsset?.objectUrl;
    const oldVideoId = slide.transitionToNext.videoAsset?.id;

    const { videoAsset, reverseFrames } = await DemoGenerator.generateTransitionVideoBetweenSlides(
      slide,
      this.project.slides[nextIdx],
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
      this.revokeUrlsIfUnused([oldVideoUrl]);
    }

    this.emit('structural');
    this.notify(t('notify.generatedTransSuccess'), 'success');
    return true;
  }

  async extractNextSlideFromTransitionEnd(
    slideId: string,
    atTimeSec?: number
  ): Promise<SlideNode | null> {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return null;
    const slide = this.project.slides[idx];
    const videoAsset = slide.transitionToNext.videoAsset;
    if (!videoAsset) {
      this.notify(t('notify.noTransVideoToExtract'), 'warning');
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

      const created = this.addSlideFromImage(extractedImage, idx);
      created.title =
        targetTime !== null
          ? t('slide.extractedAt', { index: idx + 2, time: targetTime.toFixed(2) })
          : t('slide.extractedEnd', { index: idx + 2 });
      this.notify(t('notify.extractedEndSuccess'), 'success');
      return created;
    } catch (err) {
      this.notify(
        err instanceof Error ? err.message : t('notify.extractFailed'),
        'error'
      );
      return null;
    }
  }

  updateSlideDetails(
    slideId: string,
    patch: Partial<Pick<SlideNode, 'title' | 'notes' | 'holdDurationSec'>>
  ): void {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return;
    this.recordHistorySnapshot();
    if (patch.title !== undefined) slide.title = patch.title;
    if (patch.notes !== undefined) slide.notes = patch.notes;
    if (patch.holdDurationSec !== undefined) slide.holdDurationSec = patch.holdDurationSec;
    this.emit('metadata');
  }

  updateTransitionSpec(
    slideId: string,
    patch: Partial<Omit<TransitionSpec, 'id' | 'videoAsset'>>
  ): void {
    const slide = this.project.slides.find((s) => s.id === slideId);
    if (!slide) return;
    this.recordHistorySnapshot();

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

    this.emit(rangeChanged ? 'structural' : 'metadata');
  }

  moveSlide(slideId: string, direction: 'up' | 'down'): void {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= this.project.slides.length) return;
    this.moveSlideToIndex(slideId, targetIdx);
  }

  moveSlideToIndex(slideId: string, targetIndex: number): void {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1 || this.project.slides.length <= 1) return;
    const clampedTarget = Math.max(
      0,
      Math.min(this.project.slides.length - 1, Math.trunc(targetIndex))
    );
    if (idx === clampedTarget) return;

    this.recordHistorySnapshot();
    const [removed] = this.project.slides.splice(idx, 1);
    this.project.slides.splice(clampedTarget, 0, removed);
    this.activePreviewIndex = clampedTarget;
    if (!this.selectedSlideIds.has(removed.id) || this.selectedSlideIds.size <= 1) {
      this.applySingleSelection({ type: 'slide', slideId: removed.id });
    } else {
      this.selection = { type: 'slide', slideId: removed.id };
    }
    this.emit('structural');
  }

  private removeSlideAt(
    idx: number,
    transitionChoice: 'above' | 'below' | 'bridge' | undefined,
    candidateRevokeUrls: Array<string | undefined>,
    reverseKeysToInvalidate: string[]
  ): void {
    const wasLastSlide = idx === this.project.slides.length - 1;
    const prevSlide = idx > 0 ? this.project.slides[idx - 1] : null;
    const [removed] = this.project.slides.splice(idx, 1);

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
            this.project.settings.defaultFallbackStyle,
            null,
            this.project.settings.defaultFallbackDurationMs
          );
          reverseKeysToInvalidate.push(evictedPrevTrans.id, removed.transitionToNext.id);
          candidateRevokeUrls.push(
            removed.imageAsset?.objectUrl,
            evictedPrevTrans?.videoAsset?.objectUrl
          );
        }
      } else if (
        this.project.slides.length > 0 &&
        removed.transitionToNext.videoAsset &&
        !this.project.slides[0].transitionToNext.videoAsset
      ) {
        const evictedNextTrans = this.project.slides[0].transitionToNext;
        this.project.slides[0].transitionToNext = {
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

  deleteSlide(
    slideId: string,
    transitionChoice?: 'above' | 'below' | 'bridge'
  ): void {
    const idx = this.project.slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return;

    this.recordHistorySnapshot();
    const candidateRevokeUrls: Array<string | undefined> = [];
    const reverseKeysToInvalidate: string[] = [];

    this.removeSlideAt(idx, transitionChoice, candidateRevokeUrls, reverseKeysToInvalidate);

    StagePlaybackEngine.invalidateReverseFrames(reverseKeysToInvalidate);
    this.revokeUrlsIfUnused(candidateRevokeUrls);

    if (this.project.slides.length === 0) {
      this.activePreviewIndex = 0;
      this.project.reelMetadata = undefined;
      this.applySingleSelection({ type: 'settings' });
    } else {
      this.activePreviewIndex = Math.max(0, Math.min(idx, this.project.slides.length - 1));
      this.applySingleSelection({
        type: 'slide',
        slideId: this.project.slides[this.activePreviewIndex].id,
      });
    }
    this.emit('structural');
  }

  deleteMultipleItems(
    slideIds: string[],
    transitionSlideIds: string[],
    transitionChoice: 'above' | 'below' | 'bridge' = 'below'
  ): { deletedSlidesCount: number; deletedTransitionsCount: number } {
    const slideIdSet = new Set(slideIds);
    const transSlideIdSet = new Set(transitionSlideIds);
    if (slideIdSet.size === 0 && transSlideIdSet.size === 0) {
      return { deletedSlidesCount: 0, deletedTransitionsCount: 0 };
    }

    this.recordHistorySnapshot();
    const candidateRevokeUrls: Array<string | undefined> = [];
    const reverseKeysToInvalidate: string[] = [];
    const targetTransitionIds = new Set<string>();
    let deletedTransitionsCount = 0;
    let deletedSlidesCount = 0;
    let firstDeletedSlideIdx = this.project.slides.length;

    // 1. Clear all explicitly selected transition videos
    for (const slide of this.project.slides) {
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
    for (let i = this.project.slides.length - 1; i >= 0; i--) {
      const slide = this.project.slides[i];
      if (!slideIdSet.has(slide.id)) continue;

      firstDeletedSlideIdx = Math.min(firstDeletedSlideIdx, i);
      const prevSlide = i > 0 ? this.project.slides[i - 1] : null;
      const aboveTargeted = Boolean(prevSlide && targetTransitionIds.has(prevSlide.transitionToNext.id));
      const belowTargeted = targetTransitionIds.has(slide.transitionToNext.id);

      let effectiveChoice: 'above' | 'below' | 'bridge' = transitionChoice;
      if (aboveTargeted && !belowTargeted) {
        effectiveChoice = 'above';
      } else if (belowTargeted && !aboveTargeted) {
        effectiveChoice = 'below';
      }

      this.removeSlideAt(i, effectiveChoice, candidateRevokeUrls, reverseKeysToInvalidate);
      deletedSlidesCount++;
    }

    if (reverseKeysToInvalidate.length > 0) {
      StagePlaybackEngine.invalidateReverseFrames(reverseKeysToInvalidate);
    }
    if (candidateRevokeUrls.length > 0) {
      this.revokeUrlsIfUnused(candidateRevokeUrls);
    }

    if (this.project.slides.length === 0) {
      this.activePreviewIndex = 0;
      this.project.reelMetadata = undefined;
      this.applySingleSelection({ type: 'settings' });
    } else if (deletedSlidesCount > 0) {
      this.activePreviewIndex = Math.max(
        0,
        Math.min(firstDeletedSlideIdx, this.project.slides.length - 1)
      );
      this.applySingleSelection({
        type: 'slide',
        slideId: this.project.slides[this.activePreviewIndex].id,
      });
    } else {
      // Only transitions were cleared: keep primary selection valid
      const firstRemainingTransId = this.project.slides.find((s) => transSlideIdSet.has(s.id))?.id;
      if (firstRemainingTransId) {
        this.applySingleSelection({ type: 'transition', slideId: firstRemainingTransId });
      } else {
        this.reconcilePrimarySelectionAfterToggle();
      }
    }

    this.emit('structural');
    return { deletedSlidesCount, deletedTransitionsCount };
  }

  duplicateSlide(slideId?: string): SlideNode | null {
    const targetId =
      slideId ??
      (this.selection.type === 'slide' || this.selection.type === 'transition'
        ? this.selection.slideId
        : this.project.slides[this.activePreviewIndex]?.id);
    if (!targetId) return null;

    const idx = this.project.slides.findIndex((s) => s.id === targetId);
    if (idx === -1) return null;

    this.recordHistorySnapshot();
    const source = this.project.slides[idx];
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

    this.project.slides.splice(idx + 1, 0, clonedSlide);
    this.activePreviewIndex = idx + 1;
    this.applySingleSelection({ type: 'slide', slideId: clonedSlide.id });
    this.emit('structural');
    return clonedSlide;
  }

  applyTransitionSpecToAllSlides(sourceSlideId: string): number {
    const source = this.project.slides.find((s) => s.id === sourceSlideId);
    if (!source || this.project.slides.length === 0) return 0;

    this.recordHistorySnapshot();
    const src = source.transitionToNext;
    const keysToInvalidate: string[] = [];

    for (const s of this.project.slides) {
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

    this.emit('structural');
    return this.project.slides.length;
  }

  getProjectDiagnostics(): ProjectDiagnostics {
    const slides = this.project.slides;
    const slideCount = slides.length;
    const transitionSlides =
      slideCount <= 1
        ? []
        : this.project.settings.loopPresentation
          ? slides
          : slides.slice(0, -1);

    let videoTransitionCount = 0;
    let proceduralTransitionCount = 0;
    let estimatedDurationSec = 0;

    for (const s of slides) {
      estimatedDurationSec += s.holdDurationSec && s.holdDurationSec > 0 ? s.holdDurationSec : 3;
    }

    for (const s of transitionSlides) {
      const t = s.transitionToNext;
      if (t.videoAsset) {
        videoTransitionCount++;
        const speed = Math.max(0.25, t.playbackSpeed || 1);
        const start = typeof t.startTimeSec === 'number' ? t.startTimeSec : 0;
        const end =
          typeof t.endTimeSec === 'number' && t.endTimeSec > start
            ? t.endTimeSec
            : t.videoAsset.durationSec > start
              ? t.videoAsset.durationSec
              : start + 1.5;
        estimatedDurationSec += (end - start) / speed;
      } else {
        proceduralTransitionCount++;
        estimatedDurationSec += Math.max(0.05, (t.fallbackDurationMs || 700) / 1000);
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

  clearAllSlides(): void {
    this.clearHistory();
    const urlsToCheck: Array<string | undefined> = [];
    const keysToInvalidate: string[] = [];
    for (const slide of this.project.slides) {
      urlsToCheck.push(slide.imageAsset?.objectUrl);
      urlsToCheck.push(slide.idleLoopAsset?.objectUrl);
      urlsToCheck.push(slide.transitionToNext?.videoAsset?.objectUrl);
      keysToInvalidate.push(slide.transitionToNext.id);
      if (slide.transitionToNext?.videoAsset?.id) {
        keysToInvalidate.push(slide.transitionToNext.videoAsset.id);
      }
    }
    this.project.slides = [];
    this.project.reelMetadata = undefined;
    this.project.aiSourceMeta = undefined;
    this.revokeUrlsIfUnused(urlsToCheck);
    StagePlaybackEngine.invalidateReverseFrames(keysToInvalidate);
    this.activePreviewIndex = 0;
    this.applySingleSelection({ type: 'settings' });
    this.emit('structural');
  }

  updateSettings(patch: Partial<PresentationSettings>): void {
    this.project.settings = {
      ...this.project.settings,
      ...patch,
    };
    ProjectSerializer.saveSettingsToLocal(this.project.settings);
    this.emit('settings');
  }

  async loadProjectBundle(bundle: LoadedProjectBundle): Promise<void> {
    if (bundle.format !== 'mpres-bundle' || typeof document === 'undefined') {
      this.loadProjectFromManifest(bundle.projectData);
      return;
    }

    const imageMap = new Map<string, MediaAsset>();
    const videoMap = new Map<string, MediaAsset>();

    for (const [archivePath, item] of bundle.imageAssets.entries()) {
      try {
        const ab = item.bytes.buffer.slice(
          item.bytes.byteOffset,
          item.bytes.byteOffset + item.bytes.byteLength
        ) as ArrayBuffer;
        const file = new File([ab], item.fileName, { type: item.mimeType });
        const asset = await MediaValidator.ingestFile(file, 'image');
        imageMap.set(archivePath, asset);
      } catch {
        // Fallback to thumbnail in manifest if image decode fails
      }
    }

    for (const [archivePath, item] of bundle.videoAssets.entries()) {
      try {
        const ab = item.bytes.buffer.slice(
          item.bytes.byteOffset,
          item.bytes.byteOffset + item.bytes.byteLength
        ) as ArrayBuffer;
        const file = new File([ab], item.fileName, { type: item.mimeType });
        const asset = await MediaValidator.ingestFile(file, 'video');
        videoMap.set(archivePath, asset);
      } catch {
        // Leave expectedVideoFileName for relink UI if video decode fails
      }
    }

    this.loadProjectFromManifest(bundle.projectData, {
      skipCacheHydration: true,
      preloadedAssets: { imageMap, videoMap },
    });

    if (this.project.slides.length > 0) {
      void ProjectSerializer.cacheProjectAssetsToLocalDb(this.project);
    }
  }

  loadProjectFromManifest(
    data: Partial<DeserializedProjectData> & {
      slides?: SlideNode[];
      slidesData?: any[];
    },
    options?: {
      skipCacheHydration?: boolean;
      preloadedAssets?: {
        imageMap: Map<string, MediaAsset>;
        videoMap: Map<string, MediaAsset>;
      };
    }
  ): void {
    this.clearHistory();
    const oldUrls: Array<string | undefined> = [];
    const oldReverseKeys: string[] = [];
    for (const s of this.project.slides) {
      oldUrls.push(s.imageAsset?.objectUrl);
      oldUrls.push(s.idleLoopAsset?.objectUrl);
      oldUrls.push(s.transitionToNext?.videoAsset?.objectUrl);
      oldReverseKeys.push(s.transitionToNext.id);
      if (s.transitionToNext?.videoAsset?.id) {
        oldReverseKeys.push(s.transitionToNext.videoAsset.id);
      }
    }

    if (data.projectId) this.project.id = data.projectId;
    if (data.title) this.project.title = data.title;
    if (data.settings) {
      this.project.settings = { ...this.project.settings, ...data.settings };
      ProjectSerializer.saveSettingsToLocal(this.project.settings);
    }
    this.project.reelMetadata = data.reelMetadata;
    this.project.aiSourceMeta = data.aiSourceMeta;

    if (Array.isArray(data.slides) && data.slides.length > 0 && 'imageAsset' in data.slides[0]) {
      this.project.slides = data.slides;
    } else if (Array.isArray(data.slidesData) && data.slidesData.length > 0) {
      this.project.slides = data.slidesData.map((sd: any, i: number) => {
        const title = sd.title || t('slide.defaultTitle', { index: i + 1 });
        const fileName = sd.imageFileName || `slide_${i + 1}.png`;
        const { width, height } = parseResolution(
          sd.imageWidth,
          sd.imageHeight,
          sd.imageResolution
        );

        const preloadedImg =
          typeof sd.imageArchivePath === 'string'
            ? options?.preloadedAssets?.imageMap.get(sd.imageArchivePath)
            : undefined;

        let imgAsset: MediaAsset;
        if (preloadedImg) {
          imgAsset = {
            ...preloadedImg,
            sourceVideoId:
              typeof sd.sourceVideoId === 'string'
                ? sd.sourceVideoId
                : preloadedImg.sourceVideoId,
            sourceTimeSec:
              typeof sd.sourceTimeSec === 'number' && !Number.isNaN(sd.sourceTimeSec)
                ? sd.sourceTimeSec
                : preloadedImg.sourceTimeSec,
          };
        } else {
          const imageUrl =
            sd.imageDataUrl ||
            sd.imageThumbnailUrl ||
            createPlaceholderSlideImage(title, fileName, i + 1).thumbnailUrl;
          const thumbUrl = sd.imageThumbnailUrl || imageUrl;

          imgAsset = {
            id: generateId('img'),
            name: fileName,
            kind: 'image',
            mimeType: sd.imageMimeType || 'image/png',
            extension: fileName.split('.').pop()?.toLowerCase() || 'png',
            objectUrl: imageUrl,
            fileSize: sd.imageDataUrl ? sd.imageDataUrl.length : 0,
            width,
            height,
            durationSec: 0,
            thumbnailUrl: thumbUrl,
            sourceVideoId: typeof sd.sourceVideoId === 'string' ? sd.sourceVideoId : undefined,
            sourceTimeSec:
              typeof sd.sourceTimeSec === 'number' && !Number.isNaN(sd.sourceTimeSec)
                ? sd.sourceTimeSec
                : undefined,
          };
        }

        const tr = sd.transitionToNext;
        const fallbackDur =
          typeof tr?.fallbackDurationMs === 'number' && Number.isFinite(tr.fallbackDurationMs)
            ? tr.fallbackDurationMs
            : this.project.settings.defaultFallbackDurationMs;

        const slide = createSlideNode(
          imgAsset,
          i,
          tr?.fallbackStyle || this.project.settings.defaultFallbackStyle,
          fallbackDur
        );
        slide.title = title;
        slide.notes = sd.notes || '';
        slide.holdDurationSec =
          typeof sd.holdDurationSec === 'number' ? sd.holdDurationSec : null;
        if (sd.sourceMeta && typeof sd.sourceMeta === 'object') {
          slide.sourceMeta = sd.sourceMeta;
        }
        const preloadedIdleLoop =
          typeof sd.idleLoopArchivePath === 'string'
            ? options?.preloadedAssets?.videoMap.get(sd.idleLoopArchivePath)
            : undefined;
        if (preloadedIdleLoop) {
          slide.idleLoopAsset = preloadedIdleLoop;
          slide.expectedIdleLoopFileName = undefined;
        } else if (typeof sd.expectedIdleLoopFileName === 'string' && sd.expectedIdleLoopFileName) {
          slide.expectedIdleLoopFileName = sd.expectedIdleLoopFileName;
        } else if (typeof sd.idleLoopFileName === 'string' && sd.idleLoopFileName) {
          slide.expectedIdleLoopFileName = sd.idleLoopFileName;
        }

        if (tr) {
          slide.transitionToNext.playbackSpeed =
            typeof tr.playbackSpeed === 'number' && tr.playbackSpeed > 0
              ? tr.playbackSpeed
              : 1.0;
          slide.transitionToNext.muted = Boolean(tr.muted);
          if (typeof tr.easing === 'string' && tr.easing) {
            slide.transitionToNext.easing = tr.easing as any;
          }
          slide.transitionToNext.startTimeSec =
            typeof tr.startTimeSec === 'number' && !Number.isNaN(tr.startTimeSec)
              ? tr.startTimeSec
              : undefined;
          slide.transitionToNext.endTimeSec =
            typeof tr.endTimeSec === 'number' && !Number.isNaN(tr.endTimeSec)
              ? tr.endTimeSec
              : undefined;

          const preloadedVid =
            typeof tr.videoArchivePath === 'string'
              ? options?.preloadedAssets?.videoMap.get(tr.videoArchivePath)
              : undefined;
          if (preloadedVid) {
            slide.transitionToNext.videoAsset = preloadedVid;
            slide.transitionToNext.expectedVideoFileName = undefined;
            slide.transitionToNext.expectedVideoDurationSec = undefined;
          } else if (tr.hasCustomVideo && typeof tr.videoFileName === 'string' && tr.videoFileName) {
            slide.transitionToNext.expectedVideoFileName = tr.videoFileName;
            slide.transitionToNext.expectedVideoDurationSec =
              typeof tr.videoDurationSec === 'number' ? tr.videoDurationSec : undefined;
          }
        }

        return slide;
      });
    } else {
      this.project.slides = [];
    }

    this.revokeUrlsIfUnused(oldUrls);
    StagePlaybackEngine.invalidateReverseFrames(oldReverseKeys);

    this.activePreviewIndex = 0;
    this.applySingleSelection(
      this.project.slides.length > 0
        ? { type: 'slide', slideId: this.project.slides[0].id }
        : { type: 'settings' }
    );
    this.emit('structural');

    if (
      !options?.skipCacheHydration &&
      typeof indexedDB !== 'undefined' &&
      this.project.slides.length > 0
    ) {
      void this.hydrateProjectAssetsFromCache();
    }
  }

  async hydrateProjectAssetsFromCache(): Promise<number> {
    if (typeof indexedDB === 'undefined' || typeof document === 'undefined') return 0;
    const projectId = this.project.id;
    let restoredCount = 0;

    // 1. Restore missing videos from IndexedDB first (deduplicated by filename)
    const missingGroups = this.getMissingVideoAssets();
    for (const group of missingGroups) {
      try {
        const cachedFile = await ProjectSerializer.restoreCachedFile(
          projectId,
          group.videoFileName,
          'video'
        );
        if (cachedFile) {
          const videoAsset = await MediaValidator.ingestFile(cachedFile, 'video');
          const count = await this.relinkReelVideo(group.slideIds, videoAsset, {
            reextractMissingImages: true,
          });
          restoredCount += count;
        }
      } catch {
        // Leave pending relink metadata for UI banner
      }
    }

    // 2. Restore any remaining placeholder slide images from IndexedDB
    const imagePatches: Array<{ idx: number; asset: MediaAsset }> = [];
    for (let i = 0; i < this.project.slides.length; i++) {
      const s = this.project.slides[i];
      if (s.imageAsset.fileSize === 0 && s.imageAsset.name) {
        try {
          const cachedFile = await ProjectSerializer.restoreCachedFile(
            projectId,
            s.imageAsset.name,
            'image'
          );
          if (cachedFile) {
            const imgAsset = await MediaValidator.ingestFile(cachedFile, 'image');
            imgAsset.sourceVideoId = s.imageAsset.sourceVideoId;
            imgAsset.sourceTimeSec = s.imageAsset.sourceTimeSec;
            imagePatches.push({ idx: i, asset: imgAsset });
          }
        } catch {
          // ignore
        }
      }
    }

    if (imagePatches.length > 0) {
      this.batchUpdate(() => {
        const oldUrls: string[] = [];
        for (const p of imagePatches) {
          const slide = this.project.slides[p.idx];
          if (slide) {
            oldUrls.push(slide.imageAsset.objectUrl);
            slide.imageAsset = p.asset;
            restoredCount++;
          }
        }
        this.revokeUrlsIfUnused(oldUrls);
      });
    }

    return restoredCount;
  }
}

function parseResolution(
  widthVal?: number,
  heightVal?: number,
  resString?: string
): { width: number; height: number } {
  if (
    typeof widthVal === 'number' &&
    widthVal > 0 &&
    typeof heightVal === 'number' &&
    heightVal > 0
  ) {
    return { width: widthVal, height: heightVal };
  }
  if (typeof resString === 'string') {
    const match = resString.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (match) {
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  }
  return { width: 1920, height: 1080 };
}

function createPlaceholderSlideImage(
  title: string,
  fileName: string,
  index: number
): { objectUrl: string; thumbnailUrl: string } {
  if (typeof document === 'undefined') {
    return { objectUrl: '', thumbnailUrl: '' };
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E293B');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.fillStyle = '#38BDF8';
    ctx.font = '700 28px Cairo, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('slide.mockCanvasLabel', { index, name: fileName }), 640, 330);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 20px Cairo, -apple-system, sans-serif';
    ctx.fillText(title, 640, 390);
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { objectUrl: dataUrl, thumbnailUrl: dataUrl };
}

function safeRevokeUrl(url?: string): void {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}
