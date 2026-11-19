/**
 * Deterministic Test Fixtures and Generator Utilities for Motion Presentation Studio
 */

import { MediaAsset, SlideNode, PresentationProject, PresentationSettings } from '../../src/core/domain/types';
import {
  createDefaultTransition,
  createSlideNode,
  createEmptyProject,
} from '../../src/core/domain/defaults';

export function makeMockImageAsset(id: string, name: string, width = 1920, height = 1080): MediaAsset {
  return {
    id,
    name,
    kind: 'image',
    mimeType: 'image/png',
    extension: 'png',
    objectUrl: `data:image/png;base64,mock_${id}`,
    thumbnailUrl: `data:image/png;base64,mock_thumb_${id}`,
    fileSize: 1024,
    width,
    height,
    durationSec: 0,
  };
}

export function makeMockVideoAsset(
  id: string,
  name: string,
  durationSec = 10.0,
  width = 1920,
  height = 1080
): MediaAsset {
  return {
    id,
    name,
    kind: 'video',
    mimeType: 'video/mp4',
    extension: 'mp4',
    objectUrl: `blob:http://localhost/${id}.mp4`,
    thumbnailUrl: `data:image/png;base64,mock_thumb_${id}`,
    fileSize: 1024 * 1024 * 2,
    width,
    height,
    durationSec,
    hasAudio: true,
  };
}

export function createDeterministicDeck(slideCount = 3): SlideNode[] {
  const slides: SlideNode[] = [];
  for (let i = 0; i < slideCount; i++) {
    const img = makeMockImageAsset(`img_${i + 1}`, `slide_${i + 1}.png`);
    const trans = createDefaultTransition();
    trans.fallbackStyle = i % 2 === 0 ? 'crossfade' : 'zoom-morph';
    trans.fallbackDurationMs = 300;
    slides.push(createSlideNode(img, trans, `Slide ${i + 1}`));
  }
  return slides;
}

export function createDeterministicProject(slideCount = 4, customSettings?: Partial<PresentationSettings>): PresentationProject {
  const project = createEmptyProject();
  project.title = 'Deterministic Test Project';
  project.slides = createDeterministicDeck(slideCount);
  if (customSettings) {
    project.settings = { ...project.settings, ...customSettings };
  }
  return project;
}

export async function flushMicrotasks(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

export async function advanceTime(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
