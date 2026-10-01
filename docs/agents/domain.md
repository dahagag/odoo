# Domain Docs

How agents consume and extend this repository's multi-context domain documentation.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: identify every business context touched by the work, including integration edges.
- **`docs/contexts/<context>/GLOSSARY.md`** when present: read the glossary for each relevant context.
- **`docs/adr/`**: read system-wide decisions that touch the work.

Context glossaries are lazy. If a relevant `GLOSSARY.md` does not exist, proceed with the map's vocabulary and create a glossary only when `/domain-modeling` resolves a project-specific term.

## File structure

```
/
├── GLOSSARY-MAP.md
└── docs/
    ├── adr/                            ← system-wide decisions
    └── contexts/
        ├── crm/GLOSSARY.md             ← created when terms resolve
        └── hosting/GLOSSARY.md
```

Do not create empty context files. `GLOSSARY-MAP.md` is the boundary map; a context file is a resolved glossary.

## Use the glossary's vocabulary

When output names a domain concept, use the map and relevant glossary's canonical term. A shared Odoo model is an implementation convenience, not evidence that every context shares ownership of the concept.

Keep `GLOSSARY.md` implementation-free: define business meaning in one or two sentences, and place model names, fields, APIs, workflows, and code decisions in specifications or agent playbooks.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
