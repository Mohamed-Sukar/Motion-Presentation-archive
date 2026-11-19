export type LayerKind =
  | 'stage'
  | 'sheet'
  | 'popover'
  | 'context-menu'
  | 'modal'
  | 'command-palette'
  | 'presenter-overlay'
  | 'toast';

export interface LayerEntry {
  id: string;
  kind: LayerKind;
  priority: number;
  close?: () => void;
}

const DEFAULT_PRIORITIES: Record<LayerKind, number> = {
  stage: 0,
  sheet: 20,
  popover: 30,
  'context-menu': 40,
  modal: 50,
  'command-palette': 60,
  'presenter-overlay': 80,
  toast: 90,
};

/**
 * Tracks active transient UI layers so Escape, backdrop clicks,
 * and presentation isolation operate predictably without hardcoded z-index races.
 */
export class LayerStack {
  private layers: LayerEntry[] = [];
  private presenting = false;
  private listeners = new Set<() => void>();

  setPresenting(flag: boolean): void {
    if (this.presenting === flag) return;
    this.presenting = flag;
    this.notify();
  }

  isPresenting(): boolean {
    return this.presenting;
  }

  shouldSuppressToasts(): boolean {
    return this.presenting || this.hasKind('presenter-overlay');
  }

  push(entry: Omit<LayerEntry, 'priority'> & { priority?: number }): () => void {
    const resolved: LayerEntry = {
      ...entry,
      priority: entry.priority ?? DEFAULT_PRIORITIES[entry.kind],
    };
    this.layers = this.layers.filter((item) => item.id !== resolved.id);
    this.layers.push(resolved);
    this.layers.sort((a, b) => a.priority - b.priority);
    this.notify();
    return () => this.remove(resolved.id);
  }

  remove(id: string): void {
    const prevLen = this.layers.length;
    this.layers = this.layers.filter((item) => item.id !== id);
    if (this.layers.length !== prevLen) {
      this.notify();
    }
  }

  hasKind(kind: LayerKind): boolean {
    return this.layers.some((item) => item.kind === kind);
  }

  getTopmost(): LayerEntry | null {
    return this.layers.length > 0 ? this.layers[this.layers.length - 1] : null;
  }

  dismissTopmost(): boolean {
    const top = this.getTopmost();
    if (!top) return false;
    if (top.close) {
      top.close();
    } else {
      this.remove(top.id);
    }
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
