import { generateId } from '../domain/defaults';
import { MediaAsset } from '../domain/types';
import { MediaValidator } from './MediaValidator';
import { t } from '../i18n';

export interface FrameExtractionProgress {
  done: number;
  total: number;
  currentTimeSec: number;
}

export interface BatchFrameExtractOptions {
  labels?: string[];
  onProgress?: (done: number, total: number, timeSec: number) => void;
  signal?: AbortSignal;
}

export interface FilmstripFrame {
  timeSec: number;
  dataUrl: string;
}

export interface FilmstripOptions {
  maxWidth?: number;
  onThumbnail?: (frame: FilmstripFrame, index: number, total: number) => void;
  signal?: AbortSignal;
}

export interface VideoFrameExtractorSession {
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  seekAndCaptureThumb(timeSec: number, maxDimension?: number, signal?: AbortSignal): Promise<string>;
  extractFrameAsSlideAsset(timeSec: number, customLabel?: string, signal?: AbortSignal): Promise<MediaAsset>;
  drawFrameAt(timeSec: number, targetCanvas: HTMLCanvasElement, signal?: AbortSignal): Promise<number>;
  dispose(): void;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Extracts pixel-exact PNG frames and JPEG preview thumbnails from a Transition/Reel Video
 * using a reusable video decoder session, frame-readiness synchronization, and cancellation support.
 */
export class FrameExtractor {
  /**
   * Opens a reusable video decoder session so multiple scrubs, filmstrip thumbnails,
   * or cue-point slide extractions share one decoded <video> element and reusable canvases.
   */
  static async createSession(
    videoAsset: MediaAsset,
    signal?: AbortSignal
  ): Promise<VideoFrameExtractorSession> {
    MediaValidator.throwIfAborted(signal, t('core.extractFramesCancelled'));

    if (!videoAsset?.objectUrl) {
      throw new Error(
        t('core.videoUrlMissing', { name: videoAsset?.name || t('core.unknown') })
      );
    }

    const video = document.createElement('video') as VideoWithRvfc;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    if (/^(https?|mpres):\/\//i.test(videoAsset.objectUrl)) {
      video.crossOrigin = 'anonymous';
    }

    try {
      await MediaValidator.waitForVideoLoadedData(video, videoAsset.objectUrl, videoAsset.name, {
        timeoutMs: 10000,
        errorMessage: t('core.videoReadExtractFailed', { name: videoAsset.name }),
        signal,
      });

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        throw new Error(
          t('core.videoNoVisualTrackExtract', { name: videoAsset.name })
        );
      }

      const durationSec = await MediaValidator.resolveFiniteVideoDuration(video, {
        fallbackDurationSec: videoAsset.durationSec,
        timeoutMs: 2500,
        signal,
      });
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new Error(t('core.videoNoDurationExtract', { name: videoAsset.name }));
      }

      if (video.currentTime > 1e10 || !Number.isFinite(video.currentTime)) {
        await MediaValidator.seekVideoToTimestamp(video, 0, {
          timeoutMs: 2500,
          rejectOnTimeout: false,
          signal,
        });
      }

