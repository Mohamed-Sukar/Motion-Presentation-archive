import { computeLayoutPlan, computeStageFrameSize } from '../layout/LayoutGovernor';

interface LabScenario {
  title: string;
  width: number;
  height: number;
  isRtl: boolean;
  aspectRatio: number;
  aspectLabel: string;
}

const SCENARIOS: LabScenario[] = [
  { title: 'Min Window (EN)', width: 720, height: 500, isRtl: false, aspectRatio: 16 / 9, aspectLabel: '16:9' },
  { title: '125% Zoom Effective (EN)', width: 576, height: 400, isRtl: false, aspectRatio: 16 / 9, aspectLabel: '16:9' },
  { title: 'Compact Half-Screen (AR)', width: 860, height: 560, isRtl: true, aspectRatio: 16 / 9, aspectLabel: '16:9' },
  { title: 'Laptop Compact (EN)', width: 1024, height: 680, isRtl: false, aspectRatio: 9 / 16, aspectLabel: '9:16' },
  { title: 'Studio Full (AR)', width: 1366, height: 768, isRtl: true, aspectRatio: 4 / 3, aspectLabel: '4:3' },
];

/**
 * Dev-only multi-viewport responsive layout verification board (`?lab=1`).
 */
export class LayoutLabView {
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('dir', 'ltr');
    this.root.innerHTML = `
      <div class="layout-lab-shell">
        <header class="layout-lab-header">
          <div>
            <h1>Motion Presentation — Responsive Layout Lab</h1>
            <p>Live matrix verifying <code>LayoutGovernor</code> modes, Focus Mode, docked/overlay/sheet inspector, and aspect-aware stage safe areas.</p>
          </div>
          <a class="btn btn-sm" href="?">Exit Lab</a>
        </header>
        <div class="layout-lab-grid">
          ${SCENARIOS.map((sc) => this.renderScenarioCard(sc)).join('')}
        </div>
      </div>
    `;
  }

  private renderScenarioCard(sc: LabScenario): string {
    const plan = computeLayoutPlan({
      viewportWidth: sc.width,
      viewportHeight: sc.height,
      isRtl: sc.isRtl,
      requestedSequenceMode: 'docked',
      requestedNavigatorOpen: true,
      requestedInspectorOpen: true,
      floatingSequenceSize: { width: 620, height: 176 },
      inspectorWidth: 300,
    });
    const frame = computeStageFrameSize({
      containerWidth: plan.stageSafeWidth,
      containerHeight: plan.stageSafeHeight,
      aspectRatio: sc.aspectRatio,
    });
    const scale = Math.min(0.32, 340 / sc.width);
    const previewW = Math.round(sc.width * scale);
    const previewH = Math.round(sc.height * scale);

    return `
      <section class="layout-lab-card" dir="${sc.isRtl ? 'rtl' : 'ltr'}">
        <div class="layout-lab-card-meta">
          <strong>${sc.title}</strong>
          <span>${sc.width}x${sc.height} · ${sc.aspectLabel}</span>
        </div>
        <div class="layout-lab-badges">
          <span class="lab-badge">${plan.focusMode ? 'focusMode' : 'workspace'}</span>
          <span class="lab-badge">seq: ${plan.effectiveSequenceMode}</span>
          <span class="lab-badge">nav: ${plan.navigatorMode}</span>
          <span class="lab-badge">insp: ${plan.inspectorMode}</span>
          <span class="lab-badge">tb: ${plan.toolbarTier} (${plan.overflowToolbarButtons.length} overflow)</span>
        </div>
        <div class="layout-lab-viewport" style="width:${previewW}px;height:${previewH}px;">
          <div class="lab-tb" style="height:${Math.round(44 * scale)}px;"></div>
          <div class="lab-body">
            ${plan.navigatorMode === 'docked' ? `<div class="lab-nav" style="width:${Math.round(220 * scale)}px;"></div>` : ''}
            <div class="lab-stage">
              <div class="lab-canvas" style="width:${Math.round(frame.width * scale)}px;height:${Math.round(frame.height * scale)}px;"></div>
            </div>
            ${plan.inspectorMode === 'docked' ? `<div class="lab-insp" style="width:${Math.round(plan.dockedInspectorWidth * scale)}px;"></div>` : ''}
          </div>
          ${plan.effectiveSequenceMode === 'docked' ? `<div class="lab-seq" style="height:${Math.round(126 * scale)}px;"></div>` : ''}
        </div>
        <div class="layout-lab-metrics">
          Safe stage: ${plan.stageSafeWidth}x${plan.stageSafeHeight} · Rendered frame: ${frame.width}x${frame.height}
        </div>
      </section>
    `;
  }
}
