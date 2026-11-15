import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  MediaAsset,
  MediaKind,
  PresentationProject,
  PresentationSettings,
  ProjectAiSourceMeta,
  ReelMetadata,
  SlideSourceMeta,
} from '../domain/types';
import { t } from '../i18n';

const STORAGE_KEY = 'motion_presentation_settings_v1';
const ASSET_DB_NAME = 'motion_presentation_assets_v1';
const ASSET_STORE_NAME = 'blobs';

export interface SerializedTransitionData {
  hasCustomVideo?: boolean;
  videoId?: string;
  videoFileName?: string | null;
  videoDurationSec?: number;
  startTimeSec?: number;
  endTimeSec?: number;
  videoThumbnailUrl?: string;
  videoArchivePath?: string;
  fallbackStyle?: string;
  fallbackDurationMs?: number;
  playbackSpeed?: number;
  muted?: boolean;
  easing?: string;
}

export interface SerializedSlideData {
  id?: string;
  index: number;
  title: string;
  notes: string;
  holdDurationSec: number | null;
  imageFileName: string;
  imageMimeType?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageResolution?: string;
  imageThumbnailUrl?: string;
  imageDataUrl?: string;
  imageArchivePath?: string;
  sourceVideoId?: string;
  sourceTimeSec?: number;
  idleLoopVideoId?: string;
  idleLoopFileName?: string | null;
  idleLoopDurationSec?: number;
  idleLoopArchivePath?: string;
  expectedIdleLoopFileName?: string;
  sourceMeta?: SlideSourceMeta;
  transitionToNext?: SerializedTransitionData;
}

export interface DeserializedProjectData {
  projectId?: string;
  title: string;
  settings?: Partial<PresentationSettings>;
  reelMetadata?: ReelMetadata;
  aiSourceMeta?: ProjectAiSourceMeta;
  slidesData: SerializedSlideData[];
}

