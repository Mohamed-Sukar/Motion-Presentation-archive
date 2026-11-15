import { createEmptyProject } from '../domain/defaults';
import {
  MediaAsset,
  PresentationProject,
  PresentationSettings,
  ProjectAiSourceMeta,
  SlideNode,
  TransitionSpec,
} from '../domain/types';
import { AppLanguage } from '../i18n';
import {
  OpenedProjectDescriptor,
  projectFiles,
} from '../services/ProjectFileService';
import {
  DeserializedProjectData,
  LoadedProjectBundle,
  ProjectSerializer,
} from '../services/ProjectSerializer';
import {
  addSlideFromImageInDeck,
  appendBatchSlidesInDeck,
  applyTransitionSpecToAllInDeck,
  clearAllSlidesInDeck,
  computeProjectDiagnostics,
  deleteMultipleItemsInDeck,
  deleteSlideInDeck,
  duplicateSlideInDeck,
  moveSlideInDeck,
  moveSlideToIndexInDeck,
  replaceSlideImageInDeck,
  setProjectAiSourceMetaInDeck,
  setProjectTitleInDeck,
  setSlideIdleLoopVideoInDeck,
  setSlideTransitionVideoInDeck,
  StoreSliceContext,
  syncDefaultTitlesInDeck,
  updateSettingsInDeck,
  updateSlideDetailsInDeck,
  updateTransitionRangeInDeck,
  updateTransitionSpecInDeck,
} from './slices/DeckSlice';
import { HistorySlice } from './slices/HistorySlice';
import {
  hydrateProjectAssetsFromCacheInStore,
  loadOpenedDesktopProjectIntoStore,
  loadProjectBundleIntoStore,
  loadProjectFromManifestIntoStore,
} from './slices/ProjectLoaderSlice';
import {
  applyVideoCuePointsWorkflowInDeck,
  extractNextSlideFromTransitionEndInDeck,
  findMissingVideoAssets,
  generateTransitionVideoForSlideInDeck,
  ReelSliceContext,
  relinkReelVideoInDeck,
  resolveReelContextForSlide,
  splitTransitionAtTimeInDeck,
} from './slices/ReelWorkflowSlice';
import { SelectionSlice } from './slices/SelectionSlice';
import {
  StudioAnyCommand,
  StudioAsyncCommand,
  StudioAsyncCommandResult,
  StudioCommand,
  StudioCommandListener,
  StudioCommandResult,
} from './StudioCommands';
import {
  ApplyCuePointsOptions,
  HistorySummary,
  MissingVideoAssetGroup,
  ProjectDiagnostics,
  ReelContext,
  SelectionTarget,
  StoreChangeType,
  StoreListener,
  StoreNotification,
} from './types';

export type {
  ApplyCuePointsOptions,
  HistorySummary,
  MissingVideoAssetGroup,
  ProjectDiagnostics,
  ReelContext,
  SelectionTarget,
  StoreChangeType,
  StoreListener,
  StoreNotification,
};
export * from './StudioCommands';

export class PresentationStore {
  private project: PresentationProject;
  private readonly historySlice = new HistorySlice();
  private readonly selectionSlice = new SelectionSlice();
  private listeners = new Set<StoreListener>();
  private commandListeners = new Set<StudioCommandListener>();
  private notification: StoreNotification | null = null;
  private isBatching = false;
  private currentProjectToken: string | null = null;

  constructor() {
    this.project = createEmptyProject();
    const savedSettings = ProjectSerializer.loadSettingsFromLocal();
    if (savedSettings) {
      this.project.settings = { ...this.project.settings, ...savedSettings };
    }
  }

  private get sliceCtx(): ReelSliceContext {
    return {
      getProject: () => this.project,
      history: this.historySlice,
      selection: this.selectionSlice,
      emit: (changeType?: StoreChangeType) => this.emit(changeType),
      notify: (message, kind, autoClearMs) => this.notify(message, kind, autoClearMs),
      setProjectToken: (token) => this.setProjectToken(token),
      batchUpdate: (fn) => this.batchUpdate(fn),
    };
  }

