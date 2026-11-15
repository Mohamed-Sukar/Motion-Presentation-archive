/**
 * Pure decision helpers for the unsaved-changes lifecycle.
 *
 * The actual dialogs live in the Electron main process and the DOM wiring lives in `App.ts`;
 * keeping the *decisions* here makes them unit-testable without a renderer or a real quit.
 */

export type QuitSaveOutcome = 'proceed' | 'save' | 'block';

export interface QuitSaveInput {
  isDirty: boolean;
  slideCount: number;
  isSaving: boolean;
}

/**
 * Decides what the renderer should do after the user picked "Save & Close".
 *
 * - `proceed`: nothing worth saving (clean buffer, or an intentionally emptied deck).
 * - `block`:   a save is already in flight; closing now could tear down a half-written bundle.
 * - `save`:    persist first, then quit only if the buffer ends up clean.
 */
export function decideQuitSave(input: QuitSaveInput): QuitSaveOutcome {
  if (!input.isDirty || input.slideCount === 0) return 'proceed';
  if (input.isSaving) return 'block';
  return 'save';
}

export interface AutosaveDecisionInput {
  isDirty: boolean;
  slideCount: number;
  isSaving: boolean;
  isPresentingFullscreen: boolean;
  msSinceLastAutosave: number;
  msSinceLastChange: number;
  minIntervalMs?: number;
  debounceMs?: number;
}

export const DEFAULT_AUTOSAVE_MIN_INTERVAL_MS = 45_000;
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 8_000;

/**
 * Autosave is deliberately conservative: it must never compete with a real save, never run
 * during a live presentation (I/O on the show screen is unacceptable), and never fire for an
 * empty deck (which would overwrite a recoverable session with nothing).
 */
export function shouldAutosave(input: AutosaveDecisionInput): boolean {
  if (!input.isDirty || input.slideCount === 0) return false;
  if (input.isSaving || input.isPresentingFullscreen) return false;
  const minInterval = input.minIntervalMs ?? DEFAULT_AUTOSAVE_MIN_INTERVAL_MS;
  const debounce = input.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  if (input.msSinceLastChange < debounce) return false;
  if (input.msSinceLastAutosave < minInterval) return false;
  return true;
}
