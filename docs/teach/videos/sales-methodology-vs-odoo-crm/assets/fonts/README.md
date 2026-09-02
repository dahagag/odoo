# Webfonts for this video project

These four `.woff2` files ship with the project because the render machine is a clean
headless Chrome with no system fonts installed — a font that is only *named* silently falls
back and the typography is wrong in the MP4. Every frame composition therefore carries its own
`@font-face` block pointing at these files (project-root-relative, the way the assembler and
the live preview resolve `assets/…`).

The three families are the ones [`docs/teach/DESIGN-TOKENS.md`](../../../DESIGN-TOKENS.md)
declares for the teach page this video is embedded in — Source Serif 4 for display, Karla for
body, IBM Plex Mono for labels and data — so the video reads as part of the page rather than
next to it.

| File | Family / weight | Bytes |
|---|---|---|
| `SourceSerif4-latin.woff2` | Source Serif 4, 400 | 20,088 |
| `Karla-latin.woff2` | Karla, variable weight axis (used at 400 and 500) | 24,320 |
| `IBMPlexMono-400-latin.woff2` | IBM Plex Mono, 400 | 14,708 |
| `IBMPlexMono-500-latin.woff2` | IBM Plex Mono, 500 | 14,888 |

Total 74 KB. Latin subset only (`U+0000-00FF` + the punctuation/currency range Google Fonts
ships with it) — this video's visible text is all Latin. Karla is one variable file serving both
weights: Google Fonts returns byte-identical files for its 400 and 500 requests, so the
duplicate was removed and the single face is declared with `font-weight: 400 500`.

## Provenance

Fetched from `fonts.gstatic.com` via the Google Fonts CSS API, which is the same source
`DESIGN-TOKENS.md` already loads these families from for the HTML page (see
[ADR 0009](../../../../adr/0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.md),
which reversed the zero-network constraint). Reproduce with:

```bash
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400&family=Karla:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap"
```

then download the `latin` subset URL for each face (the block whose `unicode-range` contains
`U+0000-00FF`).

## Licences

All three are open-licensed and redistributable:

- **Source Serif 4** — SIL Open Font License 1.1 (Adobe)
- **Karla** — SIL Open Font License 1.1 (Jonny Pinhorn)
- **IBM Plex Mono** — SIL Open Font License 1.1 (IBM)
