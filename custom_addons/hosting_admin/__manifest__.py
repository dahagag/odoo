{
    'name': "Hosting Administration",
    'summary': "CRM integration over the administration stack's Trial Org record (docs/adr/0034)",
    'description': """
A thin CRM integration (#197): issue a Trial Org from an Opportunity, mirror its read-only
state, and hand off everything else to the administration stack - a separate application that
owns the Trial Org/Client Org record of truth, the AWS/OpenTofu provisioning call surface, and
the cost dashboard (docs/adr/0034). `HostingStackClient` is the single outbound seam this addon
calls through (RealHostingStackClient signs every request with SigV4 under Odoo's own
instance-profile role - no AWS credential stored in Odoo; StubHostingStackClient is a no-network
stand-in when no stack is configured). Installed only on the factory1 Platform instance - never
on a Trial Org's own instance, which instead installs the thin `hosting` addon.

See docs/adr/0018 for the original admin/org-facing addon split, docs/adr/0034 for why the Trial
Org record moved out of Odoo, docs/adr/0036 for the REST/OpenAPI contract this addon's client
implements, and docs/contexts/hosting/CONTEXT.md for vocabulary (Trial Org, Seat, Active/
Suspended, Wake, Auto-Destroy, Deployment Version).
    """,
    'author': "agentic-erp",
    'category': 'Hosting',
    'version': '19.0.2.0.0',

    'depends': ['base', 'bus'],

    'data': [
        'security/hosting_admin_groups.xml',
        'security/ir.model.access.csv',
        'data/ir_cron.xml',
        'views/hosting_trial_org_views.xml',
        'views/hosting_trial_org_menus.xml',
    ],

    'demo': [
        'demo/hosting_admin_demo.xml',
    ],

    'license': 'LGPL-3',
}
