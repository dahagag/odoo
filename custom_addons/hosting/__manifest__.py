{
    'name': "Hosting",
    'summary': "Read-only Org Registration view for a Trial Org's own instance",
    'description': """
Installed on every Trial Org's own instance (never on the factory1 Platform instance, which
instead installs `hosting_admin`). Shows this org its own registration standing - name,
prospect domain, seats used/total, and expiry date - with no admin capability, no AWS
credentials, and no cross-org data. Deliberately thin: read-only, no dependency on
`hosting_admin` or any AWS/OpenTofu code.

See docs/adr/0018 for the admin/org-facing addon split and docs/contexts/hosting/CONTEXT.md
for vocabulary (Trial Org, Seat, Org Registration).
    """,
    'author': "agentic-erp",
    'category': 'Hosting',
    'version': '19.0.1.0.0',

    'depends': ['base', 'web', 'web_tour'],

    'data': [
        'security/ir.model.access.csv',
        'views/hosting_org_registration_views.xml',
        'views/hosting_org_registration_menus.xml',
    ],

    'assets': {
        'web.assets_backend': [
            'hosting/static/src/js/**/*',
            'hosting/static/src/xml/**/*',
            'hosting/static/src/scss/**/*',
        ],
        'web.assets_unit_tests': [
            'hosting/static/tests/expiry_countdown_systray.test.js',
            'hosting/static/tests/onboarding_prompt.test.js',
        ],
        'web.assets_tests': [
            'hosting/static/tests/tours/**/*',
        ],
    },

    'license': 'LGPL-3',
}
