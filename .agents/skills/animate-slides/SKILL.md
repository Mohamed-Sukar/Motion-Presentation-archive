---
name: animate-slides
description: >-
  Project-specific workflow for turning an ordered folder of presentation frames
  into 2D-code-drawn canvases and animated frame-to-frame motion transition videos
  using the motion-reel skill. Use when the user invokes /animate-slides or asks to
  create motion transitions between existing slide frames.
---

# Animate Slides (`/animate-slides`)

Turn a sequence of user-provided keyframe images into faithful **2D-code-drawings** and choreograph smooth, expressive **motion transition videos** between every consecutive frame (`Frame i -> Frame i+1`) using the `motion-reel` skill, ready for **Motion Presentation Studio**.

> **Scope vs `/new-motion-presentation`:**
> - Use **`/animate-slides`** when the user *already has* pre-made presentation slide images (`01.png`, `02.png`, ...) and wants the model to stay visually faithful to those original slide layouts while generating kinetic transitions between them.
> - Use **`/new-motion-presentation`** when creating a presentation **from scratch** (from a topic, outline, or product URL) with high creative freedom and Rest-Pose Idle Motion Loops (`XX_loop.mp4`).

> **Creative autonomy:** Stay faithful to the visual look of the user's frames and the exact frame order, while keeping full creative freedom over transition choreography, pacing, and timing unless the user specifies constraints. Transitions are **audio-free (silent) by default** unless the user explicitly asks for sound.

---

## 1. Wait For & Validate Frame Sequence (Mandatory Gate)

1. **Wait for the frames path:**
   If the user invoked `/animate-slides` without providing the path to their frames folder (or image files), ask for the frames path and stop. Do not guess a path or fabricate frames.

2. **Inspect and verify numeric ordering:**
   Once a path is given, run the inspection helper from the workspace root:
   ```bash
   node ".agents/skills/animate-slides/scripts/inspect_frames.mjs" "<frames_path>"
   ```
   Every frame filename must carry an unambiguous ordering number (e.g., `01_intro.png`, `frame_2.png`, `03-architecture.png`).

3. **Clarification Gate — stop and ask the user if `needsClarification` is `true`:**
   Do **not** guess or fall back to alphabetical order if any of these occur:
   - Any frame filename has **no ordering number** (`UNNUMBERED_FRAMES`).
   - Multiple numbers in a filename make the sequence order **ambiguous** (`AMBIGUOUS_FRAME_NUMBERS`).
   - Two or more frames resolve to the **same order number** (`DUPLICATE_ORDER_NUMBERS`).
   - The path does not exist, contains no supported images, or has fewer than 2 frames (`PATH_NOT_FOUND`, `NO_FRAMES_FOUND`, `FEWER_THAN_TWO_FRAMES`).

   List the detected files and the specific ambiguity, then wait for the user's clarification before continuing.
   *(If `warnings` mentions `IRREGULAR_NUMBER_GAPS` or `MIXED_DIMENSIONS`, verify with the user only if it looks unintentional.)*

---

## 2. Read & Deconstruct Each Frame

1. Read the `motion-reel` skill instructions before scaffolding or rendering:
   - `C:\Users\Mohamed\.gemini\config\plugins\motion-reel\skills\motion-reel\SKILL.md`
2. Inspect **every ordered frame image directly** (`read_file`) in sequence (`1 .. N`).
3. For each frame, break down its visual anatomy so it can be drawn in code:
   - **Canvas & Palette:** background tones/gradients, card surfaces, borders, accent colors, exact hex values.
   - **Typography & Copy:** font families/weights/hierarchy, exact text (Arabic/English, RTL/LTR alignment). Copy/bundle needed font files into `fonts/` and verify non-Latin glyphs render cleanly without broken fallback fonts.
   - **2D Geometry & Components:** cards, badges, charts, icons, connectors, dividers, pills, progress indicators, and geometric motifs.
   - **Raster Elements (only when genuinely needed):** if a frame embeds real photography or complex brand artwork that shouldn't be approximated in vector paths, save/reference that real asset in `assets/` and composite it cleanly alongside the 2D-code-drawn layers.
4. Map **pair-by-pair relationships** (`Frame 1 -> Frame 2`, `Frame 2 -> Frame 3`, ...):
   - Identify **persistent / shared elements** that can morph, travel, resize, or re-anchor across the cut.
   - Identify **exiting** and **entering** layers so movement feels motivated rather than like a flat crossfade.

---

## 3. Build 2D-Code-Drawings & Motion Transitions via `/motion-reel`

