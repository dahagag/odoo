# Teach-doc design system

Ground truth for `docs-build:doc`'s shared HTML/CSS template ([#35](https://github.com/dahagag/odoo/issues/35)). Extracted from the two hand-authored Claude Artifacts stakeholders already reviewed (published from `docs/teach/sales-methodology-vs-odoo-crm.md` and `docs/teach/methodologies.md` — see [ADR 0007](adr/0007-self-contained-teach-docs-served-from-static.md)). This file is a reference for implementation, not itself rendered output — do not treat it as a third teach doc.

## Fonts

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
```

- **Display/headings**: `'Source Serif 4', Georgia, serif` — weight 600 for `h1`/`h2`.
- **Body**: `'Karla', system-ui, sans-serif`.
- **Labels, data, code, eyebrows**: `'IBM Plex Mono', monospace`.

Per #35's Implementation Decisions, whether these load via the Google Fonts `<link>` above (fine inside a Claude Artifact's sandbox, not fine for a truly self-contained/offline static file) or get embedded as data URIs / replaced with a system-font fallback is still open — resolve it there, not here.

## Color tokens

```css
:root{
  --ink-900:#1B2430; --ink-700:#3E4A59; --ink-500:#6B7688;
  --paper-0:#F3F4EF; --paper-1:#FFFFFF; --line:#D3D6CC;
  --amber:#B96A22; --amber-soft:#F0DFC7;
  --teal:#2E6B60; --teal-soft:#D9E8E3;
  --violet:#5B5285; --violet-soft:#E5E2F0;
  --block:#A23B3B; --block-soft:#F3DBDB;
  --shadow: 0 1px 2px rgba(27,36,48,.06), 0 8px 24px rgba(27,36,48,.05);
  color-scheme: light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink-900:#ECEAE2; --ink-700:#C7CCC0; --ink-500:#93998C;
    --paper-0:#181B17; --paper-1:#20241F; --line:#3A3F35;
    --amber:#E0954C; --amber-soft:#3B2C18;
    --teal:#6FBBAC; --teal-soft:#1D332E;
    --violet:#B0A6E0; --violet-soft:#2A2540;
    --block:#E28080; --block-soft:#3A2222;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
    color-scheme: dark;
  }
}
:root[data-theme="dark"]{ /* same values as the dark media block above, for an explicit toggle */ }
```

Roles: `ink-*` = text (900 primary, 700 secondary, 500 tertiary/labels). `paper-0`/`paper-1` = page background / card background. `line` = hairline borders. `amber` = primary accent (links-on-hover, eyebrows, active states). `teal` = links, "Sales"-tagged content. `violet` = "R&D"-tagged content. `block` = error/blocker semantic color (distinct from the accent hues). `-soft` variants = tinted backgrounds for badges/callouts at low opacity-equivalent lightness.

`--block` was only defined on the main teach doc (it has status pills: New/Extended/Unchanged); the methodologies page omits it since it doesn't need that semantic. Include it in the shared template regardless — the "used in our demo" badges and any future status pill need it.

## Layout conventions

- `.shell { max-width: 1180px }` for the main multi-section page (with a sidebar TOC); `840px` for a single-column deep-dive page (no TOC needed).
- Responsive padding: `padding: 0 clamp(1.25rem, 4vw, 3rem) 6rem` (main page) / `clamp(1.25rem, 4vw, 2rem)` (deep-dive page).
- Sidebar TOC: `230px` fixed column + `minmax(0,1fr)` content, collapsing to a single column under `860px` via `grid-template-columns: 1fr`.

## Component patterns

- **Audience tags**: small circular badges (`.tag.s/.r/.c`, 1.4rem circle, IBM Plex Mono, background = the role's accent color, white text).
- **Callouts** (`blockquote.callout`): left border in `--amber` (3px), tinted `--amber-soft` background, small uppercase IBM Plex Mono label (`<b>` child) above the body text, 0.5rem border radius.
- **Tables** (`.table-wrap > table`): wrapped in `overflow-x:auto` + bordered container with `box-shadow: var(--shadow)`; header row uses IBM Plex Mono uppercase labels on `--paper-0` background; body rows on `--paper-1`; `tabular-nums` implied by IBM Plex Mono's monospace digits.
- **Status pills** (`.pill.new/.ext/.same`): small rounded-pill badges, IBM Plex Mono, background = the status's `-soft` color, text = the full-saturation color (`new`→teal, `ext`→violet, `same`→block).
- **Focus state**: `a:focus-visible, button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px }` — applied uniformly, not per-component.
- **`prefers-reduced-motion`**: any transition/animation added to the shared template must be guarded with `@media (prefers-reduced-motion: reduce) { *{ transition:none !important; } }`, per the two source Artifacts.

## What this file deliberately omits

Full markup, the audience-filter JavaScript, and the sticky-TOC scroll-spy logic from the main teach doc's Artifact — those are page-specific interactive behavior from a single-page design, not necessarily what the generated multi-page pipeline output should do. #35 should treat this file as the *visual* system to reproduce, and make its own call on interactivity within the pipeline's own constraints (e.g. determinism, no embedded per-view JS state).
