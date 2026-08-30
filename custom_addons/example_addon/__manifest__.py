{
    'name': "Example Addon",
    'version': '1.0.0',
    'category': 'Foundation/Example',
    'summary': "Reference addon demonstrating this repository's Odoo 19 conventions and dev workflow.",
    'description': """
Example Addon
=============

A small, real internal-announcement feature. It exists as two things at once:

- A living example of this repository's Odoo 19 coding, security, and
  testing conventions (see docs/agents/odoo-19-development.md).
- A smoke-test fixture for the local dev workflow (see
  docs/agents/local-development.md): scaffold, install, update, test, lint.

Any internal user can read active announcements; only Announcement Managers
can create, edit, or archive them.
""",
    'author': "Agentic ERP",
    'license': 'LGPL-3',
    'depends': ['base'],
    'data': [
        'security/example_addon_groups.xml',
        'security/ir.model.access.csv',
        'views/example_announcement_views.xml',
        'views/example_announcement_menus.xml',
    ],
    'installable': True,
    'application': False,
}
