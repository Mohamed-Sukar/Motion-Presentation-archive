const WINDOW_MIN_CSS_WIDTH = 720;
const WINDOW_MIN_CSS_HEIGHT = 500;
const MIN_ZOOM_FACTOR = 0.8;
const MAX_ZOOM_FACTOR = 1.25;
const ZOOM_STEP = 0.1;

function clampZoomFactor(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 1.0;
  const clamped = Math.max(MIN_ZOOM_FACTOR, Math.min(MAX_ZOOM_FACTOR, num));
  return Math.round(clamped * 100) / 100;
}

function stepZoomFactor(current, direction) {
  const base = clampZoomFactor(current);
  const delta = direction > 0 ? ZOOM_STEP : direction < 0 ? -ZOOM_STEP : 0;
  return clampZoomFactor(base + delta);
}

function computeScaledMinSize(zoomFactor) {
  const z = clampZoomFactor(zoomFactor);
  return {
    minWidth: Math.round(WINDOW_MIN_CSS_WIDTH * z),
    minHeight: Math.round(WINDOW_MIN_CSS_HEIGHT * z),
  };
}

function getDisplayOverlapArea(bounds, workArea) {
  if (!bounds || !workArea) return 0;
  const x1 = Math.max(bounds.x, workArea.x);
  const y1 = Math.max(bounds.y, workArea.y);
  const x2 = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const y2 = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function pickTargetDisplay({ savedState, displays, primaryDisplay }) {
  const list = Array.isArray(displays) && displays.length > 0 ? displays : [primaryDisplay];
  const fallbackDisplay = primaryDisplay || list[0];

  if (savedState && savedState.displayId !== undefined && savedState.displayId !== null) {
    const byId = list.find((d) => d && d.id === savedState.displayId);
    if (byId) return byId;
  }

  if (
    savedState &&
    Number.isFinite(savedState.x) &&
    Number.isFinite(savedState.y) &&
    Number.isFinite(savedState.width) &&
    Number.isFinite(savedState.height)
  ) {
    const candidate = {
      x: Number(savedState.x),
      y: Number(savedState.y),
      width: Math.max(100, Number(savedState.width)),
      height: Math.max(100, Number(savedState.height)),
    };
    let bestDisplay = null;
    let bestArea = 0;
    for (const d of list) {
      if (!d || !d.workArea) continue;
      const area = getDisplayOverlapArea(candidate, d.workArea);
      if (area > bestArea) {
        bestArea = area;
        bestDisplay = d;
      }
    }
    if (bestDisplay && bestArea > 0) {
      return bestDisplay;
    }
  }

  return fallbackDisplay;
}

function clampWindowBoundsToWorkArea(bounds, workArea, minSize = { minWidth: WINDOW_MIN_CSS_WIDTH, minHeight: WINDOW_MIN_CSS_HEIGHT }) {
  const wa = workArea || { x: 0, y: 0, width: 1280, height: 800 };
  const effectiveMinW = Math.min(wa.width, Math.max(320, minSize.minWidth || WINDOW_MIN_CSS_WIDTH));
  const effectiveMinH = Math.min(wa.height, Math.max(240, minSize.minHeight || WINDOW_MIN_CSS_HEIGHT));

  const width = Math.max(effectiveMinW, Math.min(wa.width, Math.round(Number(bounds?.width) || effectiveMinW)));
  const height = Math.max(effectiveMinH, Math.min(wa.height, Math.round(Number(bounds?.height) || effectiveMinH)));

  const hasCoords = Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y);
  let x = hasCoords ? Math.round(Number(bounds.x)) : Math.round(wa.x + (wa.width - width) / 2);
  let y = hasCoords ? Math.round(Number(bounds.y)) : Math.round(wa.y + (wa.height - height) / 2);

  // Keep the window fully reachable inside the target workArea
  const maxX = wa.x + Math.max(0, wa.width - width);
  const maxY = wa.y + Math.max(0, wa.height - height);
  x = Math.max(wa.x, Math.min(maxX, x));
  y = Math.max(wa.y, Math.min(maxY, y));

  return { x, y, width, height };
}

function resolveBoundsForDisplays({ savedState, displays, primaryDisplay }) {
  const targetDisplay = pickTargetDisplay({ savedState, displays, primaryDisplay });
  const wa = targetDisplay?.workArea || { x: 0, y: 0, width: 1280, height: 800 };

  const zoomFactor = clampZoomFactor(savedState?.zoomFactor ?? 1.0);
  const minSize = computeScaledMinSize(zoomFactor);

  const defaultWidth = Math.min(
    1360,
    wa.width,
    Math.max(minSize.minWidth, Math.round(wa.width * 0.88))
  );
  const defaultHeight = Math.min(
    840,
    wa.height,
    Math.max(minSize.minHeight, Math.round(wa.height * 0.88))
  );

  const parsedMode =
    savedState?.mode === 'maximized' || savedState?.isMaximized === true
      ? 'maximized'
      : 'normal';

  const hasValidSavedSize =
    savedState &&
    Number.isFinite(savedState.width) &&
    Number(savedState.width) > 0 &&
    Number.isFinite(savedState.height) &&
    Number(savedState.height) > 0;

  const rawBounds = hasValidSavedSize
    ? {
        x: savedState.x,
        y: savedState.y,
        width: Number(savedState.width),
        height: Number(savedState.height),
      }
    : {
        width: defaultWidth,
        height: defaultHeight,
      };

  const clamped = clampWindowBoundsToWorkArea(rawBounds, wa, minSize);

  return {
    ...clamped,
    mode: parsedMode,
    displayId: targetDisplay?.id ?? null,
    zoomFactor,
    minWidth: Math.min(wa.width, minSize.minWidth),
    minHeight: Math.min(wa.height, minSize.minHeight),
  };
}

function shouldPersistBounds({ isDestroyed, isFullScreen, isMinimized, isPresenting }) {
  if (isDestroyed) return false;
  if (isFullScreen) return false;
  if (isMinimized) return false;
  if (isPresenting) return false;
  return true;
}

function choosePresenterDisplay({ displays, primaryDisplay, studioDisplay, preferredDisplayId }) {
  const list = Array.isArray(displays) && displays.length > 0 ? displays : [primaryDisplay || studioDisplay].filter(Boolean);
  if (preferredDisplayId !== undefined && preferredDisplayId !== null) {
    const requested = list.find((d) => d && d.id === preferredDisplayId);
    if (requested) return requested;
  }
  if (list.length > 1 && studioDisplay) {
    const external = list.find((d) => d && d.id !== studioDisplay.id);
    if (external) return external;
  }
  return studioDisplay || primaryDisplay || list[0] || null;
}

module.exports = {
  WINDOW_MIN_CSS_WIDTH,
  WINDOW_MIN_CSS_HEIGHT,
  MIN_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
  ZOOM_STEP,
  clampZoomFactor,
  stepZoomFactor,
  computeScaledMinSize,
  pickTargetDisplay,
  clampWindowBoundsToWorkArea,
  resolveBoundsForDisplays,
  shouldPersistBounds,
  choosePresenterDisplay,
};