export interface ExtractedBundleAsset {
  archivePath: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface LoadedProjectBundle {
  projectData: DeserializedProjectData;
  imageAssets: Map<string, ExtractedBundleAsset>;
  videoAssets: Map<string, ExtractedBundleAsset>;
  format: 'mpres-bundle' | 'manifest-json';
}

interface StoredBlobRecord {
  key: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  kind: MediaKind;
  updatedAt: number;
}

export class ProjectSerializer {
  static saveSettingsToLocal(settings: PresentationSettings): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota errors
    }
  }

  static loadSettingsFromLocal(): Partial<PresentationSettings> | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as Partial<PresentationSettings>;
    } catch {
      return null;
    }
  }

  static buildManifestObject(
    project: PresentationProject,
    embeddedImagesMap?: Map<string, string>,
    archivePathMap?: {
      images?: Map<string, string>;
      videos?: Map<string, string>;
    }
  ) {
    const usesV12Features = Boolean(
      project.aiSourceMeta ||
        project.slides.some(
          (s) => s.idleLoopAsset || s.expectedIdleLoopFileName || s.sourceMeta
        )
    );
    return {
      version: usesV12Features ? '1.2.0' : '1.1.0',
      projectId: project.id,
      exportedAt: new Date().toISOString(),
      title: project.title,
      settings: project.settings,
      reelMetadata: project.reelMetadata,
      aiSourceMeta: project.aiSourceMeta,
      slides: project.slides.map((s, idx) => {
        const embeddedDataUrl =
          embeddedImagesMap?.get(s.imageAsset.id) ||
          (s.imageAsset.objectUrl?.startsWith('data:') ? s.imageAsset.objectUrl : undefined);
        const videoAsset = s.transitionToNext.videoAsset;
        const videoFileName =
          videoAsset?.name ||
          s.transitionToNext.expectedVideoFileName ||
          null;
        const videoDurationSec =
          videoAsset?.durationSec ||
          s.transitionToNext.expectedVideoDurationSec ||
          0;
        const hasCustomVideo = Boolean(
          videoAsset || s.transitionToNext.expectedVideoFileName
        );
        const imageArchivePath = archivePathMap?.images?.get(s.imageAsset.id);
        const videoKey = videoAsset ? this.getAssetDedupKey(videoAsset) : '';
        const videoArchivePath = videoKey ? archivePathMap?.videos?.get(videoKey) : undefined;
        const idleLoop = s.idleLoopAsset;
        const idleLoopKey = idleLoop ? this.getAssetDedupKey(idleLoop) : '';
        const idleLoopArchivePath = idleLoopKey
          ? archivePathMap?.videos?.get(idleLoopKey)
          : undefined;

        return {
          id: s.id,
          index: idx + 1,
          title: s.title,
          notes: s.notes,
          holdDurationSec: s.holdDurationSec,
          imageFileName: s.imageAsset.name,
          imageMimeType: s.imageAsset.mimeType,
          imageWidth: s.imageAsset.width,
          imageHeight: s.imageAsset.height,
          imageResolution: `${s.imageAsset.width}x${s.imageAsset.height}`,
          imageThumbnailUrl: s.imageAsset.thumbnailUrl?.startsWith('data:')
            ? s.imageAsset.thumbnailUrl
            : undefined,
          imageDataUrl: imageArchivePath ? undefined : embeddedDataUrl,
          imageArchivePath,
          sourceVideoId: s.imageAsset.sourceVideoId,
          sourceTimeSec: s.imageAsset.sourceTimeSec,
          idleLoopVideoId: idleLoop?.id,
          idleLoopFileName: idleLoop?.name || s.expectedIdleLoopFileName || null,
          idleLoopDurationSec: idleLoop?.durationSec || 0,
          idleLoopArchivePath,
          expectedIdleLoopFileName: s.expectedIdleLoopFileName,
          sourceMeta: s.sourceMeta,
          transitionToNext: {
            hasCustomVideo,
            videoId: videoAsset?.id,
            videoFileName,
            videoDurationSec,
            startTimeSec: s.transitionToNext.startTimeSec,
            endTimeSec: s.transitionToNext.endTimeSec,
            videoThumbnailUrl: videoAsset?.thumbnailUrl?.startsWith('data:')
              ? videoAsset.thumbnailUrl
              : undefined,
            videoArchivePath,
            fallbackStyle: s.transitionToNext.fallbackStyle,
            fallbackDurationMs: s.transitionToNext.fallbackDurationMs,
            playbackSpeed: s.transitionToNext.playbackSpeed,
            muted: s.transitionToNext.muted,
            easing: s.transitionToNext.easing ?? 'linear',
          },
        };
      }),
    };
  }

  static async buildBundleBytes(project: PresentationProject): Promise<Uint8Array> {
    const archiveEntries: Record<string, Uint8Array> = {};
    const imagePaths = new Map<string, string>();
    const videoPaths = new Map<string, string>();

    let imageCounter = 0;
    let videoCounter = 0;

    for (const slide of project.slides) {
      const img = slide.imageAsset;
      if (img && !imagePaths.has(img.id)) {
        const bytes = await this.readAssetBytes(img);
        if (bytes && bytes.byteLength > 0) {
          imageCounter += 1;
          const ext = this.sanitizeExtension(img.name, img.extension || 'png');
          const entryPath = `assets/images/slide_${String(imageCounter).padStart(3, '0')}.${ext}`;
          archiveEntries[entryPath] = bytes;
          imagePaths.set(img.id, entryPath);
        }
      }

      const vid = slide.transitionToNext?.videoAsset;
      if (vid) {
        const key = this.getAssetDedupKey(vid);
        if (!videoPaths.has(key)) {
          const bytes = await this.readAssetBytes(vid);
          if (bytes && bytes.byteLength > 0) {
            videoCounter += 1;
            const ext = this.sanitizeExtension(vid.name, vid.extension || 'mp4');
            const entryPath = `assets/videos/video_${String(videoCounter).padStart(3, '0')}.${ext}`;
            archiveEntries[entryPath] = bytes;
            videoPaths.set(key, entryPath);
          }
        }
      }

      const loopVid = slide.idleLoopAsset;
      if (loopVid) {
        const key = this.getAssetDedupKey(loopVid);
        if (!videoPaths.has(key)) {
          const bytes = await this.readAssetBytes(loopVid);
          if (bytes && bytes.byteLength > 0) {
            videoCounter += 1;
            const ext = this.sanitizeExtension(loopVid.name, loopVid.extension || 'mp4');
            const entryPath = `assets/videos/video_${String(videoCounter).padStart(3, '0')}.${ext}`;
            archiveEntries[entryPath] = bytes;
            videoPaths.set(key, entryPath);
          }
        }
      }
    }

    const manifest = this.buildManifestObject(project, undefined, {
      images: imagePaths,
      videos: videoPaths,
    });
    archiveEntries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

    // STORE mode (level 0): instant packaging without re-compressing PNG/MP4 media
    return zipSync(archiveEntries, { level: 0 });
  }

  static isZipBundleBytes(bytes: Uint8Array): boolean {
    return (
      bytes.byteLength >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    );
  }

  static parseProjectBytes(bytes: Uint8Array): LoadedProjectBundle {
    if (this.isZipBundleBytes(bytes)) {
      const entries = unzipSync(bytes);
      const manifestEntry = entries['manifest.json'];
      if (!manifestEntry) {
        throw new Error(t('core.projectMissingManifest'));
      }

      const manifestText = strFromU8(manifestEntry);
      const projectData = this.deserializeProject(manifestText);
      const imageAssets = new Map<string, ExtractedBundleAsset>();
      const videoAssets = new Map<string, ExtractedBundleAsset>();

      for (const sd of projectData.slidesData) {
        if (sd.imageArchivePath && !imageAssets.has(sd.imageArchivePath)) {
          const entryBytes = entries[sd.imageArchivePath];
          if (entryBytes && entryBytes.byteLength > 0) {
            const fileName = sd.imageFileName || pathBaseName(sd.imageArchivePath);
            imageAssets.set(sd.imageArchivePath, {
              archivePath: sd.imageArchivePath,
              fileName,
              mimeType: sd.imageMimeType || this.inferMimeType(fileName, 'image'),
              bytes: entryBytes.slice(),
            });
          }
        }

        const tr = sd.transitionToNext;
        if (tr?.videoArchivePath && !videoAssets.has(tr.videoArchivePath)) {
          const entryBytes = entries[tr.videoArchivePath];
          if (entryBytes && entryBytes.byteLength > 0) {
            const fileName = tr.videoFileName || pathBaseName(tr.videoArchivePath);
            videoAssets.set(tr.videoArchivePath, {
              archivePath: tr.videoArchivePath,
              fileName,
              mimeType: this.inferMimeType(fileName, 'video'),
              bytes: entryBytes.slice(),
            });
          }
        }

        if (sd.idleLoopArchivePath && !videoAssets.has(sd.idleLoopArchivePath)) {
          const entryBytes = entries[sd.idleLoopArchivePath];
          if (entryBytes && entryBytes.byteLength > 0) {
            const fileName = sd.idleLoopFileName || pathBaseName(sd.idleLoopArchivePath);
            videoAssets.set(sd.idleLoopArchivePath, {
              archivePath: sd.idleLoopArchivePath,
              fileName,
              mimeType: this.inferMimeType(fileName, 'video'),
              bytes: entryBytes.slice(),
            });
          }
        }
      }

      return {
        projectData,
        imageAssets,
        videoAssets,
        format: 'mpres-bundle',
      };
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    const projectData = this.deserializeProject(text);
    return {
      projectData,
      imageAssets: new Map(),
      videoAssets: new Map(),
      format: 'manifest-json',
    };
  }

  static triggerBundleDownload(title: string, bundleBytes: Uint8Array): void {
    const ab = bundleBytes.buffer.slice(
      bundleBytes.byteOffset,
      bundleBytes.byteOffset + bundleBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_') || 'presentation';
    a.download = `${safeName}.mpres`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  static async exportProjectBundle(project: PresentationProject): Promise<void> {
    void this.cacheProjectAssetsToLocalDb(project);
    const bundleBytes = await this.buildBundleBytes(project);
    this.triggerBundleDownload(project.title, bundleBytes);
  }

  private static getAssetDedupKey(asset: MediaAsset): string {
    return asset.id || `${asset.kind}::${asset.name}::${asset.fileSize}`;
  }

  private static sanitizeExtension(fileName: string, fallback: string): string {
    const rawExt = fileName.split('.').pop()?.toLowerCase() || fallback;
    const clean = rawExt.replace(/[^a-z0-9]/g, '');
    return clean || fallback;
  }

  private static inferMimeType(fileName: string, kind: MediaKind): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (kind === 'image') {
      const imgMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        avif: 'image/avif',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };
      return imgMap[ext] || 'image/png';
    }
    const vidMap: Record<string, string> = {
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      ogv: 'video/ogg',
    };
    return vidMap[ext] || 'video/mp4';
  }

  private static async readAssetBytes(asset: MediaAsset): Promise<Uint8Array | null> {
    try {
      if (asset.rawFile && asset.rawFile.size > 0) {
        return new Uint8Array(await asset.rawFile.arrayBuffer());
      }
      if (!asset.objectUrl) return null;

      if (asset.objectUrl.startsWith('data:')) {
        const commaIdx = asset.objectUrl.indexOf(',');
        if (commaIdx === -1) return null;
        const header = asset.objectUrl.slice(0, commaIdx);
        const body = asset.objectUrl.slice(commaIdx + 1);
        if (header.includes(';base64')) {
          const bin = atob(body);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        return strToU8(decodeURIComponent(body));
      }

      if (asset.objectUrl.startsWith('blob:') || asset.objectUrl.startsWith('http')) {
        const resp = await fetch(asset.objectUrl);
        if (!resp.ok) return null;
        return new Uint8Array(await resp.arrayBuffer());
      }
    } catch {
      return null;
    }
    return null;
  }

  static exportProjectManifest(
    project: PresentationProject,
    options?: { embedSlideImages?: boolean }
  ): void {
    void options;
    // Cache binary Blobs/Files in IndexedDB asynchronously for seamless local re-open
    void this.cacheProjectAssetsToLocalDb(project);

    const manifest = this.buildManifestObject(project);
    this.triggerManifestDownload(project.title, manifest);
  }

  static async exportProjectManifestAsync(
    project: PresentationProject,
    options?: { embedSlideImages?: boolean }
  ): Promise<void> {
    await this.cacheProjectAssetsToLocalDb(project);

    const embeddedImages = new Map<string, string>();
    if (options?.embedSlideImages) {
      for (const slide of project.slides) {
        const asset = slide.imageAsset;
        if (asset.objectUrl?.startsWith('data:')) {
          embeddedImages.set(asset.id, asset.objectUrl);
          continue;
        }
        if (asset.rawFile && asset.rawFile.size > 0 && asset.rawFile.size <= 8 * 1024 * 1024) {
          try {
            const dataUrl = await this.blobToDataUrl(asset.rawFile);
            embeddedImages.set(asset.id, dataUrl);
          } catch {
            // Fallback to thumbnailUrl
          }
        }
      }
    }

    const manifest = this.buildManifestObject(project, embeddedImages);
    this.triggerManifestDownload(project.title, manifest);
  }

  private static triggerManifestDownload(title: string, manifest: unknown): void {
    const json = JSON.stringify(manifest, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[\\/:*?"<>|]/g, '_') || 'presentation';
    a.download = `${safeName}.mpres.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  static deserializeProject(jsonString: string): DeserializedProjectData {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      throw new Error(t('core.projectInvalidFile'));
    }
    const projectId = typeof data.projectId === 'string' ? data.projectId : undefined;
    const title = typeof data.title === 'string' ? data.title : t('app.titleImported');
    const settings =
      data.settings && typeof data.settings === 'object' ? data.settings : undefined;
    const reelMetadata =
      data.reelMetadata &&
      typeof data.reelMetadata === 'object' &&
      Array.isArray(data.reelMetadata.cueTimesSec)
        ? (data.reelMetadata as ReelMetadata)
        : undefined;
    const aiSourceMeta =
      data.aiSourceMeta && typeof data.aiSourceMeta === 'object'
        ? (data.aiSourceMeta as ProjectAiSourceMeta)
        : undefined;
    const slidesData: SerializedSlideData[] = Array.isArray(data.slides) ? data.slides : [];
    return { projectId, title, settings, reelMetadata, aiSourceMeta, slidesData };
  }

  static async readProjectFile(file: File): Promise<DeserializedProjectData> {
    const text = await file.text();
    return this.deserializeProject(text);
  }

  static async readProjectBundleFromFile(file: File): Promise<LoadedProjectBundle> {
    const buf = new Uint8Array(await file.arrayBuffer());
    return this.parseProjectBytes(buf);
  }

  static async cacheProjectAssetsToLocalDb(project: PresentationProject): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await this.openAssetDb();
      if (!db) return;
      const records: StoredBlobRecord[] = [];
      const seen = new Set<string>();
      const now = Date.now();

      const addRecord = (
        blob: Blob | undefined,
        fileName: string,
        mimeType: string,
        kind: MediaKind
      ) => {
        if (!blob || blob.size === 0 || !fileName) return;
        const projKey = `${project.id}::${kind}::${fileName}`;
        const latestKey = `latest::${kind}::${fileName}`;
        if (!seen.has(projKey)) {
          seen.add(projKey);
          records.push({ key: projKey, blob, fileName, mimeType, kind, updatedAt: now });
        }
        if (!seen.has(latestKey)) {
          seen.add(latestKey);
          records.push({ key: latestKey, blob, fileName, mimeType, kind, updatedAt: now });
        }
      };

      for (const s of project.slides) {
        if (s.imageAsset?.rawFile) {
          addRecord(
            s.imageAsset.rawFile,
            s.imageAsset.name,
            s.imageAsset.mimeType || 'image/png',
            'image'
          );
        }
        const v = s.transitionToNext?.videoAsset;
        if (v?.rawFile) {
          addRecord(v.rawFile, v.name, v.mimeType || 'video/mp4', 'video');
        }
        const loopV = s.idleLoopAsset;
        if (loopV?.rawFile) {
          addRecord(loopV.rawFile, loopV.name, loopV.mimeType || 'video/mp4', 'video');
        }
      }

      if (records.length === 0) {
        db.close();
        return;
      }

      await new Promise<void>((resolve) => {
        const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ASSET_STORE_NAME);
        for (const rec of records) {
          store.put(rec);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Ignore IndexedDB unavailability / quota errors
    }
  }

  static async restoreCachedFile(
    projectId: string | undefined,
    fileName: string,
    kind: MediaKind
  ): Promise<File | null> {
    if (typeof indexedDB === 'undefined' || !fileName) return null;
    try {
      const db = await this.openAssetDb();
      if (!db) return null;

      const tryKeys = [
        ...(projectId ? [`${projectId}::${kind}::${fileName}`] : []),
        `latest::${kind}::${fileName}`,
      ];

      for (const key of tryKeys) {
        const rec = await new Promise<StoredBlobRecord | undefined>((resolve) => {
          const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
          const req = tx.objectStore(ASSET_STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result as StoredBlobRecord | undefined);
          req.onerror = () => resolve(undefined);
        });
        if (rec?.blob && rec.blob.size > 0) {
          db.close();
          return new File([rec.blob], rec.fileName || fileName, {
            type: rec.mimeType || (kind === 'video' ? 'video/mp4' : 'image/png'),
          });
        }
      }

      db.close();
      return null;
    } catch {
      return null;
    }
  }

  private static openAssetDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(ASSET_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
            db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private static blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to encode asset blob'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  }
}

function pathBaseName(archivePath: string): string {
  const parts = archivePath.split('/');
  return parts[parts.length - 1] || archivePath;
}
