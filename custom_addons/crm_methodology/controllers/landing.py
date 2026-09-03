"""Public landing page at `/`.

Per docs/adr/0011, this overrides Odoo's default `Home.index` redirect to
the backend/login screen for the root path only — `/odoo` itself is left
completely untouched, since it already resolves to Odoo's own backend/login
on this instance and doubles as "the demo" with zero additional code.

The markup below is a hand-authored static HTML asset in the same spirit as
the teach docs' committed, self-contained HTML (docs/adr/0007): it shares
their design tokens, type stack, and video-scrim/theater-mode treatment
(scripts/docs_build/markdown_transform.py, scripts/docs_build/sales_layout.py)
so the landing page and the docs it links to read as one product.
"""
from odoo import http
from odoo.http import request

from odoo.addons.web.controllers.home import Home

_LANDING_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sales Methodology — a CRM Add-on</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  @view-transition{ navigation:auto; }
  :root{
    --ink-900:#1B2430; --ink-700:#3E4A59; --ink-500:#6B7688;
    --paper-0:#F3F4EF; --paper-1:#FFFFFF; --line:#D3D6CC;
    --amber:#B96A22; --amber-soft:#F0DFC7;
    --teal:#2E6B60; --teal-soft:#D9E8E3;
    --violet:#5B5285; --violet-soft:#E5E2F0;
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
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
      color-scheme: dark;
    }
  }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--paper-0); color:var(--ink-900); font-family:'Karla',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  a{ color:var(--teal); text-decoration:none; transition:color .15s ease; }
  a:hover{ color:var(--amber); }
  a:focus-visible{ outline:2px solid var(--amber); outline-offset:2px; }

  .shell{ max-width:840px; margin:0 auto; padding:0 clamp(1.25rem,4vw,2rem) 6rem; }

  header.hero{ padding:3.5rem 0 2.5rem; border-bottom:1px solid var(--line); margin-bottom:2.5rem; }
  .eyebrow{ font-family:'IBM Plex Mono',monospace; font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; color:var(--amber); margin:0 0 .9rem; }
  h1.title{ font-family:'Source Serif 4',Georgia,serif; font-weight:600; font-size:clamp(2rem,5vw,3rem); line-height:1.1; margin:0 0 1rem; text-wrap:balance; }
  .dek{ font-size:1.08rem; color:var(--ink-700); max-width:58ch; line-height:1.6; margin:0; }

  .hero-video{ margin-top:2.2rem; position:relative; }
  .hero-video .frame{
    position:relative; border-radius:.7rem; overflow:hidden;
    border:1px solid var(--line); box-shadow:var(--shadow);
  }
  .hero-video video{ display:block; width:100%; }
  .hero-video .video-scrim{
    position:absolute; inset:0; background:var(--ink-900); opacity:.45;
    pointer-events:none; transition:opacity .3s ease;
  }
  .hero-video .frame.is-playing .video-scrim{ opacity:0; }
  .hero-video .video-caption{
    font-family:'IBM Plex Mono',monospace; font-size:.72rem; letter-spacing:.03em; color:var(--ink-500);
    margin:.9rem 0 0;
  }

  .section-label{ font-family:'IBM Plex Mono',monospace; font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:var(--ink-500); margin:0 0 1.1rem; }

  /* Theater mode: while the hero video plays, everything below it recedes
     so the video is the only thing asking for attention, reversing the
     instant playback stops. */
  .docs, .demo{ transition:opacity .45s ease, filter .45s ease; }
  .shell.theater-mode .docs,
  .shell.theater-mode .demo{
    opacity:.22; filter:saturate(.5) blur(1px); pointer-events:none;
  }

  .docs{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:1.25rem; margin-bottom:3rem; }
  .doc-card{
    display:flex; flex-direction:column; gap:.7rem;
    background:var(--paper-1); border:1px solid var(--line); border-radius:.7rem;
    padding:1.6rem 1.7rem; box-shadow:var(--shadow);
    transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease;
  }
  .doc-card:hover{
    transform:translateY(-3px); border-color:var(--violet);
    box-shadow:0 4px 8px rgba(27,36,48,.08), 0 14px 28px rgba(27,36,48,.08);
  }
  .doc-card .kicker{ font-family:'IBM Plex Mono',monospace; font-size:.68rem; text-transform:uppercase; letter-spacing:.05em; color:var(--violet); background:var(--violet-soft); align-self:flex-start; padding:.22rem .6rem; border-radius:999px; }
  .doc-card h2{ font-family:'Source Serif 4',Georgia,serif; font-weight:600; font-size:1.25rem; margin:0; line-height:1.25; }
  .doc-card p{ font-size:.95rem; color:var(--ink-700); line-height:1.6; margin:0; flex-grow:1; }
  .doc-card .read-link{ font-family:'IBM Plex Mono',monospace; font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; display:inline-flex; align-items:center; gap:.35rem; margin-top:.3rem; }
  .doc-card .read-link svg{ width:13px; height:13px; }

  .demo{
    display:flex; align-items:center; justify-content:space-between; gap:1.5rem; flex-wrap:wrap;
    background:var(--teal-soft); border:1px solid var(--line); border-radius:.9rem;
    padding:2rem 2.2rem; margin-bottom:2.5rem;
  }
  .demo-copy h2{ font-family:'Source Serif 4',Georgia,serif; font-weight:600; font-size:1.4rem; margin:0 0 .5rem; color:var(--ink-900); }
  .demo-copy p{ font-size:.95rem; color:var(--ink-700); line-height:1.6; margin:0; max-width:46ch; }
  .demo-cta{
    display:inline-flex; align-items:center; gap:.5rem;
    font-family:'IBM Plex Mono',monospace; font-size:.82rem; text-transform:uppercase; letter-spacing:.05em; font-weight:600;
    background:var(--teal); color:var(--paper-1); padding:.85rem 1.5rem; border-radius:.5rem;
    white-space:nowrap; box-shadow:var(--shadow);
    transition:background-color .18s ease, transform .18s ease;
  }
  .demo-cta:hover{ background:var(--amber); color:var(--paper-1); transform:translateY(-2px); }
  .demo-cta svg{ width:15px; height:15px; }

  footer.foot{ padding-top:1.5rem; border-top:1px solid var(--line); }
  footer.foot p{ font-family:'IBM Plex Mono',monospace; font-size:.76rem; color:var(--ink-500); margin:0; }

  @media (max-width: 620px){
    .docs{ grid-template-columns:1fr; }
    .demo{ flex-direction:column; align-items:flex-start; }
  }
