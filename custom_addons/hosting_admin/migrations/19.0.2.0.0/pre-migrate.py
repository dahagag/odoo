import logging

_logger = logging.getLogger(__name__)

# Tables owned by models this ticket (#197) removes entirely - their lifecycle, seat, and cost
# behaviour ported to the administration stack (docs/adr/0034). Odoo's own module-upgrade
# machinery cleans up the corresponding ir.model/ir.model.fields/ir.model.access rows once this
# version's module code no longer registers these models (they're plain metadata, not data a
# site operator authored) - but it never drops the underlying SQL table itself, so a pre-migrate
# script is what actually reclaims that storage and stops a stale table from lingering forever.
_REMOVED_TABLES = (
    'hosting_trial_org_seat',
    'hosting_cost_dashboard_line',
    'hosting_cost_dashboard_snapshot',
)

# hosting_trial_org columns this ticket's model rewrite drops - every one was Provisioner/AWS-
# audit-specific (models/provisioner.py, now removed) with no administration-stack-mirrored
# counterpart Odoo still needs (docs/adr/0034: Odoo mirrors the stack's own OrgSchema, which
# carries no Deployment Version audit fields, execution ARN, or raw EC2 instance id).
_REMOVED_TRIAL_ORG_COLUMNS = (
    'ami_id',
    'tofu_module_git_sha',
    'pending_ami_id',
    'pending_tofu_module_git_sha',
    'last_execution_arn',
    'instance_id',
)


def migrate(cr, version):
    """Runs before this version's module code (and therefore its ORM schema) loads, so every
    table/column below still holds whatever the previous version (19.0.1.x) left behind. Every
    statement is its own IF EXISTS/IF EXISTS-guarded DROP, so a second run (or a fresh install
    with none of this history) is a safe no-op rather than an error."""
    for table in _REMOVED_TABLES:
        _logger.info("hosting_admin migration %s: dropping obsolete table %s", version, table)
        cr.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')

    for column in _REMOVED_TRIAL_ORG_COLUMNS:
        _logger.info(
            "hosting_admin migration %s: dropping obsolete column hosting_trial_org.%s",
            version, column)
        cr.execute(f'ALTER TABLE "hosting_trial_org" DROP COLUMN IF EXISTS "{column}"')