      return new ReusableVideoExtractorSession(video, videoAsset, width, height, durationSec);
    } catch (err) {
      MediaValidator.cleanupVideoElement(video);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Extracts a full-resolution PNG MediaAsset at the exact timestamp `timeSec`
   * (clamped to `[0, duration - 0.001]`, or end-of-video when `timeSec < 0` or non-finite).
   */
  static async extractFrameAtTimeAsSlideAsset(
    videoAsset: MediaAsset,
    timeSec: number,
    customLabel?: string,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    const session = await this.createSession(videoAsset, signal);
    try {
      return await session.extractFrameAsSlideAsset(timeSec, customLabel, signal);
    } finally {
      session.dispose();
    }
  }

  /**
   * Extracts a full-resolution static Slide Image (PNG MediaAsset) from either
   * the first frame or the final frame of a Transition Video.
   */
  static async extractFrameAsSlideAsset(
    videoAsset: MediaAsset,
    position: 'first' | 'last',
    customLabel?: string,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    const baseName = videoAsset.name.replace(/\.[^/.]+$/, '');
    const suffix = position === 'first' ? t('slide.filePrefixStart') : t('slide.filePrefixEnd');
    const fileName = customLabel || `${baseName}_${suffix}.png`;
    const timeSec = position === 'first' ? 0 : -1;
    return this.extractFrameAtTimeAsSlideAsset(videoAsset, timeSec, fileName, signal);
  }

  /**
   * Extracts multiple full-resolution PNG MediaAssets in one decoder session.
   * Requests are sorted in ascending timestamp order for fast forward GOP seeking,
   * while returning assets in the caller's original timestamp order.
   */
  static async extractFramesAtTimes(
    videoAsset: MediaAsset,
    timesSec: number[],
    options: BatchFrameExtractOptions = {}
  ): Promise<MediaAsset[]> {
    MediaValidator.throwIfAborted(options.signal, t('core.extractFramesCancelled'));
    if (!timesSec.length) return [];

    const session = await this.createSession(videoAsset, options.signal);
    const createdAssets: MediaAsset[] = [];

    try {
      const indexed = timesSec.map((timeSec, originalIndex) => ({
        originalIndex,
        timeSec,
        sortKey: Number.isFinite(timeSec) && timeSec >= 0 ? timeSec : Infinity,
        label: options.labels?.[originalIndex],
      }));

      indexed.sort((a, b) => a.sortKey - b.sortKey);

      const results = new Array<MediaAsset>(timesSec.length);
      let done = 0;
      const total = indexed.length;

      for (const item of indexed) {
        MediaValidator.throwIfAborted(options.signal, t('core.extractFramesCancelled'));
        const asset = await session.extractFrameAsSlideAsset(
          item.timeSec,
          item.label,
          options.signal
        );
        createdAssets.push(asset);
        results[item.originalIndex] = asset;
        done++;
        options.onProgress?.(done, total, asset.sourceTimeSec ?? Math.max(0, item.timeSec));
      }

      return results;
    } catch (err) {
      for (const asset of createdAssets) {
        MediaValidator.revokeAssetUrls(asset);
      }
      throw err;
    } finally {
      session.dispose();
    }
  }

  /**
   * Generates a filmstrip of `count` JPEG thumbnail data URLs across the video timeline
   * using one reusable decoder session.
   */
  static async extractFilmstripThumbnails(
    videoAsset: MediaAsset,
    count: number,
    options: FilmstripOptions = {}
  ): Promise<FilmstripFrame[]> {
    MediaValidator.throwIfAborted(options.signal, t('core.filmstripCancelled'));

    const safeCount = Math.max(1, Math.min(60, Math.round(count || 12)));
    const maxWidth = Math.max(48, options.maxWidth ?? 160);
    const session = await this.createSession(videoAsset, options.signal);

    try {
      const maxTime = Math.max(0, session.durationSec - 0.01);
      const frames: FilmstripFrame[] = [];

      for (let i = 0; i < safeCount; i++) {
        MediaValidator.throwIfAborted(options.signal, t('core.filmstripCancelled'));
        const rawTime = safeCount === 1 ? 0 : (i / (safeCount - 1)) * maxTime;
        const timeSec = Number(rawTime.toFixed(3));
        const dataUrl = await session.seekAndCaptureThumb(timeSec, maxWidth, options.signal);
        const frame: FilmstripFrame = { timeSec, dataUrl };
        frames.push(frame);
        options.onThumbnail?.(frame, i, safeCount);
      }

      return frames;
    } finally {
      session.dispose();
    }
  }
}

class ReusableVideoExtractorSession implements VideoFrameExtractorSession {
  private fullCanvas: HTMLCanvasElement | null = null;
  private thumbCanvas: HTMLCanvasElement | null = null;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private video: VideoWithRvfc,
    private videoAsset: MediaAsset,
    public readonly width: number,
    public readonly height: number,
    public readonly durationSec: number
  ) {}

