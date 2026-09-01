# Teach-doc design system

Ground truth for `docs-build:doc`'s shared HTML/CSS template ([#35](https://github.com/dahagag/odoo/issues/35)). Extracted from the two hand-authored Claude Artifacts stakeholders already reviewed (published from `docs/teach/sales-methodology-vs-odoo-crm.md` and `docs/teach/methodologies.md` — see [ADR 0007](adr/0007-self-contained-teach-docs-served-from-static.md)). This file is a reference for implementation, not itself rendered output — do not treat it as a third teach doc.

## Fonts

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
```

- **Display/headings**: `'Source Serif 4', Georgia, serif` — weight 600 for `h1`/`h2`.
- **Body**: `'Karla', system-ui, sans-serif`.
- **Labels, data, code, eyebrows**: `'IBM Plex Mono', monospace`.

**Resolved by [ADR 0009](adr/0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.md)**: load these via the Google Fonts `<link>` above, exactly as the source Artifacts do. An earlier version of this note framed the choice as blocked on a "zero network requests" constraint from #35; that constraint itself was judged invalid and reversed — self-hosting the fonts as data URIs was considered and rejected (real measurements put it at ~160–260 KB added per page, with no size advantage over the CDN, which already serves the same subsetted files). Self-contained means no unresolved *local* images/links, not no network access at all.

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
- Sidebar TOC: `230px` fixed column + `minmax(0,1fr)` content, collapsing to a single column under `860px` via `grid-template-columns: 1fr`. The TOC column itself is `position: sticky; top: 1.5rem` — pure CSS, no script — so it stays in view while the main column scrolls past it; this is distinct from (and required even without) the scroll-spy JS noted below, which only handles highlighting the *current* section as you scroll, not the sticking itself.

## Component patterns

Each pattern below is a trimmed, illustrative sample of the actual markup from the source Artifacts — not the full page. It won't render live in a plain Markdown viewer (GitHub strips `<style>` from rendered Markdown), but it documents the exact HTML shape a generator should produce; pair it with the CSS in each source Artifact for the full rule.

### Page header

Both source Artifacts open with the same block — a small uppercase IBM Plex Mono "eyebrow" label in `--amber`, a serif `h1.title` (`'Source Serif 4', Georgia, serif`, weight 600, `text-wrap: balance`), and a `.dek` subtitle paragraph in `--ink-700` capped to a readable measure (`max-width: 52–60ch`). Bottom-bordered in `--line` and bottom-margined 2–2.5rem to separate it from the body.

```html
<header class="hero">
  <p class="eyebrow">Teach doc · custom_addons/crm_methodology</p>
  <h1 class="title">Sales Methodology, Explained</h1>
  <p class="dek">What the addon does, why it exists, and how it differs from stock Odoo CRM.</p>
</header>
```

### Intended Learning Outcomes box

A bordered, shadowed card (`--paper-1` background, `--line` border, `box-shadow: var(--shadow)`, ~0.7rem radius) opening with a small uppercase IBM Plex Mono heading in `--amber`, then a plain `<ul>` of outcomes in `--ink-700`. Appears on the deep-dive page; treat as a required component for that page type, not optional decoration.

```html
<div class="ilo">
  <h2>Intended Learning Outcomes</h2>
  <ul>
    <li>Name the core framework of each methodology the addon can model.</li>
    <li>Explain what problem each methodology claims to solve.</li>
  </ul>
</div>
```

### Audience tags

Small circular badges (`.tag.s/.r/.c`, 1.4rem circle, IBM Plex Mono, background = the role's accent color, white text).

```html
<span class="tags">
  <span class="tag s" title="Sales">S</span>
  <span class="tag r" title="R&amp;D">R</span>
  <span class="tag c" title="Consultants">C</span>
</span>
```

### "Used in X" badge

Visually a status pill — rounded, IBM Plex Mono, uppercase, `--teal-soft` background with `--teal` text — but a different semantic than the New/Extended/Unchanged status pill below (it flags "this item is exercised by the demo data," not a code-change status). Share the same pill CSS shape; do not conflate the two meanings when generating markup.

```html
<span class="demo-badge">Used in our demo</span>
```

### Per-item label

A small uppercase IBM Plex Mono label in `--ink-500`, displayed as a block above a value — used to caption an inline fact (e.g. "Origin", "The framework") without a full heading.

```html
<p><span class="label">Origin</span>Developed inside PTC in the early 1990s.</p>
```

### Callouts

Left border in `--amber` (3px), tinted `--amber-soft` background, small uppercase IBM Plex Mono label (`<b>` child) above the body text, 0.5rem border radius.

```html
<blockquote class="callout">
  <b>For consultants</b>
  None of this touches the kanban pipeline.
</blockquote>
```

### Numbered step list

Steps rendered without native list markers; each `<li>` gets a circular IBM Plex Mono index badge (`counter(step)`, `--amber` border and text, 1.6rem circle) positioned left of the text, connected to the next step by a 1px `--line` vertical connector (omitted after the last item).

```html
<ol class="steps">
  <li>A client has a default methodology; every new opportunity inherits it.</li>
  <li>The opportunity's Qualification tab shows live completion.</li>
