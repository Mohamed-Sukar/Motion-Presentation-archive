import './ui/styles/fonts.css';
import './ui/styles/main.css';
import './ui/styles/studio-theme.css';
import { MotionPresentationApp } from './ui/App';
import { PresenterWindowApp } from './ui/components/PresenterWindowApp';

declare const __APP_VERSION__: string | undefined;

const splashEl = document.getElementById('app-splash');
const splashVersionEl = document.getElementById('app-splash-version');
if (splashVersionEl && typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()) {
  splashVersionEl.textContent = `v${__APP_VERSION__.trim()}`;
}

const params = new URLSearchParams(window.location.search);
const appRoot = document.getElementById('app');

if (appRoot) {
  if (params.get('presenter') === '1') {
    const presenterApp = new PresenterWindowApp(appRoot);
    presenterApp.mount();
  } else if (
    params.get('lab') === '1' &&
    Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  ) {
    void import('./ui/lab/LayoutLabView').then(({ LayoutLabView }) => {
      const lab = new LayoutLabView(appRoot);
      lab.mount();
    });
  } else {
    new MotionPresentationApp(appRoot);
  }
}

if (splashEl) {
  requestAnimationFrame(() => {
    splashEl.style.pointerEvents = 'none';
    splashEl.style.opacity = '0';
    window.setTimeout(() => {
      splashEl.remove();
    }, 240);
  });
}
