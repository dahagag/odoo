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

- **Page header** (`header.hero` / `.eyebrow` / `h1.title` / `.dek`): both source Artifacts open with the same block — a small uppercase IBM Plex Mono "eyebrow" label in `--amber`, a serif `h1.title` (`'Source Serif 4', Georgia, serif`, weight 600, `text-wrap: balance`), and a `.dek` subtitle paragraph in `--ink-700` capped to a readable measure (`max-width: 52–60ch`). Bottom-bordered in `--line` and bottom-margined 2–2.5rem to separate it from the body.
- **Intended Learning Outcomes box** (`.ilo`): a bordered, shadowed card (`--paper-1` background, `--line` border, `box-shadow: var(--shadow)`, ~0.7rem radius) opening with a small uppercase IBM Plex Mono heading in `--amber`, then a plain `<ul>` of outcomes in `--ink-700`. Appears on the deep-dive page; treat as a required component for that page type, not optional decoration.
- **Audience tags**: small circular badges (`.tag.s/.r/.c`, 1.4rem circle, IBM Plex Mono, background = the role's accent color, white text).
- **"Used in X" badge** (`.demo-badge` in the methodologies page): visually a status pill — rounded, IBM Plex Mono, uppercase, `--teal-soft` background with `--teal` text — but a different semantic than the New/Extended/Unchanged status pill below (it flags "this item is exercised by the demo data," not a code-change status). Share the same pill CSS shape; do not conflate the two meanings when generating markup.
- **Per-item label** (`.method .label` / inline `<span class="label">`): a small uppercase IBM Plex Mono label in `--ink-500`, displayed as a block above a value — used to caption an inline fact (e.g. "Origin", "The framework") without a full heading.
- **Callouts** (`blockquote.callout`): left border in `--amber` (3px), tinted `--amber-soft` background, small uppercase IBM Plex Mono label (`<b>` child) above the body text, 0.5rem border radius.
- **Numbered step list** (`ol.steps`): steps rendered without native list markers; each `<li>` gets a circular IBM Plex Mono index badge (`counter(step)`, `--amber` border and text, 1.6rem circle) positioned left of the text, connected to the next step by a 1px `--line` vertical connector (omitted after the last item).
- **Definition list / glossary** (`dl.terms`): a two-column grid (`grid-template-columns: max-content 1fr`), `dt` in bold IBM Plex Mono (`--ink-900`, `white-space: nowrap`), `dd` in `--ink-700` — used for a short list of must-use-consistently vocabulary terms.
- **Reading list links** (`ul.reading`): unstyled `<li>` rows, each wrapping an `<a>` styled as a bordered card (`--line` border, 0.5rem radius, `--paper-1` background) with a trailing `→` glyph (`content: "→"` in `--amber`, IBM Plex Mono) pushed to the row's end; hover brightens the border to `--amber` and nudges the row right 2px.
- **Tables** (`.table-wrap > table`): wrapped in `overflow-x:auto` + bordered container with `box-shadow: var(--shadow)`; header row uses IBM Plex Mono uppercase labels on `--paper-0` background; body rows on `--paper-1`; `tabular-nums` implied by IBM Plex Mono's monospace digits.
- **Status pills** (`.pill.new/.ext/.same`): small rounded-pill badges, IBM Plex Mono, background = the status's `-soft` color, text = the full-saturation color (`new`→teal, `ext`→violet, `same`→block).
- **Footer note** (`footer.verify` / `footer.reading`): small IBM Plex Mono text in `--ink-500`, top-bordered in `--line` — used for a closing "verified against code as of…" provenance line or a single back-link.
- **Focus state**: `a:focus-visible, button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px }` — applied uniformly, not per-component.
- **`prefers-reduced-motion`**: any transition/animation added to the shared template must be guarded with `@media (prefers-reduced-motion: reduce) { *{ transition:none !important; } }`, per the two source Artifacts.

## Mermaid diagrams

The main teach doc's Artifact embeds two flowcharts as `<pre class="mermaid">…</pre>` blocks (plain Mermaid flowchart syntax as text content, rendered client-side by a Mermaid `<script>` the Artifact sandbox loads — not present in either source file's own `<style>`/inline CSS). Nothing in either Artifact documents how these should look once rendered (no color-token mapping for node fill/stroke/text, no explicit light/dark variant), and per docs/adr/0007 the pipeline output must have zero network requests and no external `<script>` at view time, so the same "load a CDN script" approach these Artifacts use isn't available as-is. Whether `docs-build:doc` pre-renders Mermaid to inline SVG at build time, bundles the Mermaid runtime as an embedded (non-CDN) script, or drops diagram support for its initial scope is an open implementation decision — resolve it against a real ticket, not here.

## What this file deliberately omits

Full markup, the audience-filter JavaScript (`.chip`/`.legend`/`#reset-filter` and their click handlers), and the sticky-TOC scroll-spy logic (`IntersectionObserver` over `nav.toc`) from the main teach doc's Artifact — those are page-specific interactive behavior from a single-page design, not necessarily what the generated multi-page pipeline output should do. #35 should treat this file as the *visual* system to reproduce, and make its own call on interactivity within the pipeline's own constraints (e.g. determinism, no embedded per-view JS state).

Also omitted: `.keyword-grid`/`.keyword-card`, defined in the main teach doc Artifact's stylesheet but never referenced by its markup — dead CSS in the source Artifact itself, not a rendered design element to reproduce.
