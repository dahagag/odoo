---
status: accepted
---

# Generate the teach-doc walkthrough video with HyperFrames, authoring and re-rendering as separate steps

Stakeholders asked for a narrated walkthrough video embedded at the top of the teach page as an alternative to reading it. We're generating it with the already-installed HyperFrames skill's `faceless-explainer` workflow, chosen after a comparative pass against Remotion, Motion Canvas, Revideo, Manim, and a DIY GSAP+Puppeteer pipeline on three ranked criteria — fully local with no required paid API, scriptable from the existing Markdown source, and not a net-new dependency. HyperFrames won on all three, notably being the only candidate with local, API-key-free narration (a bundled Kokoro-82M TTS model). The video is embedded via a sibling `<video>` file next to the generated HTML — not a base64 data URI, since video doesn't compress usefully that way and can't stream or seek from one. Its lifecycle is deliberately split: *authoring* the storyboard/script/composition is an occasional, Claude-assisted task run in a Claude Code session under the team's account, producing a HyperFrames project committed to the repo; *re-rendering* that already-authored project (`docs-build:video`) is mechanical and cheap enough to run by default alongside `docs-build:doc`.

**Considered Options:** Remotion — rejected, narration and Markdown-ingestion would need to be hand-built, and its free tier is org-size-gated. Motion Canvas — documented as the fallback if a HyperFrames validation spike fails: fully local and MIT-licensed, but has no built-in narration. A single `docs-build:video` step that both authors and re-renders — rejected, authoring is a live creative/Claude-session cost and re-rendering isn't; conflating them would make the default `docs-build` slow and non-deterministic.

**Consequences:** none of this runs in CI yet — re-rendering needs local `ffmpeg`/Chrome-headless, and authoring specifically requires a live Claude Code session, so both stay manual until that changes.
