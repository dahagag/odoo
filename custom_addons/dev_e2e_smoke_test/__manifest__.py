{
    'name': "Dev E2E Smoke Test",
    'summary': "Trivial browser tour proving the dev image's Chrome/websocket-client E2E seam works",
    'description': """
Holds a single tour with no dependency on any other custom addon, so
`./scripts/dev.ps1 test dev_e2e_smoke_test` verifies HttpCase/tour tests
actually run in the dev image rather than being silently skipped.

Also serves as #203's staging deploy verification (#342): depends on
crm_methodology so its TransactionCase tests can assert crm_methodology is
installed and dev.domain.com staging's seeded early-adopter/stakeholder
res.users accounts (#339) are present with the expected groups and no
committed password - see tests/test_staging_deploy_verification.py.
    """,
    'author': "agentic-erp",
    'category': 'Hidden/Tools',
    'version': '19.0.1.0.0',

    'depends': ['web_tour', 'crm_methodology'],

    'assets': {
        'web.assets_tests': [
            'dev_e2e_smoke_test/static/tests/tours/**/*',
        ],
    },
    'installable': True,
    'license': 'LGPL-3',
}
