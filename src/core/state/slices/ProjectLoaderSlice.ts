import { createSlideNode, generateId } from '../../domain/defaults';
import { MediaAsset, SlideNode } from '../../domain/types';
import { StagePlaybackEngine } from '../../engine/StagePlaybackEngine';
import { t } from '../../i18n';
import { MediaValidator } from '../../services/MediaValidator';
import {
  OpenedProjectAssetEntry,
  OpenedProjectDescriptor,
} from '../../services/ProjectFileService';
import {
  DeserializedProjectData,
  LoadedProjectBundle,
  ProjectSerializer,
} from '../../services/ProjectSerializer';
import { StoreSliceContext } from './DeckSlice';
import {
  findMissingVideoAssets,
  ReelSliceContext,
  relinkReelVideoInDeck,
} from './ReelWorkflowSlice';

export async function loadOpenedDesktopProjectIntoStore(
  ctx: ReelSliceContext,
  opened: OpenedProjectDescriptor
): Promise<DeserializedProjectData> {
  const projectData = ProjectSerializer.deserializeProject(opened.manifestJson);

  if (opened.format !== 'mpres-bundle' || typeof document === 'undefined') {
    ctx.setProjectToken(opened.projectToken || null);
    loadProjectFromManifestIntoStore(ctx, projectData, {
      skipCacheHydration: opened.format === 'mpres-bundle',
      preserveProjectToken: true,
    });
    return projectData;
  }

  const entryByPath = new Map<string, OpenedProjectAssetEntry>();
  for (const asset of opened.assets) {
    entryByPath.set(asset.archivePath, asset);
  }

  const imageTasks: Array<{ archivePath: string; fileName: string; entry: OpenedProjectAssetEntry }> =
    [];
  const videoTasks: Array<{ archivePath: string; fileName: string; entry: OpenedProjectAssetEntry }> =
    [];
  const seenImages = new Set<string>();
  const seenVideos = new Set<string>();

  const fallbackName = (archivePath: string) =>
    archivePath.split('/').pop() || archivePath || 'asset';

  for (const sd of projectData.slidesData) {
    if (sd.imageArchivePath && !seenImages.has(sd.imageArchivePath)) {
      const entry = entryByPath.get(sd.imageArchivePath);
      if (entry) {
        seenImages.add(sd.imageArchivePath);
        imageTasks.push({
          archivePath: sd.imageArchivePath,
          fileName: sd.imageFileName || fallbackName(sd.imageArchivePath),
          entry,
        });
      }
    }

    const tr = sd.transitionToNext;
    if (tr?.videoArchivePath && !seenVideos.has(tr.videoArchivePath)) {
      const entry = entryByPath.get(tr.videoArchivePath);
      if (entry) {
        seenVideos.add(tr.videoArchivePath);
        videoTasks.push({
          archivePath: tr.videoArchivePath,
          fileName: tr.videoFileName || fallbackName(tr.videoArchivePath),
          entry,
        });
      }
    }

    if (sd.idleLoopArchivePath && !seenVideos.has(sd.idleLoopArchivePath)) {
      const entry = entryByPath.get(sd.idleLoopArchivePath);
      if (entry) {
        seenVideos.add(sd.idleLoopArchivePath);
        videoTasks.push({
          archivePath: sd.idleLoopArchivePath,
          fileName: sd.idleLoopFileName || fallbackName(sd.idleLoopArchivePath),
          entry,
        });
      }
    }
  }

  const imageMap = new Map<string, MediaAsset>();
  const videoMap = new Map<string, MediaAsset>();

  const runWithConcurrency = async <T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> => {
    if (items.length === 0) return;
    let cursor = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          await worker(items[idx]);
        }
      })
    );
  };

  await runWithConcurrency(imageTasks, 4, async (task) => {
    try {
      const asset = await MediaValidator.ingestFromUrl(task.entry.url, 'image', {
        fileName: task.fileName,
        mimeType: task.entry.mimeType,
        size: task.entry.size,
        source: {
          kind: 'archive',
          projectToken: opened.projectToken,
          archiveEntry: task.archivePath,
        },
      });
      imageMap.set(task.archivePath, asset);
    } catch {
      // Fallback to thumbnail in manifest if image decode fails
    }
  });

  await runWithConcurrency(videoTasks, 4, async (task) => {
    try {
      const asset = await MediaValidator.ingestFromUrl(task.entry.url, 'video', {
        fileName: task.fileName,
        mimeType: task.entry.mimeType,
        size: task.entry.size,
        source: {
          kind: 'archive',
          projectToken: opened.projectToken,
          archiveEntry: task.archivePath,
        },
      });
      videoMap.set(task.archivePath, asset);
    } catch {
      // Leave expectedVideoFileName for relink UI if video decode fails
    }
  });

  ctx.setProjectToken(opened.projectToken || null);
  loadProjectFromManifestIntoStore(ctx, projectData, {
    skipCacheHydration: true,
    preserveProjectToken: true,
    preloadedAssets: { imageMap, videoMap },
  });

  return projectData;
}

