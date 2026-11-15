<p align="center">
  <img src="../docs/brand/motion-studio-banner.svg" alt="Motion Presentation Studio — Kinetic M Banner" width="100%" />
</p>

# Motion Presentation Studio

![Version](https://img.shields.io/badge/version-1.2.1-FF3D2E.svg)
![Electron](https://img.shields.io/badge/Electron-33.x-47848F.svg?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF.svg?logo=vite&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg?logo=windows&logoColor=white)

**Zero-Flicker Motion Graphics Presentation Studio & Player for Desktop.**

Motion Presentation Studio eliminates the black frames, lag, and video-switching glitches common in traditional slide tools. Built on a **Unified 2D Canvas Compositor** with memory pre-buffering and an interactive **Keyframe & Cue-Point Timeline**, it lets presenters step through high-impact motion-graphics transitions as effortlessly as PowerPoint slides.

---

## ✨ Key Features

- **Zero-Flicker Unified Canvas Engine**: Preloads adjacent slides and video segments so transitions between still frames and motion clips render seamlessly with zero black frames.
- **Two Production Workflows**:
  - **Motion-Reel Cue Points**: Import a continuous motion-graphics video and define interactive pause/cue points (manually or via automated motion-signal detection) where the presentation holds until you advance.
  - **Slides-First Pairing**: Import ordered slides and transition videos (`SmartPairer`) with automatic index matching and fallback CSS/Canvas transitions.
- **Interactive Keyframe Timeline**: Scrubbable playhead with frame-accurate indicators, keyframe CRUD, boundary clamping, easing curves, undo/redo (`Ctrl+Z` / `Ctrl+Y`), and zoom controls.
- **True Reverse Transitions**: Navigate backward smoothly with cached reverse video frame playback and mirrored transition math.
- **PowerPoint-Style Presenter Mode**: Fullscreen presentation with keyboard navigation, blackout/whiteout overlays, and a quick slide-grid jumper.
- **Self-Contained `.mpres` Projects**: Save and share complete presentations (slides, transitions, cue points, and media assets) in a single `.mpres` bundle with Windows file-association support.
- **Bilingual UI (EN / AR)**: Built-in English and Arabic localization support.

---

## ⌨️ Presenter Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `→` `↓` `Space` `Page Down` | Advance to next slide / transition |
| `←` `↑` `Page Up` | Retreat to previous slide (reverse transition) |
| `B` or `.` | Toggle Blackout screen |
| `W` or `,` | Toggle Whiteout screen |
| `Esc` | Close slide grid / Exit fullscreen presenter |

---

## Included Agent Skills (`.agents/skills/`)

This repository includes native agent workflow skills tailored for motion presentation workflows:
- **`animate-slides`** in [`.agents/skills/animate-slides`](.agents/skills/animate-slides/SKILL.md) (along with [`inspect_frames.mjs`](.agents/skills/animate-slides/scripts/inspect_frames.mjs)): Automates turning an ordered sequence of user slide frames into 2D-code-drawn canvases and frame-to-frame motion transition videos.
- **`new-motion-presentation`** in [`.agents/skills/new-motion-presentation`](.agents/skills/new-motion-presentation/SKILL.md): Creates high-creativity presentations from scratch with Rest-Pose Idle Loops (`XX_loop.mp4`), kinetic transitions, and native `presentation.json` metadata for surgical AI editing.

---

## Architecture

```text
app/
├── .agents/skills/
│   ├── animate-slides/          # Workflow skill for generating motion transitions from slides
│   └── new-motion-presentation/ # High-creativity workflow for presentations from scratch
├── electron/                    # Electron main process, preload bridge, and CLI argv helper
├── src/
│   ├── core/
│   │   ├── domain/              # Pure domain types, defaults, and timeline models
│   │   ├── engine/              # StagePlaybackEngine (2D Canvas compositor & RAF loop)
│   │   ├── services/            # SmartPairer, FrameExtractor, MediaValidator, ProjectSerializer
│   │   └── state/               # PresentationStore (reactive state & undo/redo history)
│   └── ui/                      # Studio UI, fullscreen presenter, timeline modal, icons, theme
├── scripts/
│   ├── generate-icons.mjs       # App & .mpres file icon generator
│   ├── release.mjs              # Semver bump, NSIS build, archive, and git tag automation
│   └── verify-all.ts            # Master 4-tier verification & E2E test runner
└── test/                        # Unit, integration, pairwise, and real-world E2E test suites
```

---

## Getting Started

### Prerequisites
- **Node.js** `18+` (with `npm`)
- **Windows** (for Electron desktop packaging / NSIS installer)

### Installation & Development

```bash
npm install
```

Run the Vite dev server (browser preview on port `5175`):

```bash
npm run dev
```

Or launch the full Electron desktop app:

```bash
npm run build && npm run electron:dev
```

---

## Testing & Building

Run the full verification suite (184 automated tests across unit, pairwise, and E2E tiers):

```bash
npm test
```

Build TypeScript + Vite production bundle:

```bash
npm run build
```

Package a Windows NSIS installer (`dist:win`) or create a versioned release:

```bash
npm run release:patch   # 1.1.0 -> 1.1.1
npm run release:minor   # 1.1.0 -> 1.2.0
npm run release:major   # 1.1.0 -> 2.0.0
```
