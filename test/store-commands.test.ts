import assert from 'node:assert/strict';
import { MediaAsset } from '../src/core/domain/types';
import {
  PresentationStore,
  StudioAnyCommand,
} from '../src/core/state/PresentationStore';

function makeImageAsset(id: string, name = `${id}.png`): MediaAsset {
  return {
    id,
    name,
    kind: 'image',
    mimeType: 'image/png',
    extension: 'png',
    objectUrl: `blob:cmdtest/${id}`,
    fileSize: 4096,
    width: 1920,
    height: 1080,
    durationSec: 0,
    thumbnailUrl: `blob:cmdtest/${id}`,
  };
}

function makeVideoAsset(id: string, name = `${id}.mp4`, durationSec = 5.0): MediaAsset {
  return {
    id,
    name,
    kind: 'video',
    mimeType: 'video/mp4',
    extension: 'mp4',
    objectUrl: `blob:cmdtest/${id}`,
    fileSize: 65536,
    width: 1920,
    height: 1080,
    durationSec,
    thumbnailUrl: `blob:cmdtest/${id}-thumb`,
  };
}

export async function runStoreCommandsTests(): Promise<{ passed: number; failed: number }> {
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

  await runCase('CMD-01', 'Typed dispatch() executes deck mutations with narrowed return values and command log', () => {
    const store = new PresentationStore();
    const observedCommands: StudioAnyCommand['type'][] = [];
    const unsubscribeCmd = store.subscribeCommand((ev) => {
      observedCommands.push(ev.command.type);
    });

    store.dispatch({ type: 'project/setTitle', title: 'Phase 4 Typed Deck' });
    assert.equal(store.getProject().title, 'Phase 4 Typed Deck');

    const s1 = store.dispatch({
      type: 'slide/add',
      imageAsset: makeImageAsset('img-1', '01.png'),
    });
    const s2 = store.dispatch({
      type: 'slide/add',
      imageAsset: makeImageAsset('img-2', '02.png'),
    });
    assert.equal(store.getSlides().length, 2);

    store.dispatch({
      type: 'slide/updateDetails',
      slideId: s1.id,
      patch: { title: 'Opening Hook', notes: 'Keynote beat', holdDurationSec: 4 },
    });
    assert.equal(store.getSlides()[0].title, 'Opening Hook');
    assert.equal(store.getSlides()[0].notes, 'Keynote beat');
    assert.equal(store.getSlides()[0].holdDurationSec, 4);

    const dup = store.dispatch({ type: 'slide/duplicate', slideId: s1.id });
    assert.ok(dup, 'Duplicate command should return cloned slide');
    assert.equal(store.getSlides().length, 3);
    assert.equal(store.getSlides()[1].id, dup.id);

    const video = makeVideoAsset('vid-1', 'trans.mp4', 8.0);
    store.dispatch({ type: 'transition/setVideo', slideId: s1.id, videoAsset: video });
    const rangeOk = store.dispatch({
      type: 'transition/updateRange',
      slideId: s1.id,
      startTimeSec: 1.25,
      endTimeSec: 3.75,
    });
    assert.equal(rangeOk, true);
    assert.equal(store.getSlides()[0].transitionToNext.startTimeSec, 1.25);
    assert.equal(store.getSlides()[0].transitionToNext.endTimeSec, 3.75);

    const badRangeOk = store.dispatch({
      type: 'transition/updateRange',
      slideId: s1.id,
      startTimeSec: 3.0,
      endTimeSec: 3.01,
    });
    assert.equal(badRangeOk, false);

    store.dispatch({
      type: 'transition/updateSpec',
      slideId: s1.id,
      patch: { fallbackStyle: 'zoom', fallbackDurationMs: 1100, playbackSpeed: 1.5, muted: true },
    });
    const updatedCount = store.dispatch({
      type: 'transition/applySpecToAll',
      sourceSlideId: s1.id,
    });
    assert.equal(updatedCount, 3);
    assert.equal(store.getSlides()[2].transitionToNext.fallbackStyle, 'zoom');
    assert.equal(store.getSlides()[2].transitionToNext.playbackSpeed, 1.5);
    assert.equal(store.getSlides()[2].transitionToNext.muted, true);

    store.dispatch({ type: 'slide/moveToIndex', slideId: s2.id, targetIndex: 0 });
    assert.equal(store.getSlides()[0].id, s2.id);

    const delSummary = store.dispatch({
      type: 'deck/deleteMultiple',
      slideIds: [dup.id],
      transitionSlideIds: [s1.id],
      transitionChoice: 'below',
    });
    assert.equal(delSummary.deletedSlidesCount, 1);
    assert.equal(delSummary.deletedTransitionsCount, 1);
    assert.equal(store.getSlides().length, 2);

    unsubscribeCmd();
    assert.deepEqual(observedCommands, [
      'project/setTitle',
      'slide/add',
      'slide/add',
      'slide/updateDetails',
      'slide/duplicate',
      'transition/setVideo',
      'transition/updateRange',
      'transition/updateRange',
      'transition/updateSpec',
      'transition/applySpecToAll',
      'slide/moveToIndex',
      'deck/deleteMultiple',
    ]);
  });

  await runCase('CMD-02', 'SelectionSlice handles multi-select, range selection, and deletion reconciliation cleanly', () => {
    const store = new PresentationStore();
    const s1 = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('sel-1') });
    const s2 = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('sel-2') });
    const s3 = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('sel-3') });
    const s4 = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('sel-4') });

    store.dispatch({ type: 'selection/set', target: { type: 'slide', slideId: s1.id } });
    assert.equal(store.getActivePreviewIndex(), 0);
    assert.deepEqual(store.getSelectedSlideIds(), [s1.id]);

    store.dispatch({ type: 'selection/selectRange', targetSlideId: s3.id });
    assert.deepEqual(store.getSelectedSlideIds(), [s1.id, s2.id, s3.id]);
    assert.equal(store.getMultiSelectionSummary().totalCount, 3);

    store.dispatch({ type: 'selection/toggleSlide', slideId: s2.id });
    assert.deepEqual(store.getSelectedSlideIds(), [s1.id, s3.id]);

    store.dispatch({ type: 'selection/toggleTransition', slideId: s4.id });
    assert.equal(store.isTransitionSelected(s4.id), true);

    store.dispatch({ type: 'selection/selectAll' });
    assert.equal(store.getSelectedSlideIds().length, 4);

    store.dispatch({ type: 'selection/clearMulti' });
    assert.equal(store.getSelectedSlideIds().length, 1);

    // Deleting every remaining slide must reconcile back to 'settings' and index 0
    store.dispatch({
      type: 'deck/deleteMultiple',
      slideIds: [s1.id, s2.id, s3.id, s4.id],
      transitionSlideIds: [],
    });
    assert.equal(store.getSlides().length, 0);
    assert.equal(store.getSelection().type, 'settings');
    assert.equal(store.getActivePreviewIndex(), 0);
  });

  await runCase('CMD-03', 'HistorySlice records command types across undo/redo and resets cleanly', () => {
    const store = new PresentationStore();
    assert.deepEqual(store.getHistorySummary(), {
      canUndo: false,
      canRedo: false,
      undoCount: 0,
      redoCount: 0,
      lastUndoCommand: undefined,
      lastRedoCommand: undefined,
    });

    const s1 = store.dispatch({ type: 'slide/add', imageAsset: makeImageAsset('hist-1') });
    store.dispatch({
      type: 'slide/updateDetails',
      slideId: s1.id,
      patch: { title: 'Edited Title' },
    });
    store.dispatch({ type: 'slide/duplicate', slideId: s1.id });

    let summary = store.getHistorySummary();
    assert.equal(summary.canUndo, true);
    assert.equal(summary.canRedo, false);
    assert.equal(summary.undoCount, 3);
    assert.equal(summary.lastUndoCommand, 'slide/duplicate');

    assert.equal(store.dispatch({ type: 'history/undo' }), true);
    assert.equal(store.getSlides().length, 1);
    summary = store.getHistorySummary();
    assert.equal(summary.canRedo, true);
    assert.equal(summary.lastUndoCommand, 'slide/updateDetails');
    assert.equal(summary.lastRedoCommand, 'slide/duplicate');

    assert.equal(store.dispatch({ type: 'history/undo' }), true);
    assert.notEqual(store.getSlides()[0].title, 'Edited Title');

    assert.equal(store.dispatch({ type: 'history/redo' }), true);
    assert.equal(store.getSlides()[0].title, 'Edited Title');

    store.dispatch({ type: 'history/clear' });
    summary = store.getHistorySummary();
    assert.equal(summary.canUndo, false);
    assert.equal(summary.canRedo, false);
    assert.equal(summary.undoCount, 0);
    assert.equal(summary.redoCount, 0);

    store.dispatch({ type: 'project/clearAll' });
    assert.equal(store.getSlides().length, 0);
    assert.equal(store.getSelection().type, 'settings');
  });

  console.log(`\nStore Commands & Slices Suite Summary: ${passed} Passed, ${failed} Failed.`);
  return { passed, failed };
}
