# Translations

Scope of the `.po` files in this directory (added alongside the Trial Org feature on
`crm.lead` - `action_issue_trial` / `action_extend_trial`, the two trial wizards, and the
Trial Expiry countdown/retention display): the ~38 user-facing strings that feature
introduced (button labels, field names, wizard fields, validation/chatter messages, and the
countdown/retention wrapper text). The module's older pre-existing strings (Sales Methodology
qualification, Discovery Playbook) are **not** covered here - translating those is a separate,
much larger effort left for its own pass.

One `.po` file exists for every language code Odoo itself ships translations for (the set
under `odoo/addons/base/i18n/*.po`), so the file set matches what `res.lang`'s installable
language list expects. Two states:

- **Translated**: `ar`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `pt_BR`, `ru`,
  `sv`, `tr`, `zh_CN`, `zh_TW`. Real, hand-authored translations of all 38 strings.
- **Skeleton**: every other code. Correct headers and every `msgid` present with an empty
  `msgstr`, so Odoo recognizes the file and a translator (human or a follow-up pass) can fill
  it in without needing to regenerate anything.

The "Translated" tier is LLM-drafted, not reviewed by a native speaker of each language -
treat it the way you would any community-contributed `.po` file and get a native-speaker
review before treating the wording as final, especially for the longer field-help tooltips.
A few terms are deliberately kept in English across every language, matching
`docs/contexts/hosting/CONTEXT.md`'s glossary treatment of them as specific product/technical
terms rather than ordinary prose: **Trial Org**, **Auto-Destroy**, **Extension**, and the
`hosting_admin` module name.

## Regenerating

The translated `.po` files were generated from a Python translations table rather than typed
directly, to keep 16 languages' worth of the same 38 strings consistent. That generator
(`gen_i18n.py`) and its data (`translations_data.py`) aren't part of the addon - they were
throwaway scratch scripts. To add or correct a language: edit the target `<lang>.po` file
directly with a normal PO editor (or `msgstr` by hand) and re-run
`./scripts/dev.ps1 update crm_methodology`, no regeneration step required.
