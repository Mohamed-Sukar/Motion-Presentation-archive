import type { TranslationKey } from '../core/i18n';
import {
  applyDocumentSkin,
  getSavedStudioSkin,
  getStudioSkin,
  initStudioSkin,
  setStudioSkin,
  StudioSkinId,
} from './skins';

let lastDarkSkinId: StudioSkinId = 'framer';

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'motion_presentation_theme_v1';

export interface StageColorSwatch {
  id: string;
  hex: string;
  labelKey: TranslationKey;
}

export const STAGE_COLOR_SWATCHES: readonly StageColorSwatch[] = [
  { id: 'obsidian', hex: '#05070B', labelKey: 'swatch.obsidian' },
  { id: 'carbon', hex: '#09090B', labelKey: 'swatch.carbon' },
  { id: 'midnight', hex: '#0F172A', labelKey: 'swatch.midnight' },
  { id: 'graphite', hex: '#18181B', labelKey: 'swatch.graphite' },
  { id: 'indigo', hex: '#1E1B4B', labelKey: 'swatch.indigo' },
  { id: 'emerald', hex: '#042F2E', labelKey: 'swatch.emerald' },
  { id: 'paper', hex: '#F4F4F5', labelKey: 'swatch.paper' },
  { id: 'daylight', hex: '#FFFFFF', labelKey: 'swatch.daylight' },
] as const;

let currentThemePreference: ThemePreference = 'system';
let currentResolvedTheme: ResolvedTheme = 'dark';
let themeInitialized = false;
let mediaQueryUnsubscribe: (() => void) | null = null;

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && (window as any).localStorage) {
      return (window as any).localStorage as Storage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage as Storage;
    }
  } catch {
    // Storage access blocked
  }
  return null;
}

export function getSavedThemePreference(): ThemePreference | null {
  try {
    const saved = getStorageSafe()?.getItem(THEME_STORAGE_KEY);
    if (saved === 'system' || saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function detectSystemTheme(): ResolvedTheme {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const isLight = Boolean(win?.matchMedia?.('(prefers-color-scheme: light)')?.matches);
    return isLight ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return detectSystemTheme();
}

export function applyDocumentTheme(resolved: ResolvedTheme, pref: ThemePreference): void {
  try {
    const doc = typeof document !== 'undefined' ? (document as any) : undefined;
    const html = doc?.documentElement;
    if (html) {
      if (typeof html.setAttribute === 'function') {
        html.setAttribute('data-theme', resolved);
        html.setAttribute('data-theme-pref', pref);
      }
      if ('dataset' in html && html.dataset) {
        html.dataset.theme = resolved;
        html.dataset.themePref = pref;
      }
    }
  } catch {
    // Ignore mock DOM limitations
  }
}

function attachSystemThemeListener(onSystemChange?: (resolved: ResolvedTheme) => void): void {
  if (mediaQueryUnsubscribe) {
    mediaQueryUnsubscribe();
    mediaQueryUnsubscribe = null;
  }
  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const mql = win?.matchMedia?.('(prefers-color-scheme: light)');
    if (!mql || typeof mql.addEventListener !== 'function') return;
    const listener = () => {
      if (currentThemePreference === 'system') {
        currentResolvedTheme = detectSystemTheme();
        applyDocumentTheme(currentResolvedTheme, 'system');
        onSystemChange?.(currentResolvedTheme);
      }
    };
    mql.addEventListener('change', listener);
    mediaQueryUnsubscribe = () => {
      try {
        mql.removeEventListener('change', listener);
      } catch {
        // Ignore cleanup errors
      }
    };
  } catch {
    // MatchMedia unavailable in synthetic DOM environments
  }
}

export function detectInitialTheme(onSystemChange?: (resolved: ResolvedTheme) => void): ResolvedTheme {
  const saved = getSavedThemePreference();
  const pref: ThemePreference = saved ?? 'system';
  const resolved = resolveTheme(pref);
  currentThemePreference = pref;
  currentResolvedTheme = resolved;
  themeInitialized = true;
  applyDocumentTheme(resolved, pref);
  if (resolved === 'light' && getStudioSkin() !== 'paper') {
    const cur = getStudioSkin();
    if (cur !== 'paper') lastDarkSkinId = cur;
    applyDocumentSkin('paper');
  } else if (resolved === 'dark' && getStudioSkin() === 'paper') {
    const saved = getSavedStudioSkin();
    applyDocumentSkin(saved && saved !== 'paper' ? saved : lastDarkSkinId);
  }
  const initialSkin = initStudioSkin(resolved);
  if (initialSkin !== 'paper') lastDarkSkinId = initialSkin;
  attachSystemThemeListener(onSystemChange);
  return resolved;
}

export function selectStudioSkin(skinId: StudioSkinId): void {
  const def = setStudioSkin(skinId);
  if (def.id !== 'paper') lastDarkSkinId = def.id;
  setThemePreference(def.mode, { persist: true, syncDesktop: true });
}

export function getThemePreference(): ThemePreference {
  if (!themeInitialized) {
    detectInitialTheme();
  }
  return currentThemePreference;
}

export function getResolvedTheme(): ResolvedTheme {
  if (!themeInitialized) {
    detectInitialTheme();
  }
  return currentResolvedTheme;
}

export function setThemePreference(
  pref: ThemePreference,
  options: { persist?: boolean; syncDesktop?: boolean } = {}
): ResolvedTheme {
  const { persist = true, syncDesktop = true } = options;
  const resolved = resolveTheme(pref);
  currentThemePreference = pref;
  currentResolvedTheme = resolved;
  themeInitialized = true;
  applyDocumentTheme(resolved, pref);
  if (resolved === 'light' && getStudioSkin() !== 'paper') {
    const cur = getStudioSkin();
    if (cur !== 'paper') lastDarkSkinId = cur;
    applyDocumentSkin('paper');
  } else if (resolved === 'dark' && getStudioSkin() === 'paper') {
    const saved = getSavedStudioSkin();
    applyDocumentSkin(saved && saved !== 'paper' ? saved : lastDarkSkinId);
  }

  if (persist) {
    try {
      getStorageSafe()?.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Ignore storage write errors
    }
  }

  if (syncDesktop) {
    try {
      const api = typeof window !== 'undefined' ? (window as any).desktopAPI : undefined;
      if (api && typeof api.setTheme === 'function') {
        void Promise.resolve(api.setTheme(pref)).catch(() => {});
      }
    } catch {
      // Ignore Electron bridge errors
    }
  }

  return resolved;
}

/**
 * Cycles theme cleanly so the first click from `system` immediately flips
 * visually to the opposite polarity, then visits the explicit matching polarity,
 * and returns to `system`.
 */
export function cycleThemePreference(): ThemePreference {
  const pref = getThemePreference();
  const resolved = getResolvedTheme();
  if (pref === 'system') {
    const nextPref: ThemePreference = resolved === 'dark' ? 'light' : 'dark';
    setThemePreference(nextPref);
    return nextPref;
  }
  const sys = detectSystemTheme();
  if (pref !== sys) {
    setThemePreference(sys);
    return sys;
  }
  setThemePreference('system');
  return 'system';
}

export function resetThemeStateForTesting(): void {
  if (mediaQueryUnsubscribe) {
    mediaQueryUnsubscribe();
    mediaQueryUnsubscribe = null;
  }
  themeInitialized = false;
  currentThemePreference = 'system';
  currentResolvedTheme = 'dark';
}
