import {
  AspectRatioOption,
  ProjectAiSourceMeta,
  SlideNode,
  SlideSourceMeta,
} from '../domain/types';

export interface PresentationManifestSlideEntry {
  index: number;
  title?: string;
  notes?: string;
  frameFile?: string;
  idleLoopFile?: string | null;
  transitionVideoFile?: string | null;
  slideCodeFile?: string;
  idleLoopCodeFile?: string;
  transitionCodeFile?: string;
  renderCommand?: string;
  exitPointsSec?: number[];
}

export interface PresentationManifestJson {
  skill?: 'new-motion-presentation' | 'animate-slides' | 'create-new' | 'motion-reel';
  title?: string;
  aspectRatio?: string;
  projectRootPath?: string;
  outputDirPath?: string;
  creativeDirection?: string;
  slides?: PresentationManifestSlideEntry[];
}

export interface SurgicalPromptParams {
  skillName: 'new-motion-presentation' | 'animate-slides' | 'create-new';
  projectRootPath: string;
  outputDirPath: string;
  scope: 'slide' | 'idle-loop' | 'transition' | 'project';
  slideIndex: number; // 1-based
  totalSlides: number;
  slideTitle: string;
  hasIdleLoop: boolean;
  currentTimecodeSec?: number | null;
  sourceMeta?: SlideSourceMeta;
  userInstruction: string;
  language: 'ar' | 'en';
}

export interface MotionReelFilmConfig {
  title?: string;
  duration?: number;
  formats?: string[];
  poster?: number;
}

export interface MotionReelSection {
  name: string;
  beat: number;
}

export interface MotionReelBeatsConfig {
  bpm?: number;
  offset?: number;
  period?: number;
  beats?: number[];
  downbeats?: number[];
  sections?: MotionReelSection[];
}

export interface MotionReelHit {
  beat?: number;
  t?: number;
  label?: string;
  sfx?: string;
}

export interface MotionReelCuePoint {
  timeSec: number;
  label: string;
}

export interface MotionReelMetadata {
  title: string | null;
  durationSec: number | null;
  suggestedAspectRatio: AspectRatioOption | null;
  bpm: number | null;
  beatTimesSec: number[];
  sectionCues: MotionReelCuePoint[];
  hitCues: MotionReelCuePoint[];
  recommendedCuePointsSec: number[];
  recommendedCueLabels: string[];
  preferredVideoName: string | null;
}

export interface MotionReelBundle extends MotionReelMetadata {
  isMotionReel: boolean;
  primaryVideoFile: File | null;
  allVideoFiles: File[];
  posterFile: File | null;
}

const SUPPORTED_DROP_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'avif',
  'svg',
  'bmp',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'ogv',
  'mpres',
  'json',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']);

