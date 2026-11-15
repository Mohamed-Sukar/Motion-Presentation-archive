import {
  EngineStatus,
  FallbackTransitionStyle,
  MediaAsset,
  PresentationSettings,
  SegmentEasing,
  SlideNode,
  TransitionSpec,
} from '../domain/types';
import { t } from '../i18n';

export type EngineStatusListener = (status: EngineStatus) => void;

const MAX_REVERSE_CACHE_ENTRIES = 24;
export const DEFAULT_REVERSE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
export const MAX_WARMED_VIDEOS = 8;
export const MAX_CACHED_IMAGES = 48;
const MAX_RECORDED_REVERSE_FRAMES = 60;
const MAX_REVERSE_FRAME_DIM = 1280;
const MAX_PREWARM_FRAME_DIM = 960;

export class StagePlaybackEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slides: SlideNode[] = [];
  private settings: PresentationSettings;

  private imageCache = new Map<string, { url: string; img: HTMLImageElement }>();
  private videoCache = new Map<string, { url: string; video: HTMLVideoElement }>();
  private inflightImages = new Map<string, Promise<HTMLImageElement>>();
  private inflightVideos = new Map<string, Promise<HTMLVideoElement>>();
  private prewarmInFlight = new Map<string, Promise<void>>();
  private reverseFrameCache = new Map<string, (ImageBitmap | HTMLCanvasElement)[]>();
  private static globalReverseFrameCache = new Map<string, (ImageBitmap | HTMLCanvasElement)[]>();
  private static maxReverseCacheBytes = DEFAULT_REVERSE_CACHE_MAX_BYTES;
  private static maxReverseCacheEntries = MAX_REVERSE_CACHE_ENTRIES;
  private static maxWarmedVideos = MAX_WARMED_VIDEOS;
  private static maxCachedImages = MAX_CACHED_IMAGES;

  static computeFrameArrayBytes(frames: (ImageBitmap | HTMLCanvasElement)[]): number {
    let total = 0;
    for (const frame of frames) {
      if (!frame) continue;
      const w = Math.max(1, Number((frame as { width?: number }).width) || 0);
      const h = Math.max(1, Number((frame as { height?: number }).height) || 0);
      total += w * h * 4;
    }
    return total;
  }

  static getReverseCacheStats(): {
    entryCount: number;
    uniqueArrayCount: number;
    totalBytes: number;
    maxBytes: number;
    maxEntries: number;
  } {
    const seen = new Set<(ImageBitmap | HTMLCanvasElement)[]>();
    let totalBytes = 0;
    for (const frames of StagePlaybackEngine.globalReverseFrameCache.values()) {
      if (seen.has(frames)) continue;
      seen.add(frames);
      totalBytes += StagePlaybackEngine.computeFrameArrayBytes(frames);
    }
    return {
      entryCount: StagePlaybackEngine.globalReverseFrameCache.size,
      uniqueArrayCount: seen.size,
      totalBytes,
      maxBytes: StagePlaybackEngine.maxReverseCacheBytes,
      maxEntries: StagePlaybackEngine.maxReverseCacheEntries,
    };
  }

  static setReverseCacheMaxBytes(maxBytes: number): void {
    StagePlaybackEngine.maxReverseCacheBytes = Math.max(0, Math.floor(maxBytes));
    StagePlaybackEngine.evictGlobalReverseCache();
  }

  static setReverseCacheMaxEntries(maxEntries: number): void {
    StagePlaybackEngine.maxReverseCacheEntries = Math.max(1, Math.floor(maxEntries));
    StagePlaybackEngine.evictGlobalReverseCache();
  }

  static setMaxWarmedVideos(maxVideos: number): void {
    StagePlaybackEngine.maxWarmedVideos = Math.max(1, Math.floor(maxVideos));
  }

  static setMaxCachedImages(maxImages: number): void {
    StagePlaybackEngine.maxCachedImages = Math.max(1, Math.floor(maxImages));
  }

  static resetCacheLimits(): void {
    StagePlaybackEngine.maxReverseCacheBytes = DEFAULT_REVERSE_CACHE_MAX_BYTES;
    StagePlaybackEngine.maxReverseCacheEntries = MAX_REVERSE_CACHE_ENTRIES;
    StagePlaybackEngine.maxWarmedVideos = MAX_WARMED_VIDEOS;
    StagePlaybackEngine.maxCachedImages = MAX_CACHED_IMAGES;
  }

  private static isFrameArrayReferencedInGlobalCache(
    frames: (ImageBitmap | HTMLCanvasElement)[]
  ): boolean {
    for (const entry of StagePlaybackEngine.globalReverseFrameCache.values()) {
      if (entry === frames) return true;
    }
    return false;
  }

  private static disposeFrameArrayIfUnreferenced(
    frames: (ImageBitmap | HTMLCanvasElement)[]
  ): void {
    if (!StagePlaybackEngine.isFrameArrayReferencedInGlobalCache(frames)) {
      StagePlaybackEngine.disposeFrameArray(frames);
    }
  }

  private static evictGlobalReverseCache(
    protectedKeys?: Set<string>,
    pinnedKeys?: Set<string>,
    pinnedFrames?: (ImageBitmap | HTMLCanvasElement)[]
  ): void {
    const needsEviction = () => {
      if (StagePlaybackEngine.globalReverseFrameCache.size > StagePlaybackEngine.maxReverseCacheEntries) {
        return true;
      }
      return (
        StagePlaybackEngine.getReverseCacheStats().totalBytes >
        StagePlaybackEngine.maxReverseCacheBytes
      );
    };

    if (!needsEviction()) return;

    // Pass 1: Evict stale/non-active keys first in least-recently-used order.
    for (const [k, val] of Array.from(StagePlaybackEngine.globalReverseFrameCache.entries())) {
      if (!needsEviction()) break;
      if (pinnedKeys?.has(k) || protectedKeys?.has(k)) continue;
      if (
        pinnedFrames !== undefined &&
        val === pinnedFrames &&
        StagePlaybackEngine.globalReverseFrameCache.size <= StagePlaybackEngine.maxReverseCacheEntries
      ) {
        continue;
      }
      StagePlaybackEngine.globalReverseFrameCache.delete(k);
      StagePlaybackEngine.disposeFrameArrayIfUnreferenced(val);
    }

    if (!needsEviction()) return;

    // Pass 2: If byte budget or entry count is still exceeded, evict oldest active keys (LRU).
    for (const [k, val] of Array.from(StagePlaybackEngine.globalReverseFrameCache.entries())) {
      if (!needsEviction()) break;
      if (pinnedKeys?.has(k)) continue;
      if (pinnedFrames !== undefined && val === pinnedFrames) continue;
      StagePlaybackEngine.globalReverseFrameCache.delete(k);
      StagePlaybackEngine.disposeFrameArrayIfUnreferenced(val);
    }
  }

  static cacheReverseFrames(
    key: string,
    frames: (ImageBitmap | HTMLCanvasElement)[],
    protectedKeys?: Set<string>,
    pinnedKeys?: Set<string>
  ): void {
    const existing = StagePlaybackEngine.globalReverseFrameCache.get(key);
    StagePlaybackEngine.globalReverseFrameCache.delete(key);
    StagePlaybackEngine.globalReverseFrameCache.set(key, frames);
    if (existing && existing !== frames) {
      StagePlaybackEngine.disposeFrameArrayIfUnreferenced(existing);
    }
    const pinned = pinnedKeys ? new Set(pinnedKeys) : new Set<string>();
    pinned.add(key);
    StagePlaybackEngine.evictGlobalReverseCache(protectedKeys, pinned, frames);
  }

  static getReverseFrames(
    key: string
  ): (ImageBitmap | HTMLCanvasElement)[] | undefined {
    const frames = StagePlaybackEngine.globalReverseFrameCache.get(key);
    if (frames) {
      StagePlaybackEngine.globalReverseFrameCache.delete(key);
      StagePlaybackEngine.globalReverseFrameCache.set(key, frames);
    }
    return frames;
  }

  static invalidateReverseFrames(keys: string[]): void {
    const evictedArrays: (ImageBitmap | HTMLCanvasElement)[][] = [];
    for (const key of keys) {
      const frames = StagePlaybackEngine.globalReverseFrameCache.get(key);
      if (frames) {
        StagePlaybackEngine.globalReverseFrameCache.delete(key);
        evictedArrays.push(frames);
      }
    }
    for (const frames of evictedArrays) {
      StagePlaybackEngine.disposeFrameArrayIfUnreferenced(frames);
    }
  }

  static clearGlobalReverseFrameCache(): void {
    const disposed = new Set<(ImageBitmap | HTMLCanvasElement)[]>();
    for (const [, frames] of StagePlaybackEngine.globalReverseFrameCache.entries()) {
      if (!disposed.has(frames)) {
        disposed.add(frames);
        StagePlaybackEngine.disposeFrameArray(frames);
      }
    }
    StagePlaybackEngine.globalReverseFrameCache.clear();
  }

  private static disposeFrameArray(frames: (ImageBitmap | HTMLCanvasElement)[]): void {
    for (const f of frames) {
      if (!f) continue;
      if ('close' in f && typeof f.close === 'function') {
        try {
          f.close();
        } catch {
          // ignore already closed ImageBitmap
        }
      } else if (
        (typeof HTMLCanvasElement !== 'undefined' && f instanceof HTMLCanvasElement) ||
        typeof (f as { getContext?: unknown }).getContext === 'function'
      ) {
        (f as { width: number; height: number }).width = 0;
        (f as { width: number; height: number }).height = 0;
      }
    }
  }

  private status: EngineStatus = {
    phase: 'IDLE',
    currentSlideIndex: 0,
    targetSlideIndex: null,
    transitionProgress: 0,
    preloadProgress: 0,
    activeTransitionHasVideo: false,
    isFastForwarding: false,
    errorMessage: null,
    currentVideoTimeSec: null,
    segmentRangeSec: null,
  };

  private listeners = new Set<EngineStatusListener>();
  private rafId: number | null = null;
  private activeVideo: HTMLVideoElement | null = null;
  private activeIdleLoopVideo: HTMLVideoElement | null = null;
  private idleLoopRafId: number | null = null;
  private activeProceduralTransition: { speedUp: () => void } | null = null;
  private holdTimerId: number | null = null;
  private isTransitionReverse = false;
  private playbackEpoch = 0;
  private loadEpoch = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, initialSettings: PresentationSettings) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error(t('core.canvas2dInitFailed'));
    }
    this.ctx = context;
    this.settings = initialSettings;
    this.syncCanvasResolution();
  }

  onStatusChange(listener: EngineStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  getStatus(): EngineStatus {
    return {
      ...this.status,
      segmentRangeSec: this.status.segmentRangeSec ? { ...this.status.segmentRangeSec } : null,
    };
  }

  getActiveVideoTimeSec(): number | null {
    if (this.activeVideo && Number.isFinite(this.activeVideo.currentTime)) {
      return this.activeVideo.currentTime;
    }
    return this.status.currentVideoTimeSec ?? null;
  }

  private emitStatus(patch?: Partial<EngineStatus>): void {
    if (this.destroyed) return;
    if (patch) {
      this.status = { ...this.status, ...patch };
    }
    const snapshot = this.getStatus();
    for (const l of this.listeners) {
      l(snapshot);
    }
  }

  syncCanvasResolution(): void {
    const ratioMap: Record<PresentationSettings['aspectRatio'], [number, number]> = {
      '16:9': [1920, 1080],
      '16:10': [1920, 1200],
      '4:3': [1600, 1200],
      '9:16': [1080, 1920],
    };
    const [w, h] = ratioMap[this.settings.aspectRatio] || [1920, 1080];
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  resize(): void {
    this.syncCanvasResolution();
  }

  async loadProject(
    slides: SlideNode[],
    settings: PresentationSettings,
    startIndex = 0
  ): Promise<void> {
    if (this.destroyed) return;
    const myLoadEpoch = ++this.loadEpoch;
    this.stopCurrentAnimation();
    this.slides = slides;
    this.settings = settings;
    this.syncCanvasResolution();
    this.evictStaleMediaCaches();
    this.cleanUnusedReverseFrameCache();

    if (slides.length === 0) {
      this.clearStage();
      this.emitStatus({
        phase: 'IDLE',
        currentSlideIndex: 0,
        targetSlideIndex: null,
        transitionProgress: 0,
        preloadProgress: 0,
        activeTransitionHasVideo: false,
        isFastForwarding: false,
        currentVideoTimeSec: null,
        segmentRangeSec: null,
      });
      return;
    }

    const clampedStart = Math.max(0, Math.min(startIndex, slides.length - 1));
    this.emitStatus({
      phase: 'PRELOADING',
      currentSlideIndex: clampedStart,
      targetSlideIndex: null,
      preloadProgress: 0,
      errorMessage: null,
      currentVideoTimeSec: null,
      segmentRangeSec: null,
    });

    if (this.settings.preloadStrategy === 'adjacent') {
      const indicesToWarm = this.getAdjacentIndices(clampedStart);
      const uniqueVideoTargets = new Map<string, string>();
      for (const idx of indicesToWarm) {
        const vid = slides[idx]?.transitionToNext?.videoAsset;
        if (vid && !uniqueVideoTargets.has(vid.id)) {
          uniqueVideoTargets.set(vid.id, vid.objectUrl);
        }
        const loopVid = slides[idx]?.idleLoopAsset;
        if (loopVid && !uniqueVideoTargets.has(`${loopVid.id}__idle`)) {
          uniqueVideoTargets.set(`${loopVid.id}__idle`, loopVid.objectUrl);
        }
      }

      const totalToWarm = Math.max(1, indicesToWarm.size + uniqueVideoTargets.size);
      let loadedCount = 0;
      const bump = () => {
        loadedCount++;
        if (myLoadEpoch === this.loadEpoch && !this.destroyed) {
          this.emitStatus({
            preloadProgress: Math.min(1, loadedCount / totalToWarm),
          });
        }
      };

      await Promise.all([
        ...Array.from(indicesToWarm).map(async (idx) => {
          const slide = slides[idx];
          if (slide) {
            await this.ensureImageLoaded(slide.imageAsset.id, slide.imageAsset.objectUrl);
          }
          bump();
        }),
        ...Array.from(uniqueVideoTargets.entries()).map(async ([vidId, vidUrl]) => {
          await this.ensureVideoWarmed(vidId, vidUrl);
          bump();
        }),
      ]);
    } else {
      // Bound eager preloading around startIndex to respect MAX_CACHED_IMAGES and MAX_WARMED_VIDEOS.
      const orderedIndices: number[] = [clampedStart];
      for (let offset = 1; offset < slides.length; offset++) {
        if (clampedStart + offset < slides.length) orderedIndices.push(clampedStart + offset);
        if (clampedStart - offset >= 0) orderedIndices.push(clampedStart - offset);
      }

      const imageTargets: SlideNode[] = [];
      const uniqueVideoTargets = new Map<string, string>();
      for (const idx of orderedIndices) {
        const slide = slides[idx];
        if (!slide) continue;
        if (imageTargets.length < StagePlaybackEngine.maxCachedImages) {
          imageTargets.push(slide);
        }
        const vid = slide.transitionToNext.videoAsset;
        if (
          vid &&
          !uniqueVideoTargets.has(vid.id) &&
          uniqueVideoTargets.size < StagePlaybackEngine.maxWarmedVideos
        ) {
          uniqueVideoTargets.set(vid.id, vid.objectUrl);
        }
        const loopVid = slide.idleLoopAsset;
        if (
          loopVid &&
          !uniqueVideoTargets.has(`${loopVid.id}__idle`) &&
          uniqueVideoTargets.size < StagePlaybackEngine.maxWarmedVideos
        ) {
          uniqueVideoTargets.set(`${loopVid.id}__idle`, loopVid.objectUrl);
        }
      }

      const totalAssets = Math.max(1, imageTargets.length + uniqueVideoTargets.size);
      let loadedCount = 0;

      const bumpProgress = () => {
        loadedCount++;
        if (myLoadEpoch === this.loadEpoch && !this.destroyed) {
          this.emitStatus({
            preloadProgress: Math.min(1, loadedCount / totalAssets),
          });
        }
      };

      await Promise.all([
        ...imageTargets.map(async (slide) => {
          await this.ensureImageLoaded(slide.imageAsset.id, slide.imageAsset.objectUrl);
          bumpProgress();
        }),
        ...Array.from(uniqueVideoTargets.entries()).map(async ([vidId, vidUrl]) => {
          await this.ensureVideoWarmed(vidId, vidUrl);
          bumpProgress();
        }),
      ]);
    }

    if (myLoadEpoch !== this.loadEpoch || this.destroyed) return;
    this.enterHoldSlide(clampedStart);
  }

  updateSettingsLive(settings: PresentationSettings): void {
    this.settings = settings;
    this.syncCanvasResolution();
    if (this.activeVideo) {
      const currentSlide = this.slides[this.status.currentSlideIndex];
      const spec = currentSlide?.transitionToNext;
      const slideMuted = Boolean(spec?.muted);
      this.activeVideo.muted = Boolean(settings.masterMuted || slideMuted);
      const masterVol =
        typeof settings.masterVolume === 'number' && !Number.isNaN(settings.masterVolume)
          ? settings.masterVolume
          : 0.9;
      this.activeVideo.volume = Math.max(0, Math.min(1, masterVol));
      if (!this.status.isFastForwarding && spec) {
        this.activeVideo.playbackRate = Math.max(
          0.25,
          Math.min(4.0, settings.globalPlaybackSpeed * (spec.playbackSpeed || 1.0))
        );
      }
    }
    if (this.status.phase === 'HOLDING_SLIDE') {
      this.drawSlideByIndex(this.status.currentSlideIndex);
    }
  }

  pause(): void {
    this.stopCurrentAnimation();
  }

  /**
   * Primary Presenter Action: Advance to next slide (plays transition video if available)
   */
  next(): void {
    if (this.destroyed) return;

    if (this.clearBlankScreen()) {
      return;
    }

    if (this.slides.length === 0) return;

    // Handle click while transition is already playing
    if (this.status.phase === 'PLAYING_TRANSITION') {
      const behavior = this.settings.interruptBehavior;
      if (behavior === 'lock') {
        return; // Ignore input until transition finishes
      }
      if (behavior === 'skip') {
        if (this.isTransitionReverse) {
          // Mid-backward transition: pressing next reverses direction and returns forward to start slide
          this.completeTransitionImmediately(this.status.currentSlideIndex);
        } else if (this.status.targetSlideIndex !== null) {
          // Mid-forward transition: complete directly to target slide
          this.completeTransitionImmediately(this.status.targetSlideIndex);
        }
        return;
      }
      if (behavior === 'fast-forward') {
        if (this.activeVideo) {
          this.activeVideo.playbackRate = Math.min(
            6.0,
            this.activeVideo.playbackRate * 3.0
          );
          this.emitStatus({ isFastForwarding: true });
          return;
        } else if (this.activeProceduralTransition) {
          this.activeProceduralTransition.speedUp();
          this.emitStatus({ isFastForwarding: true });
          return;
        }
      }
      return;
    }

    const currentIdx = this.status.currentSlideIndex;
    let nextIdx = currentIdx + 1;

    if (nextIdx >= this.slides.length) {
      if (this.settings.loopPresentation && this.slides.length > 1) {
        nextIdx = 0;
      } else {
        // Already at final slide
        return;
      }
    }

    this.startForwardTransition(currentIdx, nextIdx);
  }

  /**
   * Presenter Action: Go back to previous slide
   */
  previous(): void {
    if (this.destroyed) return;

    if (this.clearBlankScreen()) {
      return;
    }

    if (this.slides.length === 0) return;

    // If currently mid-transition:
    if (this.status.phase === 'PLAYING_TRANSITION') {
      if (this.isTransitionReverse && this.status.targetSlideIndex !== null) {
        // Already moving backward: complete backward motion to destination slide
        this.completeTransitionImmediately(this.status.targetSlideIndex);
      } else {
        // Moving forward: cancel forward motion and return cleanly to starting slide
        this.completeTransitionImmediately(this.status.currentSlideIndex);
      }
      return;
    }

    const currentIdx = this.status.currentSlideIndex;
    let prevIdx = currentIdx - 1;
    if (prevIdx < 0) {
      if (this.settings.loopPresentation && this.slides.length > 1) {
        prevIdx = this.slides.length - 1;
      } else {
        return;
      }
    }

    if (this.settings.backwardBehavior === 'instant') {
      this.enterHoldSlide(prevIdx);
      return;
    }

    if (this.settings.backwardBehavior === 'crossfade') {
      const dur = this.settings.defaultFallbackDurationMs || 420;
      this.runProceduralTransition(currentIdx, prevIdx, 'crossfade', dur, true);
      return;
    }

    // Default / 'reverse-step': cleanly mirror the forward transition of the source slide
    const prevSlide = this.slides[prevIdx];
    const spec = prevSlide?.transitionToNext;

    // TRUE REVERSE VIDEO PLAYBACK:
    // If the transition between prevIdx and currentIdx has a video transition,
    // play the cached video frames in true reverse!
    if (spec?.videoAsset) {
      const isSegment =
        typeof spec.startTimeSec === 'number' || typeof spec.endTimeSec === 'number';
      const cachedFrames = isSegment
        ? this.getReverseFrames(spec.id)
        : (this.getReverseFrames(spec.id) || this.getReverseFrames(spec.videoAsset.id));
      if (cachedFrames && cachedFrames.length > 0) {
        this.runReverseVideoTransition(currentIdx, prevIdx, spec, cachedFrames);
        return;
      }
    }

    const style: FallbackTransitionStyle =
      spec?.fallbackStyle && spec.fallbackStyle !== 'crossfade'
        ? spec.fallbackStyle
        : (this.settings.defaultFallbackStyle && this.settings.defaultFallbackStyle !== 'crossfade')
          ? this.settings.defaultFallbackStyle
          : 'zoom-morph';
    const durationMs =
      spec?.fallbackDurationMs ?? this.settings.defaultFallbackDurationMs ?? 500;

    this.runProceduralTransition(currentIdx, prevIdx, style, durationMs, true, spec?.easing);
  }

  /**
   * Jump directly to any slide index (used by timeline selection or Grid Jump 'G')
   */
  jumpToSlide(index: number, withCrossfade = false): void {
    if (this.slides.length === 0 || this.destroyed) return;
    const target = Math.max(0, Math.min(index, this.slides.length - 1));
    if (withCrossfade && target !== this.status.currentSlideIndex) {
      this.stopCurrentAnimation();
      this.runProceduralTransition(
        this.status.currentSlideIndex,
        target,
        'crossfade',
        350,
        target < this.status.currentSlideIndex
      );
    } else {
      this.enterHoldSlide(target);
    }
  }

  /**
   * Replay the transition from the current slide to the next slide (great for previewing in Studio!)
   */
  previewCurrentTransition(): void {
    if (this.slides.length === 0 || this.destroyed) return;
    const currentIdx = this.status.currentSlideIndex;
    const nextIdx =
      currentIdx + 1 < this.slides.length
        ? currentIdx + 1
        : this.settings.loopPresentation && this.slides.length > 1
          ? 0
          : -1;

    if (nextIdx === -1) return;
    this.enterHoldSlide(currentIdx);
    this.startForwardTransition(currentIdx, nextIdx);
  }

  /**
   * If currently in BLACKOUT or WHITEOUT, return cleanly to the holding slide and return true.
   * Otherwise returns false.
   */
  clearBlankScreen(): boolean {
    if (this.destroyed) return false;
    if (this.status.phase === 'BLACKOUT' || this.status.phase === 'WHITEOUT') {
      this.enterHoldSlide(this.status.currentSlideIndex);
      return true;
    }
    return false;
  }

  toggleBlackout(): void {
    if (this.destroyed) return;
    if (this.status.phase === 'BLACKOUT') {
      this.enterHoldSlide(this.status.currentSlideIndex);
    } else {
      this.stopCurrentAnimation();
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.emitStatus({
        phase: 'BLACKOUT',
        transitionProgress: 0,
        currentVideoTimeSec: null,
        segmentRangeSec: null,
      });
    }
  }

  toggleWhiteout(): void {
    if (this.destroyed) return;
    if (this.status.phase === 'WHITEOUT') {
      this.enterHoldSlide(this.status.currentSlideIndex);
    } else {
      this.stopCurrentAnimation();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.emitStatus({
        phase: 'WHITEOUT',
        transitionProgress: 0,
        currentVideoTimeSec: null,
        segmentRangeSec: null,
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.loadEpoch++;
    this.stopCurrentAnimation();
    this.videoCache.forEach(({ video }) => {
      this.releaseVideoElement(video);
    });
    this.videoCache.clear();
    this.imageCache.clear();
    this.inflightImages.clear();
    this.inflightVideos.clear();
    this.prewarmInFlight.clear();
    // Only clear instance-local tracking; never dispose shared globalReverseFrameCache frames
    // because other StagePlaybackEngine instances (e.g. Studio after Fullscreen closes) use them.
    this.reverseFrameCache.clear();
    this.listeners.clear();
  }

  private getAdjacentIndices(currentIdx: number): Set<number> {
    const indices = new Set<number>();
    if (this.slides.length === 0) return indices;
    indices.add(currentIdx);
    if (currentIdx + 1 < this.slides.length) {
      indices.add(currentIdx + 1);
    } else if (this.settings.loopPresentation && this.slides.length > 1) {
      indices.add(0);
    }
    if (currentIdx - 1 >= 0) {
      indices.add(currentIdx - 1);
    } else if (this.settings.loopPresentation && this.slides.length > 1) {
      indices.add(this.slides.length - 1);
    }
    return indices;
  }

  private enterHoldSlide(slideIndex: number): void {
    if (this.destroyed) return;
    this.stopCurrentAnimation();
    this.isTransitionReverse = false;
    const clamped = Math.max(0, Math.min(slideIndex, this.slides.length - 1));
    this.drawSlideByIndex(clamped);

    this.emitStatus({
      phase: 'HOLDING_SLIDE',
      currentSlideIndex: clamped,
      targetSlideIndex: null,
      transitionProgress: 0,
      activeTransitionHasVideo: false,
      isFastForwarding: false,
      currentVideoTimeSec: null,
      segmentRangeSec: null,
    });

    if (this.settings.preloadStrategy === 'adjacent') {
      this.maintainAdjacentCache(clamped);
    } else {
      this.warmHoldNeighbors(clamped);
    }

    // Check if slide has an Idle Motion Loop video to animate during HOLDING_SLIDE
    const slide = this.slides[clamped];
    if (slide?.idleLoopAsset?.objectUrl) {
      this.startIdleLoopForSlide(clamped, slide.idleLoopAsset);
    }

    // Check if slide has automatic hold timer
    if (slide && slide.holdDurationSec && slide.holdDurationSec > 0) {
      this.holdTimerId = window.setTimeout(() => {
        if (
          !this.destroyed &&
          this.status.phase === 'HOLDING_SLIDE' &&
          this.status.currentSlideIndex === clamped
        ) {
          this.next();
        }
      }, slide.holdDurationSec * 1000);
    }
  }

  private warmHoldNeighbors(currentIdx: number): void {
    const holdEpoch = this.playbackEpoch;
    const currentSlide = this.slides[currentIdx];
    const nextIdx =
      currentIdx + 1 < this.slides.length
        ? currentIdx + 1
        : this.settings.loopPresentation && this.slides.length > 1
          ? 0
          : -1;
    const prevIdx =
      currentIdx - 1 >= 0
        ? currentIdx - 1
        : this.settings.loopPresentation && this.slides.length > 1
          ? this.slides.length - 1
          : -1;

    if (nextIdx !== -1 && this.slides[nextIdx]) {
      this.ensureImageLoaded(
        this.slides[nextIdx].imageAsset.id,
        this.slides[nextIdx].imageAsset.objectUrl
      ).catch(() => {});
    }

    // Pre-seek current slide's forward transition video while idle on the static slide
    if (currentSlide?.transitionToNext?.videoAsset) {
      const spec = currentSlide.transitionToNext;
      const vid = spec.videoAsset!;
      const targetStart =
        typeof spec.startTimeSec === 'number' && spec.startTimeSec >= 0 ? spec.startTimeSec : 0;

      this.ensureVideoWarmed(vid.id, vid.objectUrl)
        .then((videoEl) => {
          if (
            !this.destroyed &&
            this.playbackEpoch === holdEpoch &&
            this.status.phase === 'HOLDING_SLIDE' &&
            this.activeVideo === null &&
            videoEl.readyState >= 2 &&
            Math.abs(videoEl.currentTime - targetStart) > 0.025
          ) {
            videoEl.muted = true;
            try {
              videoEl.currentTime = targetStart;
            } catch {
              // ignore pre-seek error
            }
          }
          if (!this.destroyed && !this.hasReverseFrames(spec.id)) {
            this.prewarmReverseFrames(
              spec.id,
              vid,
              spec.startTimeSec,
              spec.endTimeSec,
              currentIdx,
              nextIdx
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // Ensure previous transition has reverse frames ready even when user jumps directly to a later slide
    if (prevIdx !== -1 && this.slides[prevIdx]?.transitionToNext?.videoAsset) {
      const prevSpec = this.slides[prevIdx].transitionToNext;
      if (!this.hasReverseFrames(prevSpec.id)) {
        this.prewarmReverseFrames(
          prevSpec.id,
          prevSpec.videoAsset!,
          prevSpec.startTimeSec,
          prevSpec.endTimeSec,
          prevIdx,
          currentIdx
        ).catch(() => {});
      }
    }
  }

  private evictStaleMediaCaches(): void {
    const validImageIds = new Set<string>();
    const validImageUrls = new Map<string, string>();
    const validVideoIds = new Set<string>();
    const validVideoUrls = new Map<string, string>();

    for (const s of this.slides) {
      validImageIds.add(s.imageAsset.id);
      validImageUrls.set(s.imageAsset.id, s.imageAsset.objectUrl);
      const v = s.transitionToNext?.videoAsset;
      if (v) {
        validVideoIds.add(v.id);
        validVideoUrls.set(v.id, v.objectUrl);
      }
      const loopV = s.idleLoopAsset;
      if (loopV) {
        const loopKey = `${loopV.id}__idle`;
        validVideoIds.add(loopKey);
        validVideoUrls.set(loopKey, loopV.objectUrl);
      }
    }

    for (const [imgId, entry] of this.imageCache.entries()) {
      if (!validImageIds.has(imgId) || validImageUrls.get(imgId) !== entry.url) {
        this.imageCache.delete(imgId);
      }
    }

    for (const [vidId, entry] of this.videoCache.entries()) {
      if (
        (!validVideoIds.has(vidId) || validVideoUrls.get(vidId) !== entry.url) &&
        this.activeVideo !== entry.video &&
        this.activeIdleLoopVideo !== entry.video
      ) {
        this.releaseVideoElement(entry.video);
        this.videoCache.delete(vidId);
      }
    }
  }

  private maintainAdjacentCache(currentIdx: number): void {
    if (this.slides.length === 0) return;

    const neededSlideIndices = this.getAdjacentIndices(currentIdx);
    const neededVideoAssetIds = new Set<string>();
    for (const idx of neededSlideIndices) {
      const s = this.slides[idx];
      if (s?.transitionToNext?.videoAsset) {
        neededVideoAssetIds.add(s.transitionToNext.videoAsset.id);
      }
      if (s?.idleLoopAsset) {
        neededVideoAssetIds.add(`${s.idleLoopAsset.id}__idle`);
      }
    }

    // Evict unused video elements to prevent hardware decoder exhaustion
    for (const [vidId, entry] of this.videoCache.entries()) {
      if (
        !neededVideoAssetIds.has(vidId) &&
        this.activeVideo !== entry.video &&
        this.activeIdleLoopVideo !== entry.video
      ) {
        this.releaseVideoElement(entry.video);
        this.videoCache.delete(vidId);
      }
    }

    for (const idx of neededSlideIndices) {
      const s = this.slides[idx];
      if (s) {
        this.ensureImageLoaded(s.imageAsset.id, s.imageAsset.objectUrl).catch(() => {});
        if (s.transitionToNext.videoAsset) {
          this.ensureVideoWarmed(
            s.transitionToNext.videoAsset.id,
            s.transitionToNext.videoAsset.objectUrl
          ).catch(() => {});
        }
        if (s.idleLoopAsset) {
          this.ensureVideoWarmed(
            `${s.idleLoopAsset.id}__idle`,
            s.idleLoopAsset.objectUrl
          ).catch(() => {});
        }
      }
    }

    this.warmHoldNeighbors(currentIdx);
  }

  private startForwardTransition(fromIndex: number, toIndex: number): void {
    this.stopCurrentAnimation();
    this.isTransitionReverse = false;
    const fromSlide = this.slides[fromIndex];
    if (!fromSlide) return;

    const spec = fromSlide.transitionToNext;
    const videoAsset = spec.videoAsset;

    if (videoAsset) {
      void this.runVideoTransition(fromIndex, toIndex, videoAsset.id, videoAsset.objectUrl);
    } else {
      this.runProceduralTransition(
        fromIndex,
        toIndex,
        spec.fallbackStyle || this.settings.defaultFallbackStyle,
        spec.fallbackDurationMs ?? this.settings.defaultFallbackDurationMs,
        false,
        spec.easing
      );
    }
  }

  private seekVideoExact(
    video: HTMLVideoElement,
    targetTimeSec: number,
    expectedEpoch: number,
    timeoutMs = 1400
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.destroyed || this.playbackEpoch !== expectedEpoch) {
        resolve(false);
        return;
      }

      const maxSafe =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.max(0, video.duration - 0.002)
          : Math.max(0, targetTimeSec);
      const clamped = Math.max(0, Math.min(targetTimeSec, maxSafe));

      if (
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - clamped) <= 0.008
      ) {
        resolve(true);
        return;
      }

      let done = false;
      let timer: number | null = null;

      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve(ok && !this.destroyed && this.playbackEpoch === expectedEpoch);
      };

      const onSeeked = () => finish(true);
      const onError = () => finish(false);

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });

      timer = window.setTimeout(() => {
        finish(video.readyState >= 2);
      }, timeoutMs);

      try {
        video.muted = true;
        video.currentTime = clamped;
      } catch {
        finish(false);
      }
    });
  }

  private async runVideoTransition(
    fromIndex: number,
    toIndex: number,
    videoAssetId: string,
    videoObjectUrl: string
  ): Promise<void> {
    const epoch = this.playbackEpoch;
    const fromSlide = this.slides[fromIndex];
    const toSlide = this.slides[toIndex];
    if (!fromSlide) return;

    const spec = fromSlide.transitionToNext;
    const startTime =
      typeof spec.startTimeSec === 'number' && Number.isFinite(spec.startTimeSec) && spec.startTimeSec >= 0
        ? spec.startTimeSec
        : 0;
    const hasExplicitEnd =
      typeof spec.endTimeSec === 'number' && Number.isFinite(spec.endTimeSec);

    // Handle invalid or zero-length explicit cue segment immediately without playing full video
    if (hasExplicitEnd && spec.endTimeSec! <= startTime + 0.03) {
      this.completeTransitionImmediately(toIndex);
      return;
    }

    const expectedEnd = hasExplicitEnd
      ? spec.endTimeSec!
      : (spec.videoAsset?.durationSec && spec.videoAsset.durationSec > startTime
          ? spec.videoAsset.durationSec
          : startTime + 1);

    // Emit PLAYING_TRANSITION immediately so interruptBehavior works during warmup/seek
    this.drawSlideByIndex(fromIndex);
    this.emitStatus({
      phase: 'PLAYING_TRANSITION',
      currentSlideIndex: fromIndex,
      targetSlideIndex: toIndex,
      transitionProgress: 0,
      activeTransitionHasVideo: true,
      isFastForwarding: false,
      currentVideoTimeSec: startTime,
      segmentRangeSec: { start: startTime, end: expectedEnd },
    });

    // Concurrently warm the video decoder AND destination slide image before playback begins
    const [video] = await Promise.all([
      this.ensureVideoWarmed(videoAssetId, videoObjectUrl),
      toSlide
        ? this.ensureImageLoaded(toSlide.imageAsset.id, toSlide.imageAsset.objectUrl).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (this.destroyed || epoch !== this.playbackEpoch) return;

    // Seek cleanly while muted BEFORE unmuting & playing to eliminate flicker/audio glitches
    const seekOk = await this.seekVideoExact(video, startTime, epoch);
    if (this.destroyed || epoch !== this.playbackEpoch) return;

    if (!seekOk && video.readyState < 2) {
      this.runProceduralTransition(
        fromIndex,
        toIndex,
        spec.fallbackStyle || 'crossfade',
        spec.fallbackDurationMs ?? 650,
        false
      );
      return;
    }

    this.activeVideo = video;

    const effectiveSpeed = Math.max(
      0.25,
      Math.min(4.0, this.settings.globalPlaybackSpeed * (spec.playbackSpeed || 1.0))
    );

    video.playbackRate = effectiveSpeed;
    video.muted = Boolean(this.settings.masterMuted || spec.muted);
    const masterVol =
      typeof this.settings.masterVolume === 'number' && !Number.isNaN(this.settings.masterVolume)
        ? this.settings.masterVolume
        : 0.9;
    video.volume = Math.max(0, Math.min(1, masterVol));

    const recordedFrames: (ImageBitmap | HTMLCanvasElement)[] = [];
    let lastRecordedTime = -Infinity;

    // Determine reverse frame capture budget (bounded RAM)
    const fullDurationEstimate =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : spec.videoAsset?.durationSec && spec.videoAsset.durationSec > 0
          ? spec.videoAsset.durationSec
          : expectedEnd;
    const estEnd = hasExplicitEnd
      ? Math.min(fullDurationEstimate, spec.endTimeSec!)
      : fullDurationEstimate;
    const estSegDur = Math.max(0.05, estEnd - startTime);
    const captureIntervalSec = Math.max(1 / 30, estSegDur / MAX_RECORDED_REVERSE_FRAMES);

    const recordScale = Math.min(
      1,
      MAX_REVERSE_FRAME_DIM / Math.max(this.canvas.width, this.canvas.height)
    );
    const recW = Math.max(1, Math.round(this.canvas.width * recordScale));
    const recH = Math.max(1, Math.round(this.canvas.height * recordScale));

    const pushStageSnapshot = () => {
      const fCanvas = document.createElement('canvas');
      fCanvas.width = recW;
      fCanvas.height = recH;
      const fCtx = fCanvas.getContext('2d');
      if (fCtx) {
        fCtx.drawImage(this.canvas, 0, 0, recW, recH);
        recordedFrames.push(fCanvas);
      }
    };

    // Capture Frame 0 from static fromSlide image
    const fromImgEntry = this.imageCache.get(fromSlide.imageAsset.id);
    if (fromImgEntry && fromImgEntry.img.complete && fromImgEntry.img.naturalWidth > 0) {
      this.clearStage();
      this.drawMediaElement(
        fromImgEntry.img,
        fromImgEntry.img.naturalWidth,
        fromImgEntry.img.naturalHeight
      );
      pushStageSnapshot();
    }

    let completed = false;
    const finish = async () => {
      if (completed || this.destroyed || epoch !== this.playbackEpoch) return;
      completed = true;

      if (this.activeVideo === video) {
        video.onended = null;
        video.onerror = null;
        video.pause();
        this.activeVideo = null;
      }

      if (toSlide) {
        let readyImgEntry = this.imageCache.get(toSlide.imageAsset.id);
        if (!readyImgEntry || !readyImgEntry.img.complete || readyImgEntry.img.naturalWidth === 0) {
          try {
            await this.ensureImageLoaded(toSlide.imageAsset.id, toSlide.imageAsset.objectUrl);
          } catch {
            // proceed
          }
          readyImgEntry = this.imageCache.get(toSlide.imageAsset.id);
        }

        if (this.destroyed || epoch !== this.playbackEpoch) return;

        if (readyImgEntry && readyImgEntry.img.complete && readyImgEntry.img.naturalWidth > 0) {
          this.clearStage();
          this.drawMediaElement(
            readyImgEntry.img,
            readyImgEntry.img.naturalWidth,
            readyImgEntry.img.naturalHeight
          );
          pushStageSnapshot();
        }
      }

      if (recordedFrames.length > 0) {
        const isWholeAsset = !hasExplicitEnd && typeof spec.startTimeSec === 'undefined';
        const aliasVideoId = isWholeAsset ? spec.videoAsset?.id : undefined;
        this.storeReverseFrames(spec.id, recordedFrames, aliasVideoId);
        if (aliasVideoId) {
          this.storeReverseFrames(aliasVideoId, recordedFrames, spec.id);
        }
      }

      this.completeTransitionImmediately(toIndex);
    };

    video.onended = () => {
      void finish();
    };
    video.onerror = () => {
      if (completed || this.destroyed || epoch !== this.playbackEpoch) return;
      completed = true;
      if (this.activeVideo === video) {
        video.onended = null;
        video.onerror = null;
        this.activeVideo = null;
      }
      this.runProceduralTransition(
        fromIndex,
        toIndex,
        spec.fallbackStyle || 'crossfade',
        spec.fallbackDurationMs ?? 650,
        false
      );
    };

    let lastVideoTime = video.currentTime;
    let lastAdvanceMs = performance.now();
    let stallCount = 0;
    let hasAdvancedPastStart = false;

    const renderTick = () => {
      if (completed || this.destroyed || epoch !== this.playbackEpoch || this.activeVideo !== video) {
        return;
      }

      const nowTime = video.currentTime;
      const finiteDuration = Number.isFinite(video.duration) && video.duration > 0;
      const fullDuration = finiteDuration
        ? video.duration
        : spec.videoAsset?.durationSec && spec.videoAsset.durationSec > 0
          ? spec.videoAsset.durationSec
          : expectedEnd;

      const endTime = hasExplicitEnd
        ? Math.min(fullDuration, Math.max(startTime, spec.endTimeSec!))
        : fullDuration;
      const segmentDuration = Math.max(0.05, endTime - startTime);
      const progress = Math.min(1, Math.max(0, (nowTime - startTime) / segmentDuration));

      const effectiveRate = Math.max(0.25, video.playbackRate || 1);
      // Pre-draw overshoot tolerance scales cleanly with playbackRate so fast-forward never paints next cue
      const endTolerance = hasExplicitEnd
        ? Math.min(0.03, Math.max(0.008, 0.01 * effectiveRate))
        : (finiteDuration ? 0.015 : 0);

      const reachedEnd =
        video.ended ||
        (hasExplicitEnd
          ? nowTime >= endTime - endTolerance
          : finiteDuration && nowTime >= endTime - 0.015);

      // 1. CHECK COMPLETION BEFORE DRAWING VIDEO FRAME (prevents overshot frame flicker!)
      if (reachedEnd) {
        video.pause();
        // Synchronously draw landing slide if already cached so stage never flashes past endTimeSec
        const cachedTo = toSlide ? this.imageCache.get(toSlide.imageAsset.id) : undefined;
        if (cachedTo && cachedTo.img.complete && cachedTo.img.naturalWidth > 0) {
          this.clearStage();
          this.drawMediaElement(
            cachedTo.img,
            cachedTo.img.naturalWidth,
            cachedTo.img.naturalHeight
          );
        }
        void finish();
        return;
      }

      // 2. ZERO-FLICKER GUARD: never paint while seeking or before play moves onto segment
      if (
        !video.seeking &&
        video.readyState >= 2 &&
        (nowTime > startTime + 0.001 || (nowTime >= startTime - 0.003 && hasAdvancedPastStart))
      ) {
        this.clearStage();
        this.drawMediaElement(video, video.videoWidth || 1920, video.videoHeight || 1080);

        if (
          recordedFrames.length < MAX_RECORDED_REVERSE_FRAMES + 1 &&
          nowTime - lastRecordedTime >= captureIntervalSec
        ) {
          lastRecordedTime = nowTime;
          pushStageSnapshot();
        }
      } else {
        this.drawSlideByIndex(fromIndex);
      }

      this.emitStatus({
        transitionProgress: progress,
        currentVideoTimeSec: nowTime,
        segmentRangeSec: { start: startTime, end: endTime },
      });

      // 3. Relative stall detection (safe for any startTimeSec, any short segment, and any refresh rate)
      if (nowTime > startTime + 0.015) {
        hasAdvancedPastStart = true;
      }

      if (Math.abs(nowTime - lastVideoTime) >= 0.001) {
        stallCount = 0;
        lastVideoTime = nowTime;
        lastAdvanceMs = performance.now();
      } else if (hasAdvancedPastStart || performance.now() - lastAdvanceMs > 300) {
        stallCount++;
        if (
          (video.paused && progress >= 0.98) ||
          (stallCount >= 6 && progress >= 0.98) ||
          performance.now() - lastAdvanceMs >= 1800
        ) {
          void finish();
          return;
        }
      }

      this.rafId = requestAnimationFrame(renderTick);
    };

    try {
      await video.play();
      if (this.destroyed || epoch !== this.playbackEpoch || this.activeVideo !== video) {
        video.pause();
        return;
      }
      this.rafId = requestAnimationFrame(renderTick);
    } catch {
      if (this.destroyed || epoch !== this.playbackEpoch) return;
      if (this.activeVideo === video) {
        video.onended = null;
        video.onerror = null;
        this.activeVideo = null;
      }
      this.runProceduralTransition(
        fromIndex,
        toIndex,
        spec.fallbackStyle || 'crossfade',
        spec.fallbackDurationMs ?? 650,
        false
      );
    }
  }

  private runProceduralTransition(
    fromIndex: number,
    toIndex: number,
    style: FallbackTransitionStyle,
    durationMs: number,
    isReverse = false,
    easing?: SegmentEasing
  ): void {
    if (this.destroyed) return;
    const epoch = this.playbackEpoch;
    this.isTransitionReverse = isReverse;
    if (style === 'cut' || durationMs <= 16) {
      this.enterHoldSlide(toIndex);
      return;
    }

    const fromSlide = this.slides[fromIndex];
    const toSlide = this.slides[toIndex];
    if (!fromSlide || !toSlide) {
      this.enterHoldSlide(toIndex);
      return;
    }

    const fromImg = this.imageCache.get(fromSlide.imageAsset.id)?.img;
    const toImg = this.imageCache.get(toSlide.imageAsset.id)?.img;
    if (!fromImg || !toImg || fromImg.naturalWidth === 0 || toImg.naturalWidth === 0) {
      this.enterHoldSlide(toIndex);
      return;
    }

    let speedMultiplier = Math.max(0.25, this.settings.globalPlaybackSpeed);
    this.activeProceduralTransition = {
      speedUp: () => {
        speedMultiplier = Math.min(8.0, speedMultiplier * 3.0);
      },
    };

    let lastTime = performance.now();
    let elapsedProgress = 0;
    const baseDuration = Math.max(80, durationMs);
    const activeEasing: SegmentEasing = easing ?? 'ease-in-out';

    this.emitStatus({
      phase: 'PLAYING_TRANSITION',
      currentSlideIndex: fromIndex,
      targetSlideIndex: toIndex,
      transitionProgress: 0,
      activeTransitionHasVideo: false,
      isFastForwarding: false,
      currentVideoTimeSec: null,
      segmentRangeSec: null,
    });

    const step = (now: number) => {
      if (this.destroyed || epoch !== this.playbackEpoch) return;
      const dt = now - lastTime;
      lastTime = now;
      elapsedProgress += (dt * speedMultiplier) / baseDuration;
      const rawProgress = Math.min(1, elapsedProgress);
      const t = this.evaluateEasing(rawProgress, activeEasing);

      this.clearStage();
      const w = this.canvas.width;
      const h = this.canvas.height;

      if (style === 'crossfade') {
        this.ctx.save();
        this.ctx.globalAlpha = 1;
        this.drawMediaElement(fromImg, fromImg.naturalWidth, fromImg.naturalHeight);
        this.ctx.globalAlpha = t;
        this.drawMediaElement(toImg, toImg.naturalWidth, toImg.naturalHeight);
        this.ctx.restore();
      } else if (style === 'zoom-morph') {
        const outScale = isReverse ? 1 - t * 0.12 : 1 + t * 0.14;
        const inScale = isReverse ? 1.14 - t * 0.14 : 0.88 + t * 0.12;

        this.ctx.save();
        this.ctx.translate(w / 2, h / 2);
        this.ctx.scale(outScale, outScale);
        this.ctx.translate(-w / 2, -h / 2);
        this.ctx.globalAlpha = 1 - t;
        this.drawMediaElement(fromImg, fromImg.naturalWidth, fromImg.naturalHeight);
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(w / 2, h / 2);
        this.ctx.scale(inScale, inScale);
        this.ctx.translate(-w / 2, -h / 2);
        this.ctx.globalAlpha = t;
        this.drawMediaElement(toImg, toImg.naturalWidth, toImg.naturalHeight);
        this.ctx.restore();
      } else if (style === 'slide-push') {
        const dir = isReverse ? 1 : -1;
        this.ctx.save();
        this.ctx.translate(dir * t * w, 0);
        this.drawMediaElement(fromImg, fromImg.naturalWidth, fromImg.naturalHeight);
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(-dir * (1 - t) * w, 0);
        this.drawMediaElement(toImg, toImg.naturalWidth, toImg.naturalHeight);
        this.ctx.restore();
      } else if (style === 'wipe-reveal') {
        this.ctx.save();
        this.ctx.globalAlpha = 1;
        this.drawMediaElement(fromImg, fromImg.naturalWidth, fromImg.naturalHeight);
        this.ctx.restore();

        const clipW = Math.max(0, w * t);
        const clipX = isReverse ? w - clipW : 0;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(clipX, 0, clipW, h);
        this.ctx.clip();
        this.ctx.globalAlpha = 1;
        this.drawMediaElement(toImg, toImg.naturalWidth, toImg.naturalHeight);
        this.ctx.restore();

        if (t > 0.02 && t < 0.98) {
          const edgeX = isReverse ? clipX : clipW;
          this.ctx.save();
          this.ctx.fillStyle = 'rgba(79, 140, 255, 0.65)';
          this.ctx.fillRect(Math.max(0, edgeX - 2), 0, 4, h);
          this.ctx.restore();
        }
      } else if (style === 'iris-spotlight') {
        this.ctx.save();
        this.ctx.globalAlpha = Math.max(0, 1 - t * 0.25);
        this.drawMediaElement(fromImg, fromImg.naturalWidth, fromImg.naturalHeight);
        this.ctx.restore();

        const maxRadius = Math.hypot(w, h) * 0.55;
        const radius = Math.max(1, maxRadius * t);

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
        this.ctx.clip();
        this.ctx.globalAlpha = 1;
        this.drawMediaElement(toImg, toImg.naturalWidth, toImg.naturalHeight);
        this.ctx.restore();
      }

      this.emitStatus({ transitionProgress: rawProgress });

      if (rawProgress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.activeProceduralTransition = null;
        this.completeTransitionImmediately(toIndex);
      }
    };

    this.rafId = requestAnimationFrame(step);
  }

  private completeTransitionImmediately(targetIndex: number): void {
    this.stopCurrentAnimation();
    this.enterHoldSlide(targetIndex);
  }

  private stopIdleLoop(): void {
    if (this.idleLoopRafId !== null) {
      cancelAnimationFrame(this.idleLoopRafId);
      this.idleLoopRafId = null;
    }
    if (this.activeIdleLoopVideo) {
      this.activeIdleLoopVideo.pause();
      this.activeIdleLoopVideo = null;
    }
  }

  private startIdleLoopForSlide(slideIndex: number, loopAsset: MediaAsset): void {
    const loopEpoch = this.playbackEpoch;
    const cacheKey = `${loopAsset.id}__idle`;

    this.ensureVideoWarmed(cacheKey, loopAsset.objectUrl)
      .then((video) => {
        if (
          this.destroyed ||
          this.playbackEpoch !== loopEpoch ||
          this.status.phase !== 'HOLDING_SLIDE' ||
          this.status.currentSlideIndex !== slideIndex
        ) {
          return;
        }

        this.activeIdleLoopVideo = video;
        video.muted = true;
        video.loop = true;
        video.playbackRate = Math.max(0.25, Math.min(4.0, this.settings.globalPlaybackSpeed || 1));

        try {
          video.currentTime = 0;
        } catch {
          // ignore initial seek error
        }

        const playPromise = typeof video.play === 'function' ? video.play() : undefined;
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }

        if (typeof requestAnimationFrame !== 'function') return;

        const tick = () => {
          if (
            this.destroyed ||
            this.playbackEpoch !== loopEpoch ||
            this.status.phase !== 'HOLDING_SLIDE' ||
            this.status.currentSlideIndex !== slideIndex ||
            this.activeIdleLoopVideo !== video
          ) {
            this.idleLoopRafId = null;
            return;
          }

          // Early wrap before Chromium's native <video loop> end-of-stream pause hitch
          const dur = Number.isFinite(video.duration) ? video.duration : 0;
          if (dur > 0.15 && video.currentTime >= dur - 0.035) {
            try {
              video.currentTime = 0;
            } catch {
              // ignore seek wrap error
            }
          }

          if (video.readyState >= 2) {
            this.clearStage();
            this.drawMediaElement(
              video,
              video.videoWidth || loopAsset.width || 1920,
              video.videoHeight || loopAsset.height || 1080
            );
          }

          this.idleLoopRafId = requestAnimationFrame(tick);
        };

        this.idleLoopRafId = requestAnimationFrame(tick);
      })
      .catch(() => {});
  }

  private stopCurrentAnimation(): void {
    this.playbackEpoch++;
    this.stopIdleLoop();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.holdTimerId !== null) {
      clearTimeout(this.holdTimerId);
      this.holdTimerId = null;
    }
    if (this.activeVideo) {
      this.activeVideo.onended = null;
      this.activeVideo.onerror = null;
      this.activeVideo.pause();
      this.activeVideo = null;
    }
    this.activeProceduralTransition = null;
  }

  private drawSlideByIndex(index: number): void {
    this.clearStage();
    const slide = this.slides[index];
    if (!slide) return;
    const entry = this.imageCache.get(slide.imageAsset.id);
    if (entry && entry.url === slide.imageAsset.objectUrl && entry.img.complete && entry.img.naturalWidth > 0) {
      this.drawMediaElement(
        entry.img,
        entry.img.naturalWidth || slide.imageAsset.width,
        entry.img.naturalHeight || slide.imageAsset.height
      );
    } else {
      this.ensureImageLoaded(slide.imageAsset.id, slide.imageAsset.objectUrl).then((loaded) => {
        if (
          !this.destroyed &&
          loaded.naturalWidth > 0 &&
          this.status.currentSlideIndex === index &&
          this.status.phase === 'HOLDING_SLIDE'
        ) {
          this.clearStage();
          this.drawMediaElement(
            loaded,
            loaded.naturalWidth || slide.imageAsset.width,
            loaded.naturalHeight || slide.imageAsset.height
          );
        }
      }).catch(() => {});
    }
  }

  private clearStage(): void {
    this.ctx.fillStyle = this.settings.stageBackground || '#05070B';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawMediaElement(
    element: HTMLImageElement | HTMLVideoElement | ImageBitmap | HTMLCanvasElement,
    sourceWidth: number,
    sourceHeight: number
  ): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const sw = sourceWidth || cw;
    const sh = sourceHeight || ch;

    const scale =
      this.settings.fitMode === 'cover'
        ? Math.max(cw / sw, ch / sh)
        : Math.min(cw / sw, ch / sh);

    const drawW = sw * scale;
    const drawH = sh * scale;
    const offsetX = (cw - drawW) / 2;
    const offsetY = (ch - drawH) / 2;

    this.ctx.drawImage(element as CanvasImageSource, offsetX, offsetY, drawW, drawH);
  }

  /**
   * TRUE REVERSE VIDEO TRANSITION:
   * Plays buffered canvas/video frames in true reverse from last frame down to frame 0
   * matching the original transition/segment duration.
   */
  private runReverseVideoTransition(
    fromIndex: number,
    toIndex: number,
    spec: TransitionSpec,
    frames: (ImageBitmap | HTMLCanvasElement)[]
  ): void {
    this.stopCurrentAnimation();
    const epoch = this.playbackEpoch;
    this.isTransitionReverse = true;

    const fromSlide = this.slides[fromIndex];
    const toSlide = this.slides[toIndex];
    if (!fromSlide || !toSlide || frames.length === 0) {
      this.enterHoldSlide(toIndex);
      return;
    }

    const startSec = typeof spec.startTimeSec === 'number' ? spec.startTimeSec : 0;
    const endSec =
      typeof spec.endTimeSec === 'number'
        ? spec.endTimeSec
        : (spec.videoAsset?.durationSec && spec.videoAsset.durationSec > 0
            ? spec.videoAsset.durationSec
            : frames.length / 30);

    const durationSec =
      typeof spec.startTimeSec === 'number' || typeof spec.endTimeSec === 'number'
        ? Math.max(0.1, endSec - startSec)
        : (spec.videoAsset?.durationSec && spec.videoAsset.durationSec > 0
            ? spec.videoAsset.durationSec
            : frames.length / 30);
    const baseDurationMs = Math.max(80, durationSec * 1000);

    let speedMultiplier = Math.max(
      0.25,
      Math.min(4.0, this.settings.globalPlaybackSpeed * (spec.playbackSpeed || 1.0))
    );

    this.activeProceduralTransition = {
      speedUp: () => {
        speedMultiplier = Math.min(8.0, speedMultiplier * 3.0);
      },
    };

    // Preload destination image concurrently while reversing
    void this.ensureImageLoaded(toSlide.imageAsset.id, toSlide.imageAsset.objectUrl).catch(() => {});

    let lastTime = performance.now();
    let elapsedProgress = 0;

    this.emitStatus({
      phase: 'PLAYING_TRANSITION',
      currentSlideIndex: fromIndex,
      targetSlideIndex: toIndex,
      transitionProgress: 0,
      activeTransitionHasVideo: true,
      isFastForwarding: false,
      currentVideoTimeSec: endSec,
      segmentRangeSec: { start: startSec, end: endSec },
    });

    let completed = false;
    const finish = async () => {
      if (completed || this.destroyed || epoch !== this.playbackEpoch) return;
      completed = true;
      this.activeProceduralTransition = null;

      const cachedImg = this.imageCache.get(toSlide.imageAsset.id)?.img;
      if (!cachedImg || !cachedImg.complete || cachedImg.naturalWidth === 0) {
        try {
          await this.ensureImageLoaded(toSlide.imageAsset.id, toSlide.imageAsset.objectUrl);
        } catch {
          // Proceed
        }
      }

      if (this.destroyed || epoch !== this.playbackEpoch) return;
      this.completeTransitionImmediately(toIndex);
    };

    const step = (now: number) => {
      if (completed || this.destroyed || epoch !== this.playbackEpoch) return;
      const dt = now - lastTime;
      lastTime = now;
      elapsedProgress += (dt * speedMultiplier) / baseDurationMs;
      const progress = Math.min(1, Math.max(0, elapsedProgress));

      const frameIdx = Math.max(
        0,
        Math.min(
          frames.length - 1,
          Math.round((1 - progress) * (frames.length - 1))
        )
      );

      const frame = frames[frameIdx];
      if (frame) {
        const frameW = frame.width;
        const frameH = frame.height;
        if (frameW > 0 && frameH > 0) {
          this.clearStage();
          this.drawMediaElement(frame, frameW, frameH);
        }
      }

      const revTime = endSec - progress * (endSec - startSec);
      this.emitStatus({
        transitionProgress: progress,
        currentVideoTimeSec: revTime,
      });

      if (progress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        void finish();
      }
    };

    this.rafId = requestAnimationFrame(step);
  }

  getReverseFrames(key: string): (ImageBitmap | HTMLCanvasElement)[] | undefined {
    const globalFrames = StagePlaybackEngine.getReverseFrames(key);
    if (globalFrames) {
      this.reverseFrameCache.set(key, globalFrames);
      return globalFrames;
    }
    const localFrames = this.reverseFrameCache.get(key);
    if (localFrames) {
      this.reverseFrameCache.delete(key);
      this.reverseFrameCache.set(key, localFrames);
      return localFrames;
    }
    return undefined;
  }

  hasReverseFrames(specId: string): boolean {
    const frames = this.getReverseFrames(specId);
    return Boolean(frames && frames.length > 0);
  }

  private storeReverseFrames(
    cacheKey: string,
    frames: (ImageBitmap | HTMLCanvasElement)[],
    aliasKey?: string
  ): void {
    this.reverseFrameCache.delete(cacheKey);
    this.reverseFrameCache.set(cacheKey, frames);
    const validKeys = this.collectValidReverseKeys();
    const pinnedKeys = new Set<string>([cacheKey]);
    if (aliasKey) pinnedKeys.add(aliasKey);
    StagePlaybackEngine.cacheReverseFrames(cacheKey, frames, validKeys, pinnedKeys);

    for (const localKey of Array.from(this.reverseFrameCache.keys())) {
      if (!StagePlaybackEngine.globalReverseFrameCache.has(localKey)) {
        this.reverseFrameCache.delete(localKey);
      }
    }
  }

  private collectValidReverseKeys(): Set<string> {
    const validKeys = new Set<string>();
    for (const s of this.slides) {
      validKeys.add(s.transitionToNext.id);
      if (
        s.transitionToNext.videoAsset &&
        typeof s.transitionToNext.startTimeSec === 'undefined' &&
        typeof s.transitionToNext.endTimeSec === 'undefined'
      ) {
        validKeys.add(s.transitionToNext.videoAsset.id);
      }
    }
    return validKeys;
  }

  private cleanUnusedReverseFrameCache(): void {
    if (this.slides.length === 0) {
      this.reverseFrameCache.clear();
      return;
    }
    const validKeys = this.collectValidReverseKeys();

    for (const key of Array.from(this.reverseFrameCache.keys())) {
      if (!validKeys.has(key)) {
        this.reverseFrameCache.delete(key);
      }
    }

    const keysToInvalidate: string[] = [];
    for (const key of StagePlaybackEngine.globalReverseFrameCache.keys()) {
      if (!validKeys.has(key)) {
        keysToInvalidate.push(key);
      }
    }
    if (keysToInvalidate.length > 0) {
      StagePlaybackEngine.invalidateReverseFrames(keysToInvalidate);
    }
  }

  clearReverseFrameCache(): void {
    this.reverseFrameCache.clear();
  }

  private prewarmReverseFrames(
    specId: string,
    videoAsset: { id: string; objectUrl: string; durationSec?: number },
    startTimeSec?: number,
    endTimeSec?: number,
    fromIdx?: number,
    toIdx?: number
  ): Promise<void> {
    const isSegment =
      typeof startTimeSec === 'number' || typeof endTimeSec === 'number';
    if (this.hasReverseFrames(specId) || (!isSegment && this.hasReverseFrames(videoAsset.id))) {
      return Promise.resolve();
    }
    if (typeof document === 'undefined' || !videoAsset.objectUrl) {
      return Promise.resolve();
    }

    const existingPromise = this.prewarmInFlight.get(specId);
    if (existingPromise) return existingPromise;

    const task = (async () => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      if (/^(https?|mpres):\/\//i.test(videoAsset.objectUrl)) {
        video.crossOrigin = 'anonymous';
      }

      try {
        video.src = videoAsset.objectUrl;

        await new Promise<void>((resolve, reject) => {
          if (video.readyState >= 2) {
            resolve();
            return;
          }
          const timer = window.setTimeout(() => resolve(), 2500);
          video.onloadeddata = () => {
            window.clearTimeout(timer);
            resolve();
          };
          video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error('Prewarm load error'));
          };
        });

        if (this.destroyed || !this.collectValidReverseKeys().has(specId)) return;

        const actualDuration =
          Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : (videoAsset.durationSec && videoAsset.durationSec > 0 ? videoAsset.durationSec : 1);

        const start =
          typeof startTimeSec === 'number' && Number.isFinite(startTimeSec) && startTimeSec >= 0
            ? Math.min(startTimeSec, actualDuration)
            : 0;
        const end =
          typeof endTimeSec === 'number' && Number.isFinite(endTimeSec) && endTimeSec > start
            ? Math.min(endTimeSec, actualDuration)
            : actualDuration;
        const dur = Math.max(0.05, end - start);

        if (this.hasReverseFrames(specId)) return;

        const sampleCount = Math.min(36, Math.max(10, Math.round(dur * 24)));
        const frames: HTMLCanvasElement[] = [];

        const rawW = video.videoWidth || 1280;
        const rawH = video.videoHeight || 720;
        const scale = Math.min(1, MAX_PREWARM_FRAME_DIM / Math.max(rawW, rawH));
        const w = Math.max(1, Math.round(rawW * scale));
        const h = Math.max(1, Math.round(rawH * scale));

        const seekSample = (timeSec: number) =>
          new Promise<void>((resolve) => {
            const clamped = Math.max(0, Math.min(timeSec, Math.max(0, actualDuration - 0.002)));
            if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - clamped) <= 0.01) {
              resolve();
              return;
            }
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
              window.clearTimeout(seekTimer);
              video.removeEventListener('seeked', done);
              resolve();
            };
            const seekTimer = window.setTimeout(done, 450);
            video.addEventListener('seeked', done, { once: true });
            try {
              video.currentTime = clamped;
            } catch {
              done();
            }
          });

        for (let i = 0; i < sampleCount; i++) {
          if (this.destroyed || !this.collectValidReverseKeys().has(specId)) {
            StagePlaybackEngine.disposeFrameArray(frames);
            return;
          }
          // Fixed segment interpolation math: start + ratio * dur (was dur - start!)
          const targetTime = start + (i / (sampleCount - 1)) * dur;
          await seekSample(targetTime);

          if (video.readyState >= 2) {
            const offscreen = document.createElement('canvas');
            offscreen.width = w;
            offscreen.height = h;
            const offCtx = offscreen.getContext('2d');
            if (offCtx) {
              offCtx.drawImage(video, 0, 0, w, h);
              frames.push(offscreen);
            }
          }
        }

        // Snap endpoints to cached slide images if available for seamless reverse landing
        if (frames.length > 0 && typeof fromIdx === 'number' && this.slides[fromIdx]) {
          const fromImg = this.imageCache.get(this.slides[fromIdx].imageAsset.id)?.img;
          if (fromImg && fromImg.complete && fromImg.naturalWidth > 0) {
            const f0Ctx = frames[0].getContext('2d');
            if (f0Ctx) {
              f0Ctx.drawImage(fromImg, 0, 0, w, h);
            }
          }
        }
        if (frames.length > 1 && typeof toIdx === 'number' && toIdx !== -1 && this.slides[toIdx]) {
          const toImg = this.imageCache.get(this.slides[toIdx].imageAsset.id)?.img;
          if (toImg && toImg.complete && toImg.naturalWidth > 0) {
            const fLastCtx = frames[frames.length - 1].getContext('2d');
            if (fLastCtx) {
              fLastCtx.drawImage(toImg, 0, 0, w, h);
            }
          }
        }

        if (
          frames.length > 0 &&
          !this.destroyed &&
          this.collectValidReverseKeys().has(specId) &&
          !this.hasReverseFrames(specId)
        ) {
          const aliasVideoId = !isSegment ? videoAsset.id : undefined;
          this.storeReverseFrames(specId, frames, aliasVideoId);
          if (aliasVideoId) {
            this.storeReverseFrames(aliasVideoId, frames, specId);
          }
        } else {
          StagePlaybackEngine.disposeFrameArray(frames);
        }
      } catch {
        // Ignored: runtime capture will populate cache on first forward play
      } finally {
        video.onloadeddata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        this.prewarmInFlight.delete(specId);
      }
    })();

    this.prewarmInFlight.set(specId, task);
    return task;
  }

  getWarmedVideoCount(): number {
    return this.videoCache.size;
  }

  getCachedImageCount(): number {
    return this.imageCache.size;
  }

  private releaseVideoElement(video: HTMLVideoElement): void {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // Ignore cleanup errors on mocked or detached video elements
    }
  }

  private evictImageCacheIfNeeded(pinnedId?: string): void {
    while (this.imageCache.size > StagePlaybackEngine.maxCachedImages) {
      let victimId: string | null = null;
      let victimImg: HTMLImageElement | null = null;
      for (const [imgId, entry] of this.imageCache.entries()) {
        if (imgId === pinnedId) continue;
        victimId = imgId;
        victimImg = entry.img;
        break;
      }
      if (!victimId) break;
      this.imageCache.delete(victimId);
      if (victimImg) {
        try {
          victimImg.src = '';
        } catch {
          // Ignore mocked image elements
        }
      }
    }
  }

  private evictVideoCacheIfNeeded(pinnedId?: string): void {
    while (this.videoCache.size > StagePlaybackEngine.maxWarmedVideos) {
      let victimId: string | null = null;
      let victimVideo: HTMLVideoElement | null = null;
      for (const [vidId, entry] of this.videoCache.entries()) {
        if (
          vidId === pinnedId ||
          entry.video === this.activeVideo ||
          entry.video === this.activeIdleLoopVideo
        ) {
          continue;
        }
        victimId = vidId;
        victimVideo = entry.video;
        break;
      }
      if (!victimId) break;
      this.videoCache.delete(victimId);
      if (victimVideo) {
        this.releaseVideoElement(victimVideo);
      }
    }
  }

  private ensureImageLoaded(assetId: string, objectUrl: string): Promise<HTMLImageElement> {
    const existing = this.imageCache.get(assetId);
    if (existing && existing.url === objectUrl && existing.img.complete && existing.img.naturalWidth > 0) {
      // Refresh LRU recency
      this.imageCache.delete(assetId);
      this.imageCache.set(assetId, existing);
      return Promise.resolve(existing.img);
    }

    const inflightKey = `${assetId}::${objectUrl}`;
    const inflight = this.inflightImages.get(inflightKey);
    if (inflight) return inflight;

    const promise = new Promise<HTMLImageElement>((resolve) => {
      if (!objectUrl) {
        this.inflightImages.delete(inflightKey);
        resolve(new Image());
        return;
      }

      const img = new Image();
      if (/^(https?|mpres):\/\//i.test(objectUrl)) {
        img.crossOrigin = 'anonymous';
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.inflightImages.delete(inflightKey);
        if (img.complete && img.naturalWidth > 0) {
          this.imageCache.delete(assetId);
          this.imageCache.set(assetId, { url: objectUrl, img });
          this.evictImageCacheIfNeeded(assetId);
        }
        resolve(img);
      };

      const timer = window.setTimeout(done, 4000);
      img.onload = done;
      img.onerror = done;
      img.src = objectUrl;
    });

    this.inflightImages.set(inflightKey, promise);
    return promise;
  }

  private ensureVideoWarmed(assetId: string, objectUrl: string): Promise<HTMLVideoElement> {
    const existing = this.videoCache.get(assetId);
    if (
      existing &&
      existing.url === objectUrl &&
      existing.video.readyState >= 2 &&
      !existing.video.error
    ) {
      // Refresh LRU recency
      this.videoCache.delete(assetId);
      this.videoCache.set(assetId, existing);
      return Promise.resolve(existing.video);
    }

    const inflightKey = `${assetId}::${objectUrl}`;
    const inflight = this.inflightVideos.get(inflightKey);
    if (inflight) return inflight;

    const promise = new Promise<HTMLVideoElement>((resolve) => {
      if (existing && existing.url !== objectUrl) {
        this.releaseVideoElement(existing.video);
        this.videoCache.delete(assetId);
      }

      const video =
        existing && existing.url === objectUrl && !existing.video.error
          ? existing.video
          : document.createElement('video');

      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('canplay', finish);
        video.removeEventListener('error', finish);
        this.inflightVideos.delete(inflightKey);
        if (video.readyState >= 2 && !video.error) {
          this.videoCache.delete(assetId);
          this.videoCache.set(assetId, { url: objectUrl, video });
          this.evictVideoCacheIfNeeded(assetId);
        }
        resolve(video);
      };

      const timer = window.setTimeout(finish, 3000);
      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('canplay', finish, { once: true });
      video.addEventListener('error', finish, { once: true });

      if (!objectUrl) {
        finish();
        return;
      }

      if (video.src !== objectUrl) {
        if (/^(https?|mpres):\/\//i.test(objectUrl)) {
          video.crossOrigin = 'anonymous';
        }
        video.src = objectUrl;
        video.load();
      } else if (video.readyState >= 2) {
        finish();
      } else {
        // Retry cleanly if previous attempt timed out at readyState < 2
        video.load();
      }
    });

    this.inflightVideos.set(inflightKey, promise);
    return promise;
  }

  private easeInOutCubic(x: number): number {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  private evaluateEasing(x: number, easing: SegmentEasing): number {
    const t = Math.max(0, Math.min(1, x));
    switch (easing) {
      case 'linear':
        return t;
      case 'ease-in':
        return t * t * t;
      case 'ease-out':
        return 1 - Math.pow(1 - t, 3);
      case 'hold':
        return t >= 1 ? 1 : 0;
      case 'step':
        return t >= 0.5 ? 1 : 0;
      case 'ease-in-out':
      default:
        return this.easeInOutCubic(t);
    }
  }
}
