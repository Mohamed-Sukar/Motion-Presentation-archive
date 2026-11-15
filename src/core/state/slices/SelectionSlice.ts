import { SlideNode } from '../../domain/types';
import { SelectionTarget } from '../types';

export interface SelectionSnapshotState {
  activePreviewIndex: number;
  selection: SelectionTarget;
  selectedSlideIds: string[];
  selectedTransitionSlideIds: string[];
}

/**
 * Manages active preview slide, primary selection target, and multi-select sets.
 */
export class SelectionSlice {
  private selection: SelectionTarget = { type: 'settings' };
  private selectedSlideIds = new Set<string>();
  private selectedTransitionSlideIds = new Set<string>();
  private activePreviewIndex = 0;

  getSelection(): SelectionTarget {
    return this.selection;
  }

  getActivePreviewIndex(): number {
    return this.activePreviewIndex;
  }

  setActivePreviewIndexRaw(index: number): void {
    this.activePreviewIndex = index;
  }

  applySingleSelection(target: SelectionTarget): void {
    this.selection = target;
    this.selectedSlideIds.clear();
    this.selectedTransitionSlideIds.clear();
    if (target.type === 'slide') {
      this.selectedSlideIds.add(target.slideId);
    } else if (target.type === 'transition') {
      this.selectedTransitionSlideIds.add(target.slideId);
    }
  }

  setPrimaryOnly(target: SelectionTarget): void {
    this.selection = target;
  }

  reconcilePrimarySelectionAfterToggle(slides: SlideNode[]): void {
    const validSlideIds = new Set(slides.map((s) => s.id));
    for (const id of Array.from(this.selectedSlideIds)) {
      if (!validSlideIds.has(id)) this.selectedSlideIds.delete(id);
    }
    for (const id of Array.from(this.selectedTransitionSlideIds)) {
      if (!validSlideIds.has(id)) this.selectedTransitionSlideIds.delete(id);
    }

    if (
      this.selection.type === 'slide' &&
      this.selectedSlideIds.has(this.selection.slideId)
    ) {
      return;
    }
    if (
      this.selection.type === 'transition' &&
      this.selectedTransitionSlideIds.has(this.selection.slideId)
    ) {
      return;
    }

    const lastSlideId = Array.from(this.selectedSlideIds).pop();
    if (lastSlideId) {
      this.selection = { type: 'slide', slideId: lastSlideId };
      const idx = slides.findIndex((s) => s.id === lastSlideId);
      if (idx !== -1) this.activePreviewIndex = idx;
      return;
    }

    const lastTransId = Array.from(this.selectedTransitionSlideIds).pop();
    if (lastTransId) {
      this.selection = { type: 'transition', slideId: lastTransId };
      const idx = slides.findIndex((s) => s.id === lastTransId);
      if (idx !== -1) this.activePreviewIndex = idx;
      return;
    }

    this.selection = { type: 'settings' };
  }

  getSelectedSlideIds(slides: SlideNode[]): string[] {
    return slides.filter((s) => this.selectedSlideIds.has(s.id)).map((s) => s.id);
  }

  getSelectedTransitionSlideIds(slides: SlideNode[]): string[] {
    return slides
      .filter((s) => this.selectedTransitionSlideIds.has(s.id))
      .map((s) => s.id);
  }

  isSlideSelected(slideId: string): boolean {
    return this.selectedSlideIds.has(slideId);
  }

  isTransitionSelected(slideId: string): boolean {
    return this.selectedTransitionSlideIds.has(slideId);
  }

  hasMultiSelectedSlide(slideId: string): boolean {
    return this.selectedSlideIds.has(slideId) && this.selectedSlideIds.size > 1;
  }

  getMultiSelectionSummary(slides: SlideNode[]): {
    slideIds: string[];
    transitionSlideIds: string[];
    totalCount: number;
  } {
    const slideIds = this.getSelectedSlideIds(slides);
    const transitionSlideIds = this.getSelectedTransitionSlideIds(slides);
    return {
      slideIds,
      transitionSlideIds,
      totalCount: slideIds.length + transitionSlideIds.length,
    };
  }

