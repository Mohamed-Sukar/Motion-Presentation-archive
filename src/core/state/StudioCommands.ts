import {
  MediaAsset,
  PresentationSettings,
  ProjectAiSourceMeta,
  SlideNode,
  TransitionSpec,
} from '../domain/types';
import { AppLanguage } from '../i18n';
import { ApplyCuePointsOptions, SelectionTarget } from './types';

/**
 * Strongly-typed synchronous commands dispatched against PresentationStore.
 */
export type StudioCommand =
  | { type: 'project/setTitle'; title: string }
  | { type: 'project/updateSettings'; patch: Partial<PresentationSettings> }
  | { type: 'project/setAiSourceMeta'; meta: ProjectAiSourceMeta | undefined }
  | { type: 'project/clearAll' }
  | {
      type: 'project/syncDefaultTitlesForLanguage';
      prevLang: AppLanguage;
      nextLang: AppLanguage;
    }
  | { type: 'slide/add'; imageAsset: MediaAsset; insertAfterIndex?: number }
  | {
      type: 'slide/appendBatch';
      newSlides: SlideNode[];
      unpairedVideos?: MediaAsset[];
    }
  | {
      type: 'slide/updateDetails';
      slideId: string;
      patch: Partial<Pick<SlideNode, 'title' | 'notes' | 'holdDurationSec'>>;
    }
  | { type: 'slide/replaceImage'; slideId: string; newImageAsset: MediaAsset }
  | {
      type: 'slide/setIdleLoopVideo';
      slideId: string;
      videoAsset: MediaAsset | null;
    }
  | { type: 'slide/move'; slideId: string; direction: 'up' | 'down' }
  | { type: 'slide/moveToIndex'; slideId: string; targetIndex: number }
  | { type: 'slide/duplicate'; slideId?: string }
  | {
      type: 'slide/delete';
      slideId: string;
      transitionChoice?: 'above' | 'below' | 'bridge';
    }
  | {
      type: 'deck/deleteMultiple';
      slideIds: string[];
      transitionSlideIds: string[];
      transitionChoice?: 'above' | 'below' | 'bridge';
    }
  | {
      type: 'transition/setVideo';
      slideId: string;
      videoAsset: MediaAsset | null;
    }
  | {
      type: 'transition/updateRange';
      slideId: string;
      startTimeSec: number;
      endTimeSec: number;
    }
  | {
      type: 'transition/updateSpec';
      slideId: string;
      patch: Partial<Omit<TransitionSpec, 'id' | 'videoAsset'>>;
    }
  | { type: 'transition/applySpecToAll'; sourceSlideId: string }
  | { type: 'selection/set'; target: SelectionTarget }
  | { type: 'selection/toggleSlide'; slideId: string }
  | { type: 'selection/toggleTransition'; slideId: string }
  | { type: 'selection/selectRange'; targetSlideId: string }
  | { type: 'selection/selectAll' }
  | { type: 'selection/clearMulti' }
  | { type: 'selection/setPreviewIndex'; index: number }
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'history/clear' };

/**
 * Strongly-typed asynchronous workflow commands dispatched via dispatchAsync().
 */
export type StudioAsyncCommand =
  | {
      type: 'reel/applyCuePoints';
      videoAsset: MediaAsset;
      cueTimesSec: number[];
      options?: boolean | ApplyCuePointsOptions;
    }
  | {
      type: 'reel/relinkVideo';
      target: string | string[];
      newVideoAsset: MediaAsset;
      options?: {
        reextractMissingImages?: boolean;
        onProgress?: (done: number, total: number) => void;
        signal?: AbortSignal;
      };
    }
  | { type: 'transition/splitAtTime'; slideId: string; splitTimeSec?: number }
  | { type: 'transition/generateVideo'; slideId: string }
  | {
      type: 'transition/extractNextSlide';
      slideId: string;
      atTimeSec?: number;
    };

export type StudioAnyCommand = StudioCommand | StudioAsyncCommand;

export interface StudioCommandResultMap {
  'project/setTitle': void;
  'project/updateSettings': void;
  'project/setAiSourceMeta': void;
  'project/clearAll': void;
  'project/syncDefaultTitlesForLanguage': void;
  'slide/add': SlideNode;
  'slide/appendBatch': void;
  'slide/updateDetails': void;
  'slide/replaceImage': void;
  'slide/setIdleLoopVideo': void;
  'slide/move': void;
  'slide/moveToIndex': void;
  'slide/duplicate': SlideNode | null;
  'slide/delete': void;
  'deck/deleteMultiple': {
    deletedSlidesCount: number;
    deletedTransitionsCount: number;
  };
  'transition/setVideo': void;
  'transition/updateRange': boolean;
  'transition/updateSpec': void;
  'transition/applySpecToAll': number;
  'selection/set': void;
  'selection/toggleSlide': void;
  'selection/toggleTransition': void;
  'selection/selectRange': void;
  'selection/selectAll': void;
  'selection/clearMulti': void;
  'selection/setPreviewIndex': void;
  'history/undo': boolean;
  'history/redo': boolean;
  'history/clear': void;
}

export interface StudioAsyncCommandResultMap {
  'reel/applyCuePoints': SlideNode[];
  'reel/relinkVideo': number;
  'transition/splitAtTime': SlideNode | null;
  'transition/generateVideo': boolean;
  'transition/extractNextSlide': SlideNode | null;
}

export type StudioCommandResult<C extends StudioCommand> =
  StudioCommandResultMap[C['type']];

export type StudioAsyncCommandResult<C extends StudioAsyncCommand> =
  StudioAsyncCommandResultMap[C['type']];

export interface ExecutedCommandEvent {
  command: StudioAnyCommand;
  timestamp: number;
}

export type StudioCommandListener = (event: ExecutedCommandEvent) => void;
