import { MediaAsset, PresentationProject } from '../domain/types';
import { PlannedArchiveLayout, ProjectSerializer } from './ProjectSerializer';

export interface OpenedProjectAssetEntry {
  archivePath: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface OpenedProjectDescriptor {
  projectToken: string;
  filePath: string;
  fileName: string;
  format: 'mpres-bundle' | 'manifest-json';
  manifestJson: string;
  assets: OpenedProjectAssetEntry[];
  recoveredFromBackup?: boolean;
}

export interface RegisteredMediaDescriptor {
  token: string;
  path: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export type StreamingSaveAssetEntry =
  | { archivePath: string; fileName?: string; source: 'file'; path: string }
  | {
      archivePath: string;
      fileName?: string;
      source: 'archive';
      projectToken: string;
      archiveEntry: string;
    }
  | { archivePath: string; fileName?: string; source: 'bytes'; bytes: Uint8Array };

export interface StreamingSavePayload {
  mode: 'dialog' | 'direct';
  filePath?: string;
  currentFilePath?: string | null;
  defaultFileName: string;
  activeProjectToken?: string | null;
  manifestJson: string;
  assets: StreamingSaveAssetEntry[];
}

export type StreamingSaveResult =
  | { ok: true; filePath: string; fileName: string; projectToken: string }
  | {
      ok: false;
      code: 'MISSING_SOURCES';
      missingFiles: Array<{ archivePath: string; fileName: string; path: string }>;
    };

export interface BuiltStreamingSaveRequest {
  manifestJson: string;
  assets: StreamingSaveAssetEntry[];
  layout: PlannedArchiveLayout;
}

export interface ProjectFileBackend {
  isDesktop(): boolean;
  openProject(): Promise<OpenedProjectDescriptor | null>;
  saveProject(
    project: PresentationProject,
    options: {
      forceSaveAs: boolean;
      currentFilePath: string | null;
      activeProjectToken: string | null;
    }
  ): Promise<StreamingSaveResult | null>;
  closeToken(projectToken: string): Promise<void>;
}

/**
 * Builds the manifest JSON and streaming asset source descriptors for `project:save-streamed`.
 * Falls back to reading raw bytes only for in-memory assets (e.g. extracted frames/canvas exports).
 */
export async function buildStreamingSavePayload(
  project: PresentationProject
): Promise<BuiltStreamingSaveRequest> {
  const layout = ProjectSerializer.planArchiveLayout(project);
  const includedImages = new Map(layout.imagePaths);
  const includedVideos = new Map(layout.videoPaths);
  const assets: StreamingSaveAssetEntry[] = [];

  for (const item of layout.items) {
    const asset = item.asset;
    if (asset.source?.kind === 'file') {
      assets.push({
        archivePath: item.archivePath,
        fileName: asset.name,
        source: 'file',
        path: asset.source.path,
      });
    } else if (asset.source?.kind === 'archive') {
      assets.push({
        archivePath: item.archivePath,
        fileName: asset.name,
        source: 'archive',
        projectToken: asset.source.projectToken,
        archiveEntry: asset.source.archiveEntry,
      });
    } else {
      const bytes = await ProjectSerializer.readAssetBytes(asset);
      if (bytes && bytes.byteLength > 0) {
        assets.push({
          archivePath: item.archivePath,
          fileName: asset.name,
          source: 'bytes',
          bytes,
        });
      } else if (item.kind === 'image') {
        includedImages.delete(asset.id);
      } else {
        const key = asset.id || `${asset.kind}::${asset.name}::${asset.fileSize}`;
        includedVideos.delete(key);
      }
    }
  }

  const manifest = ProjectSerializer.buildManifestObject(project, undefined, {
    images: includedImages,
    videos: includedVideos,
  });

  return {
    manifestJson: JSON.stringify(manifest, null, 2),
    assets,
    layout: {
      items: layout.items.filter(
        (item) =>
          (item.kind === 'image' && includedImages.has(item.asset.id)) ||
          (item.kind === 'video' &&
            includedVideos.has(item.asset.id || `${item.asset.kind}::${item.asset.name}::${item.asset.fileSize}`))
      ),
      imagePaths: includedImages,
      videoPaths: includedVideos,
    },
  };
}

/**
 * Rebinds all packed assets on `project` to the newly saved archive token so subsequent saves
 * stream directly out of the latest `.mpres` bundle even if original disk files move later.
 */
export function rebindSavedAssetSources(
  project: PresentationProject,
  newProjectToken: string,
  layout: PlannedArchiveLayout
): void {
  if (!newProjectToken) return;
  const dedupKey = (asset: MediaAsset): string =>
    asset.id || `${asset.kind}::${asset.name}::${asset.fileSize}`;

  for (const slide of project.slides) {
    const imgPath = layout.imagePaths.get(slide.imageAsset.id);
    if (imgPath) {
      slide.imageAsset.source = {
        kind: 'archive',
        projectToken: newProjectToken,
        archiveEntry: imgPath,
      };
    }

    const transVid = slide.transitionToNext?.videoAsset;
    if (transVid) {
      const vidPath = layout.videoPaths.get(dedupKey(transVid));
      if (vidPath) {
        transVid.source = {
          kind: 'archive',
          projectToken: newProjectToken,
          archiveEntry: vidPath,
        };
      }
    }

    const loopVid = slide.idleLoopAsset;
    if (loopVid) {
      const loopPath = layout.videoPaths.get(dedupKey(loopVid));
      if (loopPath) {
        loopVid.source = {
          kind: 'archive',
          projectToken: newProjectToken,
          archiveEntry: loopPath,
        };
      }
    }
  }
}

class DesktopProjectBackend implements ProjectFileBackend {
  isDesktop(): boolean {
    return typeof window !== 'undefined' && Boolean(window.desktopAPI?.saveProjectStreamed);
  }

