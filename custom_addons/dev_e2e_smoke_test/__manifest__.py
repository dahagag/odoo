{
    'name': "Dev E2E Smoke Test",
    'summary': "Trivial browser tour proving the dev image's Chrome/websocket-client E2E seam works",
    'description': """
Holds a single tour with no dependency on any other custom addon, so
`./scripts/dev.ps1 test dev_e2e_smoke_test` verifies HttpCase/tour tests
actually run in the dev image rather than being silently skipped.
    """,
    'author': "agentic-erp",
    'category': 'Hidden/Tools',
    'version': '19.0.1.0.0',

    'depends': ['web_tour'],

    'assets': {
        'web.assets_tests': [
            'dev_e2e_smoke_test/static/tests/tours/**/*',
        ],
    },
    'installable': True,
    'license': 'LGPL-3',
}