function getExt(name: string): string {
  const parts = name.toLowerCase().trim().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function safeJsonParse<T>(text?: string | null): T | null {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function roundTime(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/**
 * Native importer for `/motion-reel` & code-drawn motion video projects.
 * Reads `film.json`, `beats.json`, and `hits.json` to map beat-synced sections
 * and visual hits directly into Motion Presentation Studio cue points.
 */
export class MotionReelImporter {
  static formatToAspectRatio(formatStr?: string | null): AspectRatioOption | null {
    if (!formatStr) return null;
    const norm = formatStr.toLowerCase().trim().replace(':', 'x');
    if (norm === '16x9') return '16:9';
    if (norm === '9x16') return '9:16';
    if (norm === '16x10') return '16:10';
    if (norm === '4x3') return '4:3';
    return null;
  }

  static pickPreferredVideoName(
    videoNames: string[],
    primaryFormat?: string | null
  ): string | null {
    if (videoNames.length === 0) return null;
    const fmt = primaryFormat ? primaryFormat.toLowerCase().trim() : '';

    const rankedMatchers: Array<(lowerName: string) => boolean> = [
      (n) => n === 'final.mp4',
      (n) => Boolean(fmt && n === `final_${fmt}.mp4`),
      (n) => Boolean(fmt && n === `video_${fmt}.mp4`),
      (n) => /^final_[a-z0-9x]+\.mp4$/i.test(n),
      (n) => /^final.*\.(mp4|mov|webm)$/i.test(n),
      (n) => /^video.*\.(mp4|mov|webm)$/i.test(n),
    ];

    for (const match of rankedMatchers) {
      const found = videoNames.find((name) => {
        const base = name.split(/[/\\]/).pop()?.toLowerCase() ?? '';
        return match(base);
      });
      if (found) return found;
    }

    return videoNames[0];
  }

  static parseFromTexts(input: {
    filmJsonText?: string | null;
    beatsJsonText?: string | null;
    hitsJsonText?: string | null;
    videoFileNames?: string[];
  }): MotionReelMetadata {
    const film = safeJsonParse<MotionReelFilmConfig>(input.filmJsonText);
    const beats = safeJsonParse<MotionReelBeatsConfig>(input.beatsJsonText);
    const hitsRaw = safeJsonParse<MotionReelHit[]>(input.hitsJsonText);

    const title = typeof film?.title === 'string' && film.title.trim() ? film.title.trim() : null;
    const durationSec =
      typeof film?.duration === 'number' && Number.isFinite(film.duration) && film.duration > 0
        ? film.duration
        : null;
    const primaryFormat = Array.isArray(film?.formats) && film.formats.length > 0 ? film.formats[0] : null;
    const suggestedAspectRatio = this.formatToAspectRatio(primaryFormat);

    const bpm =
      typeof beats?.bpm === 'number' && Number.isFinite(beats.bpm) && beats.bpm > 0
        ? beats.bpm
        : null;
    const offset = typeof beats?.offset === 'number' && Number.isFinite(beats.offset) ? beats.offset : 0;
    const period =
      typeof beats?.period === 'number' && Number.isFinite(beats.period) && beats.period > 0
        ? beats.period
        : bpm
          ? 60 / bpm
          : 0.5;

    const beatTimesSec = Array.isArray(beats?.beats)
      ? beats.beats
          .filter((b): b is number => typeof b === 'number' && Number.isFinite(b) && b >= 0)
          .map(roundTime)
      : [];

    const sectionCues: MotionReelCuePoint[] = [];
    if (Array.isArray(beats?.sections)) {
      for (const sec of beats.sections) {
        if (!sec || typeof sec.beat !== 'number' || !Number.isFinite(sec.beat)) continue;
        const timeSec = roundTime(Math.max(0, offset + sec.beat * period));
        const label = typeof sec.name === 'string' && sec.name.trim() ? sec.name.trim() : `Beat ${sec.beat}`;
        sectionCues.push({ timeSec, label });
      }
      sectionCues.sort((a, b) => a.timeSec - b.timeSec);
    }

    const hitCues: MotionReelCuePoint[] = [];
    if (Array.isArray(hitsRaw)) {
      for (const hit of hitsRaw) {
        if (!hit) continue;
        const rawT =
          typeof hit.t === 'number' && Number.isFinite(hit.t)
            ? hit.t
            : typeof hit.beat === 'number' && Number.isFinite(hit.beat)
              ? offset + hit.beat * period
              : null;
        if (rawT === null || rawT < 0) continue;
        const label =
          typeof hit.label === 'string' && hit.label.trim()
            ? hit.label.trim()
            : typeof hit.beat === 'number'
              ? `Hit @ ${hit.beat}`
              : 'Hit';
        hitCues.push({ timeSec: roundTime(rawT), label });
      }
      hitCues.sort((a, b) => a.timeSec - b.timeSec);
    }

    // Prefer sectionCues for slide-level presenter pauses; fall back to hitCues if no sections exist
    const sourceCues = sectionCues.length > 0 ? sectionCues : hitCues;
    const recommendedCuePointsSec: number[] = [];
    const recommendedCueLabels: string[] = [];

    const pushUniqueCue = (timeSec: number, label: string) => {
      const clamped = durationSec !== null ? Math.min(durationSec, Math.max(0, timeSec)) : Math.max(0, timeSec);
      const rounded = roundTime(clamped);
      const existingIdx = recommendedCuePointsSec.findIndex((t) => Math.abs(t - rounded) < 0.08);
      if (existingIdx >= 0) {
        if (!recommendedCueLabels[existingIdx] && label) {
          recommendedCueLabels[existingIdx] = label;
        }
        return;
      }
      recommendedCuePointsSec.push(rounded);
      recommendedCueLabels.push(label);
    };

    if (sourceCues.length > 0) {
      if (sourceCues[0].timeSec > 0.08) {
        pushUniqueCue(0, 'Start');
      }
      for (const c of sourceCues) {
        pushUniqueCue(c.timeSec, c.label);
      }
      if (durationSec !== null && durationSec - recommendedCuePointsSec[recommendedCuePointsSec.length - 1] > 0.08) {
        pushUniqueCue(durationSec, 'End');
      }
    }

    const preferredVideoName = this.pickPreferredVideoName(
      input.videoFileNames ?? [],
      primaryFormat
    );

    return {
      title,
      durationSec,
      suggestedAspectRatio,
      bpm,
      beatTimesSec,
      sectionCues,
      hitCues,
      recommendedCuePointsSec,
      recommendedCueLabels,
      preferredVideoName,
    };
  }

  static async parseBundle(files: File[]): Promise<MotionReelBundle> {
    const findByName = (target: string): File | undefined =>
      files.find((f) => f.name.toLowerCase() === target.toLowerCase());

    const filmFile = findByName('film.json');
    const beatsFile = findByName('beats.json');
    const hitsFile = findByName('hits.json');
    const posterFile = findByName('poster.png') ?? null;

    const videoFiles = files.filter((f) => VIDEO_EXTENSIONS.has(getExt(f.name)));
    const hasMeta = Boolean(filmFile || beatsFile || hitsFile);

    if (!hasMeta || videoFiles.length === 0) {
      return {
        isMotionReel: false,
        title: null,
        durationSec: null,
        suggestedAspectRatio: null,
        bpm: null,
        beatTimesSec: [],
        sectionCues: [],
        hitCues: [],
        recommendedCuePointsSec: [],
        recommendedCueLabels: [],
        preferredVideoName: null,
        primaryVideoFile: null,
        allVideoFiles: videoFiles,
        posterFile,
      };
    }

    const [filmJsonText, beatsJsonText, hitsJsonText] = await Promise.all([
      filmFile ? filmFile.text() : Promise.resolve(null),
      beatsFile ? beatsFile.text() : Promise.resolve(null),
      hitsFile ? hitsFile.text() : Promise.resolve(null),
    ]);

    const meta = this.parseFromTexts({
      filmJsonText,
      beatsJsonText,
      hitsJsonText,
      videoFileNames: videoFiles.map((f) => f.name),
    });

    const primaryVideoFile =
      (meta.preferredVideoName
        ? videoFiles.find((f) => f.name === meta.preferredVideoName)
        : undefined) ?? videoFiles[0] ?? null;

    return {
      isMotionReel: Boolean(primaryVideoFile && hasMeta),
      ...meta,
      primaryVideoFile,
      allVideoFiles: videoFiles,
      posterFile,
    };
  }

  /**
   * Recursively extracts files from a drag-and-drop DataTransfer (supporting dropped folders
   * such as `<film>/` or `out/<film>/` via `webkitGetAsEntry()`).
   */
  static async extractFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items
      .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry));

    const hasDirectory = entries.some((e) => e.isDirectory);
    if (!hasDirectory) {
      return dt.files ? Array.from(dt.files) : [];
    }

    const collected: File[] = [];
    const readEntry = async (entry: FileSystemEntry, depth = 0): Promise<void> => {
      if (depth > 5) return;
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const ext = getExt(entry.name);
        if (!SUPPORTED_DROP_EXTENSIONS.has(ext) && !entry.name.toLowerCase().endsWith('.mpres.json')) {
          return;
        }
        await new Promise<void>((resolve) => {
          fileEntry.file(
            (file) => {
              collected.push(file);
              resolve();
            },
            () => resolve()
          );
        });
        return;
      }

      if (entry.isDirectory) {
        const lower = entry.name.toLowerCase();
        if (lower === 'node_modules' || lower === '.git') return;
        const dirReader = (entry as FileSystemDirectoryEntry).createReader();
        const readAllBatches = async (): Promise<FileSystemEntry[]> => {
          const all: FileSystemEntry[] = [];
          while (true) {
            const batch = await new Promise<FileSystemEntry[]>((resolve) => {
              dirReader.readEntries(
                (res) => resolve(res),
                () => resolve([])
              );
            });
            if (batch.length === 0) break;
            all.push(...batch);
          }
          return all;
        };
        const children = await readAllBatches();
        for (const child of children) {
          await readEntry(child, depth + 1);
        }
      }
    };

    for (const entry of entries) {
      await readEntry(entry, 0);
    }

    return collected;
  }

  static findPresentationManifestFile(files: File[]): File | undefined {
    return files.find((f) => {
      const lower = f.name.toLowerCase();
      return lower === 'presentation.json' || lower === 'presentation.meta.json';
    });
  }

  static parsePresentationManifest(jsonText?: string | null): PresentationManifestJson | null {
    const parsed = safeJsonParse<PresentationManifestJson>(jsonText);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.slides) && !parsed.projectRootPath && !parsed.skill) {
      return null;
    }
    return parsed;
  }

  static applyPresentationManifestToSlides(
    slides: SlideNode[],
    manifest: PresentationManifestJson
  ): ProjectAiSourceMeta {
    const entries = Array.isArray(manifest.slides) ? manifest.slides : [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const oneBased = i + 1;
      const entry =
        entries.find((e) => e.index === oneBased) ??
        entries.find(
          (e) =>
            e.frameFile &&
            slide.imageAsset?.name &&
            e.frameFile.toLowerCase() === slide.imageAsset.name.toLowerCase()
        ) ??
        entries[i];

      if (!entry) continue;

      if (typeof entry.title === 'string' && entry.title.trim()) {
        slide.title = entry.title.trim();
      }
      if (typeof entry.notes === 'string' && entry.notes.trim() && !slide.notes) {
        slide.notes = entry.notes.trim();
      }
      if (entry.idleLoopFile) {
        slide.expectedIdleLoopFileName = entry.idleLoopFile;
      }
      slide.sourceMeta = {
        slideCodeFile: entry.slideCodeFile,
        idleLoopCodeFile: entry.idleLoopCodeFile,
        transitionCodeFile: entry.transitionCodeFile,
        renderCommand: entry.renderCommand,
        exitPointsSec: Array.isArray(entry.exitPointsSec) ? entry.exitPointsSec : undefined,
      };
    }

    return {
      skillName: manifest.skill ?? 'new-motion-presentation',
      projectRootPath: manifest.projectRootPath,
      outputDirPath: manifest.outputDirPath,
      creativeDirection: manifest.creativeDirection,
    };
  }

  static buildSurgicalEditPrompt(params: SurgicalPromptParams): string {
    const pad = (n: number) => String(Math.max(1, n)).padStart(2, '0');
    const idx = Math.max(1, params.slideIndex);
    const nextIdx = idx + 1;
    const prevIdx = idx - 1;
    const skillCmd =
      params.skillName === 'animate-slides' || params.skillName === 'create-new'
        ? '/animate-slides'
        : '/new-motion-presentation';
    const rootPath = params.projectRootPath.trim() || '<PROJECT_ROOT_PATH>';
    const outPath = params.outputDirPath.trim() || '<PRESENTATION_OUTPUT_DIR>';
    const instruction =
      params.userInstruction.trim() ||
      (params.language === 'ar'
        ? '[اكتب التعديل المطلوب هنا...]'
        : '[Describe the exact change you want here...]');

    const slideCode = params.sourceMeta?.slideCodeFile || `scenes/slide_${pad(idx)}.js`;
    const loopCode = params.sourceMeta?.idleLoopCodeFile || `loops/loop_${pad(idx)}.js`;
    const transCode =
      params.sourceMeta?.transitionCodeFile ||
      `transitions/t${pad(idx)}_${pad(nextIdx)}/film.js`;

    const timeNote =
      typeof params.currentTimecodeSec === 'number' && Number.isFinite(params.currentTimecodeSec)
        ? ` (at t = ${params.currentTimecodeSec.toFixed(2)}s)`
        : '';

    const touchedOutputFiles: string[] = [];
    const codeTargets: string[] = [];
    const continuityRules: string[] = [];

    if (params.scope === 'slide') {
      codeTargets.push(slideCode);
      touchedOutputFiles.push(`${pad(idx)}_frame.png`);
      if (prevIdx >= 1) {
        touchedOutputFiles.push(`${pad(prevIdx)}-${pad(idx)}_transition.mp4`);
      }
      if (params.hasIdleLoop) {
        touchedOutputFiles.push(`${pad(idx)}_loop.mp4`);
      }
      if (idx < params.totalSlides) {
        touchedOutputFiles.push(`${pad(idx)}-${pad(nextIdx)}_transition.mp4`);
      }
      continuityRules.push(
        params.language === 'ar'
          ? `بما أن تصميم الشريحة ${idx} تغيّر، أعد رندرة ${touchedOutputFiles.join(' و ')} لضمان تطابق نقطة البداية/النهاية 100% بدون أي قفزة أو وميض.`
          : `Because Slide ${idx} visual design changed, re-render ${touchedOutputFiles.join(', ')} so start/end boundary frames match 100% with zero flicker.`
      );
    } else if (params.scope === 'idle-loop') {
      codeTargets.push(loopCode);
      touchedOutputFiles.push(`${pad(idx)}_loop.mp4`);
      continuityRules.push(
        params.language === 'ar'
          ? `التزم بعقد نقطة الراحة (Rest-Pose Contract): يجب أن يتطابق t=0 و t=duration في ${pad(idx)}_loop.mp4 تماماً مع ${pad(idx)}_frame.png مع إبقاء النصوص الأساسية ثابتة ومقروءة.`
          : `Follow the Rest-Pose Contract: t=0 and t=duration in ${pad(idx)}_loop.mp4 must match ${pad(idx)}_frame.png 100%, keeping core typography rock-steady and readable.`
      );
    } else if (params.scope === 'transition') {
      codeTargets.push(transCode);
      touchedOutputFiles.push(`${pad(idx)}-${pad(nextIdx)}_transition.mp4`);
      continuityRules.push(
        params.language === 'ar'
          ? `حافظ على تطابق t=0 مع ${pad(idx)}_frame.png وتطابق t=duration مع ${pad(nextIdx)}_frame.png تماماً.`
          : `Keep t=0 locked to ${pad(idx)}_frame.png and t=duration locked to ${pad(nextIdx)}_frame.png.`
      );
    } else {
      codeTargets.push('scenes/*, loops/*, transitions/*');
      touchedOutputFiles.push(
        params.language === 'ar' ? 'ملفات العرض بالكامل' : 'Full presentation output files'
      );
      continuityRules.push(
        params.language === 'ar'
          ? 'حدّث presentation.json بعد إتمام التعديل والرندرة.'
          : 'Update presentation.json after rendering.'
      );
    }

    const untouchedSlides: string[] = [];
    for (let s = 1; s <= params.totalSlides; s++) {
      if (params.scope === 'project') break;
      if (params.scope === 'transition' && (s === idx || s === nextIdx)) continue;
      if (s === idx) continue;
      untouchedSlides.push(`#${s}`);
    }

    const renderCmdNote = params.sourceMeta?.renderCommand
      ? `\n- Render Command: ${params.sourceMeta.renderCommand}`
      : '';

    if (params.language === 'ar') {
      const targetDesc =
        params.scope === 'slide'
          ? `الشريحة رقم ${idx} ("${params.slideTitle}")`
          : params.scope === 'idle-loop'
            ? `حلقة الخمول (Idle Loop) للشريحة رقم ${idx} ("${params.slideTitle}")${timeNote}`
            : params.scope === 'transition'
              ? `فيديو الانتقال (${idx} -> ${nextIdx})${timeNote}`
              : `العرض التقديمي بالكامل (${params.totalSlides} شرائح)`;

      const doNotTouchLine =
        untouchedSlides.length > 0
          ? `\n- لا تلمس أو تعيد رندرة الشرائح غير المتأثرة (${untouchedSlides.join(', ')}).`
          : '';

      return [
        `استخدم مهارة ${skillCmd} لتنفيذ تعديل جراحي دقيق في مشروع العرض التالي:`,
        `- مسار كود المشروع (Project Root): ${rootPath}`,
        `- مسار مجلد المخرجات (Output Dir): ${outPath}`,
        `- الجزء المستهدف: ${targetDesc}`,
        `- ملفات الكود المرتبطة: ${codeTargets.join(', ')}`,
        `- ملفات المخرجات المتأثرة: ${touchedOutputFiles.join(', ')}${renderCmdNote}`,
        ``,
        `[التعديل المطلوب من المستخدم]:`,
        instruction,
        ``,
        `[قواعد الترابط والسلامة الإلزامية]:`,
        `- ${continuityRules.join('\n- ')}${doNotTouchLine}`,
        `- احفظ الملفات المحدثة في نفس مسار المخرجات وبنفس الأسماء القياسية (وحدّث presentation.json إن لزم).`,
      ].join('\n');
    }

    const targetDescEn =
      params.scope === 'slide'
        ? `Slide #${idx} ("${params.slideTitle}")`
        : params.scope === 'idle-loop'
          ? `Idle Motion Loop for Slide #${idx} ("${params.slideTitle}")${timeNote}`
          : params.scope === 'transition'
            ? `Transition Video (${idx} -> ${nextIdx})${timeNote}`
            : `Full Presentation (${params.totalSlides} slides)`;

    const doNotTouchEn =
      untouchedSlides.length > 0
        ? `\n- DO NOT modify or re-render unrelated slides (${untouchedSlides.join(', ')}).`
        : '';

    return [
      `Use the ${skillCmd} skill to perform a surgical edit on this presentation project:`,
      `- Project Root Path: ${rootPath}`,
      `- Output Directory: ${outPath}`,
      `- Target Scope: ${targetDescEn}`,
      `- Source Code Files: ${codeTargets.join(', ')}`,
      `- Affected Output Assets: ${touchedOutputFiles.join(', ')}${renderCmdNote}`,
      ``,
      `[Requested Modification]:`,
      instruction,
      ``,
      `[Mandatory Continuity & Guardrails]:`,
      `- ${continuityRules.join('\n- ')}${doNotTouchEn}`,
      `- Write updated files back into the same Output Directory using identical filenames (and update presentation.json if metadata changed).`,
    ].join('\n');
  }
}
