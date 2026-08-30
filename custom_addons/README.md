# Custom Addons

Repository-owned Odoo modules live in this directory. Generate a module with:

```text
scripts/dev.ps1 scaffold <module>
scripts/dev.sh scaffold <module>
```

Keep upstream `odoo/` and `addons/` unchanged unless a core patch is explicitly approved. See `docs/adr/0001-separate-custom-addons-from-upstream.md` and `docs/agents/odoo-19-development.md` before implementing an addon.

`example_addon/` is a small, real internal-announcement feature kept as a living reference: it demonstrates this repo's manifest, model, security (privilege/group/ACL), view, menu, and test conventions, and doubles as a smoke-test fixture for the dev workflow (scaffold, install, update, test, lint).
