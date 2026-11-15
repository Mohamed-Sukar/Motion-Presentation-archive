import { ProjectAiSourceMeta, SlideNode } from '../../core/domain/types';
import { getLanguage, t } from '../../core/i18n';
import { MotionReelImporter } from '../../core/services/MotionReelImporter';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

export type SurgicalAiScope = 'slide' | 'idle-loop' | 'transition' | 'project';
export type SurgicalAiSkill = 'new-motion-presentation' | 'animate-slides' | 'create-new';

export interface SurgicalAiPromptRenderProps {
  activeSlide: SlideNode;
  slideIdx: number;
  totalSlides: number;
  defaultScope: 'slide' | 'transition';
  scopeOverride: SurgicalAiScope | null;
  draftInstruction: string;
  aiMeta: ProjectAiSourceMeta | undefined;
  currentVideoTimeSec: number | null;
}

export interface SurgicalAiPromptWireCallbacks {
  getAiMeta: () => ProjectAiSourceMeta | undefined;
  setAiMeta: (meta: ProjectAiSourceMeta) => void;
  getCurrentVideoTimeSec: () => number | null;
  onDraftChange: (draft: string, scope: SurgicalAiScope) => void;
  onNotifyCopied: () => void;
}

export function renderSurgicalAiPromptMarkup(props: SurgicalAiPromptRenderProps): string {
  const skillName: SurgicalAiSkill =
    props.aiMeta?.skillName === 'animate-slides' || props.aiMeta?.skillName === 'create-new'
      ? 'animate-slides'
      : 'new-motion-presentation';
  const scope: SurgicalAiScope = props.scopeOverride ?? props.defaultScope;
  const outputDirPath = props.aiMeta?.outputDirPath || props.aiMeta?.projectRootPath || '';
  const lang = getLanguage();

  const previewPrompt = MotionReelImporter.buildSurgicalEditPrompt({
    skillName,
    projectRootPath: props.aiMeta?.projectRootPath || outputDirPath,
    outputDirPath,
    scope,
    slideIndex: props.slideIdx + 1,
    totalSlides: props.totalSlides,
    slideTitle: props.activeSlide.title,
    hasIdleLoop: Boolean(
      props.activeSlide.idleLoopAsset || props.activeSlide.expectedIdleLoopFileName
    ),
    currentTimecodeSec: props.currentVideoTimeSec,
    sourceMeta: props.activeSlide.sourceMeta,
    userInstruction: props.draftInstruction,
    language: lang,
  });

  const chipLoopVal =
    lang === 'ar'
      ? 'أضف حركة خمول دائرية ناعمة (Idle Loop) تلتزم بنقطة الراحة مع بقاء النصوص ثابتة.'
      : 'Add a subtle Rest-Pose Idle Loop animation keeping core typography rock-steady.';
  const chipFasterVal =
    lang === 'ar'
      ? 'اجعل التوقيت أسرع وأكثر حيوية (Snappier spring easing).'
      : 'Make the motion timing snappier with crisp spring easing.';
  const chipZoomVal =
    lang === 'ar'
      ? 'نفّذ انتقال كاميرا سلس (Camera Zoom Morph) نحو العنصر الرئيسي.'
      : 'Use a smooth log-space camera zoom morph into the hero element.';
  const chipColorsVal =
    lang === 'ar'
      ? 'حسّن تباين الألوان ووضوح العناوين.'
      : 'Boost color contrast and headline legibility.';
  const chipAltVal =
    lang === 'ar'
      ? 'ابتكر تصميماً وحركة بديلة أكثر إبداعاً لنفس المحتوى.'
      : 'Propose and render a fresh, higher-creativity visual alternative for this same content.';

  return `
    <div class="inspector-group" id="insp-ai-prompt-group">
      <div class="inspector-group-title">
        <span>${escapeHtml(t('inspector.aiEditTitle'))}</span>
        ${Icons.wand}
      </div>

      <div class="ai-prompt-grid">
        <div class="prop-row">
          <label class="prop-label" for="insp-ai-scope">${escapeHtml(t('inspector.aiScopeLabel'))}</label>
          <select class="select-field" id="insp-ai-scope">
            <option value="slide" ${scope === 'slide' ? 'selected' : ''}>${escapeHtml(t('inspector.aiScopeSlide'))}</option>
            <option value="idle-loop" ${scope === 'idle-loop' ? 'selected' : ''}>${escapeHtml(t('inspector.aiScopeLoop'))}</option>
            <option value="transition" ${scope === 'transition' ? 'selected' : ''}>${escapeHtml(t('inspector.aiScopeTransition'))}</option>
            <option value="project" ${scope === 'project' ? 'selected' : ''}>${escapeHtml(t('inspector.aiScopeProject'))}</option>
          </select>
        </div>
        <div class="prop-row">
          <label class="prop-label" for="insp-ai-skill">${escapeHtml(t('inspector.aiSkillLabel'))}</label>
          <select class="select-field" id="insp-ai-skill">
            <option value="new-motion-presentation" ${skillName === 'new-motion-presentation' ? 'selected' : ''}>/new-motion-presentation</option>
            <option value="animate-slides" ${skillName === 'animate-slides' ? 'selected' : ''}>/animate-slides</option>
          </select>
        </div>
      </div>

      <div class="prop-row">
        <label class="prop-label" for="insp-ai-path">${escapeHtml(t('inspector.aiPathLabel'))}</label>
        <input
          type="text"
          class="input-field"
          id="insp-ai-path"
          dir="ltr"
          placeholder="${escapeHtml(t('inspector.aiPathPlaceholder'))}"
          value="${escapeHtml(outputDirPath)}"
        />
      </div>

      <div class="prop-row">
        <label class="prop-label" for="insp-ai-custom-input">${escapeHtml(t('inspector.aiInstructionLabel'))}</label>
        <div class="ai-chip-row">
          <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${escapeHtml(chipLoopVal)}">${Icons.infinityLoop}<span>${escapeHtml(t('inspector.chipLoop'))}</span></button>
          <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${escapeHtml(chipFasterVal)}">${Icons.bolt}<span>${escapeHtml(t('inspector.chipFaster'))}</span></button>
          <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${escapeHtml(chipZoomVal)}">${Icons.maximize}<span>${escapeHtml(t('inspector.chipZoom'))}</span></button>
          <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${escapeHtml(chipColorsVal)}">${Icons.palette}<span>${escapeHtml(t('inspector.chipColors'))}</span></button>
          <button type="button" class="btn btn-xs ai-quick-chip" data-chip-text="${escapeHtml(chipAltVal)}">${Icons.sparkles}<span>${escapeHtml(t('inspector.chipAlt'))}</span></button>
        </div>
        <textarea
          class="textarea-field"
          id="insp-ai-custom-input"
          rows="3"
          placeholder="${escapeHtml(t('inspector.aiInstructionPlaceholder'))}"
        >${escapeHtml(props.draftInstruction)}</textarea>
      </div>

      <div class="prop-row">
        <label class="prop-label" for="insp-ai-prompt-output">${escapeHtml(t('inspector.aiPreviewLabel'))}</label>
        <textarea
          class="textarea-field ai-prompt-output"
          id="insp-ai-prompt-output"
          rows="5"
          readonly
        >${escapeHtml(previewPrompt)}</textarea>
      </div>

      <button class="btn btn-primary ai-copy-btn" id="btn-copy-ai-prompt" type="button">
        ${Icons.duplicate}
        <span>${escapeHtml(t('inspector.aiCopyBtn'))}</span>
      </button>
    </div>
  `;
}

