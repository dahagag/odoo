# Translations

Scope: the 11 user-facing strings this addon introduces - the 7 from the Org Registration
view (menu/action/view titles and the five `hosting.org.registration` field labels) plus the
4 the expiry countdown systray (issue #137) added (`expiry_countdown_systray.js`'s `_t`
strings: the "Trial: ..." wrapper and the left/expired/expires-today day-count phrasing). One
`.po` file exists for every language code in `dev.ps1`/`dev.sh`'s `i18n-export` default set
(`$DefaultI18nLanguages` / `DEFAULT_I18N_LANGUAGES`) - the same "Translated" tier
`crm_methodology` ships (see `custom_addons/crm_methodology/i18n/README.md`), just scoped to
this addon's much smaller 11-string surface instead of a full skeleton for every Odoo-shipped
language:

- **`ar`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `pt_BR`, `ru`, `sv`, `tr`,
  `zh_CN`, `zh_TW`**: real, hand-authored translations of all 11 strings.

This tier is LLM-drafted, not reviewed by a native speaker of each language - treat it the
way you would any community-contributed `.po` file and get a native-speaker review before
treating the wording as final.

No other language codes are shipped here - add one by hand the same way (a new `<lang>.po`
following the header/entry shape below) if a broader rollout is needed later.

Only "Trial" in the systray's "Trial: ..." wrapper falls under
`docs/contexts/hosting/CONTEXT.md`'s glossary treatment of specific product/technical terms
kept in English (Trial Org, Auto-Destroy, Extension, the `hosting_admin` module name) - it's
kept untranslated in every language, the same way `crm_methodology`'s translations keep
"Trial Org" itself in English. Everything else, including the older 7 strings ("Org
Registration", "Domain", "Seat Cap", etc.), is ordinary UI labels translated normally.

## Regenerating

`./scripts/dev.ps1 i18n-export hosting` (or the `dev.sh` equivalent) with no explicit
language argument regenerates all 16 of these files' `msgid` set from the addon's current
models/views - installs the module into a disposable database, activates each language, and
calls `odoo.tools.translate.trans_export` (see `scripts/i18n_export_shell.py`). It does not
write `msgstr` values for a new or changed string; edit the `.po` file directly afterward (or
via a normal PO editor) and re-run `./scripts/dev.ps1 update hosting`, no further
regeneration step required.

`ko` needs `i18n_export_shell.py`'s region-variant fallback: this Odoo version's `res.lang`
only ships Korean under `iso_code` `ko_KR`/`ko_KP`, not a bare `ko`, so the script falls back
to the first region variant (`ko_KP`, picked deterministically by `code` order) when the
exact `iso_code` lookup misses, and still writes the output as `ko.po` - matching how Odoo's
own `base` module names its shipped Korean translation.