</style>
</head>
<body>

<div class="shell">
  <header class="hero">
    <p class="eyebrow">CRM Methodology Add-on</p>
    <h1 class="title">Sell with a named methodology, not tribal knowledge</h1>
    <p class="dek">Configurable MEDDIC, Sandler, SPIN and more — qualification fields, coaching gates, and discovery playbooks built into the CRM pipeline your reps already use.</p>

    <div class="hero-video">
      <div class="frame">
        <video src="/crm_methodology/static/docs/sales-methodology-vs-odoo-crm.mp4" controls preload="metadata"></video>
        <div class="video-scrim" aria-hidden="true"></div>
      </div>
      <p class="video-caption">Sales Methodology, Explained &middot; narrated walkthrough</p>
    </div>
  </header>

  <section>
    <p class="section-label">Read the docs</p>
    <div class="docs">
      <a class="doc-card" href="/crm_methodology/static/docs/sales-methodology-vs-odoo-crm.html">
        <span class="kicker">Start here</span>
        <h2>Sales Methodology, Explained</h2>
        <p>What a Sales Methodology is in this addon, how Requirements and Checkpoints gate the pipeline, and how it differs from stock Odoo CRM.</p>
        <span class="read-link">Read the doc <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8h10M9 4l4 4-4 4"/></svg></span>
      </a>
      <a class="doc-card" href="/crm_methodology/static/docs/methodologies.html">
        <span class="kicker">Deep dive</span>
        <h2>The Eight B2B Sales Methodologies</h2>
        <p>MEDDIC, Sandler, SPIN and five more — each framework's own terms, the problem it solves, and how it maps onto a Requirement.</p>
        <span class="read-link">Read the doc <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8h10M9 4l4 4-4 4"/></svg></span>
      </a>
    </div>
  </section>

  <section class="demo">
    <div class="demo-copy">
      <h2>See it on a live pipeline</h2>
      <p>Pre-seeded demo data across three methodologies and three clients — sign in and walk a deal through its gates.</p>
    </div>
    <a class="demo-cta" href="/odoo">Try the demo <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>
  </section>

  <footer class="foot">
    <p>crm_methodology — an Odoo 19 CRM extension</p>
  </footer>
</div>

<script>
  (function(){
    var frame = document.querySelector('.hero-video .frame');
    var video = frame && frame.querySelector('video');
    var shell = document.querySelector('.shell');
    if (!video) { return; }
    var setPlaying = function(playing){ frame.classList.toggle('is-playing', playing); };
    var exitTheaterMode = function(){ if (shell) shell.classList.remove('theater-mode'); };
    video.addEventListener('play', function(){ setPlaying(true); if (shell) shell.classList.add('theater-mode'); });
    video.addEventListener('playing', function(){ setPlaying(true); if (shell) shell.classList.add('theater-mode'); });
    video.addEventListener('pause', function(){ setPlaying(false); exitTheaterMode(); });
    video.addEventListener('ended', function(){ setPlaying(false); exitTheaterMode(); });
    // Theater mode backs off on scroll or once the pointer leaves the video —
    // signals that attention has moved elsewhere — without pausing playback.
    window.addEventListener('scroll', exitTheaterMode, { passive: true });
    frame.addEventListener('mouseleave', exitTheaterMode);
  })();
</script>
</body>
</html>
"""


class LandingHome(Home):
    """Deliberately non-cooperative override: `/` should show the landing page
    instead of Home's redirect-to-backend, not both, so this never calls
    super(). See docs/agents/odoo-19-development.md's override-cooperation
    exception for a controller meant to fully replace what it overrides."""

    @http.route('/', type='http', auth='public')
    def index(self, *args, **kw):
        return request.make_response(_LANDING_HTML, headers=[('Content-Type', 'text/html; charset=utf-8')])
