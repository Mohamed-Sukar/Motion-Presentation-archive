import {
  AspectRatioOption,
  FallbackTransitionStyle,
  MediaAsset,
  PresentationProject,
  PresentationSettings,
  SegmentEasing,
  SlideNode,
  TransitionSpec,
} from './types';
import { t } from '../i18n';

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Infers the closest supported stage AspectRatioOption for a given media resolution.
 */
export function inferAspectRatioFromDimensions(
  width: number,
  height: number
): AspectRatioOption {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '16:9';
  }
  const ratio = width / height;
  const candidates: Array<{ option: AspectRatioOption; value: number }> = [
    { option: '16:9', value: 16 / 9 },
    { option: '16:10', value: 16 / 10 },
    { option: '4:3', value: 4 / 3 },
    { option: '9:16', value: 9 / 16 },
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(Math.log(ratio / best.value));
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(Math.log(ratio / candidates[i].value));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidates[i];
    }
  }
  return best.option;
}

export function createDefaultSettings(): PresentationSettings {
  return {
    aspectRatio: '16:9',
    fitMode: 'contain',
    stageBackground: '#05070B',
    globalPlaybackSpeed: 1.0,
    interruptBehavior: 'skip',
    backwardBehavior: 'reverse-step',
    defaultFallbackStyle: 'crossfade',
    defaultFallbackDurationMs: 650,
    masterMuted: false,
    masterVolume: 0.9,
    loopPresentation: false,
    showPresenterHud: 'minimal',
    autoHideCursor: true,
    preloadStrategy: 'adjacent',
  };
}

export function evaluateEasing(progress: number, easing: SegmentEasing = 'linear'): number {
  const p = Math.max(0, Math.min(1, progress));
  switch (easing) {
    case 'ease-in':
      return p * p;
    case 'ease-out':
      return p * (2 - p);
    case 'ease-in-out':
      return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    case 'hold':
    case 'step':
      return p >= 1 ? 1 : 0;
    case 'linear':
    default:
      return p;
  }
}

export function createDefaultTransition(
  fallbackStyle: FallbackTransitionStyle = 'crossfade',
  videoAsset: MediaAsset | null = null,
  fallbackDurationMs = 650,
  easing: SegmentEasing = 'linear'
): TransitionSpec {
  return {
    id: generateId('tr'),
    videoAsset,
    fallbackStyle,
    fallbackDurationMs,
    playbackSpeed: 1.0,
    muted: false,
    easing,
  };
}

export function createSlideNode(
  imageAsset: MediaAsset,
  index: number,
  fallbackStyle: FallbackTransitionStyle = 'crossfade',
  fallbackDurationMs = 650
): SlideNode {
  const cleanTitle = imageAsset.name.replace(/\.[^/.]+$/, '');
  return {
    id: generateId('slide'),
    title: cleanTitle || t('slide.defaultTitle', { index: index + 1 }),
    notes: '',
    imageAsset,
    idleLoopAsset: null,
    holdDurationSec: null,
    transitionToNext: createDefaultTransition(fallbackStyle, null, fallbackDurationMs),
  };
}

export function createEmptyProject(title = t('app.titleDefault')): PresentationProject {
  const now = new Date().toISOString();
  return {
    id: generateId('proj'),
    title,
    createdAt: now,
    updatedAt: now,
    slides: [],
    settings: createDefaultSettings(),
  };
}
