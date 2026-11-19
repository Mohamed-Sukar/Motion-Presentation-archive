export type SequenceMode = 'docked' | 'floating' | 'collapsed';
export type InspectorMode = 'docked' | 'overlay' | 'sheet';
export type NavigatorMode = 'docked' | 'hidden';
export type FocusPaneTab = 'stage' | 'slides' | 'inspector';
export type ToolbarTier = 'full' | 'compact' | 'minimal';

export interface LayoutPlanInput {
  viewportWidth: number;
  viewportHeight: number;
  isRtl: boolean;
  requestedSequenceMode: SequenceMode;
  requestedNavigatorOpen: boolean;
  requestedInspectorOpen: boolean;
  floatingSequenceSize: { width: number; height: number };
  inspectorWidth: number;
  previousFocusMode?: boolean;
  previousToolbarTier?: ToolbarTier;
}

export interface LayoutPlan {
  focusMode: boolean;
  effectiveSequenceMode: SequenceMode;
  navigatorMode: NavigatorMode;
  inspectorMode: InspectorMode;
  dockedInspectorWidth: number;
  floatingSequenceSize: { width: number; height: number };
  toolbarTier: ToolbarTier;
  overflowToolbarButtons: string[];
  stageSafeWidth: number;
  stageSafeHeight: number;
}

export const FOCUS_MODE_ENTER_WIDTH = 740;
export const FOCUS_MODE_EXIT_WIDTH = 776;
export const DOCKED_NAV_MIN_WIDTH = 1040;
export const DOCKED_BOTH_MIN_WIDTH = 1120;
export const DOCKED_INSPECTOR_MIN_WIDTH = 860;
export const INSPECTOR_SHEET_MAX_HEIGHT = 600;
export const TOOLBAR_HEIGHT_PX = 44;
export const MIN_STAGE_SAFE_WIDTH = 280;
export const MIN_STAGE_SAFE_HEIGHT = 200;

export function resolveToolbarTier(
  viewportWidth: number,
  previousTier?: ToolbarTier
): { tier: ToolbarTier; overflowButtons: string[] } {
  let tier: ToolbarTier;
  if (previousTier === 'minimal') {
    tier = viewportWidth >= 780 ? (viewportWidth >= 1060 ? 'full' : 'compact') : 'minimal';
  } else if (previousTier === 'compact') {
    if (viewportWidth < 740) tier = 'minimal';
    else if (viewportWidth >= 1060) tier = 'full';
    else tier = 'compact';
  } else {
    if (viewportWidth < 740) tier = 'minimal';
    else if (viewportWidth < 1020) tier = 'compact';
    else tier = 'full';
  }

  const overflowButtons: string[] = [];
  if (tier === 'compact') {
    overflowButtons.push('btn-undo', 'btn-redo', 'btn-grid', 'btn-timeline');
  } else if (tier === 'minimal') {
    overflowButtons.push(
      'btn-undo',
      'btn-redo',
      'btn-grid',
      'btn-timeline',
      'btn-reel-workflow',
      'btn-demo',
      'btn-lang',
      'btn-theme'
    );
  }
  return { tier, overflowButtons };
}

/**
 * Pure, deterministic workspace layout planner with hysteresis deadbands
 * so resizing across breakpoints never causes rapid mode oscillation.
 */