  private get baseCtx(): StoreSliceContext {
    return this.sliceCtx;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeCommand(listener: StudioCommandListener): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  private emit(changeType: StoreChangeType = 'structural'): void {
    if (this.isBatching) return;
    this.project.updatedAt = new Date().toISOString();
    for (const listener of this.listeners) {
      listener(changeType);
    }
  }

  private emitCommand(command: StudioAnyCommand): void {
    if (this.commandListeners.size === 0) return;
    const event = { command, timestamp: Date.now() };
    for (const listener of this.commandListeners) {
      listener(event);
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

  /**
   * Executes a strongly-typed synchronous StudioCommand against the store slices.
   */
  dispatch<C extends StudioCommand>(command: C): StudioCommandResult<C> {
    this.emitCommand(command);

    switch (command.type) {
      case 'project/setTitle':
        setProjectTitleInDeck(this.baseCtx, command.title);
        return undefined as StudioCommandResult<C>;
      case 'project/updateSettings':
        updateSettingsInDeck(this.baseCtx, command.patch);
        return undefined as StudioCommandResult<C>;
      case 'project/setAiSourceMeta':
        setProjectAiSourceMetaInDeck(this.baseCtx, command.meta);
        return undefined as StudioCommandResult<C>;
      case 'project/clearAll':
        clearAllSlidesInDeck(this.baseCtx);
        return undefined as StudioCommandResult<C>;
      case 'project/syncDefaultTitlesForLanguage':
        syncDefaultTitlesInDeck(this.baseCtx, command.prevLang, command.nextLang);
        return undefined as StudioCommandResult<C>;

      case 'slide/add':
        return addSlideFromImageInDeck(
          this.baseCtx,
          command.imageAsset,
          command.insertAfterIndex
        ) as StudioCommandResult<C>;
      case 'slide/appendBatch':
        appendBatchSlidesInDeck(this.baseCtx, command.newSlides, command.unpairedVideos);
        return undefined as StudioCommandResult<C>;
      case 'slide/updateDetails':
        updateSlideDetailsInDeck(this.baseCtx, command.slideId, command.patch);
        return undefined as StudioCommandResult<C>;
      case 'slide/replaceImage':
        replaceSlideImageInDeck(this.baseCtx, command.slideId, command.newImageAsset);
        return undefined as StudioCommandResult<C>;
      case 'slide/setIdleLoopVideo':
        setSlideIdleLoopVideoInDeck(this.baseCtx, command.slideId, command.videoAsset);
        return undefined as StudioCommandResult<C>;
      case 'slide/move':
        moveSlideInDeck(this.baseCtx, command.slideId, command.direction);
        return undefined as StudioCommandResult<C>;
      case 'slide/moveToIndex':
        moveSlideToIndexInDeck(this.baseCtx, command.slideId, command.targetIndex);
        return undefined as StudioCommandResult<C>;
      case 'slide/duplicate':
        return duplicateSlideInDeck(this.baseCtx, command.slideId) as StudioCommandResult<C>;
      case 'slide/delete':
        deleteSlideInDeck(this.baseCtx, command.slideId, command.transitionChoice);
        return undefined as StudioCommandResult<C>;
      case 'deck/deleteMultiple':
        return deleteMultipleItemsInDeck(
          this.baseCtx,
          command.slideIds,
          command.transitionSlideIds,
          command.transitionChoice
        ) as StudioCommandResult<C>;

      case 'transition/setVideo':
        setSlideTransitionVideoInDeck(this.baseCtx, command.slideId, command.videoAsset);
        return undefined as StudioCommandResult<C>;
      case 'transition/updateRange':
        return updateTransitionRangeInDeck(
          this.baseCtx,
          command.slideId,
          command.startTimeSec,
          command.endTimeSec
        ) as StudioCommandResult<C>;
      case 'transition/updateSpec':
        updateTransitionSpecInDeck(this.baseCtx, command.slideId, command.patch);
        return undefined as StudioCommandResult<C>;
      case 'transition/applySpecToAll':
        return applyTransitionSpecToAllInDeck(
          this.baseCtx,
          command.sourceSlideId
        ) as StudioCommandResult<C>;

      case 'selection/set':
        this.selectionSlice.setSelection(this.project.slides, command.target);
        this.emit('selection');
        return undefined as StudioCommandResult<C>;
      case 'selection/toggleSlide':
        if (this.selectionSlice.toggleSlideSelection(this.project.slides, command.slideId)) {
          this.emit('selection');
        }
        return undefined as StudioCommandResult<C>;
      case 'selection/toggleTransition':
        if (this.selectionSlice.toggleTransitionSelection(this.project.slides, command.slideId)) {
          this.emit('selection');
        }
        return undefined as StudioCommandResult<C>;
      case 'selection/selectRange':
        if (this.selectionSlice.selectSlideRange(this.project.slides, command.targetSlideId)) {
          this.emit('selection');
        }
        return undefined as StudioCommandResult<C>;
      case 'selection/selectAll':
        if (this.selectionSlice.selectAllSlides(this.project.slides)) {
          this.emit('selection');
        }
        return undefined as StudioCommandResult<C>;
      case 'selection/clearMulti':
        this.selectionSlice.clearMultiSelection();
        this.emit('selection');
        return undefined as StudioCommandResult<C>;
      case 'selection/setPreviewIndex':
        this.selectionSlice.setActivePreviewIndex(this.project.slides, command.index);
        this.emit('selection');
        return undefined as StudioCommandResult<C>;

      case 'history/undo': {
        const applied = this.historySlice.undo(this.project, this.selectionSlice);
        if (applied) this.emit('structural');
        return applied as StudioCommandResult<C>;
      }
      case 'history/redo': {
        const applied = this.historySlice.redo(this.project, this.selectionSlice);
        if (applied) this.emit('structural');
        return applied as StudioCommandResult<C>;
      }
      case 'history/clear':
        this.historySlice.clearHistory(this.project.slides);
        return undefined as StudioCommandResult<C>;
    }
  }

  /**
   * Executes a strongly-typed asynchronous workflow command (cue slicing, relinking, frame extraction).
   */
  async dispatchAsync<C extends StudioAsyncCommand>(
    command: C
  ): Promise<StudioAsyncCommandResult<C>> {
    this.emitCommand(command);

    switch (command.type) {
      case 'reel/applyCuePoints':
        return (await applyVideoCuePointsWorkflowInDeck(
          this.sliceCtx,
          command.videoAsset,
          command.cueTimesSec,
          command.options
        )) as StudioAsyncCommandResult<C>;
      case 'reel/relinkVideo':
        return (await relinkReelVideoInDeck(
          this.sliceCtx,
          command.target,
          command.newVideoAsset,
          command.options
        )) as StudioAsyncCommandResult<C>;
      case 'transition/splitAtTime':
        return (await splitTransitionAtTimeInDeck(
          this.sliceCtx,
          command.slideId,
          command.splitTimeSec
        )) as StudioAsyncCommandResult<C>;
      case 'transition/generateVideo':
        return (await generateTransitionVideoForSlideInDeck(
          this.baseCtx,
          command.slideId
        )) as StudioAsyncCommandResult<C>;
      case 'transition/extractNextSlide':
        return (await extractNextSlideFromTransitionEndInDeck(
          this.baseCtx,
          command.slideId,
          command.atTimeSec
        )) as StudioAsyncCommandResult<C>;
    }
  }

  // ---- Project & Notification Getters ----

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
    return this.selectionSlice.getSelection();
  }

  getActivePreviewIndex(): number {
    return this.selectionSlice.getActivePreviewIndex();
  }

  getNotification(): StoreNotification | null {
    return this.notification;
  }

  getProjectToken(): string | null {
    return this.currentProjectToken;
  }

  setProjectToken(token: string | null): void {
    const prev = this.currentProjectToken;
    const next = token || null;
    this.currentProjectToken = next;
    if (prev && prev !== next) {
      void projectFiles.closeToken(prev);
    }
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

  // ---- History Slice API ----

  canUndo(): boolean {
    return this.historySlice.canUndo();
  }

  canRedo(): boolean {
    return this.historySlice.canRedo();
  }

  getHistorySummary(): HistorySummary {
    return this.historySlice.getSummary();
  }

  undo(): boolean {
    return this.dispatch({ type: 'history/undo' });
  }

  redo(): boolean {
    return this.dispatch({ type: 'history/redo' });
  }

  clearHistory(): void {
    this.dispatch({ type: 'history/clear' });
  }

  // ---- Project Title & Localization ----

  setProjectTitle(title: string): void {
    this.dispatch({ type: 'project/setTitle', title });
  }

  syncDefaultTitlesForLanguage(prevLang: AppLanguage, nextLang: AppLanguage): void {
    this.dispatch({ type: 'project/syncDefaultTitlesForLanguage', prevLang, nextLang });
  }

  // ---- Selection Slice API ----

  getSelectedSlideIds(): string[] {
    return this.selectionSlice.getSelectedSlideIds(this.project.slides);
  }

  getSelectedTransitionSlideIds(): string[] {
    return this.selectionSlice.getSelectedTransitionSlideIds(this.project.slides);
  }

  isSlideSelected(slideId: string): boolean {
    return this.selectionSlice.isSlideSelected(slideId);
  }

  isTransitionSelected(slideId: string): boolean {
    return this.selectionSlice.isTransitionSelected(slideId);
  }

  getMultiSelectionSummary(): {
    slideIds: string[];
    transitionSlideIds: string[];
    totalCount: number;
  } {
    return this.selectionSlice.getMultiSelectionSummary(this.project.slides);
  }

  setSelection(target: SelectionTarget): void {
    this.dispatch({ type: 'selection/set', target });
  }

  toggleSlideSelection(slideId: string): void {
    this.dispatch({ type: 'selection/toggleSlide', slideId });
  }

  toggleTransitionSelection(slideId: string): void {
    this.dispatch({ type: 'selection/toggleTransition', slideId });
  }

  selectSlideRange(targetSlideId: string): void {
    this.dispatch({ type: 'selection/selectRange', targetSlideId });
  }

  selectAllSlides(): void {
    this.dispatch({ type: 'selection/selectAll' });
  }

  clearMultiSelection(): void {
    this.dispatch({ type: 'selection/clearMulti' });
  }

  setActivePreviewIndex(index: number): void {
    this.dispatch({ type: 'selection/setPreviewIndex', index });
  }

  // ---- Deck & Slide Mutation API ----

  addSlideFromImage(imageAsset: MediaAsset, insertAfterIndex?: number): SlideNode {
    return this.dispatch({ type: 'slide/add', imageAsset, insertAfterIndex });
  }

  appendBatchSlides(newSlides: SlideNode[], unpairedVideos: MediaAsset[] = []): void {
    this.dispatch({ type: 'slide/appendBatch', newSlides, unpairedVideos });
  }

  replaceSlideImage(slideId: string, newImageAsset: MediaAsset): void {
    this.dispatch({ type: 'slide/replaceImage', slideId, newImageAsset });
  }

  setProjectAiSourceMeta(meta: ProjectAiSourceMeta | undefined): void {
    this.dispatch({ type: 'project/setAiSourceMeta', meta });
  }

  getProjectAiSourceMeta(): ProjectAiSourceMeta | undefined {
    return this.project.aiSourceMeta;
  }

  setSlideIdleLoopVideo(slideId: string, videoAsset: MediaAsset | null): void {
    this.dispatch({ type: 'slide/setIdleLoopVideo', slideId, videoAsset });
  }

  setSlideTransitionVideo(slideId: string, videoAsset: MediaAsset | null): void {
    this.dispatch({ type: 'transition/setVideo', slideId, videoAsset });
  }

  updateTransitionRange(slideId: string, startTimeSec: number, endTimeSec: number): boolean {
    return this.dispatch({
      type: 'transition/updateRange',
      slideId,
      startTimeSec,
      endTimeSec,
    });
  }

  updateSlideDetails(
    slideId: string,
    patch: Partial<Pick<SlideNode, 'title' | 'notes' | 'holdDurationSec'>>
  ): void {
    this.dispatch({ type: 'slide/updateDetails', slideId, patch });
  }

  updateTransitionSpec(
    slideId: string,
    patch: Partial<Omit<TransitionSpec, 'id' | 'videoAsset'>>
  ): void {
    this.dispatch({ type: 'transition/updateSpec', slideId, patch });
  }

  moveSlide(slideId: string, direction: 'up' | 'down'): void {
    this.dispatch({ type: 'slide/move', slideId, direction });
  }

  moveSlideToIndex(slideId: string, targetIndex: number): void {
    this.dispatch({ type: 'slide/moveToIndex', slideId, targetIndex });
  }

  deleteSlide(
    slideId: string,
    transitionChoice?: 'above' | 'below' | 'bridge'
  ): void {
    this.dispatch({ type: 'slide/delete', slideId, transitionChoice });
  }

  deleteMultipleItems(
    slideIds: string[],
    transitionSlideIds: string[],
    transitionChoice: 'above' | 'below' | 'bridge' = 'below'
  ): { deletedSlidesCount: number; deletedTransitionsCount: number } {
    return this.dispatch({
      type: 'deck/deleteMultiple',
      slideIds,
      transitionSlideIds,
      transitionChoice,
    });
  }

  duplicateSlide(slideId?: string): SlideNode | null {
    return this.dispatch({ type: 'slide/duplicate', slideId });
  }

  applyTransitionSpecToAllSlides(sourceSlideId: string): number {
    return this.dispatch({ type: 'transition/applySpecToAll', sourceSlideId });
  }

  getProjectDiagnostics(): ProjectDiagnostics {
    return computeProjectDiagnostics(this.project);
  }

  clearAllSlides(): void {
    this.dispatch({ type: 'project/clearAll' });
  }

  updateSettings(patch: Partial<PresentationSettings>): void {
    this.dispatch({ type: 'project/updateSettings', patch });
  }

  // ---- Reel & Cue Workflow Slice API ----

  async applyVideoCuePointsWorkflow(
    videoAsset: MediaAsset,
    cueTimesSec: number[],
    optionsOrAppend: boolean | ApplyCuePointsOptions = false
  ): Promise<SlideNode[]> {
    return this.dispatchAsync({
      type: 'reel/applyCuePoints',
      videoAsset,
      cueTimesSec,
      options: optionsOrAppend,
    });
  }

  getReelContextForSlide(slideId?: string): ReelContext | null {
    return resolveReelContextForSlide(this.baseCtx, slideId);
  }

  getMissingVideoAssets(): MissingVideoAssetGroup[] {
    return findMissingVideoAssets(this.project.slides);
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
    return this.dispatchAsync({
      type: 'reel/relinkVideo',
      target,
      newVideoAsset,
      options,
    });
  }

  async splitTransitionAtTime(slideId: string, splitTimeSec?: number): Promise<SlideNode | null> {
    return this.dispatchAsync({
      type: 'transition/splitAtTime',
      slideId,
      splitTimeSec,
    });
  }

  async generateTransitionVideoForSlide(slideId: string): Promise<boolean> {
    return this.dispatchAsync({
      type: 'transition/generateVideo',
      slideId,
    });
  }

  async extractNextSlideFromTransitionEnd(
    slideId: string,
    atTimeSec?: number
  ): Promise<SlideNode | null> {
    return this.dispatchAsync({
      type: 'transition/extractNextSlide',
      slideId,
      atTimeSec,
    });
  }

  // ---- Project Loader Slice API ----

  async loadOpenedDesktopProject(opened: OpenedProjectDescriptor): Promise<DeserializedProjectData> {
    return loadOpenedDesktopProjectIntoStore(this.sliceCtx, opened);
  }

  async loadProjectBundle(bundle: LoadedProjectBundle): Promise<void> {
    return loadProjectBundleIntoStore(this.sliceCtx, bundle);
  }

  loadProjectFromManifest(
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
    loadProjectFromManifestIntoStore(this.sliceCtx, data, options);
  }

  async hydrateProjectAssetsFromCache(): Promise<number> {
    return hydrateProjectAssetsFromCacheInStore(this.sliceCtx);
  }
}
