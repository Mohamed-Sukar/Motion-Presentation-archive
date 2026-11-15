/**
 * Pure helpers behind the app-wide error handlers.
 *
 * The global `error` / `unhandledrejection` listeners live in `App.ts`; everything that decides
 * *what* to show and *how often* lives here so it can be tested without a DOM or a live event loop.
 */

export type GlobalErrorSource = 'unhandledrejection' | 'error';

export interface NormalizedError {
  source: GlobalErrorSource;
  message: string;
  stack: string | null;
}

export const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

function cleanMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Turns any thrown value (Error, string, rejected plain object, null) into a display-safe message.
 * A rejection reason can be literally anything, so this never throws and never returns an empty
 * string — that would render an empty toast.
 */
export function normalizeError(reason: unknown, source: GlobalErrorSource): NormalizedError {
  if (reason instanceof Error) {
    const message = cleanMessage(reason.message || reason.name || '') || UNKNOWN_ERROR_MESSAGE;
    return { source, message, stack: typeof reason.stack === 'string' ? reason.stack : null };
  }

  if (typeof reason === 'string') {
    return { source, message: cleanMessage(reason) || UNKNOWN_ERROR_MESSAGE, stack: null };
  }

  if (reason && typeof reason === 'object') {
    const candidate = reason as { message?: unknown; stack?: unknown };
    if (typeof candidate.message === 'string' && cleanMessage(candidate.message)) {
      return {
        source,
        message: cleanMessage(candidate.message),
        stack: typeof candidate.stack === 'string' ? candidate.stack : null,
      };
    }
  }

  if (reason === null || reason === undefined) {
    return { source, message: UNKNOWN_ERROR_MESSAGE, stack: null };
  }

  if (typeof reason === 'number' || typeof reason === 'boolean' || typeof reason === 'bigint') {
    return { source, message: String(reason), stack: null };
  }

  return { source, message: UNKNOWN_ERROR_MESSAGE, stack: null };
}

export interface ErrorReportThrottle {
  /**
   * True when this message has not been reported within the cooldown window.
   * Repeated identical messages do not extend the window, so a stuck loop still reports once per
   * cooldown rather than never again.
   */
  shouldReport(message: string, now?: number): boolean;
  reset(): void;
}

export const DEFAULT_ERROR_COOLDOWN_MS = 5000;

export function createErrorThrottle(cooldownMs = DEFAULT_ERROR_COOLDOWN_MS): ErrorReportThrottle {
  const lastReportedAt = new Map<string, number>();

  return {
    shouldReport(message: string, now = Date.now()): boolean {
      const key = cleanMessage(message) || UNKNOWN_ERROR_MESSAGE;
      const previous = lastReportedAt.get(key);
      if (previous !== undefined && now - previous < cooldownMs) return false;
      lastReportedAt.set(key, now);
      return true;
    },
    reset(): void {
      lastReportedAt.clear();
    },
  };
}