Follow `motion-reel`'s core architecture (`window.seek(t)` pure function of time, seeded noise only, closed-form springs `springU`/`springKeys`, `kf`, `E.*`, `layout`/`glyph`, motion blur, and critique loop):

1. **Modular 2D-Code-Drawing per Frame:**
   - Represent each frame (`Frame 1` .. `Frame N`) as a reusable 2D Canvas drawing module/function (where layers and elements can be parameterized for offset, scale, opacity, clip, morph progress, stroke draw-on, etc.).
   - Sharing the exact same `Frame k` code definition between the end of transition `(k-1 -> k)` and the start of transition `(k -> k+1)` guarantees seamless continuity across the presentation.

2. **Transition Films Between Consecutive Frames (`N - 1` transitions):**
   - Scaffold or structure each transition cleanly (e.g., inside a dedicated workspace folder such as `reels/<project-slug>/t01-02/`, `t02-03/`, ... so `app/src/` stays untouched).
   - **Boundary Continuity Contract:**
     - **At `t = 0`:** the rendered canvas must faithfully match **Frame `i`** (same composition, colors, typography, and geometry — no blank lead-in, no fade from black, no sudden pop).
     - **During `0 < t < duration`:** choreograph expressive, purposeful 2D motion (element handoffs, morphing shapes, staggered springs, directional wipes/clips, camera push/pull in log space, overlapping timing).
     - **At `t = duration`:** the rendered canvas must settle cleanly on **Frame `i+1`** with zero drift.
   - **Audio Policy (Silent by Default) & Beat Grid:**
     - **Default — Audio-Free (`--video-only`):** Unless the user explicitly asks for sound/SFX/music, generate **silent transition videos** (`render.mjs --film <film> --format <f> --video-only`, outputting H.264 `.mp4` with no audio stream). Do **not** generate `music.wav`, `sfx.wav`, or run `mix.mjs`.
     - `render.mjs` and `motion.js` still require `<film>/beats.json` (`offset`, `period`, `beats` array) for beat timing and `--contact` sheets; for silent transitions, write a clean `beats.json` grid matching your transition tempo (e.g., 120 BPM -> `period: 0.5`).
     - **When the user explicitly asks for sound:** Use `motion-reel`'s audio pipeline (`beats.py` / `score.py`, `sfx.mjs`, `mix.mjs`) and mux into the final `.mp4`.
   - **Format & Resolution:**
     - Match `detectedFormat` from `inspect_frames.mjs` (`16x9` for widescreen 1920x1080 slides, `9x16` for portrait, `1x1` for square). If frames use a non-standard 16:9 size (e.g. 1280x720), draw proportionally in the 1920x1080 canvas space.

3. **Visual Verification (Look Before You Deliver):**
   - For every transition video, inspect:
     - First frame (`--at 0`) vs input **Frame `i`**
     - Mid-transition strip (`--strip 0:<duration>:8`) to verify motion arcs, blur, overlap, and absence of blank frames
     - Final frame (`--at <duration>`) vs input **Frame `i+1`**
   - Iterate until every endpoint aligns cleanly and every transition looks intentional, crisp, and kinetic.

---

## 4. Deliver Ready for Motion Presentation Studio

Export the final presentation assets into a clean output folder (e.g., `out/<project-slug>/presentation/` or a user-specified directory) using filenames that **Motion Presentation's `SmartPairer`** auto-pairs on drag-and-drop:

- Slides (ordered PNGs): `01_frame.png`, `02_frame.png`, ..., `0N_frame.png` (matching exact start/end visual states)
- Transition videos (H.264 `yuv420p`, 60 fps `.mp4`): `01-02_transition.mp4`, `02-03_transition.mp4`, ..., `0(N-1)-0N_transition.mp4`
- Native `presentation.json` manifest (for Motion Presentation Studio's Surgical AI Edit Prompt Builder):
  ```json
  {
    "skill": "animate-slides",
    "title": "<Presentation Title>",
    "aspectRatio": "16:9",
    "projectRootPath": "<absolute path to reels/<project-slug>>",
    "outputDirPath": "<absolute path to output folder>",
    "slides": [
      {
        "index": 1,
        "title": "Slide 1",
        "frameFile": "01_frame.png",
        "transitionVideoFile": "01-02_transition.mp4",
        "slideCodeFile": "scenes/slide_01.js",
        "transitionCodeFile": "t01-02/film.js"
      }
    ]
  }
  ```

Verify every final `.mp4` with `ffprobe` (duration, 60 fps, `yuv420p`, no audio stream by default unless sound was explicitly requested) and report the output folder path and summary of all generated transitions to the user.
