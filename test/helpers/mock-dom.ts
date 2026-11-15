/**
 * Headless In-Memory DOM & Browser Fixture for Motion Presentation Studio
 * Zero external npm dependencies. Native Node.js 18+ and TypeScript.
 */

export class MockEvent {
  type: string;
  target: any = null;
  currentTarget: any = null;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean = false;
  _propagationStopped: boolean = false;
  _immediatePropagationStopped: boolean = false;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {
    this._propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this._immediatePropagationStopped = true;
  }
}

export class MockCustomEvent extends MockEvent {
  detail: any;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; detail?: any } = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

export class MockKeyboardEvent extends MockEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;

  constructor(
    type: string,
    init: {
      key: string;
      code?: string;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      repeat?: boolean;
      bubbles?: boolean;
      cancelable?: boolean;
    }
  ) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.key = init.key;
    this.code = init.code || init.key;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.repeat = !!init.repeat;
  }
}

export class MockPointerEvent extends MockEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;

  constructor(
    type: string,
    init: {
      pointerId?: number;
      clientX?: number;
      clientY?: number;
      button?: number;
      buttons?: number;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
      bubbles?: boolean;
      cancelable?: boolean;
    } = {}
  ) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.pointerId = init.pointerId ?? 1;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 1;
    this.shiftKey = !!init.shiftKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.altKey = !!init.altKey;
  }
}

export class MockMouseEvent extends MockEvent {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;

  constructor(
    type: string,
    init: {
      clientX?: number;
      clientY?: number;
      button?: number;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
      bubbles?: boolean;
      cancelable?: boolean;
    } = {}
  ) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.button = init.button ?? 0;
    this.shiftKey = !!init.shiftKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.altKey = !!init.altKey;
  }
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

export class MockHTMLElement {
  tagName: string;
  id: string = '';
  className: string = '';
  style: Record<string, string>;
  dataset: Record<string, string> = {};
  children: MockHTMLElement[] = [];
  parentElement: MockHTMLElement | null = null;
  attributes: Record<string, string> = {};
  private listeners: Map<string, Set<(e: any) => void>> = new Map();
  private bounds = { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0 };
  private capturedPointers = new Set<number>();
  value: string = '';
  files: File[] = [];
  checked: boolean = false;
  disabled: boolean = false;
  tabIndex: number = 0;
  _textContent: string = '';

  constructor(tagName = 'div') {
    this.tagName = (tagName || 'div').toUpperCase();
    const styleObj: Record<string, any> = {};
    Object.defineProperties(styleObj, {
      setProperty: {
        enumerable: false,
        value: (prop: string, val: string) => {
          styleObj[prop] = String(val);
        },
      },
      getPropertyValue: {
        enumerable: false,
        value: (prop: string) => (styleObj[prop] !== undefined ? String(styleObj[prop]) : ''),
      },
      removeProperty: {
        enumerable: false,
        value: (prop: string) => {
          const prev = styleObj[prop] ?? '';
          delete styleObj[prop];
          return String(prev);
        },
      },
    });
    this.style = styleObj as Record<string, string>;
  }

  setBounds(bounds: Partial<typeof this.bounds>): void {
    this.bounds = { ...this.bounds, ...bounds };
    this.bounds.right = this.bounds.left + (bounds.width ?? this.bounds.width);
    this.bounds.bottom = this.bounds.top + (bounds.height ?? this.bounds.height);
    this.bounds.x = this.bounds.left;
    this.bounds.y = this.bounds.top;
  }

  scrollIntoView(): void {}

  async requestFullscreen(): Promise<void> {}