export async function loadProjectBundleIntoStore(
  ctx: ReelSliceContext,
  bundle: LoadedProjectBundle
): Promise<void> {
  const project = ctx.getProject();
  if (bundle.format !== 'mpres-bundle' || typeof document === 'undefined') {
    loadProjectFromManifestIntoStore(ctx, bundle.projectData);
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

  loadProjectFromManifestIntoStore(ctx, bundle.projectData, {
    skipCacheHydration: true,
    preloadedAssets: { imageMap, videoMap },
  });

  if (project.slides.length > 0) {
    void ProjectSerializer.cacheProjectAssetsToLocalDb(project);
  }
}

export function loadProjectFromManifestIntoStore(
  ctx: ReelSliceContext,
  data: Partial<DeserializedProjectData> & {
    slides?: SlideNode[];
    slidesData?: any[];
  },
  options?: {
    skipCacheHydration?: boolean;
    preserveProjectToken?: boolean;
    preloadedAssets?: {
      imageMap: Map<string, MediaAsset>;
      videoMap: Map<string, MediaAsset>;
    };
  }
): void {
  const project = ctx.getProject();
  ctx.history.clearHistory(project.slides);
  if (!options?.preserveProjectToken) {
    ctx.setProjectToken(null);
  }
  const oldUrls: Array<string | undefined> = [];
  const oldReverseKeys: string[] = [];
  for (const s of project.slides) {
    oldUrls.push(s.imageAsset?.objectUrl);
    oldUrls.push(s.idleLoopAsset?.objectUrl);
    oldUrls.push(s.transitionToNext?.videoAsset?.objectUrl);
    oldReverseKeys.push(s.transitionToNext.id);
    if (s.transitionToNext?.videoAsset?.id) {
      oldReverseKeys.push(s.transitionToNext.videoAsset.id);
    }
  }

  if (data.projectId) project.id = data.projectId;
  if (data.title) project.title = data.title;
  if (data.settings) {
    project.settings = { ...project.settings, ...data.settings };
    ProjectSerializer.saveSettingsToLocal(project.settings);
  }
  project.reelMetadata = data.reelMetadata;
  project.aiSourceMeta = data.aiSourceMeta;

  if (Array.isArray(data.slides) && data.slides.length > 0 && 'imageAsset' in data.slides[0]) {
    project.slides = data.slides;
  } else if (Array.isArray(data.slidesData) && data.slidesData.length > 0) {
    project.slides = data.slidesData.map((sd: any, i: number) => {
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
          : project.settings.defaultFallbackDurationMs;

      const slide = createSlideNode(
        imgAsset,
        i,
        tr?.fallbackStyle || project.settings.defaultFallbackStyle,
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
    project.slides = [];
  }

  ctx.history.revokeUrlsIfUnused(project.slides, oldUrls);
  StagePlaybackEngine.invalidateReverseFrames(oldReverseKeys);

  ctx.selection.setActivePreviewIndexRaw(0);
  ctx.selection.applySingleSelection(
    project.slides.length > 0
      ? { type: 'slide', slideId: project.slides[0].id }
      : { type: 'settings' }
  );
  ctx.emit('structural');

  if (
    !options?.skipCacheHydration &&
    typeof indexedDB !== 'undefined' &&
    project.slides.length > 0
  ) {
    void hydrateProjectAssetsFromCacheInStore(ctx);
  }
}

export async function hydrateProjectAssetsFromCacheInStore(
  ctx: ReelSliceContext
): Promise<number> {
  const project = ctx.getProject();
  if (typeof indexedDB === 'undefined' || typeof document === 'undefined') return 0;
  const projectId = project.id;
  let restoredCount = 0;

  const missingGroups = findMissingVideoAssets(project.slides);
  for (const group of missingGroups) {
    try {
      const cachedFile = await ProjectSerializer.restoreCachedFile(
        projectId,
        group.videoFileName,
        'video'
      );
      if (cachedFile) {
        const videoAsset = await MediaValidator.ingestFile(cachedFile, 'video');
        const count = await relinkReelVideoInDeck(ctx, group.slideIds, videoAsset, {
          reextractMissingImages: true,
        });
        restoredCount += count;
      }
    } catch {
      // Leave pending relink metadata for UI banner
    }
  }

  const imagePatches: Array<{ idx: number; asset: MediaAsset }> = [];
  for (let i = 0; i < project.slides.length; i++) {
    const s = project.slides[i];
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
    ctx.batchUpdate(() => {
      const oldUrls: string[] = [];
      for (const p of imagePatches) {
        const slide = project.slides[p.idx];
        if (slide) {
          oldUrls.push(slide.imageAsset.objectUrl);
          slide.imageAsset = p.asset;
          restoredCount++;
        }
      }
      ctx.history.revokeUrlsIfUnused(project.slides, oldUrls);
    });
  }

  return restoredCount;
}

export function parseResolution(
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

export function createPlaceholderSlideImage(
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

export type { StoreSliceContext };