  async openProject(): Promise<OpenedProjectDescriptor | null> {
    if (!window.desktopAPI?.openProjectStreamedDialog) return null;
    return await window.desktopAPI.openProjectStreamedDialog();
  }

  async saveProject(
    project: PresentationProject,
    options: {
      forceSaveAs: boolean;
      currentFilePath: string | null;
      activeProjectToken: string | null;
    }
  ): Promise<StreamingSaveResult | null> {
    if (!window.desktopAPI?.saveProjectStreamed) return null;
    const built = await buildStreamingSavePayload(project);
    const hasDirectPath =
      !options.forceSaveAs &&
      Boolean(options.currentFilePath) &&
      options.currentFilePath!.toLowerCase().endsWith('.mpres');
    const suggestedPath = options.currentFilePath
      ? options.currentFilePath.replace(/(\.mpres\.json|\.json)$/i, '.mpres')
      : `${project.title || 'presentation'}.mpres`;

    const res = await window.desktopAPI.saveProjectStreamed({
      mode: hasDirectPath ? 'direct' : 'dialog',
      filePath: hasDirectPath ? options.currentFilePath! : undefined,
      currentFilePath: suggestedPath,
      defaultFileName: suggestedPath,
      activeProjectToken: options.activeProjectToken,
      manifestJson: built.manifestJson,
      assets: built.assets,
    });
    if (res && res.ok) {
      rebindSavedAssetSources(project, res.projectToken, built.layout);
    }
    return res;
  }

  async closeToken(projectToken: string): Promise<void> {
    if (projectToken && window.desktopAPI?.closeProjectToken) {
      await window.desktopAPI.closeProjectToken(projectToken);
    }
  }
}

class BrowserProjectBackend implements ProjectFileBackend {
  isDesktop(): boolean {
    return false;
  }

  async openProject(): Promise<OpenedProjectDescriptor | null> {
    return null;
  }

  async saveProject(project: PresentationProject): Promise<StreamingSaveResult | null> {
    await ProjectSerializer.exportProjectBundle(project);
    return null;
  }

  async closeToken(): Promise<void> {
    // No-op in browser mode
  }
}

export function getProjectFileBackend(): ProjectFileBackend {
  if (typeof window !== 'undefined' && window.desktopAPI?.saveProjectStreamed) {
    return desktopBackendInstance;
  }
  return browserBackendInstance;
}

const desktopBackendInstance = new DesktopProjectBackend();
const browserBackendInstance = new BrowserProjectBackend();
export const projectFiles: ProjectFileBackend = desktopBackendInstance;
