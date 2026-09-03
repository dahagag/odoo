from . import controllers, models, wizards


def _post_init_backfill_methodology(env):
    default_methodology = env['crm.methodology']._get_default()
    env['res.partner'].with_context(active_test=False).search([('methodology_id', '=', False)]).write({
        'methodology_id': default_methodology.id,
    })
    env['crm.lead'].with_context(active_test=False).search([('methodology_id', '=', False)]).write({
        'methodology_id': default_methodology.id,
    })
