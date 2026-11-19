/**
 * Leak-free component lifecycle and DOM helper utilities for Motion Presentation Studio.
 *
 * Wraps listener registration with deterministic removal callbacks so repeated
 * re-renders never accumulate duplicate handlers on persistent hosts or window/document.
 */

export interface EventTargetLike {
  addEventListener: (
    type: string,
    listener: (ev: any) => void,
    options?: boolean | AddEventListenerOptions
  ) => void;
  removeEventListener: (
    type: string,
    listener: (ev: any) => void,
    options?: boolean | EventListenerOptions
  ) => void;
}

export class ComponentScope {
  private static globalActiveListeners = 0;

  private controller = new AbortController();
  private cleanups: Array<() => void> = [];
  private children = new Set<ComponentScope>();
  private activeListenerCount = 0;
  private disposed = false;

  /**
   * Returns total active listeners across all live ComponentScope instances.
   * Useful for deterministic zero-leak verification in tests.
   */
  public static getGlobalActiveListenerCount(): number {
    return ComponentScope.globalActiveListeners;
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public getActiveListenerCount(): number {
    let total = this.activeListenerCount;
    this.children.forEach((child) => {
      total += child.getActiveListenerCount();
    });
    return total;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Attaches a tracked event listener that is automatically removed on `clear()` or `dispose()`.
   */
  public listen<E = Event>(
    target: EventTargetLike | null | undefined,
    type: string,
    listener: (ev: E) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!target || typeof target.addEventListener !== 'function') return;
    if (this.disposed) return;

    const wrappedListener = listener as (ev: any) => void;
    target.addEventListener(type, wrappedListener, options);
    this.activeListenerCount++;
    ComponentScope.globalActiveListeners++;

    let removed = false;
    this.cleanups.push(() => {
      if (removed) return;
      removed = true;
      try {
        target.removeEventListener?.(type, wrappedListener, options);
      } finally {
        this.activeListenerCount = Math.max(0, this.activeListenerCount - 1);
        ComponentScope.globalActiveListeners = Math.max(0, ComponentScope.globalActiveListeners - 1);
      }
    });
  }

  /**
   * Registers an arbitrary cleanup callback invoked when the scope clears or disposes.
   */
  public addCleanup(fn: () => void): void {
    if (this.disposed) {
      fn();
      return;
    }
    this.cleanups.push(fn);
  }

  /**
   * Creates a child scope bound to this scope's lifecycle.
   */
  public createChildScope(): ComponentScope {
    const child = new ComponentScope();
    if (this.disposed) {
      child.dispose();
    } else {
      this.children.add(child);
    }
    return child;
  }

  /**
   * Removes all listeners and runs registered cleanups so the scope can be reused on re-render.
   */
  public clear(): void {
    this.children.forEach((child) => {
      child.dispose();
    });
    this.children.clear();

    const toRun = this.cleanups.splice(0, this.cleanups.length);
    for (let i = toRun.length - 1; i >= 0; i--) {
      toRun[i]();
    }

    if (!this.controller.signal.aborted) {
      this.controller.abort();
    }
    if (!this.disposed) {
      this.controller = new AbortController();
    }
  }

  /**
   * Permanently disposes this scope and all child scopes.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }
}

export function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
