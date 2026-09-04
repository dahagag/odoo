"""Regenerate a module's ``i18n/<iso>.po`` files for a set of target languages.

Piped into ``odoo-source shell`` (via stdin, so it needs no argv of its own) by
``dev.ps1``/``dev.sh``'s ``i18n-export`` command, against a disposable database with
the target module already installed - ``env`` below comes from the shell's REPL
locals. Reads which module and languages to export from the ``I18N_EXPORT_MODULE``
/ ``I18N_EXPORT_LANGS`` environment variables instead.

Mirrors what Settings > Translations > Export Translation
(``base.language.export``, ``odoo/addons/base/wizard/base_export_language.py``)
does under the hood - activate each language, then ``trans_export()`` - with two
conveniences this repo's i18n convention wants that the wizard doesn't give you:

- Naming the output file by each language's ``iso_code`` (matching the filenames
  Odoo's own ``odoo/addons/base/i18n/*.po`` ships - e.g. ``ar.po`` for the res.lang
  record whose actual ``code`` is ``ar_001``) and stamping that same code into the
  file's own ``Language:`` header, rather than the wizard's raw internal lang code.
- Dropping the handful of field labels every model gets for free from the
  mail/base mixins (Created by/on, Last Updated by/on, Display Name, ID) - Odoo's
  own base module already ships translations for those literal strings, so
  repeating them here would just be noise against the module's own introduced
  strings (see ``custom_addons/crm_methodology/i18n/README.md``'s documented scope
  of "the strings *this* feature introduced").
"""
import io
import logging
import os

import polib

from odoo.tools.translate import trans_export

_logger = logging.getLogger(__name__)

MODULE = os.environ['I18N_EXPORT_MODULE']
ISO_CODES = os.environ['I18N_EXPORT_LANGS'].split(',')

_BOILERPLATE_MSGIDS = {
    "Created by", "Created on", "Display Name", "ID", "Last Updated by", "Last Updated on",
}

Lang = env['res.lang'].with_context(active_test=False)  # noqa: F821 (env: shell REPL local)
lang_by_iso = {}
for iso in ISO_CODES:
    record = Lang.search([('iso_code', '=', iso)], limit=1)
    if not record:
        # A handful of languages (e.g. Korean) have no bare `res.lang.iso_code` in this
        # Odoo version - only region variants like `ko_KR`/`ko_KP`. Odoo's own shipped
        # translation file is still named after the bare code (base/i18n/ko.po), so fall
        # back to the first region variant (ordered by `code` for determinism) and keep
        # naming the output file by the requested bare `iso`.
        record = Lang.search([('code', '=like', f'{iso}\\_%')], order='code', limit=1)
    if not record:
        raise RuntimeError(f"No res.lang record with iso_code={iso!r} or a region variant")
    lang_by_iso[iso] = record
    # _activate_lang() alone only flips the record's `active` flag - it does not load any
    # installed module's existing i18n/<iso>.po from disk. _activate_and_install_lang() goes
    # through action_unarchive(), which does (see res_lang.py's _update_translations call), so
    # an already-translated msgstr already on disk actually gets read back by trans_export()
    # below instead of coming back blank.
    env['res.lang']._activate_and_install_lang(record.code)  # noqa: F821
env.cr.commit()  # noqa: F821

i18n_dir = f'/workspace/custom_addons/{MODULE}/i18n'
os.makedirs(i18n_dir, exist_ok=True)
for iso, record in lang_by_iso.items():
    buf = io.BytesIO()
    trans_export(record.code, [MODULE], buf, 'po', env)  # noqa: F821
    po = polib.pofile(buf.getvalue().decode('utf-8'))
    po.metadata['Language'] = iso
    for entry in [e for e in po if e.msgid in _BOILERPLATE_MSGIDS]:
        po.remove(entry)
    po.save(f'{i18n_dir}/{iso}.po')
    _logger.info('Wrote i18n/%s.po (%d entries, res.lang code %r)', iso, len(po), record.code)
