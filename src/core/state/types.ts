import { MediaAsset, ReelMetadata, SegmentEasing, SlideNode } from '../domain/types';

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

export interface StoreNotification {
  message: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

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

export interface StudioHistorySnapshot {
  title: string;
  slides: SlideNode[];
  reelMetadata: ReelMetadata | undefined;
  activePreviewIndex: number;
  selection: SelectionTarget;
  selectedSlideIds: string[];
  selectedTransitionSlideIds: string[];
  commandType?: string;
}

export interface HistorySummary {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  lastUndoCommand?: string;
  lastRedoCommand?: string;
}
