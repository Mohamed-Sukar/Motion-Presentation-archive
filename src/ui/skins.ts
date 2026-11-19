export type StudioSkinId = 'framer' | 'capcut' | 'figma' | 'linear' | 'davinci' | 'paper';

export interface StudioSkinDefinition {
  id: StudioSkinId;
  name: string;
  tagline: string;
  mode: 'dark' | 'light';
  swatchBg: string;
  swatchAccent: string;
}

export const SKIN_STORAGE_KEY = 'motion_presentation_skin_v1';

export const STUDIO_SKINS: readonly StudioSkinDefinition[] = [
  {
    id: 'framer',
    name: 'Framer Noir',
    tagline: 'Pure carbon black with crisp white primary actions',
    mode: 'dark',
    swatchBg: '#0A0A0A',
    swatchAccent: '#FFFFFF',
  },
  {
    id: 'capcut',
    name: 'CapCut Teal',
    tagline: 'Warm neutral NLE graphite with electric cyan accent',
    mode: 'dark',
    swatchBg: '#141414',
    swatchAccent: '#03B9CE',
  },
  {
    id: 'figma',
    name: 'Figma UI3',
    tagline: 'Balanced zinc layers with vivid studio blue focus',
    mode: 'dark',
    swatchBg: '#09090B',
    swatchAccent: '#3B82F6',
  },
  {
    id: 'linear',
    name: 'Linear Craft',
    tagline: 'Deep obsidian with precision lavender-indigo accent',
    mode: 'dark',
    swatchBg: '#08090A',
    swatchAccent: '#6875E8',
  },
  {
    id: 'davinci',
    name: 'DaVinci Neutral',
    tagline: 'Color-accurate neutral gray for cinema grading',
    mode: 'dark',
    swatchBg: '#181818',
    swatchAccent: '#4D94CC',
  },
  {
    id: 'paper',
    name: 'Studio Paper Light',
    tagline: 'Daylight studio paper with high-contrast carbon ink',
    mode: 'light',
    swatchBg: '#F3F4F6',
    swatchAccent: '#09090B',
  },
] as const;

let currentSkinId: StudioSkinId = 'framer';

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && (window as any).localStorage) {
      return (window as any).localStorage as Storage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage as Storage;
    }
  } catch {
    // Ignore storage block in restricted sandboxes
  }
  return null;
}

export function isValidStudioSkin(id: string | null | undefined): id is StudioSkinId {
  return Boolean(id && STUDIO_SKINS.some((s) => s.id === id));
}

export function getSavedStudioSkin(): StudioSkinId | null {
  try {
    const val = getStorageSafe()?.getItem(SKIN_STORAGE_KEY);
    if (isValidStudioSkin(val)) return val;
  } catch {
    // Ignore read errors
  }
  return null;
}

export function getStudioSkin(): StudioSkinId {
  return currentSkinId;
}

export function applyDocumentSkin(skinId: StudioSkinId): void {
  try {
    const doc = typeof document !== 'undefined' ? (document as any) : undefined;
    const html = doc?.documentElement;
    if (html) {
      if (typeof html.setAttribute === 'function') {
        html.setAttribute('data-skin', skinId);
      }
      if ('dataset' in html && html.dataset) {
        html.dataset.skin = skinId;
      }
    }
  } catch {
    // Ignore synthetic DOM errors
  }
}

export function initStudioSkin(defaultMode: 'dark' | 'light' = 'dark'): StudioSkinId {
  const saved = getSavedStudioSkin();
  currentSkinId = saved ?? (defaultMode === 'light' ? 'paper' : 'framer');
  applyDocumentSkin(currentSkinId);
  return currentSkinId;
}

export function setStudioSkin(skinId: StudioSkinId): StudioSkinDefinition {
  const def = STUDIO_SKINS.find((s) => s.id === skinId) ?? STUDIO_SKINS[0];
  currentSkinId = def.id;
  try {
    getStorageSafe()?.setItem(SKIN_STORAGE_KEY, def.id);
  } catch {
    // Ignore storage write errors
  }
  applyDocumentSkin(def.id);
  return def;
}
