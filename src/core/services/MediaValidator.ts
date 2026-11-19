import { generateId } from '../domain/defaults';
import { AspectRatioOption, MediaAsset, MediaKind, ValidationResult } from '../domain/types';
import { t } from '../i18n';

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'avif',
  'svg',
  'bmp',
]);

export const ALLOWED_VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'ogv',
]);

export const IMAGE_ACCEPT_STRING =
  '.png,.jpg,.jpeg,.webp,.avif,.svg,.bmp,image/png,image/jpeg,image/webp,image/avif,image/svg+xml,image/bmp';

export const VIDEO_ACCEPT_STRING =
  '.mp4,.webm,.mov,.m4v,.mkv,.ogv,video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-matroska,video/ogg';

export const ALL_MEDIA_ACCEPT_STRING = `${IMAGE_ACCEPT_STRING},${VIDEO_ACCEPT_STRING}`;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
};

const ASPECT_RATIO_TARGETS: Array<{ option: AspectRatioOption; ratio: number }> = [
  { option: '16:9', ratio: 16 / 9 },
  { option: '16:10', ratio: 16 / 10 },
  { option: '4:3', ratio: 4 / 3 },
  { option: '9:16', ratio: 9 / 16 },
];

/**
 * Validates, probes, and ingests image/video media files into MediaAsset objects,
 * and provides shared video element readiness/seeking/cleanup utilities.
 */
export class MediaValidator {
  static createAbortError(message = t('core.cancelled')): Error {
    if (typeof DOMException === 'function') {
      return new DOMException(message, 'AbortError');
    }
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
  }

