import { PresentationProject, SlideNode } from '../../domain/types';
import { HistorySummary, StudioHistorySnapshot } from '../types';
import { SelectionSlice } from './SelectionSlice';

/**
 * Manages undo/redo snapshots, command labels, and safe blob URL lifecycle across history.
 */
export class HistorySlice {
  private undoStack: StudioHistorySnapshot[] = [];
  private redoStack: StudioHistorySnapshot[] = [];
  private readonly maxHistoryDepth = 40;
  private isRecordingSuppressed = false;
  private revokedBlobUrls = new Set<string>();

  setRecordingSuppressed(suppressed: boolean): void {
    this.isRecordingSuppressed = suppressed;
  }

  collectSlideBlobUrls(slides: SlideNode[], into: Set<string> = new Set()): Set<string> {
    for (const s of slides) {
      if (s.imageAsset?.objectUrl?.startsWith('blob:')) {
        into.add(s.imageAsset.objectUrl);
      }
      const vidUrl = s.transitionToNext?.videoAsset?.objectUrl;
      if (vidUrl?.startsWith('blob:')) {
        into.add(vidUrl);
      }
      const loopUrl = s.idleLoopAsset?.objectUrl;
      if (loopUrl?.startsWith('blob:')) {
        into.add(loopUrl);
      }
    }
    return into;
  }

  private collectSnapshotBlobUrls(snapshots: StudioHistorySnapshot[]): string[] {
    const urls = new Set<string>();
    for (const snap of snapshots) {
      this.collectSlideBlobUrls(snap.slides, urls);
    }
    return Array.from(urls);
  }

  private pruneHistoryBlobTracking(
    projectSlides: SlideNode[],
    droppedSnapshots: StudioHistorySnapshot[]
  ): void {
    if (droppedSnapshots.length > 0) {
      this.revokeUrlsIfUnused(projectSlides, this.collectSnapshotBlobUrls(droppedSnapshots));
    }
    const stillReferencedInHistory = new Set<string>();
    for (const snap of this.undoStack) {
      this.collectSlideBlobUrls(snap.slides, stillReferencedInHistory);
    }
    for (const snap of this.redoStack) {
      this.collectSlideBlobUrls(snap.slides, stillReferencedInHistory);
    }
    for (const tracked of Array.from(this.revokedBlobUrls)) {
      if (!stillReferencedInHistory.has(tracked)) {
        this.revokedBlobUrls.delete(tracked);
      }
    }
  }

  revokeUrlsIfUnused(
    liveSlides: SlideNode[],
    candidateUrls: Array<string | undefined | null>
  ): void {
    const live = this.collectSlideBlobUrls(liveSlides);
    for (const url of candidateUrls) {
      if (url && typeof url === 'string' && url.startsWith('blob:') && !live.has(url)) {
        safeRevokeUrl(url);
        this.revokedBlobUrls.add(url);
      }
    }
  }

  private reviveBlobUrlIfRevoked(
    asset:
      | {
          objectUrl?: string;
          thumbnailUrl?: string;
          lastFrameUrl?: string;
          rawFile?: File | Blob;
          file?: File | Blob;
        }
      | null
      | undefined,
    revivedByOldUrl?: Map<string, string>
  ): void {
    if (!asset?.objectUrl || !this.revokedBlobUrls.has(asset.objectUrl)) return;
    const oldUrl = asset.objectUrl;
    const cachedRevived = revivedByOldUrl?.get(oldUrl);
    if (cachedRevived) {
      asset.objectUrl = cachedRevived;
      if (asset.thumbnailUrl === oldUrl) asset.thumbnailUrl = cachedRevived;
      if (asset.lastFrameUrl === oldUrl) asset.lastFrameUrl = cachedRevived;
      return;
    }
    const backingBlob = asset.rawFile ?? asset.file;
    if (
      backingBlob &&
      typeof Blob !== 'undefined' &&
      backingBlob instanceof Blob &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const nextUrl = URL.createObjectURL(backingBlob);
      revivedByOldUrl?.set(oldUrl, nextUrl);
      asset.objectUrl = nextUrl;
      if (asset.thumbnailUrl === oldUrl) asset.thumbnailUrl = nextUrl;
      if (asset.lastFrameUrl === oldUrl) asset.lastFrameUrl = nextUrl;
    }
  }