</ol>
```

### Definition list / glossary

A two-column grid (`grid-template-columns: max-content 1fr`), `dt` in bold IBM Plex Mono (`--ink-900`, `white-space: nowrap`), `dd` in `--ink-700` — used for a short list of must-use-consistently vocabulary terms.

```html
<dl class="terms">
  <dt>Sales Methodology</dt>
  <dd>A named qualification framework, owning Requirements and Playbook Questions.</dd>
</dl>
```

### Reading list links

Unstyled `<li>` rows, each wrapping an `<a>` styled as a bordered card (`--line` border, 0.5rem radius, `--paper-1` background) with a trailing `→` glyph (`content: "→"` in `--amber`, IBM Plex Mono) pushed to the row's end; hover brightens the border to `--amber` and nudges the row right 2px.

```html
<ul class="reading">
  <li><a href="../adr/0005-methodology-requirements-reference-properties-by-key.md">ADR 0005 — Requirements reference Properties by key</a></li>
</ul>
```

### Tables

Wrapped in `overflow-x:auto` + bordered container with `box-shadow: var(--shadow)`; header row uses IBM Plex Mono uppercase labels on `--paper-0` background; body rows on `--paper-1`; `tabular-nums` implied by IBM Plex Mono's monospace digits.

```html
<div class="table-wrap">
  <table>
    <thead><tr><th class="model">Model</th><th>What the addon adds</th><th>OOTB status</th></tr></thead>
    <tbody>
      <tr><td class="model">crm.methodology</td><td>Named framework.</td><td><span class="pill new">New</span></td></tr>
    </tbody>
  </table>
</div>
```

### Status pills

Small rounded-pill badges, IBM Plex Mono, background = the status's `-soft` color, text = the full-saturation color (`new`→teal, `ext`→violet, `same`→block).

```html
<span class="pill new">New</span>
<span class="pill ext">Extended</span>
<span class="pill same">Unchanged</span>
```

### Footer note

Small IBM Plex Mono text in `--ink-500`, top-bordered in `--line` — used for a closing "verified against code as of…" provenance line or a single back-link.

```html
<footer class="verify">Verified against code as of 2026-09-01 — six of seven technical claims checked directly.</footer>
```

### Focus state and reduced motion

`a:focus-visible, button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px }` — applied uniformly, not per-component. Any transition/animation added to the shared template must be guarded with `@media (prefers-reduced-motion: reduce) { *{ transition:none !important; } }`, per the two source Artifacts. Neither has a markup sample — they're global CSS rules, not components with their own HTML shape.

## Mermaid diagrams

Verified directly against the live Artifact's page source (not just the two source `.md`/`.html` files): the main teach doc author only writes `<pre class="mermaid">…flowchart syntax as plain text…</pre>` twice — nothing else. There is no Mermaid `<script>` or `<link>` in the Artifact's own authored markup. The rendering is done entirely by a runtime the Claude Artifacts *platform* injects after the author's content (bounded by an explicit `<!--claude-mermaid-runtime-end-->` marker in the page source), bundling the full Mermaid library inline (not fetched from a CDN at view time) and scanning the page for `pre.mermaid` elements to replace with rendered SVG.

That platform runtime uses its **own hardcoded color palette**, entirely independent of this doc's `--ink`/`--paper`/`--amber`/`--teal`/`--violet`/`--block` tokens:

```js
{"light":{"surface":"#f4efe4","text":"#42392e","line":"#8a7f6d","border":"#7a6c52","bg":"#fffdf8"},
 "dark":{"surface":"#262b34","text":"#f2f3f5","line":"#a8adb8","border":"#9aa4b8","bg":"#1f232b"}}
```

So today, inside the Artifact, the two flowcharts do **not** visually match the surrounding design system at all — there's no existing color-token mapping to copy.

**Resolved, correcting an earlier version of this section**: `docs-build:doc` never renders Mermaid at all, at view time or build time — issue #33 rejects pipeline-rendered Mermaid outright (parser complexity, a required headless-browser step), and [ADR 0009](adr/0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.md)'s zero-network reversal doesn't touch that reasoning (a stray claim to the contrary was struck from ADR 0009 as a mistake). The two Mermaid blocks in the source Markdown are a **content sketch** only — see #56, which tracks a Claude Code session authoring them as finished SVG image assets using this design system's actual color tokens (not the hardcoded palette above), then embedding them through the pipeline's ordinary image-embedding mechanism like any screenshot.

## What this file deliberately omits

Full markup. This file documents the *visual* system, not a copy-pasteable source — the audience-filter JavaScript (`.chip`/`.legend`/`#reset-filter` and their click handlers) and the TOC's scroll-spy *highlighting* logic (`IntersectionObserver` over `nav.toc`, which toggles `.current` as sections scroll past) exist verbatim in the source Artifact and should be re-embedded as-is per [ADR 0009](adr/0009-docs-build-doc-relaxes-zero-network-and-adds-authoring-directives.md), not reproduced from this description. (An earlier version of this section called these "page-specific interactive behavior" the pipeline should make its own call on, favoring determinism over embedded JS — that framing is reversed by ADR 0009 in favor of matching the reviewed Artifacts.) The TOC's `position: sticky` itself is captured above (Layout conventions) since that's pure CSS, not JS.

Also omitted: `.keyword-grid`/`.keyword-card`, defined in the main teach doc Artifact's stylesheet but never referenced by its markup — dead CSS in the source Artifact itself, not a rendered design element to reproduce.
