import importlib.util
import os

from odoo.tests import TransactionCase, tagged

_MIGRATION_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), 'migrations', '19.0.2.0.0', 'pre-migrate.py')


def _load_migrate():
    """`migrations/19.0.2.0.0/pre-migrate.py` lives under a directory name ("19.0.2.0.0") that
    isn't a valid Python package path segment, and Odoo itself only ever loads it by file path
    during an actual module upgrade - so this test loads it the same way, via importlib against
    the file directly, rather than a regular `import`."""
    spec = importlib.util.spec_from_file_location('hosting_admin_migration_19_0_2_0_0', _MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.migrate


@tagged('post_install', '-at_install')
class TestMigration1902000(TransactionCase):
    """Proves the pre-migrate script runs cleanly against a database carrying the old models'
    data (this ticket's Testing Decisions) - simulated here by recreating the removed tables/
    columns via raw SQL (this test's own database already runs the *new* schema, same as any
    other TransactionCase), then asserting the migration cleans them up without erroring, and
    that a second run is a safe no-op."""

    def _simulate_pre_upgrade_schema(self):
        self.env.cr.execute("""
            CREATE TABLE hosting_trial_org_seat (
                id serial PRIMARY KEY,
                trial_org_id integer,
                email varchar
            )
        """)
        self.env.cr.execute("""
            CREATE TABLE hosting_cost_dashboard_snapshot (
                id serial PRIMARY KEY,
                snapshot_date date
            )
        """)
        self.env.cr.execute("""
            CREATE TABLE hosting_cost_dashboard_line (
                id serial PRIMARY KEY,
                snapshot_id integer REFERENCES hosting_cost_dashboard_snapshot(id),
                spend numeric
            )
        """)
        self.env.cr.execute("ALTER TABLE hosting_trial_org ADD COLUMN ami_id varchar")
        self.env.cr.execute("ALTER TABLE hosting_trial_org ADD COLUMN tofu_module_git_sha varchar")
        self.env.cr.execute("ALTER TABLE hosting_trial_org ADD COLUMN pending_ami_id varchar")
        self.env.cr.execute(
            "ALTER TABLE hosting_trial_org ADD COLUMN pending_tofu_module_git_sha varchar")
        self.env.cr.execute("ALTER TABLE hosting_trial_org ADD COLUMN last_execution_arn varchar")
        self.env.cr.execute("ALTER TABLE hosting_trial_org ADD COLUMN instance_id varchar")

    def _table_exists(self, table_name):
        self.env.cr.execute(
            "SELECT to_regclass(%s) IS NOT NULL", (table_name,))
        return self.env.cr.fetchone()[0]

    def _column_exists(self, table_name, column_name):
        self.env.cr.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = %s AND column_name = %s
        """, (table_name, column_name))
        return bool(self.env.cr.fetchone())

    def test_migration_drops_the_removed_tables_and_columns(self):
        self._simulate_pre_upgrade_schema()
        migrate = _load_migrate()

        migrate(self.env.cr, '19.0.2.0.0')

        for table in ('hosting_trial_org_seat', 'hosting_cost_dashboard_line', 'hosting_cost_dashboard_snapshot'):
            self.assertFalse(self._table_exists(table), f"{table} should have been dropped")
        for column in (
            'ami_id', 'tofu_module_git_sha', 'pending_ami_id', 'pending_tofu_module_git_sha',
            'last_execution_arn', 'instance_id',
        ):
            self.assertFalse(
                self._column_exists('hosting_trial_org', column),
                f"hosting_trial_org.{column} should have been dropped")

    def test_migration_is_idempotent(self):
        self._simulate_pre_upgrade_schema()
        migrate = _load_migrate()
        migrate(self.env.cr, '19.0.2.0.0')

        # A second run against an already-migrated database (or a fresh install with none of
        # this history at all) must not raise.
        migrate(self.env.cr, '19.0.2.0.0')
