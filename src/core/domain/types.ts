export type MediaKind = 'image' | 'video';

export type FallbackTransitionStyle =
  | 'crossfade'
  | 'zoom-morph'
  | 'slide-push'
  | 'wipe-reveal'
  | 'iris-spotlight'
  | 'cut';

export type InterruptBehavior = 'lock' | 'skip' | 'fast-forward';

/**
 * Backward navigation behavior:
 * - 'reverse-step': Mirrors the previous slide's transition spec in true reverse (e.g. reverse zoom-morph or reverse slide-push)
 * - 'crossfade': Standard smooth crossfade back to the previous slide
 * - 'instant': Immediate jump back without animation
 */
export type BackwardBehavior = 'reverse-step' | 'crossfade' | 'instant';

export type AspectRatioOption = '16:9' | '16:10' | '4:3' | '9:16';

export type SegmentEasing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'hold'
  | 'step';

export type FitMode = 'contain' | 'cover';

export type HudVisibility = 'minimal' | 'progress-bar' | 'hidden';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  extension: string;
  objectUrl: string;
  fileSize: number;
  width: number;
  height: number;
  durationSec: number;
  thumbnailUrl: string;
  lastFrameUrl?: string;
  rawFile?: File | Blob;
  hasAudio?: boolean;
  suggestedAspectRatio?: AspectRatioOption;
  sourceVideoId?: string;
  sourceTimeSec?: number;
  source?:
    | { kind: 'file'; path: string }
    | { kind: 'archive'; projectToken: string; archiveEntry: string }
    | { kind: 'memory' };
}

export interface TransitionSpec {
  id: string;
  videoAsset: MediaAsset | null;
  fallbackStyle: FallbackTransitionStyle;
  fallbackDurationMs: number;
  playbackSpeed: number;
  muted: boolean;
  startTimeSec?: number;
  endTimeSec?: number;
  expectedVideoFileName?: string;
  expectedVideoDurationSec?: number;
  easing?: SegmentEasing;
}

export interface SlideSourceMeta {
  slideCodeFile?: string;
  idleLoopCodeFile?: string;
  transitionCodeFile?: string;
  renderCommand?: string;
  exitPointsSec?: number[];
}

export interface ProjectAiSourceMeta {
  skillName?: 'new-motion-presentation' | 'animate-slides' | 'create-new' | 'motion-reel';
  projectRootPath?: string;
  outputDirPath?: string;
  creativeDirection?: string;
}

export interface SlideNode {
  id: string;
  title: string;
  notes: string;
  imageAsset: MediaAsset;
  idleLoopAsset?: MediaAsset | null;
  expectedIdleLoopFileName?: string;
  sourceMeta?: SlideSourceMeta;
  holdDurationSec: number | null; // null = manual advance (click/space/arrow)
  transitionToNext: TransitionSpec;
}

export interface ReelMetadata {
  sourceVideoId: string;
  sourceVideoName: string;
  durationSec: number;
  cueTimesSec: number[];
  segmentEasings?: SegmentEasing[];
}

export type AppLanguage = 'ar' | 'en';

export interface PresentationSettings {
  aspectRatio: AspectRatioOption;
  fitMode: FitMode;
  stageBackground: string;
  globalPlaybackSpeed: number;
  interruptBehavior: InterruptBehavior;
  backwardBehavior: BackwardBehavior;
  defaultFallbackStyle: FallbackTransitionStyle;
  defaultFallbackDurationMs: number;
  masterMuted: boolean;
  masterVolume: number;
  loopPresentation: boolean;
  showPresenterHud: HudVisibility;
  autoHideCursor: boolean;
  preloadStrategy: 'all' | 'adjacent';
  language?: AppLanguage;
  navigatorWidth?: number;
  inspectorWidth?: number;
}

export interface PresentationProject {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  slides: SlideNode[];
  settings: PresentationSettings;
  reelMetadata?: ReelMetadata;
  aiSourceMeta?: ProjectAiSourceMeta;
}

export type PlaybackPhase =
  | 'IDLE'
  | 'PRELOADING'
  | 'HOLDING_SLIDE'
  | 'PLAYING_TRANSITION'
  | 'BLACKOUT'
  | 'WHITEOUT';

export interface EngineStatus {
  phase: PlaybackPhase;
  currentSlideIndex: number;
  targetSlideIndex: number | null;
  transitionProgress: number; // 0..1
  preloadProgress: number; // 0..1
  activeTransitionHasVideo: boolean;
  isFastForwarding: boolean;
  errorMessage: string | null;
  currentVideoTimeSec?: number | null;
  segmentRangeSec?: { start: number; end: number } | null;
}

export interface ValidationResult {
  valid: boolean;
  kind: MediaKind | null;
  extension: string;
  errorReason?: string;
}

export interface BatchImportReport {
  slidesAdded: number;
  transitionsMatched: number;
  rejectedFiles: Array<{ name: string; reason: string }>;
}
