from . import models, wizards


def _post_init_backfill_methodology(env):
    default_methodology = env.ref('crm_methodology.crm_methodology_none')
    env['res.partner'].search([('methodology_id', '=', False)]).write({
        'methodology_id': default_methodology.id,
    })
    env['crm.lead'].with_context(active_test=False).search([('methodology_id', '=', False)]).write({
        'methodology_id': default_methodology.id,
    })