  appendChild(child: MockHTMLElement): MockHTMLElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockHTMLElement): MockHTMLElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  insertBefore(newChild: MockHTMLElement, refChild: MockHTMLElement | null): MockHTMLElement {
    if (!refChild) {
      return this.appendChild(newChild);
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      return this.appendChild(newChild);
    }
    newChild.parentElement = this;
    this.children.splice(idx, 0, newChild);
    return newChild;
  }

  getBoundingClientRect() {
    return { ...this.bounds };
  }

  setPointerCapture(id: number): void {
    this.capturedPointers.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.capturedPointers.has(id);
  }

  releasePointerCapture(id: number): void {
    this.capturedPointers.delete(id);
  }

  classList = {
    add: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      names.forEach((n) => set.add(n));
      this.className = Array.from(set).join(' ');
    },
    remove: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      names.forEach((n) => set.delete(n));
      this.className = Array.from(set).join(' ');
    },
    toggle: (name: string, force?: boolean) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      const has = set.has(name);
      const should = force !== undefined ? force : !has;
      if (should) set.add(name);
      else set.delete(name);
      this.className = Array.from(set).join(' ');
      return should;
    },
    contains: (name: string) => {
      return this.className.split(/\s+/).filter(Boolean).includes(name);
    },
  };

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return this.dataset[camel] !== undefined ? this.dataset[camel] : null;
    }
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name: string, value: string): void {
    const lower = name.toLowerCase();
    if (lower === 'id') this.id = value;
    else if (lower === 'class') this.className = value;
    else if (lower === 'disabled') this.disabled = true;
    else if (lower === 'checked') this.checked = true;
    else if (lower === 'tabindex') this.tabIndex = parseInt(value, 10) || 0;
    else if (lower.startsWith('data-')) {
      const camel = lower.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = value;
    } else {
      this.attributes[lower] = value;
    }
  }

  removeAttribute(name: string): void {
    const lower = name.toLowerCase();
    if (lower === 'id') this.id = '';
    else if (lower === 'class') this.className = '';
    else if (lower === 'disabled') this.disabled = false;
    else if (lower === 'checked') this.checked = false;
    else if (lower === 'tabindex') this.tabIndex = 0;
    else if (lower.startsWith('data-')) {
      const camel = lower.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[camel];
    } else {
      delete this.attributes[lower];
    }
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  querySelector(sel: string): MockHTMLElement | null {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel: string): MockHTMLElement[] {
    const trimmed = sel.trim();
    if (!trimmed) return [];

    // Descendant combinator e.g. "#fs-grid-host .slide-grid-modal"
    if (trimmed.includes(' ')) {
      const parts = trimmed.split(/\s+/);
      let currentSet: MockHTMLElement[] = [this];
      for (const part of parts) {
        const nextSet: MockHTMLElement[] = [];
        for (const el of currentSet) {
          nextSet.push(...el.querySelectorAll(part));
        }
        currentSet = nextSet;
      }
      return currentSet;
    }

    const res: MockHTMLElement[] = [];
    const checkSingle = (el: MockHTMLElement): boolean => {
      if (trimmed === '*') return true;

      // Handle multi-class / compound e.g. .grid-jump-card.active or button.reel-mode-btn
      let remaining = trimmed;
      const tagMatch = remaining.match(/^([a-zA-Z0-9_-]+)/);
      if (tagMatch) {
        if (el.tagName !== tagMatch[1].toUpperCase()) return false;
        remaining = remaining.slice(tagMatch[1].length);
      }

      const idMatch = remaining.match(/#([a-zA-Z0-9_-]+)/);
      if (idMatch) {
        if (el.id !== idMatch[1]) return false;
        remaining = remaining.replace(idMatch[0], '');
      }

      const classMatches = remaining.matchAll(/\.([a-zA-Z0-9_-]+)/g);
      for (const cm of classMatches) {
        if (!el.classList.contains(cm[1])) return false;
        remaining = remaining.replace(cm[0], '');
      }

      const attrMatches = remaining.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g);
      for (const am of attrMatches) {
        const attrVal = el.getAttribute(am[1]);
        if (am[2] !== undefined) {
          if (attrVal !== am[2]) return false;
        } else {
          if (attrVal === null) return false;
        }
        remaining = remaining.replace(am[0], '');
      }

      return remaining.length === 0;
    };

    const walk = (node: MockHTMLElement) => {
      for (const ch of node.children) {
        if (checkSingle(ch)) res.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return res;
  }

  closest(sel: string): MockHTMLElement | null {
    let curr: MockHTMLElement | null = this;
    while (curr) {
      if (sel.startsWith('.') && curr.classList.contains(sel.slice(1))) return curr;
      if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
      if (/^[a-zA-Z0-9]+$/.test(sel) && curr.tagName === sel.toUpperCase()) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  addEventListener(type: string, cb: (e: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (e: any) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(event: any): boolean {
    event.target = event.target || this;
    event.currentTarget = this;
    const list = this.listeners.get(event.type);
    if (list) {
      for (const l of Array.from(list)) {
        l(event);
        if (event._immediatePropagationStopped) break;
      }
    }
    if (event.bubbles && !event._propagationStopped && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  click(): void {
    this.dispatchEvent(new MockMouseEvent('click', { bubbles: true, cancelable: true }));
  }

  focus(): void {
    if ((globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
    this.dispatchEvent(new MockEvent('focus', { bubbles: false, cancelable: false }));
  }

  blur(): void {
    if ((globalThis as any).document && (globalThis as any).document.activeElement === this) {
      (globalThis as any).document.activeElement = null;
    }
    this.dispatchEvent(new MockEvent('blur', { bubbles: false, cancelable: false }));
  }

  set innerHTML(html: string) {
    this.children = [];
    this._textContent = '';
    parseHTMLToTree(html, this);
  }

  get innerHTML(): string {
    return this.children
      .map((c) => `<${c.tagName.toLowerCase()} id="${c.id}" class="${c.className}">${c.innerHTML}</${c.tagName.toLowerCase()}>`)
      .join('');
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join(' ');
  }

  set textContent(val: string) {
    this.children = [];
    this._textContent = val;
  }
}

/**
 * Robust stack-based HTML parser that handles arbitrary nesting and siblings
 */
export function parseHTMLToTree(html: string, rootParent: MockHTMLElement): void {
  if (!html || typeof html !== 'string') return;

  const stack: MockHTMLElement[] = [rootParent];
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9_-]+)((?:\s+[^"'>/=\s]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    // 1. Comment
    if (match[0].startsWith('<!--')) {
      continue;
    }

    // 2. Text node
    if (match[5]) {
      const text = match[5].trim();
      if (text && stack.length > 0) {
        const top = stack[stack.length - 1];
        top._textContent += (top._textContent ? ' ' : '') + text;
      }
      continue;
    }

    const isClosing = Boolean(match[1]);
    const tagName = match[2];
    const rawAttrs = match[3] || '';
    const hasTrailingSlash = Boolean(match[4]);

    if (!tagName) continue;

    const lowerTag = tagName.toLowerCase();
    const isVoid = isClosing ? false : (hasTrailingSlash || VOID_ELEMENTS.has(lowerTag));

    if (isClosing) {
      // Pop stack up to matching tag
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === lowerTag) {
          stack.length = i;
          break;
        }
      }
    } else {
      // Opening element
      const el = createElementByTag(tagName);
      applyAttributes(el, rawAttrs);

      const currentParent = stack[stack.length - 1];
      if (currentParent) {
        el.parentElement = currentParent;
        currentParent.children.push(el);
      }

      if (!isVoid) {
        stack.push(el);
      }
    }
  }
}

function applyAttributes(el: MockHTMLElement, rawAttrs: string): void {
  if (!rawAttrs || typeof rawAttrs !== 'string') return;

  const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));

    if (name === 'id') {
      el.id = value;
    } else if (name === 'class') {
      el.className = value;
    } else if (name === 'style') {
      const rules = value.split(';');
      for (const rule of rules) {
        const idx = rule.indexOf(':');
        if (idx !== -1) {
          const k = rule.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const v = rule.slice(idx + 1).trim();
          if (k) el.style[k] = v;
        }
      }
    } else if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[camel] = value;
    } else {
      el.setAttribute(name, value);
    }
  }
}

export function createElementByTag(tag: string): MockHTMLElement {
  const t = (typeof tag === 'string' && tag.trim() ? tag.trim() : 'div').toLowerCase();
  if (t === 'canvas') return new MockHTMLCanvasElement();
  if (t === 'video') return new MockHTMLVideoElement();
  if (t === 'img') return new MockHTMLImageElement();
  return new MockHTMLElement(t);
}

export class MockCanvasRenderingContext2D {
  canvas: MockHTMLCanvasElement;
  private lastDrawnSource: any = null;
  fillStyle: string | any = '#000000';
  strokeStyle: string | any = '#000000';
  globalAlpha: number = 1.0;
  lineWidth: number = 1.0;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'high';

  drawCalls: Array<{ method: string; args: any[]; timestampMs: number }> = [];
  fillRectHistory: Array<{ x: number; y: number; w: number; h: number; fillStyle: string; alpha: number }> = [];

  constructor(canvas: MockHTMLCanvasElement) {
    this.canvas = canvas;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const fill = String(this.fillStyle);
    this.fillRectHistory.push({ x, y, w, h, fillStyle: fill, alpha: this.globalAlpha });
    this.drawCalls.push({ method: 'fillRect', args: [x, y, w, h], timestampMs: performance.now() });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.drawCalls.push({ method: 'clearRect', args: [x, y, w, h], timestampMs: performance.now() });
  }

  drawImage(img: any, ...args: any[]): void {
    this.lastDrawnSource = img;
    this.drawCalls.push({ method: 'drawImage', args: [img, ...args], timestampMs: performance.now() });
  }

  getImageData(
    _sx: number,
    _sy: number,
    sw: number,
    sh: number
  ): { data: Uint8ClampedArray; width: number; height: number } {
    const w = Math.max(1, Math.round(sw || this.canvas.width || 1));
    const h = Math.max(1, Math.round(sh || this.canvas.height || 1));
    const globalRenderer = (globalThis as any).__mockVideoFrameRenderer;
    const renderer =
      typeof this.lastDrawnSource?._frameRenderer === 'function'
        ? this.lastDrawnSource._frameRenderer
        : typeof globalRenderer === 'function'
          ? globalRenderer
          : null;
    if (renderer) {
      const timeSec = Number(this.lastDrawnSource?.currentTime ?? 0);
      const rendered = renderer(timeSec, w, h, this.lastDrawnSource);
      if (rendered && rendered.length === w * h * 4) {
        return { data: rendered, width: w, height: h };
      }
    }
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }

  save(): void {
    this.drawCalls.push({ method: 'save', args: [], timestampMs: performance.now() });
  }

  restore(): void {
    this.drawCalls.push({ method: 'restore', args: [], timestampMs: performance.now() });
  }

  translate(x: number, y: number): void {
    this.drawCalls.push({ method: 'translate', args: [x, y], timestampMs: performance.now() });
  }

  scale(x: number, y: number): void {
    this.drawCalls.push({ method: 'scale', args: [x, y], timestampMs: performance.now() });
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.drawCalls.push({ method: 'setTransform', args: [a, b, c, d, e, f], timestampMs: performance.now() });
  }

  beginPath(): void {
    this.drawCalls.push({ method: 'beginPath', args: [], timestampMs: performance.now() });
  }
  closePath(): void {
    this.drawCalls.push({ method: 'closePath', args: [], timestampMs: performance.now() });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.drawCalls.push({ method: 'rect', args: [x, y, w, h], timestampMs: performance.now() });
  }
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void {
    this.drawCalls.push({ method: 'arc', args: [x, y, r, startAngle, endAngle], timestampMs: performance.now() });
  }
  clip(): void {
    this.drawCalls.push({ method: 'clip', args: [], timestampMs: performance.now() });
  }
  stroke(): void {}
  fill(): void {}

  hasDrawnBlackout(): boolean {
    return this.fillRectHistory.some(
      (r) =>
        (r.fillStyle === '#000000' || r.fillStyle === 'black') &&
        r.w >= this.canvas.width &&
        r.h >= this.canvas.height
    );
  }

  hasDrawnWhiteout(): boolean {
    return this.fillRectHistory.some(
      (r) =>
        (r.fillStyle === '#ffffff' || r.fillStyle === 'white') &&
        r.w >= this.canvas.width &&
        r.h >= this.canvas.height
    );
  }

  getLastFillRect() {
    return this.fillRectHistory[this.fillRectHistory.length - 1] || null;
  }

  reset(): void {
    this.lastDrawnSource = null;
    this.drawCalls = [];
    this.fillRectHistory = [];
  }
}

export class MockHTMLCanvasElement extends MockHTMLElement {
  width: number = 1920;
  height: number = 1080;
  private ctx: MockCanvasRenderingContext2D;

  constructor() {
    super('canvas');
    this.ctx = new MockCanvasRenderingContext2D(this);
  }

  getContext(type: string): MockCanvasRenderingContext2D | null {
    return type === '2d' ? this.ctx : null;
  }

  toDataURL(): string {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  }

  toBlob(cb: (b: Blob | null) => void, type = 'image/png'): void {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
  }
}

export class MockHTMLVideoElement extends MockHTMLElement {
  private _currentTime: number = 0;
  duration: number = 10.0;
  videoWidth: number = 1920;
  videoHeight: number = 1080;
  readyState: number = 4;
  seeking: boolean = false;
  paused: boolean = true;
  ended: boolean = false;
  playbackRate: number = 1.0;
  muted: boolean = true;
  volume: number = 1.0;
  private _src: string = '';
  _frameRenderer?: (
    timeSec: number,
    width: number,
    height: number,
    videoEl?: MockHTMLVideoElement
  ) => Uint8ClampedArray;

  constructor() {
    super('video');
    const mockDur = (globalThis as any).__mockVideoDuration;
    if (typeof mockDur === 'number' && Number.isFinite(mockDur) && mockDur > 0) {
      this.duration = mockDur;
    }
  }

  get src(): string {
    return this._src;
  }

  set src(url: string) {
    this._src = url;
    if (url) {
      this.dispatchEvent(new MockEvent('loadedmetadata'));
      this.dispatchEvent(new MockEvent('loadeddata'));
      this.dispatchEvent(new MockEvent('canplay'));
    }
  }

  get currentTime(): number {
    return this._currentTime;
  }

  set currentTime(t: number) {
    this._currentTime = Math.max(0, Math.min(this.duration, t));
    this.dispatchEvent(new MockEvent('seeked'));
    this.dispatchEvent(new MockEvent('timeupdate'));
  }

  async play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new MockEvent('play'));
  }

  pause(): void {
    this.paused = true;
    this.dispatchEvent(new MockEvent('pause'));
  }

  load(): void {}

  removeAttribute(attr: string): void {
    super.removeAttribute(attr);
    if (attr === 'src') this._src = '';
  }

  requestVideoFrameCallback(cb: () => void): number {
    return (setTimeout(cb, (globalThis as any).__mockVideoFrameRenderer ? 0 : 16) as unknown) as number;
  }

  cancelVideoFrameCallback(id: number): void {
    clearTimeout(id);
  }
}

export class MockHTMLImageElement extends MockHTMLElement {
  naturalWidth: number = 1920;
  naturalHeight: number = 1080;
  complete: boolean = true;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src: string = '';

  constructor() {
    super('img');
  }

  get src(): string {
    return this._src;
  }

  set src(url: string) {
    this._src = url;
    if (url) {
      this.complete = true;
      if (this.onload) {
        try {
          this.onload();
        } catch {}
      }
      this.dispatchEvent(new MockEvent('load'));
    }
  }
}

export class MockDesktopAPI {
  isDesktopApp = true;
  private _isFullScreen = false;
  private menuListeners: Array<(cmd: string) => void> = [];
  private openProjectListeners: Array<(payload: any) => void> = [];
  windowTitle: string = '';
  language: 'ar' | 'en' | null = null;
  systemLocale: 'ar' | 'en' = 'ar';

  async setFullScreen(f: boolean): Promise<boolean> {
    this._isFullScreen = f;
    return f;
  }

  async isFullScreen(): Promise<boolean> {
    return this._isFullScreen;
  }

  async setWindowTitle(title: string): Promise<void> {
    this.windowTitle = title;
  }

  async getSystemLocale(): Promise<'ar' | 'en'> {
    return this.systemLocale;
  }

  async setLanguage(lang: 'ar' | 'en'): Promise<'ar' | 'en'> {
    this.language = lang;
    return lang;
  }

  onMenuCommand(cb: (cmd: string) => void): void {
    this.menuListeners.push(cb);
  }

  triggerMenuCommand(cmd: string): void {
    this.menuListeners.forEach((l) => l(cmd));
  }

  onOpenProjectFile(cb: (payload: any) => void): void {
    this.openProjectListeners.push(cb);
  }

  triggerOpenProjectFile(payload: any): void {
    this.openProjectListeners.forEach((l) => l(payload));
  }

  getPathForFile(file: File): string {
    return (file as any).path || `C:\\Mock\\${file.name}`;
  }
}

export interface MockEnvironment {
  window: any;
  document: any;
  root: MockHTMLElement;
  desktopAPI: MockDesktopAPI;
  teardown: () => void;
}

let originalGlobals: Record<string, any> | null = null;
const activeRafTimers = new Set<NodeJS.Timeout>();
const activeWindowTimers = new Set<NodeJS.Timeout>();

export function setupMockDOM(): MockEnvironment {
  if (originalGlobals) teardownMockDOM();

  const desktopAPI = new MockDesktopAPI();
  const root = new MockHTMLElement('div');
  root.id = 'app';

  const windowListeners = new Map<string, Set<(e: any) => void>>();
  const docListeners = new Map<string, Set<(e: any) => void>>();

  const rafImpl = (cb: any) => {
    const timer = setTimeout(() => {
      activeRafTimers.delete(timer);
      cb(performance.now());
    }, 16);
    activeRafTimers.add(timer);
    return (timer as unknown) as number;
  };
  const cancelRafImpl = (id: any) => {
    clearTimeout(id);
    activeRafTimers.delete(id);
  };

  const setTimeoutImpl = (cb: any, ms?: number, ...args: any[]) => {
    const timer = setTimeout(() => {
      activeWindowTimers.delete(timer);
      cb(...args);
    }, ms);
    activeWindowTimers.add(timer);
    return (timer as unknown) as number;
  };
  const clearTimeoutImpl = (id: any) => {
    clearTimeout(id);
    activeWindowTimers.delete(id);
  };

  const storageData = new Map<string, string>();
  const mockLocalStorage: any = {
    getItem: (key: string) => (storageData.has(key) ? storageData.get(key)! : null),
    setItem: (key: string, val: string) => {
      storageData.set(key, String(val));
    },
    removeItem: (key: string) => {
      storageData.delete(key);
    },
    clear: () => {
      storageData.clear();
    },
    get length() {
      return storageData.size;
    },
    key: (index: number) => Array.from(storageData.keys())[index] ?? null,
  };

  const windowMock: any = {
    addEventListener: (t: string, cb: any) => {
      if (!windowListeners.has(t)) windowListeners.set(t, new Set());
      windowListeners.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: any) => {
      windowListeners.get(t)?.delete(cb);
    },
    dispatchEvent: (e: any) => {
      e.target = e.target || windowMock;
      const list = windowListeners.get(e.type);
      if (list) {
        for (const l of Array.from(list)) {
          l(e);
          if (e._immediatePropagationStopped) break;
        }
      }
      return !e.defaultPrevented;
    },
    desktopAPI,
    localStorage: mockLocalStorage,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    requestAnimationFrame: rafImpl,
    cancelAnimationFrame: cancelRafImpl,
  };
  windowMock.window = windowMock;

  const documentElementMock = new MockHTMLElement('html');
  documentElementMock.setAttribute('lang', 'ar');
  documentElementMock.setAttribute('dir', 'rtl');
  const bodyMock = new MockHTMLElement('body');

  const documentMock: any = {
    title: '',
    documentElement: documentElementMock,
    body: bodyMock,
    activeElement: null,
    fullscreenElement: null,
    exitFullscreen: async () => {},
    createElement: createElementByTag,
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    getElementById: (id: string) => root.querySelector(`#${id}`),
    addEventListener: (t: string, cb: any) => {
      if (!docListeners.has(t)) docListeners.set(t, new Set());
      docListeners.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: any) => {
      docListeners.get(t)?.delete(cb);
    },
    dispatchEvent: (e: any) => {
      e.target = e.target || documentMock;
      const list = docListeners.get(e.type);
      if (list) {
        for (const l of Array.from(list)) {
          l(e);
          if (e._immediatePropagationStopped) break;
        }
      }
      return !e.defaultPrevented;
    },
  };
  windowMock.document = documentMock;

  originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: (globalThis as any).localStorage,
    HTMLElement: (globalThis as any).HTMLElement,
    HTMLCanvasElement: (globalThis as any).HTMLCanvasElement,
    HTMLVideoElement: (globalThis as any).HTMLVideoElement,
    HTMLImageElement: (globalThis as any).HTMLImageElement,
    HTMLInputElement: (globalThis as any).HTMLInputElement,
    Image: (globalThis as any).Image,
    KeyboardEvent: (globalThis as any).KeyboardEvent,
    PointerEvent: (globalThis as any).PointerEvent,
    MouseEvent: (globalThis as any).MouseEvent,
    CustomEvent: (globalThis as any).CustomEvent,
    Event: (globalThis as any).Event,
    requestAnimationFrame: (globalThis as any).requestAnimationFrame,
    cancelAnimationFrame: (globalThis as any).cancelAnimationFrame,
  };

  Object.assign(globalThis, {
    window: windowMock,
    document: documentMock,
    localStorage: mockLocalStorage,
    HTMLElement: MockHTMLElement,
    HTMLCanvasElement: MockHTMLCanvasElement,
    HTMLVideoElement: MockHTMLVideoElement,
    HTMLImageElement: MockHTMLImageElement,
    HTMLInputElement: MockHTMLElement,
    Image: MockHTMLImageElement,
    KeyboardEvent: MockKeyboardEvent,
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    CustomEvent: MockCustomEvent,
    Event: MockEvent,
    requestAnimationFrame: rafImpl,
    cancelAnimationFrame: cancelRafImpl,
  });

  return {
    window: windowMock,
    document: documentMock,
    root,
    desktopAPI,
    teardown: teardownMockDOM,
  };
}

export function teardownMockDOM(): void {
  for (const timer of activeRafTimers) {
    clearTimeout(timer);
  }
  activeRafTimers.clear();
  for (const timer of activeWindowTimers) {
    clearTimeout(timer);
  }
  activeWindowTimers.clear();
  if (!originalGlobals) return;
  for (const [k, v] of Object.entries(originalGlobals)) {
    if (v === undefined) {
      delete (globalThis as any)[k];
    } else {
      (globalThis as any)[k] = v;
    }
  }
  originalGlobals = null;
}
