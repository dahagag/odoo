"""Approved structural template for the sales-methodology teach document.

Content remains in Markdown; this module owns only the reviewed layout, CSS,
video/TOC scaffolding, and interaction script.
"""

SALES_LAYOUT_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  :root{
    --ink-900:#1B2430;
    --ink-700:#3E4A59;
    --ink-500:#6B7688;
    --paper-0:#F3F4EF;
    --paper-1:#FFFFFF;
    --line:#D3D6CC;
    --amber:#B96A22;
    --amber-soft:#F0DFC7;
    --teal:#2E6B60;
    --teal-soft:#D9E8E3;
    --violet:#5B5285;
    --violet-soft:#E5E2F0;
    --block:#A23B3B;
    --block-soft:#F3DBDB;
    --shadow: 0 1px 2px rgba(27,36,48,.06), 0 8px 24px rgba(27,36,48,.05);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ink-900:#ECEAE2;
      --ink-700:#C7CCC0;
      --ink-500:#93998C;
      --paper-0:#181B17;
      --paper-1:#20241F;
      --line:#3A3F35;
      --amber:#E0954C;
      --amber-soft:#3B2C18;
      --teal:#6FBBAC;
      --teal-soft:#1D332E;
      --violet:#B0A6E0;
      --violet-soft:#2A2540;
      --block:#E28080;
      --block-soft:#3A2222;
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"]{
    --ink-900:#ECEAE2;
    --ink-700:#C7CCC0;
    --ink-500:#93998C;
    --paper-0:#181B17;
    --paper-1:#20241F;
    --line:#3A3F35;
    --amber:#E0954C;
    --amber-soft:#3B2C18;
    --teal:#6FBBAC;
    --teal-soft:#1D332E;
    --violet:#B0A6E0;
    --violet-soft:#2A2540;
    --block:#E28080;
    --block-soft:#3A2222;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
    color-scheme: dark;
  }

  @view-transition{
    navigation:auto;
  }
  *{box-sizing:border-box;}
  body{
    margin:0;
    background:var(--paper-0);
    color:var(--ink-900);
    font-family:'Karla',system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  a{color:var(--teal); transition:color .15s ease;}
  a:focus-visible, button:focus-visible, .chip:focus-visible{
    outline:2px solid var(--amber);
    outline-offset:2px;
  }

  .shell{
    max-width:840px;
    margin:0 auto;
    padding:0 clamp(1.25rem,4vw,2rem) 6rem;
  }

  /* ---------- Header ---------- */
  /* Hero walkthrough video. Rules copied verbatim from docs-build:doc's template
     (scripts/docs_build/markdown_transform.py) so a regeneration under #74 matches. */
  .video-embed{
    /* sits between the hero rule and the audience filter */
    position:relative;
    margin:0 0 1.75rem;
  }
  /* Darkens the frame while the video is stopped. Frame 1 opens on a near-empty
     cream ground, so an undimmed poster reads as a bright slab; the scrim fades
     out on play and back in on pause/end. pointer-events:none so it never
     intercepts a click on the native controls, and it is the default state so
     the page still behaves with JS unavailable. */
  .video-scrim{
    position:absolute;
    inset:0;
    border-radius:.5rem;
    background:var(--ink-900);
    opacity:.45;
    pointer-events:none;
    transition:opacity .3s ease;
  }
  .video-embed.is-playing .video-scrim{
    opacity:0;
  }
  .video-embed video{
    display:block;
    width:100%;
    border-radius:.5rem;
    box-shadow:var(--shadow);
  }
  /* Theater mode: while the video plays, everything below it recedes so the
     video is the only thing asking for attention. Reverses the instant the
     video stops so reading resumes exactly where it left off. */
  .legend, .layout, .demo{
    transition:opacity .45s ease, filter .45s ease;
  }
  .shell.theater-mode .legend,
  .shell.theater-mode .layout,
  .shell.theater-mode .demo{
    opacity:.22;
    filter:saturate(.5) blur(1px);
    pointer-events:none;
  }
  header.hero{
    padding:clamp(2.5rem,6vw,4rem) 0 2rem;
    border-bottom:1px solid var(--line);
    margin-bottom:2.5rem;
  }
  .eyebrow{
    font-family:'IBM Plex Mono',monospace;
    font-size:.72rem;
    letter-spacing:.14em;
    text-transform:uppercase;
    color:var(--amber);
    margin:0 0 .9rem;
  }
  h1.title{
    font-family:'Source Serif 4',Georgia,serif;
    font-weight:600;
    font-size:clamp(2.1rem,4.4vw,3.4rem);
    line-height:1.06;
    margin:0 0 .9rem;
    text-wrap:balance;
    max-width:16ch;
  }
  .dek{
    font-size:clamp(1rem,1.6vw,1.2rem);
    color:var(--ink-700);
    max-width:52ch;
    line-height:1.55;
    margin:0 0 1.75rem;
  }
  .legend{
    margin:0 0 2.5rem;
    display:flex;
    flex-wrap:wrap;
    gap:.6rem;
    align-items:center;
  }
  .legend-label{
    font-family:'IBM Plex Mono',monospace;
    font-size:.72rem;
    letter-spacing:.08em;
    text-transform:uppercase;
    color:var(--ink-500);
    margin-right:.25rem;
  }
  .chip{
    font-family:'IBM Plex Mono',monospace;
    font-size:.78rem;
    font-weight:500;
    border-radius:999px;
    padding:.36rem .85rem;
    border:1px solid var(--line);
    background:var(--paper-1);
    color:var(--ink-700);
    cursor:pointer;
    display:inline-flex;
    align-items:center;
    gap:.4rem;
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease;
  }
  .chip:hover{ box-shadow:var(--shadow); transform:translateY(-1px); }
  .chip[data-active="true"]{
    border-color:transparent;
    color:var(--paper-1);
  }
  .chip.s[data-active="true"]{ background:var(--teal); }
  .chip.r[data-active="true"]{ background:var(--violet); }
  .chip.c[data-active="true"]{ background:var(--amber); }
  .chip .dot{ width:.5rem; height:.5rem; border-radius:50%; }
  .chip.s .dot{ background:var(--teal); }
  .chip.r .dot{ background:var(--violet); }
  .chip.c .dot{ background:var(--amber); }
  .chip[data-active="true"] .dot{ background:var(--paper-1); }
  #reset-filter{
    font-family:'IBM Plex Mono',monospace;
    font-size:.75rem;
    color:var(--ink-500);
    background:none;
    border:none;
    text-decoration:underline;
    cursor:pointer;
    padding:.36rem .3rem;
  }
  #reset-filter[hidden]{ display:none; }

  /* ---------- Layout ---------- */
  .layout{
    display:grid;
    grid-template-columns:230px minmax(0,1fr);
    gap:clamp(2rem,4vw,4rem);
    align-items:start;
  }
  @media (max-width:860px){
    .layout{ grid-template-columns:1fr; }
    nav.toc{ position:static !important; margin-bottom:2rem; }
  }

  nav.toc{
    position:sticky;
    top:1.5rem;
    font-family:'IBM Plex Mono',monospace;
    font-size:.8rem;
  }
  nav.toc ol{
    list-style:none;
    margin:0;
    padding:0;
    border-left:1px solid var(--line);
  }
  nav.toc li{ margin:0; }
  nav.toc a{
    display:block;
    padding:.42rem .9rem;
    margin-left:-1px;
    border-left:1px solid transparent;
    color:var(--ink-500);
    text-decoration:none;
    line-height:1.35;
    transition:color .15s ease, border-color .15s ease;
  }
  nav.toc a:hover{ color:var(--ink-900); }
  nav.toc a.current{
    color:var(--amber);
    border-left-color:var(--amber);
    font-weight:500;
  }
  nav.toc a[data-dim="true"]{ opacity:.35; }

  main{ min-width:0; }

  section{
    padding-bottom:2.6rem;
    margin-bottom:2.6rem;
    border-bottom:1px solid var(--line);
    scroll-margin-top:1.5rem;
    transition:opacity .2s ease;
  }
  section:last-of-type{ border-bottom:none; }
  section[data-dim="true"]{ opacity:.3; }

  .sec-head{
    display:flex;
    align-items:baseline;
    gap:.8rem;
    flex-wrap:wrap;
    margin-bottom:1rem;
  }
  .sec-num{
    font-family:'IBM Plex Mono',monospace;
    font-size:.78rem;
    color:var(--ink-500);
  }
  h2{
    font-family:'Source Serif 4',Georgia,serif;
    font-weight:600;
    font-size:clamp(1.35rem,2.4vw,1.7rem);
    margin:0;
    text-wrap:balance;
  }
  .tags{ display:flex; gap:.35rem; }
  .tag{
    width:1.4rem; height:1.4rem;
    border-radius:50%;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    font-family:'IBM Plex Mono',monospace;
    font-size:.68rem;
    font-weight:600;
    color:var(--paper-1);
  }
  .tag.s{ background:var(--teal); }
  .tag.r{ background:var(--violet); }
  .tag.c{ background:var(--amber); }

  section > p, section > ul, section > ol{
    max-width:64ch;
    line-height:1.7;
    color:var(--ink-700);
    font-size:1.02rem;
  }
  section > p{ margin:0 0 1.1rem; }
  section strong{ color:var(--ink-900); }
  ol.steps{
    max-width:64ch;
    padding-left:0;
    list-style:none;
    counter-reset:step;
    margin:1.2rem 0 0;
  }
  ol.steps li{
    counter-increment:step;
    position:relative;
    padding:0 0 1.1rem 2.4rem;
    line-height:1.65;
    color:var(--ink-700);
  }
  ol.steps li::before{
    content:counter(step);
    position:absolute;
    left:0; top:.05rem;
    font-family:'IBM Plex Mono',monospace;
    font-size:.75rem;
    font-weight:600;
    color:var(--amber);
    width:1.6rem; height:1.6rem;
    border:1px solid var(--amber);
    border-radius:50%;
    display:flex; align-items:center; justify-content:center;
  }
  ol.steps li::after{
    content:"";
    position:absolute;
    left:.79rem; top:1.7rem; bottom:0;
    width:1px;
    background:var(--line);
  }
  ol.steps li:last-child::after{ display:none; }

  dl.terms{
    display:grid;
    grid-template-columns:max-content 1fr;
    gap:.6rem 1.6rem;
    max-width:64ch;
  }
  dl.terms dt{
    font-family:'IBM Plex Mono',monospace;
    font-size:.85rem;
    font-weight:600;
    color:var(--ink-900);
    white-space:nowrap;
    padding-top:.15rem;
  }
  dl.terms dd{
    margin:0;
    color:var(--ink-700);
    line-height:1.6;
  }

  blockquote.callout{
    margin:1.4rem 0 0;
    max-width:64ch;
    padding:.9rem 1.1rem;
    border-radius:.5rem;
    border-left:3px solid var(--amber);
    background:var(--amber-soft);
    font-size:.94rem;
    line-height:1.6;
    color:var(--ink-900);
  }
  blockquote.callout b{
    font-family:'IBM Plex Mono',monospace;
    font-size:.72rem;
    text-transform:uppercase;
    letter-spacing:.06em;
    display:block;
    margin-bottom:.3rem;
    color:var(--amber);
  }

  img{ max-width:100%; height:auto; display:block; margin:0 auto; }

  .table-wrap{ overflow-x:auto; border:1px solid var(--line); border-radius:.6rem; box-shadow:var(--shadow); }
  table{
    border-collapse:collapse;
    width:100%;
    font-size:.88rem;
    min-width:640px;
    background:var(--paper-1);
  }
  th, td{
    text-align:left;
    padding:.65rem .85rem;
    border-bottom:1px solid var(--line);
    vertical-align:top;
    line-height:1.5;
  }
  thead th{
    font-family:'IBM Plex Mono',monospace;
    font-size:.72rem;
    text-transform:uppercase;
    letter-spacing:.05em;
    color:var(--ink-500);
    background:var(--paper-0);
  }
  tbody tr:last-child td{ border-bottom:none; }
  td.model, th.model{ font-family:'IBM Plex Mono',monospace; font-size:.83rem; color:var(--ink-900); white-space:nowrap; }
  td.status{ white-space:nowrap; }
  .pill{
    font-family:'IBM Plex Mono',monospace;
    font-size:.72rem;
    padding:.15rem .55rem;
    border-radius:999px;
    display:inline-block;
  }
  .pill.new{ background:var(--teal-soft); color:var(--teal); }
  .pill.ext{ background:var(--violet-soft); color:var(--violet); }
  .pill.same{ background:var(--block-soft); color:var(--block); }

  .keyword-grid{
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
    gap:.7rem;
    max-width:64ch;
    margin-top:1.2rem;
  }
  .keyword-card{
    border:1px solid var(--line);
    border-radius:.5rem;
    padding:.75rem .9rem;
    background:var(--paper-1);
  }
  .keyword-card .name{ font-weight:600; font-size:.92rem; color:var(--ink-900); }
  .keyword-card .role{ font-family:'IBM Plex Mono',monospace; font-size:.72rem; color:var(--ink-500); margin-top:.15rem; }

  ul.plain{ padding-left:1.2rem; max-width:64ch; }
  ul.plain li{ line-height:1.7; color:var(--ink-700); margin-bottom:.4rem; }

  ul.reading{ list-style:none; padding:0; max-width:64ch; display:flex; flex-direction:column; gap:.6rem; }
  ul.reading li a{
    display:flex; align-items:center; gap:.6rem;
    text-decoration:none;
    padding:.7rem .9rem;
    border:1px solid var(--line);
    border-radius:.5rem;
    color:var(--ink-900);
    font-size:.92rem;
    background:var(--paper-1);
    transition:border-color .15s ease, transform .15s ease;
  }
  ul.reading li a:hover{ border-color:var(--amber); transform:translateX(2px); }
  ul.reading li a::after{ content:"→"; margin-left:auto; color:var(--amber); font-family:'IBM Plex Mono',monospace; }

  footer.verify{
    max-width:64ch;
    margin-top:1rem;
    padding-top:1.5rem;
    border-top:1px solid var(--line);
    font-family:'IBM Plex Mono',monospace;
    font-size:.78rem;
    color:var(--ink-500);
    line-height:1.6;
  }

  .demo{
    display:flex; align-items:center; justify-content:space-between; gap:1.5rem; flex-wrap:wrap;
    background:var(--teal-soft); border:1px solid var(--line); border-radius:.9rem;
    padding:2rem 2.2rem; margin-top:2.5rem;
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
  @media (max-width: 620px){
    .demo{ flex-direction:column; align-items:flex-start; }
  }

  @media (prefers-reduced-motion: reduce){
    *{ transition:none !important; }
  }
</style>
</head>
<body>

<div class="shell">
  <header class="hero">
    <p class="eyebrow">Teach doc &middot; custom_addons/crm_methodology</p>
    <h1 class="title">__TITLE__</h1>
    <p class="dek">__DEK__</p>
  </header>

__VIDEO__
  <div class="legend">
    <span class="legend-label">Filter by audience</span>
    <button class="chip s" data-filter="s" data-active="false"><span class="dot"></span>Sales</button>
    <button class="chip r" data-filter="r" data-active="false"><span class="dot"></span>R&amp;D</button>
    <button class="chip c" data-filter="c" data-active="false"><span class="dot"></span>Consultants</button>
    <button id="reset-filter" hidden>Clear filter</button>
  </div>

  <div class="layout">
    <nav class="toc" aria-label="Table of contents">
      <ol id="toc-list"></ol>
    </nav>

    <main>

__SECTIONS__

    </main>
  </div>

  <section class="demo">
    <div class="demo-copy">
      <h2>See it on a live pipeline</h2>
      <p>Pre-seeded demo data across three methodologies and three clients — sign in and walk a deal through its gates.</p>
    </div>
    <a class="demo-cta" href="/odoo">Try the demo <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>
  </section>
</div>

<script>
  (function(){
    // Scrim + theater mode: lift the video's own dim, and dim everything
    // else on the page, while the video is actually playing.
    var embed = document.querySelector('.video-embed');
    var video = embed && embed.querySelector('video');
    var shell = document.querySelector('.shell');
    if (video) {
      var setPlaying = function(playing){ embed.classList.toggle('is-playing', playing); };
      var exitTheaterMode = function(){ if (shell) shell.classList.remove('theater-mode'); };
      video.addEventListener('play', function(){ setPlaying(true); if (shell) shell.classList.add('theater-mode'); });
      video.addEventListener('playing', function(){ setPlaying(true); if (shell) shell.classList.add('theater-mode'); });
      video.addEventListener('pause', function(){ setPlaying(false); exitTheaterMode(); });
      video.addEventListener('ended', function(){ setPlaying(false); exitTheaterMode(); });
      // Theater mode backs off on scroll or once the pointer leaves the video —
      // signals that attention has moved elsewhere — without pausing playback.
      window.addEventListener('scroll', exitTheaterMode, { passive: true });
      embed.addEventListener('mouseleave', exitTheaterMode);
      // ...and comes back the moment the pointer returns to a still-playing video.
      embed.addEventListener('mouseenter', function(){
        if (!video.paused && shell) shell.classList.add('theater-mode');
      });
    }
  })();

  (function(){
    var sections = Array.prototype.slice.call(document.querySelectorAll('main > section'));
    var tocList = document.getElementById('toc-list');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    var resetBtn = document.getElementById('reset-filter');
    var active = null;

    sections.forEach(function(sec){
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + sec.id;
      a.textContent = sec.querySelector('h2').textContent;
      a.dataset.target = sec.id;
      li.appendChild(a);
      tocList.appendChild(li);
    });
    var tocLinks = Array.prototype.slice.call(tocList.querySelectorAll('a'));

    function applyFilter(tag){
      active = tag;
      chips.forEach(function(c){ c.dataset.active = (c.dataset.filter === tag) ? 'true' : 'false'; });
      resetBtn.hidden = !tag;
      sections.forEach(function(sec){
        var tags = (sec.dataset.tags || '').split(' ');
        var dim = tag && tags.indexOf(tag) === -1;
        sec.dataset.dim = dim ? 'true' : 'false';
      });
      tocLinks.forEach(function(a){
        var sec = document.getElementById(a.dataset.target);
        var tags = (sec.dataset.tags || '').split(' ');
        var dim = tag && tags.indexOf(tag) === -1;
        a.dataset.dim = dim ? 'true' : 'false';
      });
    }

    chips.forEach(function(chip){
      chip.addEventListener('click', function(){
        var tag = chip.dataset.filter;
        applyFilter(active === tag ? null : tag);
      });
    });
    resetBtn.addEventListener('click', function(){ applyFilter(null); });

    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        var link = tocList.querySelector('a[data-target="' + entry.target.id + '"]');
        if(!link) return;
        if(entry.isIntersecting){
          tocLinks.forEach(function(a){ a.classList.remove('current'); });
          link.classList.add('current');
        }
      });
    }, { rootMargin: '-10% 0px -70% 0px' });
    sections.forEach(function(sec){ observer.observe(sec); });
  })();
</script>
</body>
</html>
"""