  seekAndCaptureThumb(
    timeSec: number,
    maxDimension = 320,
    signal?: AbortSignal
  ): Promise<string> {
    return this.enqueue(async () => {
      MediaValidator.throwIfAborted(signal);
      await this.seekToValidatedFrame(timeSec, signal);
      return this.renderThumbDataUrl(this.video, maxDimension);
    }, signal);
  }

  extractFrameAsSlideAsset(
    timeSec: number,
    customLabel?: string,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    return this.enqueue(async () => {
      MediaValidator.throwIfAborted(signal);
      const actualTime = await this.seekToValidatedFrame(timeSec, signal);
      const canvas = this.ensureFullCanvas();
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error(t('core.extractCtxFailed'));
      }

      if (this.video.videoWidth === 0 || this.video.videoHeight === 0 || this.video.readyState < 2) {
        throw new Error(t('core.frameNotReady', { time: actualTime.toFixed(2) }));
      }

      ctx.clearRect(0, 0, this.width, this.height);
      ctx.drawImage(this.video, 0, 0, this.width, this.height);

      const thumbnailUrl = this.renderThumbDataUrl(canvas, 320);
      const blob = await canvasToPngBlob(canvas);
      MediaValidator.throwIfAborted(signal);

      const baseName = this.videoAsset.name.replace(/\.[^/.]+$/, '');
      const fileName = customLabel || `${baseName}_${actualTime.toFixed(2)}s.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      const objectUrl = URL.createObjectURL(file);

      return {
        id: generateId('img'),
        name: fileName,
        kind: 'image',
        mimeType: 'image/png',
        extension: 'png',
        objectUrl,
        fileSize: file.size,
        width: this.width,
        height: this.height,
        durationSec: 0,
        thumbnailUrl,
        rawFile: file,
        hasAudio: false,
        suggestedAspectRatio: MediaValidator.inferAspectRatio(this.width, this.height),
        sourceVideoId: this.videoAsset.id,
        sourceTimeSec: Number(actualTime.toFixed(3)),
      };
    }, signal);
  }

  drawFrameAt(
    timeSec: number,
    targetCanvas: HTMLCanvasElement,
    signal?: AbortSignal
  ): Promise<number> {
    return this.enqueue(async () => {
      MediaValidator.throwIfAborted(signal);
      const actualTime = await this.seekToValidatedFrame(timeSec, signal);
      const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error(t('core.analyzeCtxFailed'));
      }
      ctx.drawImage(this.video, 0, 0, targetCanvas.width, targetCanvas.height);
      return actualTime;
    }, signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    MediaValidator.cleanupVideoElement(this.video);
    if (this.fullCanvas) {
      this.fullCanvas.width = 0;
      this.fullCanvas.height = 0;
      this.fullCanvas = null;
    }
    if (this.thumbCanvas) {
      this.thumbCanvas.width = 0;
      this.thumbCanvas.height = 0;
      this.thumbCanvas = null;
    }
  }

  private enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error(t('core.decoderClosedAlready')));
    }
    if (signal?.aborted) {
      return Promise.reject(MediaValidator.createAbortError(t('core.extractFramesCancelled')));
    }

    const run = this.queue.then(async () => {
      if (this.disposed) {
        throw new Error(t('core.decoderClosed'));
      }
      MediaValidator.throwIfAborted(signal, t('core.extractFramesCancelled'));
      return task();
    });

    this.queue = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }

  private async seekToValidatedFrame(
    requestedTimeSec: number,
    signal?: AbortSignal
  ): Promise<number> {
    const maxClamped = this.durationSec > 0.002 ? Math.max(0, this.durationSec - 0.001) : 0;
    const requested =
      Number.isFinite(requestedTimeSec) && requestedTimeSec >= 0
        ? requestedTimeSec
        : maxClamped;
    const targetTime = Math.min(requested, maxClamped);
    const needSeek =
      this.video.seeking ||
      this.video.readyState < 2 ||
      Math.abs(this.video.currentTime - targetTime) > 0.0015;

    try {
      await MediaValidator.seekVideoToTimestamp(this.video, targetTime, {
        timeoutMs: 4000,
        rejectOnTimeout: true,
        signal,
      });
      await waitForCompositorFrame(this.video, signal, needSeek);
    } catch (err) {
      if (MediaValidator.isAbortError(err)) throw err;
      // Retry slightly earlier when an end-of-file timestamp lands past the final video PTS
      if (targetTime >= this.durationSec - 0.05 && this.durationSec > 0.08) {
        const retryTime = Math.max(0, this.durationSec - 0.05);
        await MediaValidator.seekVideoToTimestamp(this.video, retryTime, {
          timeoutMs: 4000,
          rejectOnTimeout: true,
          signal,
        });
        await waitForCompositorFrame(this.video, signal, true);
        return retryTime;
      }
      throw err;
    }

    if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      throw new Error(
        t('core.decodeFrameFailed', { time: targetTime.toFixed(2), name: this.videoAsset.name })
      );
    }

    return targetTime;
  }

  private ensureFullCanvas(): HTMLCanvasElement {
    if (!this.fullCanvas) {
      this.fullCanvas = document.createElement('canvas');
    }
    if (this.fullCanvas.width !== this.width || this.fullCanvas.height !== this.height) {
      this.fullCanvas.width = this.width;
      this.fullCanvas.height = this.height;
    }
    return this.fullCanvas;
  }

  private renderThumbDataUrl(
    source: HTMLVideoElement | HTMLCanvasElement,
    maxDimension: number
  ): string {
    if (!this.thumbCanvas) {
      this.thumbCanvas = document.createElement('canvas');
    }
    const { width, height } = MediaValidator.computeBoundedSize(
      this.width,
      this.height,
      maxDimension
    );
    if (this.thumbCanvas.width !== width || this.thumbCanvas.height !== height) {
      this.thumbCanvas.width = width;
      this.thumbCanvas.height = height;
    }
    const ctx = this.thumbCanvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(source, 0, 0, width, height);
    return this.thumbCanvas.toDataURL('image/jpeg', 0.85);
  }
}

function waitForCompositorFrame(
  video: VideoWithRvfc,
  signal?: AbortSignal,
  didSeek = true
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(MediaValidator.createAbortError(t('core.extractFramesCancelled')));
      return;
    }

    if (!didSeek) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        resolve();
      }
      return;
    }

    let done = false;
    let rvfcId: number | null = null;
    let fallbackTimer: number | null = null;

    const cleanup = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (rvfcId !== null && typeof video.cancelVideoFrameCallback === 'function') {
        try {
          video.cancelVideoFrameCallback(rvfcId);
        } catch {
          // Ignore
        }
        rvfcId = null;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    const onAbort = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(MediaValidator.createAbortError(t('core.extractFramesCancelled')));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (typeof video.requestVideoFrameCallback === 'function') {
      try {
        rvfcId = video.requestVideoFrameCallback(() => finish());
        // Detached or same-frame paused videos may skip RVFC; settle quickly via timeout
        fallbackTimer = window.setTimeout(finish, 90);
        return;
      } catch {
        // Fall through to rAF
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => finish());
    } else {
      window.setTimeout(finish, 16);
    }
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(t('core.pngEncodeTimeout')));
    }, 10000);

    canvas.toBlob(
      (blob) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!blob) {
          reject(new Error(t('core.frameToImageFailed')));
          return;
        }
        resolve(blob);
      },
      'image/png',
      1.0
    );
  });
}
