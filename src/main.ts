import './ui/styles/main.css';
import './ui/styles/studio-theme.css';
import { MotionPresentationApp } from './ui/App';

declare const __APP_VERSION__: string | undefined;

const splashEl = document.getElementById('app-splash');
const splashVersionEl = document.getElementById('app-splash-version');
if (splashVersionEl && typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim()) {
  splashVersionEl.textContent = `v${__APP_VERSION__.trim()}`;
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new MotionPresentationApp(appRoot);
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
