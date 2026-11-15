import { t } from '../../core/i18n';
import { ComponentScope, escapeHtml } from '../core/ComponentLifecycle';
import { Icons } from '../icons';

declare const __APP_VERSION__: string | undefined;

export const FALLBACK_APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim() ? __APP_VERSION__.trim() : '1.2.1';

export function openAboutModalView(
  host: HTMLElement,
  scope: ComponentScope,
  version: string,
  onBeforeClose: () => void
): () => void {
  scope.clear();
  let isClosed = false;
  const prevFocused =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    onBeforeClose();
    scope.clear();
    host.innerHTML = '';
    if (prevFocused && (prevFocused as any).isConnected) {
      prevFocused.focus?.();
    }
  };

  if (typeof window !== 'undefined') {
    scope.listen<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    });
  }

  const safeVersion = escapeHtml(version || FALLBACK_APP_VERSION);

  host.innerHTML = `
    <div class="reel-cue-modal-backdrop apple-modal-backdrop-centered" id="about-modal-backdrop">
      <div class="choice-modal about-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('about.modalAria'))}">
        <button class="icon-btn about-modal-close" id="btn-about-close" aria-label="${escapeHtml(t('modal.close'))}">${Icons.close}</button>
        <div class="about-modal-hero">
          <div class="about-modal-icon" aria-hidden="true">${Icons.brandAppIcon}</div>
          <h2 class="about-modal-title">Motion Presentation Studio</h2>
          <span class="about-modal-version tabular-nums">${escapeHtml(t('about.version', { version: safeVersion }))}</span>
        </div>
        <p class="about-modal-tagline">${escapeHtml(t('about.tagline'))}</p>
        <p class="about-modal-credit">${escapeHtml(t('about.techCredit'))}</p>
        <div class="about-modal-actions">
          <button class="btn btn-primary about-done-btn" id="btn-about-done" type="button">${escapeHtml(t('about.closeBtn'))}</button>
        </div>
      </div>
    </div>
  `;

  scope.listen(host.querySelector('#btn-about-close'), 'click', cleanup);
  scope.listen(host.querySelector('#btn-about-done'), 'click', cleanup);
  scope.listen<MouseEvent>(host.querySelector('#about-modal-backdrop'), 'click', (e) => {
    if ((e.target as HTMLElement | null)?.id === 'about-modal-backdrop') {
      cleanup();
    }
  });
  (host.querySelector('#btn-about-done') as HTMLElement | null)?.focus?.();

  return cleanup;
}