export function wireSurgicalAiPromptView(
  pane: HTMLElement,
  scope: ComponentScope,
  activeSlide: SlideNode,
  slideIdx: number,
  totalSlides: number,
  callbacks: SurgicalAiPromptWireCallbacks
): void {
  const scopeSel = pane.querySelector('#insp-ai-scope') as HTMLSelectElement | null;
  const skillSel = pane.querySelector('#insp-ai-skill') as HTMLSelectElement | null;
  const pathIn = pane.querySelector('#insp-ai-path') as HTMLInputElement | null;
  const customIn = pane.querySelector('#insp-ai-custom-input') as HTMLTextAreaElement | null;
  const outputPreview = pane.querySelector('#insp-ai-prompt-output') as HTMLTextAreaElement | null;
  const copyBtn = pane.querySelector('#btn-copy-ai-prompt') as HTMLButtonElement | null;

  const refreshPreview = () => {
    if (!outputPreview) return;
    const selectedScope = (scopeSel?.value || 'slide') as SurgicalAiScope;
    const skillName = (skillSel?.value || 'new-motion-presentation') as SurgicalAiSkill;
    const pathVal = pathIn?.value ?? '';
    const draft = customIn?.value ?? '';
    const aiMeta = callbacks.getAiMeta();

    callbacks.onDraftChange(draft, selectedScope);

    outputPreview.value = MotionReelImporter.buildSurgicalEditPrompt({
      skillName,
      projectRootPath: aiMeta?.projectRootPath || pathVal,
      outputDirPath: pathVal,
      scope: selectedScope,
      slideIndex: Math.max(1, slideIdx + 1),
      totalSlides,
      slideTitle: activeSlide.title,
      hasIdleLoop: Boolean(activeSlide.idleLoopAsset || activeSlide.expectedIdleLoopFileName),
      currentTimecodeSec: callbacks.getCurrentVideoTimeSec(),
      sourceMeta: activeSlide.sourceMeta,
      userInstruction: draft,
      language: getLanguage(),
    });
  };

  scope.listen(scopeSel, 'change', refreshPreview);
  scope.listen(skillSel, 'change', () => {
    if (!skillSel) return;
    const curr = callbacks.getAiMeta() || {};
    callbacks.setAiMeta({
      ...curr,
      skillName: skillSel.value as SurgicalAiSkill,
    });
    refreshPreview();
  });
  scope.listen(pathIn, 'input', refreshPreview);
  scope.listen(pathIn, 'change', () => {
    if (!pathIn) return;
    const curr = callbacks.getAiMeta() || {};
    callbacks.setAiMeta({
      ...curr,
      outputDirPath: pathIn.value.trim(),
      projectRootPath: curr.projectRootPath || pathIn.value.trim(),
    });
    refreshPreview();
  });
  scope.listen(customIn, 'input', refreshPreview);

  pane.querySelectorAll('.ai-quick-chip').forEach((chip) => {
    scope.listen(chip, 'click', () => {
      const snippet = (chip as HTMLElement).dataset.chipText || '';
      if (!snippet || !customIn) return;
      const current = customIn.value.trim();
      customIn.value = current ? `${current}\n- ${snippet}` : snippet;
      refreshPreview();
      customIn.focus();
    });
  });

  scope.listen(copyBtn, 'click', async () => {
    refreshPreview();
    const text = outputPreview?.value || '';
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      callbacks.onNotifyCopied();
    } catch {
      (outputPreview as any)?.select?.();
      document.execCommand?.('copy');
      callbacks.onNotifyCopied();
    }
  });
}