export function computeLayoutPlan(input: LayoutPlanInput): LayoutPlan {
  const vw = Math.max(320, Math.round(input.viewportWidth || 1280));
  const vh = Math.max(240, Math.round(input.viewportHeight || 720));

  // Focus Mode hysteresis: enter < 740px, exit >= 776px
  const focusMode = input.previousFocusMode
    ? vw < FOCUS_MODE_EXIT_WIDTH
    : vw < FOCUS_MODE_ENTER_WIDTH;

  const navigatorWidth = 220;
  const inspectorMinDocked = 260;

  let effectiveSequenceMode: SequenceMode = input.requestedSequenceMode;
  if (focusMode) {
    effectiveSequenceMode = 'collapsed';
  } else if (vw < DOCKED_NAV_MIN_WIDTH && effectiveSequenceMode === 'floating') {
    effectiveSequenceMode = 'docked';
  }

  let navigatorMode: NavigatorMode = 'hidden';
  let inspectorMode: InspectorMode = focusMode || vh <= INSPECTOR_SHEET_MAX_HEIGHT ? 'sheet' : 'overlay';

  if (!focusMode) {
    if (effectiveSequenceMode === 'docked' && input.requestedNavigatorOpen) {
      if (vw >= DOCKED_NAV_MIN_WIDTH) {
        navigatorMode = 'docked';
      }
    }

    if (input.requestedInspectorOpen) {
      const canDockInspector =
        navigatorMode === 'docked'
          ? vw >= DOCKED_BOTH_MIN_WIDTH
          : vw >= DOCKED_INSPECTOR_MIN_WIDTH;
      if (canDockInspector) {
        inspectorMode = 'docked';
      } else {
        inspectorMode = vh <= INSPECTOR_SHEET_MAX_HEIGHT ? 'sheet' : 'overlay';
      }
    }
  }

  const maxAllowedInspectorWidth = Math.max(
    inspectorMinDocked,
    Math.min(460, vw - (navigatorMode === 'docked' ? navigatorWidth : 0) - 360)
  );
  const dockedInspectorWidth =
    inspectorMode === 'docked'
      ? Math.max(inspectorMinDocked, Math.min(maxAllowedInspectorWidth, Math.round(input.inspectorWidth || 300)))
      : 0;

  const dockedNavPx = navigatorMode === 'docked' ? navigatorWidth : 0;
  const stageSafeWidth = Math.max(MIN_STAGE_SAFE_WIDTH, vw - dockedNavPx - dockedInspectorPx(inspectorMode, dockedInspectorWidth));
  const bottomSequencePx =
    effectiveSequenceMode === 'docked' && !focusMode ? 126 : 0;
  const stageSafeHeight = Math.max(MIN_STAGE_SAFE_HEIGHT, vh - TOOLBAR_HEIGHT_PX - bottomSequencePx);

  const clampedFloatW = Math.min(
    Math.max(440, Math.round(input.floatingSequenceSize.width || 620)),
    Math.max(440, vw - 48)
  );
  const clampedFloatH = Math.min(
    Math.max(150, Math.round(input.floatingSequenceSize.height || 176)),
    Math.max(150, Math.floor((vh - TOOLBAR_HEIGHT_PX) * 0.42))
  );

  const { tier, overflowButtons } = resolveToolbarTier(vw, input.previousToolbarTier);

  return {
    focusMode,
    effectiveSequenceMode,
    navigatorMode,
    inspectorMode,
    dockedInspectorWidth,
    floatingSequenceSize: {
      width: clampedFloatW,
      height: clampedFloatH,
    },
    toolbarTier: tier,
    overflowToolbarButtons: overflowButtons,
    stageSafeWidth,
    stageSafeHeight,
  };
}

function dockedInspectorPx(mode: InspectorMode, width: number): number {
  return mode === 'docked' ? width : 0;
}

/**
 * Computes exact rendered canvas frame dimensions from actual available container space
 * and deck aspect ratio, avoiding magic `100vh - 230px` approximations.
 */
export function computeStageFrameSize(params: {
  containerWidth: number;
  containerHeight: number;
  aspectRatio: number;
  padHorizontal?: number;
  padVertical?: number;
  hudReservedPx?: number;
  fillRatio?: number;
}): { width: number; height: number } {
  const ratio = Number.isFinite(params.aspectRatio) && params.aspectRatio > 0 ? params.aspectRatio : 16 / 9;
  const padH = params.padHorizontal ?? 28;
  const padV = params.padVertical ?? 20;
  const hudReserve = params.hudReservedPx ?? 72;
  const fill = params.fillRatio ?? 0.96;

  const availW = Math.max(180, params.containerWidth - padH);
  const availH = Math.max(120, params.containerHeight - padV - hudReserve);

  let frameW = availW * fill;
  let frameH = frameW / ratio;
  if (frameH > availH * fill) {
    frameH = availH * fill;
    frameW = frameH * ratio;
  }

  return {
    width: Math.max(180, Math.floor(frameW)),
    height: Math.max(100, Math.floor(frameH)),
  };
}
