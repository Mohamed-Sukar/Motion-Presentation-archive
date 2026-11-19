import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { attachModalDialogBehavior } from '../core/ModalDialog';
import { Icons } from '../icons';

declare const __APP_VERSION__: string | undefined;

export const FALLBACK_APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim() ? __APP_VERSION__.trim() : '1.2.1';

export function openAboutModalView(
  host: HTMLElement,
  scope: ComponentScope,
  version: string,
  onBeforeClose: () => void,
  layerStack?: LayerStack
): () => void {
  scope.clear();
  const safeVersion = escapeHtml(version || FALLBACK_APP_VERSION);

  host.innerHTML = `
    <div class="modal-backdrop apple-modal-backdrop-centered" id="about-modal-backdrop" role="presentation">
      <div class="modal-card about-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('about.modalAria'))}">
        <button class="btn btn-icon-only about-modal-close" id="btn-about-close" type="button" title="${escapeHtml(t('modal.close'))}" aria-label="${escapeHtml(t('modal.close'))}">${Icons.close}</button>
        <div class="about-modal-hero">
          <div class="about-modal-icon" aria-hidden="true">${Icons.brandAppIcon}</div>
          <h2 class="about-modal-title">Motion Presentation Studio</h2>
          <span class="about-modal-version tabular-nums">${escapeHtml(t('about.version', { version: safeVersion }))}</span>
        </div>
        <p class="about-modal-tagline">${escapeHtml(t('about.tagline'))}</p>
        <p class="about-modal-credit">${escapeHtml(t('about.techCredit'))}</p>
        <div class="about-modal-actions">
          <span class="muted-note">${t('shortcuts.footerHint', { key: '<kbd class="kbd-badge">Esc</kbd>' })}</span>
        </div>
      </div>
    </div>
  `;

  const backdrop = host.querySelector('#about-modal-backdrop') as HTMLElement;
  const dialog = host.querySelector('.about-modal-card') as HTMLElement | null;
  const closeBtn = host.querySelector('#btn-about-close') as HTMLElement | null;

  const cleanup = attachModalDialogBehavior({
    host,
    scope,
    backdropEl: backdrop,
    dialogEl: dialog,
    layerStack,
    layerId: 'about-modal',
    layerKind: 'modal',
    initialFocusEl: closeBtn,
    onBeforeClose,
  });

  if (closeBtn) scope.listen(closeBtn, 'click', cleanup);

  return cleanup;
}
