# Translations

Scope: the 7 user-facing strings the Org Registration view introduces (menu/action/view
titles and the five `hosting.org.registration` field labels). Two languages, chosen for this
addon's small surface rather than the crm_methodology's full ship-wide "Translated" tier (see
`custom_addons/crm_methodology/i18n/README.md`):

- **`ar`**, **`fr`**: real, hand-authored translations of all 7 strings.

No other language codes are shipped here yet - add one the same way `crm_methodology`'s were
added (see its README's "Regenerating" section) if a broader rollout is needed later.

None of this addon's strings fall under `docs/contexts/hosting/CONTEXT.md`'s glossary
treatment of specific product/technical terms kept in English (Trial Org, Auto-Destroy,
Extension, the `hosting_admin` module name) - "Org Registration", "Domain", "Seat Cap", etc.
are ordinary UI labels here, translated normally.

## Regenerating

`./scripts/dev.ps1 i18n-export hosting ar,fr` (or `bash scripts/dev.sh i18n-export hosting
ar,fr`) regenerates these two files' `msgid` set from the addon's current models/views -
installs the module into a disposable database, activates each language, and calls
`odoo.tools.translate.trans_export` (see `scripts/i18n_export_shell.py`). It does not write
`msgstr` values for a new or changed string; edit the `.po` file directly afterward (or via a
normal PO editor) and re-run `./scripts/dev.ps1 update hosting`, no further regeneration step
required.