  cloneSlideForHistory(s: SlideNode): SlideNode {
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

  createSnapshot(
    project: PresentationProject,
    selectionSlice: SelectionSlice,
    commandType?: string
  ): StudioHistorySnapshot {
    const selState = selectionSlice.exportSnapshotState();
    return {
      title: project.title,
      slides: project.slides.map((s) => this.cloneSlideForHistory(s)),
      reelMetadata: project.reelMetadata
        ? {
            ...project.reelMetadata,
            cueTimesSec: [...project.reelMetadata.cueTimesSec],
            segmentEasings: project.reelMetadata.segmentEasings
              ? [...project.reelMetadata.segmentEasings]
              : undefined,
          }
        : undefined,
      activePreviewIndex: selState.activePreviewIndex,
      selection: selState.selection,
      selectedSlideIds: selState.selectedSlideIds,
      selectedTransitionSlideIds: selState.selectedTransitionSlideIds,
      commandType,
    };
  }

  applySnapshot(
    project: PresentationProject,
    selectionSlice: SelectionSlice,
    snap: StudioHistorySnapshot
  ): void {
    const previousSlideUrls = Array.from(this.collectSlideBlobUrls(project.slides));
    const revivedByOldUrl = new Map<string, string>();
    project.title = snap.title;
    project.slides = snap.slides.map((s) => {
      const restored = this.cloneSlideForHistory(s);
      this.reviveBlobUrlIfRevoked(restored.imageAsset, revivedByOldUrl);
      this.reviveBlobUrlIfRevoked(restored.idleLoopAsset, revivedByOldUrl);
      this.reviveBlobUrlIfRevoked(restored.transitionToNext.videoAsset, revivedByOldUrl);
      return restored;
    });
    this.revokeUrlsIfUnused(project.slides, previousSlideUrls);
    project.reelMetadata = snap.reelMetadata
      ? {
          ...snap.reelMetadata,
          cueTimesSec: [...snap.reelMetadata.cueTimesSec],
          segmentEasings: snap.reelMetadata.segmentEasings
            ? [...snap.reelMetadata.segmentEasings]
            : undefined,
        }
      : undefined;
    selectionSlice.restoreSnapshotState(project.slides, snap);
  }

  recordSnapshot(
    project: PresentationProject,
    selectionSlice: SelectionSlice,
    commandType?: string
  ): void {
    if (this.isRecordingSuppressed) return;
    const dropped: StudioHistorySnapshot[] = [];
    this.undoStack.push(this.createSnapshot(project, selectionSlice, commandType));
    if (this.undoStack.length > this.maxHistoryDepth) {
      const shifted = this.undoStack.shift();
      if (shifted) dropped.push(shifted);
    }
    if (this.redoStack.length > 0) {
      dropped.push(...this.redoStack);
      this.redoStack = [];
    }
    if (dropped.length > 0) {
      this.pruneHistoryBlobTracking(project.slides, dropped);
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(project: PresentationProject, selectionSlice: SelectionSlice): boolean {
    if (!this.canUndo()) return false;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this.createSnapshot(project, selectionSlice, prev.commandType));
    this.applySnapshot(project, selectionSlice, prev);
    return true;
  }

  redo(project: PresentationProject, selectionSlice: SelectionSlice): boolean {
    if (!this.canRedo()) return false;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this.createSnapshot(project, selectionSlice, next.commandType));
    this.applySnapshot(project, selectionSlice, next);
    return true;
  }

  clearHistory(liveSlides: SlideNode[]): void {
    const dropped = [...this.undoStack, ...this.redoStack];
    this.undoStack = [];
    this.redoStack = [];
    if (dropped.length > 0) {
      this.revokeUrlsIfUnused(liveSlides, this.collectSnapshotBlobUrls(dropped));
    }
    this.revokedBlobUrls.clear();
  }

  getSummary(): HistorySummary {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      lastUndoCommand: this.undoStack[this.undoStack.length - 1]?.commandType,
      lastRedoCommand: this.redoStack[this.redoStack.length - 1]?.commandType,
    };
  }
}

export function safeRevokeUrl(url?: string): void {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}
