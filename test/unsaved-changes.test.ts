import assert from 'node:assert/strict';
import { MediaAsset } from '../src/core/domain/types';
import { PresentationStore } from '../src/core/state/PresentationStore';
import {
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  DEFAULT_AUTOSAVE_MIN_INTERVAL_MS,
  decideQuitSave,
  shouldAutosave,
} from '../src/core/services/UnsavedChangesGuard';

function makeImageAsset(id: string): MediaAsset {
  return {
    id,
    name: `${id}.png`,
    kind: 'image',
    mimeType: 'image/png',
    extension: 'png',
    objectUrl: `blob:dirtytest/${id}`,
    fileSize: 4096,
    width: 1920,
    height: 1080,
    durationSec: 0,
    thumbnailUrl: `blob:dirtytest/${id}`,
  };
}

export async function runUnsavedChangesTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function runCase(id: string, title: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ [${id}] ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [${id}] ${title}:`, err);
      failed++;
    }
  }

  await runCase('UNSAVED-01', 'A freshly constructed store is clean', () => {
    const store = new PresentationStore();
    assert.equal(store.isProjectDirty(), false);
  });

  await runCase('UNSAVED-02', 'Deck mutations mark the project dirty and a save clears it', () => {
    const store = new PresentationStore();
    const slide = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('a') });
    assert.equal(store.isProjectDirty(), true);

    store.markProjectSaved();
    assert.equal(store.isProjectDirty(), false);

    store.dispatch({ type: 'slide/delete', slideId: slide.id });
    assert.equal(store.isProjectDirty(), true);
  });

  await runCase('UNSAVED-03', 'Selection and notification changes never dirty the document', () => {
    const store = new PresentationStore();
    const slide = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('b') });
    store.markProjectSaved();
    assert.equal(store.isProjectDirty(), false);

    store.setSelection({ type: 'slide', slideId: slide.id });
    store.setActivePreviewIndex(0);
    store.selectAllSlides();
    store.clearMultiSelection();
    store.notify('hello');
    assert.equal(store.isProjectDirty(), false);
  });

  await runCase('UNSAVED-04', 'Metadata, settings and batched edits all dirty the document', () => {
    const store = new PresentationStore();
    const slide = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('c') });
    store.markProjectSaved();

    store.setProjectTitle('Renamed Deck');
    assert.equal(store.isProjectDirty(), true, 'title change must dirty');

    store.markProjectSaved();
    store.updateSlideDetails(slide.id, { notes: 'speaker note' });
    assert.equal(store.isProjectDirty(), true, 'slide details change must dirty');

    store.markProjectSaved();
    store.updateSettings({ aspectRatio: '9:16' });
    assert.equal(store.isProjectDirty(), true, 'settings change must dirty');

    store.markProjectSaved();
    store.batchUpdate(() => {
      store.updateSlideDetails(slide.id, { title: 'Batched' });
    });
    assert.equal(store.isProjectDirty(), true, 'batch update must dirty');
  });

  await runCase('UNSAVED-05', 'Undo after a save reports changes again (no false clean state)', () => {
    const store = new PresentationStore();
    const slide = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('d') });
    store.dispatch({ type: 'slide/updateDetails', slideId: slide.id, patch: { title: 'One' } });
    store.markProjectSaved();
    assert.equal(store.isProjectDirty(), false);

    store.undo();
    assert.equal(store.isProjectDirty(), true);
  });

  await runCase('UNSAVED-06', 'Store listeners keep receiving the exact change types (no regression)', () => {
    const store = new PresentationStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((changeType) => seen.push(String(changeType)));
    store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('e') });
    store.setSelection({ type: 'slide', slideId: store.getSlides()[0].id });
    store.notify('toast');
    unsubscribe();
    assert.deepEqual(seen, ['structural', 'selection', 'notification']);
  });

  await runCase('UNSAVED-07', 'Quit decision: clean buffer or empty deck proceeds directly', () => {
    assert.equal(decideQuitSave({ isDirty: false, slideCount: 3, isSaving: false }), 'proceed');
    assert.equal(decideQuitSave({ isDirty: true, slideCount: 0, isSaving: false }), 'proceed');
  });

  await runCase('UNSAVED-08', 'Quit decision: in-flight save blocks the quit instead of racing it', () => {
    assert.equal(decideQuitSave({ isDirty: true, slideCount: 5, isSaving: true }), 'block');
    assert.equal(decideQuitSave({ isDirty: true, slideCount: 5, isSaving: false }), 'save');
  });

  await runCase('UNSAVED-09', 'Autosave policy respects dirtiness, emptiness, presentation and throttling', () => {
    const base = {
      isDirty: true,
      slideCount: 4,
      isSaving: false,
      isPresentingFullscreen: false,
      msSinceLastAutosave: DEFAULT_AUTOSAVE_MIN_INTERVAL_MS + 1,
      msSinceLastChange: DEFAULT_AUTOSAVE_DEBOUNCE_MS + 1,
    };
    assert.equal(shouldAutosave(base), true);
    assert.equal(shouldAutosave({ ...base, isDirty: false }), false);
    assert.equal(shouldAutosave({ ...base, slideCount: 0 }), false);
    assert.equal(shouldAutosave({ ...base, isSaving: true }), false);
    assert.equal(shouldAutosave({ ...base, isPresentingFullscreen: true }), false);
    assert.equal(shouldAutosave({ ...base, msSinceLastChange: 10 }), false);
    assert.equal(shouldAutosave({ ...base, msSinceLastAutosave: 10 }), false);
  });

  await runCase(
    'UNSAVED-10',
    'Content restored from an autosave snapshot stays dirty until it is really saved',
    () => {
      const store = new PresentationStore();
      store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('f') });
      store.markProjectSaved();
      assert.equal(store.isProjectDirty(), false);

      // Recovery hands the bytes over through a normal load, which would otherwise wipe the
      // dirty state and let the next close silently throw the recovered work away.
      store.markProjectDirty();
      assert.equal(store.isProjectDirty(), true);
      assert.equal(decideQuitSave({ isDirty: store.isProjectDirty(), slideCount: 1, isSaving: false }), 'save');

      store.markProjectSaved();
      assert.equal(store.isProjectDirty(), false);
      assert.equal(decideQuitSave({ isDirty: store.isProjectDirty(), slideCount: 1, isSaving: false }), 'proceed');
    }
  );

  console.log(`\nUnsaved Changes Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
