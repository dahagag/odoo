{
    'name': "Sales Methodology",
    'summary': "Configurable B2B sales methodologies (MEDDIC, Sandler, ...) for CRM opportunities",
    'description': """
Assign a Sales Methodology per client, governing which qualification
properties apply to their opportunities (with per-requirement Block/Warn
enforcement at the Quotation-Created and Marked-Won checkpoints) and which
discovery Playbook Questions surface when a matching activity is completed.

See docs/research/b2b-sales-methodologies-odoo.md and
docs/contexts/crm/CONTEXT.md in the repository for the research and
vocabulary behind this module, and docs/adr/0005 for why Requirements
reference Properties by key instead of owning field definitions.
    """,
    'author': "agentic-erp",
    'category': 'Sales/CRM',
    'version': '19.0.1.0.0',

    'depends': ['crm', 'sales_team', 'mail', 'sale_crm'],

    'data': [
        'security/crm_methodology_groups.xml',
        'security/ir.model.access.csv',
        'data/crm_methodology_data.xml',
        'views/crm_methodology_views.xml',
        'views/crm_lead_views.xml',
        'views/res_partner_views.xml',
        'views/crm_methodology_playbook_wizard_views.xml',
        'views/crm_methodology_menus.xml',
    ],
    'demo': [
        'demo/crm_methodology_demo.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'crm_methodology/static/src/js/activity_model_patch.js',
        ],
        'web.assets_tests': [
            'crm_methodology/static/tests/tours/**/*',
        ],
    },
    'post_init_hook': '_post_init_backfill_methodology',
    'license': 'LGPL-3',
}