  static isAbortError(err: unknown): boolean {
    if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
      return err.name === 'AbortError';
    }
    if (err instanceof Error) {
      return err.name === 'AbortError';
    }
    return (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError'
    );
  }

  static throwIfAborted(signal?: AbortSignal, message?: string): void {
    if (signal?.aborted) {
      throw this.createAbortError(message);
    }
  }

  static getExtension(filename: string): string {
    const parts = filename.toLowerCase().trim().split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  static inferAspectRatio(width: number, height: number): AspectRatioOption {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return '16:9';
    }
    const actual = width / height;
    let best: AspectRatioOption = '16:9';
    let bestDiff = Infinity;

    for (const candidate of ASPECT_RATIO_TARGETS) {
      const diff = Math.abs(Math.log(actual / candidate.ratio));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate.option;
      }
    }
    return best;
  }

  static computeBoundedSize(
    width: number,
    height: number,
    maxDimension = 320
  ): { width: number; height: number } {
    const safeW = width > 0 ? width : maxDimension;
    const safeH = height > 0 ? height : maxDimension;
    const maxSide = Math.max(safeW, safeH);
    const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;
    return {
      width: Math.max(1, Math.round(safeW * scale)),
      height: Math.max(1, Math.round(safeH * scale)),
    };
  }

  static revokeAssetUrls(asset?: MediaAsset | null): void {
    if (!asset) return;
    const urls = [asset.objectUrl, asset.thumbnailUrl, asset.lastFrameUrl];
    for (const url of urls) {
      if (url && typeof url === 'string' && url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revocation failures on already-freed URLs
        }
      }
    }
  }

  static cleanupVideoElement(video: HTMLVideoElement | null | undefined): void {
    if (!video) return;
    video.onloadedmetadata = null;
    video.onloadeddata = null;
    video.oncanplay = null;
    video.onseeked = null;
    video.onerror = null;
    video.ondurationchange = null;
    try {
      video.pause();
    } catch {
      // Ignore
    }
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Ignore
    }
  }

  static resolveMimeType(file: File, kind: MediaKind, extension: string): string {
    const rawMime = (file.type || '').toLowerCase().trim();
    if (kind === 'video') {
      if (rawMime.startsWith('video/') && rawMime !== 'video/mov') {
        return rawMime;
      }
      return VIDEO_MIME_BY_EXT[extension] || `video/${extension || 'mp4'}`;
    }
    if (rawMime.startsWith('image/')) {
      return rawMime;
    }
    return IMAGE_MIME_BY_EXT[extension] || `image/${extension || 'png'}`;
  }

  static validateFile(file: File, expectedKind?: MediaKind): ValidationResult {
    return this.validateDescriptor(file.name, file.type || '', file.size, expectedKind);
  }

  static validateDescriptor(
    fileName: string,
    mimeType: string,
    size: number,
    expectedKind?: MediaKind
  ): ValidationResult {
    const ext = this.getExtension(fileName);
    const mime = (mimeType || '').toLowerCase();

    const isKnownVideoExt = ALLOWED_VIDEO_EXTENSIONS.has(ext);
    const isKnownImageExt = ALLOWED_IMAGE_EXTENSIONS.has(ext);
    const isVideo = isKnownVideoExt || (!isKnownImageExt && mime.startsWith('video/'));
    const isImage = isKnownImageExt || (!isKnownVideoExt && mime.startsWith('image/'));

    if (!isImage && !isVideo) {
      return {
        valid: false,
        kind: null,
        extension: ext,
        errorReason: t('core.unsupportedExt', { ext: ext || t('core.unknown') }),
      };
    }

    const detectedKind: MediaKind = isVideo ? 'video' : 'image';

    if (expectedKind && detectedKind !== expectedKind) {
      const expectedLabel =
        expectedKind === 'image'
          ? t('core.expectedKindImage')
          : t('core.expectedKindVideo');
      const actualLabel =
        detectedKind === 'image' ? t('core.actualKindImage') : t('core.actualKindVideo');
      return {
        valid: false,
        kind: detectedKind,
        extension: ext,
        errorReason: t('core.kindMismatch', {
          expected: expectedLabel,
          actual: actualLabel,
          name: fileName,
        }),
      };
    }

    if (size === 0) {
      return {
        valid: false,
        kind: detectedKind,
        extension: ext,
        errorReason: t('core.emptyFile', { name: fileName }),
      };
    }

    return {
      valid: true,
      kind: detectedKind,
      extension: ext,
    };
  }

  static async ingestFile(
    file: File,
    expectedKind?: MediaKind,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    this.throwIfAborted(signal, t('core.importCancelled'));

    const validation = this.validateFile(file, expectedKind);
    if (!validation.valid || !validation.kind) {
      throw new Error(validation.errorReason || t('core.invalidFile'));
    }

    if (validation.kind === 'image') {
      return this.ingestImageFile(file, validation.extension, signal);
    }
    return this.ingestVideoFile(file, validation.extension, signal);
  }

  /**
   * Probes and ingests a media resource from an existing URL (`mpres://`, `blob:`, or HTTP)
   * without reading the underlying file into JavaScript heap memory.
   */
  static async ingestFromUrl(
    url: string,
    kind: MediaKind,
    meta: {
      fileName: string;
      mimeType: string;
      size: number;
      source?: MediaAsset['source'];
    },
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    this.throwIfAborted(signal, t('core.importCancelled'));
    const extension = this.getExtension(meta.fileName) || (kind === 'video' ? 'mp4' : 'png');

    if (kind === 'image') {
      return this.ingestImageFromUrl(
        url,
        {
          name: meta.fileName,
          mimeType: meta.mimeType || IMAGE_MIME_BY_EXT[extension] || 'image/png',
          extension,
          fileSize: meta.size,
          source: meta.source,
          revokeOnFail: false,
        },
        signal
      );
    }

    return this.ingestVideoFromUrl(
      url,
      {
        name: meta.fileName,
        mimeType: meta.mimeType || VIDEO_MIME_BY_EXT[extension] || 'video/mp4',
        extension,
        fileSize: meta.size,
        source: meta.source,
        revokeOnFail: false,
      },
      signal
    );
  }

  /**
   * Loads a video element until metadata and the first decoded frame (readyState >= 2) are ready.
   */
  static waitForVideoLoadedData(
    video: HTMLVideoElement,
    srcUrl: string,
    fileName: string,
    options: { timeoutMs?: number; errorMessage?: string; signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(this.createAbortError(t('core.videoLoadCancelled')));
        return;
      }

      const timeoutMs = options.timeoutMs ?? 12000;
      let settled = false;
      let metadataSeen = false;
      let timerId: number | null = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        options.signal?.removeEventListener('abort', onAbort);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onErr);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const onAbort = () => fail(this.createAbortError(t('core.videoLoadCancelled')));

      const onMeta = () => {
        metadataSeen = true;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          succeed();
        }
      };

      const onReady = () => {
        if (video.readyState >= 2) {
          succeed();
        }
      };

      const onErr = () => {
        fail(
          new Error(
            options.errorMessage ||
              t('core.videoDecodeHint', { name: fileName })
          )
        );
      };

      timerId = window.setTimeout(() => {
        if (metadataSeen && video.videoWidth === 0) {
          fail(
            new Error(
              t('core.videoNoVisualTrack', { name: fileName })
            )
          );
        } else {
          fail(new Error(t('core.videoMetadataTimeout', { name: fileName })));
        }
      }, timeoutMs);

      options.signal?.addEventListener('abort', onAbort, { once: true });
      video.addEventListener('loadedmetadata', onMeta);
      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onErr);
      video.src = srcUrl;
    });
  }

  /**
   * Resolves a finite video duration, handling Chromium's WebM Infinity duration quirk safely.
   */
  static async resolveFiniteVideoDuration(
    video: HTMLVideoElement,
    options: { fallbackDurationSec?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<number> {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      return video.duration;
    }

    const timeoutMs = options.timeoutMs ?? 2500;

    await new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(this.createAbortError(t('core.videoDurationCancelled')));
        return;
      }

      let settled = false;
      let timerId: number | null = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        options.signal?.removeEventListener('abort', onAbort);
        video.removeEventListener('durationchange', checkDuration);
        video.removeEventListener('seeked', checkDuration);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(this.createAbortError(t('core.videoDurationCancelled')));
      };

      const checkDuration = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          finish();
        }
      };

      timerId = window.setTimeout(finish, timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      video.addEventListener('durationchange', checkDuration);
      video.addEventListener('seeked', checkDuration);

      try {
        video.currentTime = 1e101;
      } catch {
        finish();
      }
    });

    if (Number.isFinite(video.duration) && video.duration > 0) {
      return video.duration;
    }
    if (video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      if (Number.isFinite(bufferedEnd) && bufferedEnd > 0) {
        return bufferedEnd;
      }
    }
    if (Number.isFinite(video.currentTime) && video.currentTime > 0 && video.currentTime < 1e10) {
      return video.currentTime;
    }
    return options.fallbackDurationSec && options.fallbackDurationSec > 0
      ? options.fallbackDurationSec
      : 0;
  }

  /**
   * Seeks a video element to `targetTimeSec` and waits until a decoded frame is available (`readyState >= 2`).
   */
  static seekVideoToTimestamp(
    video: HTMLVideoElement,
    targetTimeSec: number,
    options: { timeoutMs?: number; rejectOnTimeout?: boolean; signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(this.createAbortError(t('core.videoSeekCancelled')));
        return;
      }

      const target = Math.max(0, targetTimeSec);
      const timeoutMs = options.timeoutMs ?? 4000;
      const rejectOnTimeout = options.rejectOnTimeout ?? true;

      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= 0.0015) {
        resolve();
        return;
      }

      let settled = false;
      let timerId: number | null = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        options.signal?.removeEventListener('abort', onAbort);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('error', onErr);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (rejectOnTimeout) {
          reject(err);
        } else {
          resolve();
        }
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(this.createAbortError(t('core.videoSeekCancelled')));
      };

      const onCanPlay = () => {
        if (!video.seeking && video.readyState >= 2) {
          succeed();
        }
      };

      const onSeeked = () => {
        if (video.readyState >= 2) {
          succeed();
        } else {
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('loadeddata', onCanPlay);
        }
      };

      const onErr = () => {
        fail(new Error(t('core.videoSeekFailed', { time: target.toFixed(2) })));
      };

      timerId = window.setTimeout(() => {
        if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= 0.06) {
          succeed();
        } else {
          fail(new Error(t('core.videoSeekTimeout', { time: target.toFixed(2) })));
        }
      }, timeoutMs);

      options.signal?.addEventListener('abort', onAbort, { once: true });
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onErr, { once: true });

      try {
        video.currentTime = target;
      } catch {
        fail(new Error(t('core.videoSetPosFailed', { time: target.toFixed(2) })));
      }
    });
  }

  private static ingestImageFile(
    file: File,
    extension: string,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    const objectUrl = URL.createObjectURL(file);
    return this.ingestImageFromUrl(
      objectUrl,
      {
        name: file.name,
        mimeType: this.resolveMimeType(file, 'image', extension),
        extension,
        fileSize: file.size,
        rawFile: file,
        source: { kind: 'memory' },
        revokeOnFail: true,
      },
      signal
    );
  }

  private static ingestImageFromUrl(
    objectUrl: string,
    meta: {
      name: string;
      mimeType: string;
      extension: string;
      fileSize: number;
      rawFile?: File | Blob;
      source?: MediaAsset['source'];
      revokeOnFail?: boolean;
    },
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        if (meta.revokeOnFail && objectUrl.startsWith('blob:')) {
          URL.revokeObjectURL(objectUrl);
        }
        reject(this.createAbortError(t('core.imageImportCancelled')));
        return;
      }

      const img = new Image();
      if (/^(https?|mpres):\/\//i.test(objectUrl)) {
        img.crossOrigin = 'anonymous';
      }
      let settled = false;
      let timeoutId: number | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        signal?.removeEventListener('abort', onAbort);
        img.onload = null;
        img.onerror = null;
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (meta.revokeOnFail && objectUrl.startsWith('blob:')) {
          URL.revokeObjectURL(objectUrl);
        }
        reject(err);
      };

      const onAbort = () => fail(this.createAbortError(t('core.imageImportCancelled')));
      signal?.addEventListener('abort', onAbort, { once: true });

      timeoutId = window.setTimeout(() => {
        fail(new Error(t('core.imageReadTimeout', { name: meta.name })));
      }, 10000);

      img.onload = () => {
        if (settled) return;
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;

        if ((!naturalW || !naturalH) && meta.extension !== 'svg') {
          fail(new Error(t('core.imageCorrupted', { name: meta.name })));
          return;
        }

        const width = naturalW || 1920;
        const height = naturalH || 1080;
        const thumbUrl = this.renderCanvasThumbnail(img, width, height, 320);

        settled = true;
        cleanup();

        resolve({
          id: generateId('img'),
          name: meta.name,
          kind: 'image',
          mimeType: meta.mimeType,
          extension: meta.extension,
          objectUrl,
          fileSize: meta.fileSize,
          width,
          height,
          durationSec: 0,
          thumbnailUrl: thumbUrl || objectUrl,
          rawFile: meta.rawFile,
          source: meta.source ?? (meta.rawFile ? { kind: 'memory' } : undefined),
          hasAudio: false,
          suggestedAspectRatio: this.inferAspectRatio(width, height),
        });
      };

      img.onerror = () => {
        fail(new Error(t('core.imageReadFailed', { name: meta.name })));
      };

      img.src = objectUrl;
    });
  }

  private static async ingestVideoFile(
    file: File,
    extension: string,
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    this.throwIfAborted(signal, t('core.videoAnalyzeCancelled'));

    const audioProbePromise = probeAudioInContainer(file, extension).catch(() => undefined);
    const objectUrl = URL.createObjectURL(file);
    return this.ingestVideoFromUrl(
      objectUrl,
      {
        name: file.name,
        mimeType: this.resolveMimeType(file, 'video', extension),
        extension,
        fileSize: file.size,
        rawFile: file,
        source: { kind: 'memory' },
        containerAudioPromise: audioProbePromise,
        revokeOnFail: true,
      },
      signal
    );
  }

  private static async ingestVideoFromUrl(
    objectUrl: string,
    meta: {
      name: string;
      mimeType: string;
      extension: string;
      fileSize: number;
      rawFile?: File | Blob;
      source?: MediaAsset['source'];
      containerAudioPromise?: Promise<boolean | undefined>;
      revokeOnFail?: boolean;
    },
    signal?: AbortSignal
  ): Promise<MediaAsset> {
    this.throwIfAborted(signal, t('core.videoAnalyzeCancelled'));

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    if (/^(https?|mpres):\/\//i.test(objectUrl)) {
      video.crossOrigin = 'anonymous';
    }

    try {
      await this.waitForVideoLoadedData(video, objectUrl, meta.name, { signal });

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        throw new Error(
          t('core.videoNoVisualTrack', { name: meta.name })
        );
      }

      const wasInfinity = !Number.isFinite(video.duration) || video.duration <= 0;
      const durationSec = await this.resolveFiniteVideoDuration(video, { signal });

      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        throw new Error(t('core.videoDurationUnknown', { name: meta.name }));
      }

      let firstFrameUrl = '';
      let lastFrameUrl = '';

      if (wasInfinity) {
        // After resolving WebM Infinity duration via 1e101, capture the end frame before seeking to 0
        if (video.readyState >= 2) {
          lastFrameUrl = this.renderCanvasThumbnail(video, width, height, 320);
        }
        await this.seekVideoToTimestamp(video, 0, {
          timeoutMs: 3500,
          rejectOnTimeout: false,
          signal,
        });
        if (video.readyState >= 2) {
          firstFrameUrl = this.renderCanvasThumbnail(video, width, height, 320);
        }
        if (!lastFrameUrl) {
          await this.seekVideoToTimestamp(video, Math.max(0, durationSec - 0.001), {
            timeoutMs: 3500,
            rejectOnTimeout: false,
            signal,
          });
          if (video.readyState >= 2) {
            lastFrameUrl = this.renderCanvasThumbnail(video, width, height, 320);
          }
        }
      } else {
        if (Math.abs(video.currentTime) > 0.01 || video.readyState < 2) {
          await this.seekVideoToTimestamp(video, 0, {
            timeoutMs: 3500,
            rejectOnTimeout: false,
            signal,
          });
        }
        if (video.readyState >= 2) {
          firstFrameUrl = this.renderCanvasThumbnail(video, width, height, 320);
        }
        await this.seekVideoToTimestamp(video, Math.max(0, durationSec - 0.001), {
          timeoutMs: 3500,
          rejectOnTimeout: false,
          signal,
        });
        if (video.readyState >= 2) {
          lastFrameUrl = this.renderCanvasThumbnail(video, width, height, 320);
        }
      }

      const containerHasAudio = meta.containerAudioPromise
        ? await meta.containerAudioPromise
        : undefined;
      const runtimeHasAudio = detectRuntimeAudioFlag(video);
      const hasAudio =
        containerHasAudio !== undefined ? containerHasAudio : runtimeHasAudio;

      return {
        id: generateId('vid'),
        name: meta.name,
        kind: 'video',
        mimeType: meta.mimeType,
        extension: meta.extension,
        objectUrl,
        fileSize: meta.fileSize,
        width,
        height,
        durationSec,
        thumbnailUrl: firstFrameUrl || lastFrameUrl,
        lastFrameUrl: lastFrameUrl || firstFrameUrl,
        rawFile: meta.rawFile,
        source: meta.source ?? (meta.rawFile ? { kind: 'memory' } : undefined),
        hasAudio,
        suggestedAspectRatio: this.inferAspectRatio(width, height),
      };
    } catch (err) {
      if (meta.revokeOnFail && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
      throw err instanceof Error ? err : new Error(t('core.videoAnalyzeError', { name: meta.name }));
    } finally {
      this.cleanupVideoElement(video);
    }
  }

  static renderCanvasThumbnail(
    source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    sourceWidth: number,
    sourceHeight: number,
    maxDimension = 320
  ): string {
    const canvas = document.createElement('canvas');
    try {
      const { width, height } = this.computeBoundedSize(
        sourceWidth,
        sourceHeight,
        maxDimension
      );
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(source, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return '';
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

function detectRuntimeAudioFlag(video: HTMLVideoElement): boolean | undefined {
  const anyVideo = video as unknown as {
    mozHasAudio?: boolean;
    audioTracks?: { length: number };
    webkitAudioDecodedByteCount?: number;
  };
  if (typeof anyVideo.mozHasAudio === 'boolean') {
    return anyVideo.mozHasAudio;
  }
  if (anyVideo.audioTracks && typeof anyVideo.audioTracks.length === 'number') {
    return anyVideo.audioTracks.length > 0;
  }
  if (
    typeof anyVideo.webkitAudioDecodedByteCount === 'number' &&
    anyVideo.webkitAudioDecodedByteCount > 0
  ) {
    return true;
  }
  return undefined;
}

async function probeAudioInContainer(
  file: File,
  extension: string
): Promise<boolean | undefined> {
  if (extension === 'mp4' || extension === 'mov' || extension === 'm4v') {
    return probeIsoBmffAudio(file);
  }
  if (extension === 'webm' || extension === 'mkv') {
    return probeEbmlAudio(file);
  }
  return undefined;
}

async function probeIsoBmffAudio(file: File): Promise<boolean | undefined> {
  const maxChunk = 2 * 1024 * 1024;
  let offset = 0;
  const viewSize = 16;

  for (let steps = 0; steps < 64 && offset + 8 <= file.size; steps++) {
    const headerBuf = await file
      .slice(offset, Math.min(file.size, offset + viewSize))
      .arrayBuffer();
    if (headerBuf.byteLength < 8) break;
    const view = new DataView(headerBuf);
    let boxSize = view.getUint32(0, false);
    const boxType = readAscii(new Uint8Array(headerBuf), 4, 4);
    let headerLen = 8;

    if (boxSize === 1 && headerBuf.byteLength >= 16) {
      const hi = view.getUint32(8, false);
      const lo = view.getUint32(12, false);
      boxSize = hi * 4294967296 + lo;
      headerLen = 16;
    } else if (boxSize === 0) {
      boxSize = file.size - offset;
    }

    if (boxSize < headerLen) break;

    if (boxType === 'moov') {
      const sliceLen = Math.min(boxSize, maxChunk);
      const moovBytes = new Uint8Array(
        await file.slice(offset, offset + sliceLen).arrayBuffer()
      );
      return scanMoovForSoundHandler(moovBytes);
    }

    offset += boxSize;
  }

  return undefined;
}

function scanMoovForSoundHandler(bytes: Uint8Array): boolean | undefined {
  let sawVideo = false;
  for (let i = 4; i + 16 <= bytes.length; i++) {
    if (
      bytes[i] === 0x68 &&
      bytes[i + 1] === 0x64 &&
      bytes[i + 2] === 0x6c &&
      bytes[i + 3] === 0x72
    ) {
      const handlerType = readAscii(bytes, i + 12, 4);
      if (handlerType === 'soun') return true;
      if (handlerType === 'vide') sawVideo = true;
    }
  }
  return sawVideo ? false : undefined;
}

async function probeEbmlAudio(file: File): Promise<boolean | undefined> {
  const headLen = Math.min(file.size, 512 * 1024);
  const headBytes = new Uint8Array(await file.slice(0, headLen).arrayBuffer());
  const headResult = scanEbmlTracks(headBytes);
  if (headResult !== undefined) return headResult;

  if (file.size > headLen) {
    const tailStart = Math.max(0, file.size - 512 * 1024);
    const tailBytes = new Uint8Array(
      await file.slice(tailStart, file.size).arrayBuffer()
    );
    return scanEbmlTracks(tailBytes);
  }
  return undefined;
}

function scanEbmlTracks(bytes: Uint8Array): boolean | undefined {
  let tracksStart = -1;
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (
      bytes[i] === 0x16 &&
      bytes[i + 1] === 0x54 &&
      bytes[i + 2] === 0xae &&
      bytes[i + 3] === 0x6b
    ) {
      tracksStart = i;
      break;
    }
  }

  if (tracksStart === -1) return undefined;

  const scanLimit = Math.min(bytes.length, tracksStart + 32 * 1024);
  let sawVideo = false;

  for (let i = tracksStart; i + 3 <= scanLimit; i++) {
    if (bytes[i] === 0x83 && bytes[i + 1] === 0x81) {
      if (bytes[i + 2] === 0x02) return true;
      if (bytes[i + 2] === 0x01) sawVideo = true;
    }
    if (
      i > tracksStart + 8 &&
      bytes[i] === 0x1f &&
      bytes[i + 1] === 0x43 &&
      bytes[i + 2] === 0xb6 &&
      bytes[i + 3] === 0x75
    ) {
      break;
    }
  }

  return sawVideo ? false : undefined;
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  for (let i = 0; i < len && start + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}
