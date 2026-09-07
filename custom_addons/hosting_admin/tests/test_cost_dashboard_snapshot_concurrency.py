from datetime import date

from odoo.modules.registry import Registry
from odoo.tests import tagged
from odoo.tests.common import BaseCase, get_db_name


@tagged('post_install', '-at_install')
class TestCostDashboardSnapshotConcurrency(BaseCase):
    """Real two-connection test proving the advisory lock _cron_refresh_snapshot() takes
    (CodeRabbit finding on PR #167: the daily cron and an admin's "Refresh Now" can land in the
    same window, racing either create() against the UNIQUE(snapshot_date) constraint or
    line_ids.unlink() against a concurrent write()) is genuine and scoped to the right date.

    Same instrument as test_trial_org_open_invite_concurrency.py (PR #160) and
    crm_methodology/tests/test_crm_lead_trial_concurrency.py: hold the lock open on one
    connection, then prove a second, fully independent connection's attempt to take the same
    lock is rejected rather than silently proceeding past it. Unlike those two, there is no
    existing row to FOR UPDATE for the "no snapshot yet today" half of this race, so this locks
    on the same pg_advisory_xact_lock key _cron_refresh_snapshot() itself takes, keyed by the
    date, rather than a row id.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.registry = Registry(get_db_name())

    def test_refresh_snapshot_advisory_lock_blocks_a_concurrent_transaction(self):
        today = date.today()
        lock_key = today.toordinal()
        with self.registry.cursor() as cr0:
            cr0.execute(
                "SELECT pg_advisory_xact_lock(hashtext('hosting.cost.dashboard.snapshot'), %s)",
                (lock_key,))
            with self.registry.cursor() as cr1:
                cr1.execute(
                    "SELECT pg_try_advisory_xact_lock("
                    "hashtext('hosting.cost.dashboard.snapshot'), %s)",
                    (lock_key,))
                self.assertFalse(cr1.fetchone()[0])

    def test_refresh_snapshot_advisory_lock_is_scoped_to_its_own_date(self):
        # A concurrent refresh for a *different* day must not block on today's lock - the whole
        # point of keying by snapshot_date is that only same-day refreshes ever contend.
        today = date.today()
        with self.registry.cursor() as cr0:
            cr0.execute(
                "SELECT pg_advisory_xact_lock(hashtext('hosting.cost.dashboard.snapshot'), %s)",
                (today.toordinal(),))
            with self.registry.cursor() as cr1:
                cr1.execute(
                    "SELECT pg_try_advisory_xact_lock("
                    "hashtext('hosting.cost.dashboard.snapshot'), %s)",
                    (today.toordinal() + 1,))
                self.assertTrue(cr1.fetchone()[0])