  setSelection(slides: SlideNode[], target: SelectionTarget): void {
    this.applySingleSelection(target);
    if (target.type === 'slide' || target.type === 'transition') {
      const idx = slides.findIndex((s) => s.id === target.slideId);
      if (idx !== -1) {
        this.activePreviewIndex = idx;
      }
    }
  }

  toggleSlideSelection(slides: SlideNode[], slideId: string): boolean {
    const idx = slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return false;

    if (this.selectedSlideIds.has(slideId)) {
      this.selectedSlideIds.delete(slideId);
      this.reconcilePrimarySelectionAfterToggle(slides);
    } else {
      this.selectedSlideIds.add(slideId);
      this.selection = { type: 'slide', slideId };
      this.activePreviewIndex = idx;
    }
    return true;
  }

  toggleTransitionSelection(slides: SlideNode[], slideId: string): boolean {
    const idx = slides.findIndex((s) => s.id === slideId);
    if (idx === -1) return false;

    if (this.selectedTransitionSlideIds.has(slideId)) {
      this.selectedTransitionSlideIds.delete(slideId);
      this.reconcilePrimarySelectionAfterToggle(slides);
    } else {
      this.selectedTransitionSlideIds.add(slideId);
      this.selection = { type: 'transition', slideId };
      this.activePreviewIndex = idx;
    }
    return true;
  }

  selectSlideRange(slides: SlideNode[], targetSlideId: string): boolean {
    const targetIdx = slides.findIndex((s) => s.id === targetSlideId);
    if (targetIdx === -1) return false;

    let anchorIdx = this.activePreviewIndex;
    if (this.selection.type === 'slide' || this.selection.type === 'transition') {
      const selectedId = this.selection.slideId;
      const found = slides.findIndex((s) => s.id === selectedId);
      if (found !== -1) anchorIdx = found;
    }
    anchorIdx = Math.max(0, Math.min(anchorIdx, slides.length - 1));

    const [low, high] = [Math.min(anchorIdx, targetIdx), Math.max(anchorIdx, targetIdx)];
    for (let i = low; i <= high; i++) {
      this.selectedSlideIds.add(slides[i].id);
    }
    this.selection = { type: 'slide', slideId: targetSlideId };
    this.activePreviewIndex = targetIdx;
    return true;
  }

  selectAllSlides(slides: SlideNode[]): boolean {
    if (slides.length === 0) return false;
    this.selectedSlideIds.clear();
    for (const s of slides) {
      this.selectedSlideIds.add(s.id);
    }
    if (this.selection.type !== 'slide') {
      const firstId = slides[0].id;
      this.selection = { type: 'slide', slideId: firstId };
      this.activePreviewIndex = 0;
    }
    return true;
  }

  clearMultiSelection(): void {
    if (this.selection.type === 'slide') {
      this.applySingleSelection({ type: 'slide', slideId: this.selection.slideId });
    } else if (this.selection.type === 'transition') {
      this.applySingleSelection({ type: 'transition', slideId: this.selection.slideId });
    } else {
      this.applySingleSelection({ type: 'settings' });
    }
  }

  setActivePreviewIndex(slides: SlideNode[], index: number): void {
    if (slides.length === 0) {
      this.activePreviewIndex = 0;
    } else {
      this.activePreviewIndex = Math.max(0, Math.min(index, slides.length - 1));
    }
  }

  exportSnapshotState(): SelectionSnapshotState {
    return {
      activePreviewIndex: this.activePreviewIndex,
      selection: { ...this.selection },
      selectedSlideIds: Array.from(this.selectedSlideIds),
      selectedTransitionSlideIds: Array.from(this.selectedTransitionSlideIds),
    };
  }

  restoreSnapshotState(slides: SlideNode[], state: SelectionSnapshotState): void {
    this.activePreviewIndex =
      slides.length === 0
        ? 0
        : Math.max(0, Math.min(state.activePreviewIndex, slides.length - 1));
    this.selection = { ...state.selection };
    this.selectedSlideIds = new Set(state.selectedSlideIds);
    this.selectedTransitionSlideIds = new Set(state.selectedTransitionSlideIds);
    this.reconcilePrimarySelectionAfterToggle(slides);
  }
}
