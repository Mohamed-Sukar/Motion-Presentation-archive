import { AspectRatioOption } from '../domain/types';
import { AppLanguage, t } from '../i18n';

export interface RecentSessionEntry {
  id: string;
  title: string;
  filePath: string;
  fileName: string;
  slideCount: number;
  aspectRatio: AspectRatioOption;
  lastOpenedAt: number;
  pinned?: boolean;
  thumbnailDataUrl?: string;
  exists?: boolean;
}

export interface UpsertRecentSessionInput {
  title: string;
  filePath: string;
  fileName: string;
  slideCount: number;
  aspectRatio: AspectRatioOption;
  thumbnailDataUrl?: string;
}

const RECENT_STORAGE_KEY = 'motion_presentation_recent_sessions_v1';
const MAX_RECENT_SESSIONS = 20;

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && (window as any).localStorage) {
      return (window as any).localStorage as Storage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage as Storage;
    }
  } catch {
    // Ignore restricted storage access
  }
  return null;
}

function getDesktopApi(): any {
  return typeof window !== 'undefined' ? (window as any).desktopAPI : undefined;
}

export function normalizeRecentId(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').toLowerCase();
}

function sortRecentEntries(entries: RecentSessionEntry[]): RecentSessionEntry[] {
  return [...entries].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
  });
}

function readLocalRecents(): RecentSessionEntry[] {
  try {
    const raw = getStorageSafe()?.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortRecentEntries(
      parsed.filter(
        (item): item is RecentSessionEntry =>
          Boolean(item && typeof item.filePath === 'string' && typeof item.title === 'string')
      )
    ).slice(0, MAX_RECENT_SESSIONS);
  } catch {
    return [];
  }
}

function writeLocalRecents(entries: RecentSessionEntry[]): RecentSessionEntry[] {
  const sorted = sortRecentEntries(entries).slice(0, MAX_RECENT_SESSIONS);
  try {
    getStorageSafe()?.setItem(RECENT_STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Ignore storage quota errors
  }
  return sorted;
}

export async function listRecentSessions(): Promise<RecentSessionEntry[]> {
  const api = getDesktopApi();
  if (api?.listRecentProjects) {
    try {
      const list = await api.listRecentProjects();
      if (Array.isArray(list)) {
        return sortRecentEntries(list);
      }
    } catch {
      // Fallback to local cache
    }
  }
  return readLocalRecents();
}

export async function recordRecentSession(
  input: UpsertRecentSessionInput
): Promise<RecentSessionEntry[]> {
  if (!input.filePath || !input.filePath.trim()) {
    return await listRecentSessions();
  }

  const now = Date.now();
  const id = normalizeRecentId(input.filePath);

  const api = getDesktopApi();
  if (api?.upsertRecentProject) {
    try {
      const updated = await api.upsertRecentProject({
        id,
        title: input.title || input.fileName || t('app.titleUntitled'),
        filePath: input.filePath,
        fileName: input.fileName,
        slideCount: Math.max(0, Math.round(input.slideCount || 0)),
        aspectRatio: input.aspectRatio || '16:9',
        lastOpenedAt: now,
        ...(input.thumbnailDataUrl ? { thumbnailDataUrl: input.thumbnailDataUrl } : {}),
      });
      if (Array.isArray(updated)) {
        writeLocalRecents(updated);
        return sortRecentEntries(updated);
      }
    } catch {
      // Fall through to local persistence
    }
  }

  const existing = readLocalRecents();
  const prev = existing.find((item) => item.id === id);
  const nextEntry: RecentSessionEntry = {
    id,
    title: input.title || input.fileName || t('app.titleUntitled'),
    filePath: input.filePath,
    fileName: input.fileName,
    slideCount: Math.max(0, Math.round(input.slideCount || 0)),
    aspectRatio: input.aspectRatio || '16:9',
    lastOpenedAt: now,
    pinned: prev?.pinned ?? false,
    thumbnailDataUrl: input.thumbnailDataUrl || prev?.thumbnailDataUrl,
    exists: true,
  };

  return writeLocalRecents([nextEntry, ...existing.filter((item) => item.id !== id)]);
}

export async function togglePinRecentSession(filePath: string): Promise<RecentSessionEntry[]> {
  const id = normalizeRecentId(filePath);
  const api = getDesktopApi();
  if (api?.togglePinRecentProject) {
    try {
      const updated = await api.togglePinRecentProject(filePath);
      if (Array.isArray(updated)) {
        writeLocalRecents(updated);
        return sortRecentEntries(updated);
      }
    } catch {
      // Fall through
    }
  }
  const existing = readLocalRecents().map((item) =>
    item.id === id ? { ...item, pinned: !item.pinned } : item
  );
  return writeLocalRecents(existing);
}

export async function removeRecentSession(filePath: string): Promise<RecentSessionEntry[]> {
  const id = normalizeRecentId(filePath);
  const api = getDesktopApi();
  if (api?.removeRecentProject) {
    try {
      const updated = await api.removeRecentProject(filePath);
      if (Array.isArray(updated)) {
        writeLocalRecents(updated);
        return sortRecentEntries(updated);
      }
    } catch {
      // Fall through
    }
  }
  const remaining = readLocalRecents().filter((item) => item.id !== id);
  return writeLocalRecents(remaining);
}

export async function clearUnpinnedRecentSessions(): Promise<RecentSessionEntry[]> {
  const api = getDesktopApi();
  if (api?.clearRecentProjects) {
    try {
      const updated = await api.clearRecentProjects();
      if (Array.isArray(updated)) {
        writeLocalRecents(updated);
        return sortRecentEntries(updated);
      }
    } catch {
      // Fall through
    }
  }
  const pinnedOnly = readLocalRecents().filter((item) => Boolean(item.pinned));
  return writeLocalRecents(pinnedOnly);
}

export async function revealRecentSessionInFolder(filePath: string): Promise<boolean> {
  const api = getDesktopApi();
  if (api?.revealRecentProject) {
    try {
      return Boolean(await api.revealRecentProject(filePath));
    } catch {
      return false;
    }
  }
  return false;
}

export function formatRelativeSessionTime(ts: number, lang: AppLanguage): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffMs = Math.max(0, Date.now() - ts);
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) {
    return t('welcome.timeJustNow');
  }
  if (diffMin < 60) {
    return t('welcome.timeMinutesAgo', { count: diffMin });
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return t('welcome.timeHoursAgo', { count: diffHours });
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return t('welcome.timeYesterday');
  }
  if (diffDays < 30) {
    return t('welcome.timeDaysAgo', { count: diffDays });
  }
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}
