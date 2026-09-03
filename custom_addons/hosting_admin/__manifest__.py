{
    'name': "Hosting Administration",
    'summary': "Platform-only cross-org Trial Org lifecycle and AWS/OpenTofu integration",
    'description': """
Owns the Trial Org model across every prospect/customer org: issuance, seat caps, the
issued/active/suspended/destroyed lifecycle, and the AWS/OpenTofu provisioning call surface
(via an injectable Provisioner seam). Installed only on the factory1 Platform instance -
never on a Trial Org's own instance, which instead installs the thin `hosting` addon.

See docs/adr/0018 for the admin/org-facing addon split, docs/adr/0016 and docs/adr/0019 for
the OpenTofu/Step Functions job-orchestration design this module's Provisioner seam stands in
for, and docs/contexts/hosting/CONTEXT.md for vocabulary (Trial Org, Seat, Active/Suspended,
Wake, Auto-Destroy, Deployment Version).
    """,
    'author': "agentic-erp",
    'category': 'Hosting',
    'version': '19.0.1.0.0',

    'depends': ['base'],

    'data': [
        'security/hosting_admin_groups.xml',
        'security/ir.model.access.csv',
    ],

    'license': 'LGPL-3',
}
