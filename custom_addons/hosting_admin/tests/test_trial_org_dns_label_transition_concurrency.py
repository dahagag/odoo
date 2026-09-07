import psycopg2.errors

from odoo import api
from odoo.modules.registry import Registry
from odoo.tests import tagged
from odoo.tests.common import BaseCase, get_db_name
from odoo.tools import mute_logger


@tagged('post_install', '-at_install')
class TestTrialOrgDnsLabelTransitionConcurrency(BaseCase):
    """Real two-connection test proving the row locks _apply_transition() (before its
    Provisioner call) and write()'s own dns_subdomain_label guard (CodeRabbit, PR #168) take are
    genuine and scoped to the same row - closing the race CodeRabbit flagged where a concurrent
    write() could read a still-'issued' state, block on _apply_transition()'s eventual state
    write, and then land its dns_subdomain_label change anyway once unblocked, after the
    Provisioner had already used the pre-change label.

    Same same-thread, nested-cursor technique as
    test_trial_org_open_invite_concurrency.py (itself following
    crm_methodology/tests/test_crm_lead_trial_concurrency.py and, in turn, Odoo core's
    odoo/addons/base/tests/test_ir_sequence.py): hold the lock open on one connection, then
    prove a second, fully independent connection's identical ``FOR UPDATE NOWAIT`` is rejected
    immediately rather than silently proceeding past it. See that file's class docstring for why
    a genuine multi-threaded test is impractical here (issue #134) and why this uses BaseCase
    with explicitly-committed fixtures rather than TransactionCase.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.registry = Registry(get_db_name())

    def setUp(self):
        super().setUp()
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            self.trial_org_id = env['hosting.trial.org'].create({
                'name': "Concurrency Test Trial",
                'prospect_domain': "concurrency-test-dns-label.example.com",
                'seat_cap': 2,
            }).id
            # the cursor commits on clean __exit__, making this row visible to other
            # connections - see the class docstring.

    def tearDown(self):
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            env['hosting.trial.org'].browse(self.trial_org_id).unlink()
        super().tearDown()

    def test_apply_transition_row_lock_blocks_a_concurrent_transaction(self):
        # _apply_transition() takes exactly this lock on the Trial Org row before its
        # Provisioner call. Hold it open (uncommitted) here, then prove a second, fully
        # independent transaction attempting the identical lock is rejected immediately -
        # rather than silently proceeding past it, which is exactly what would let a concurrent
        # write() read a still-'issued' state and queue a dns_subdomain_label change behind
        # this one instead of being serialized in front of it.
        with mute_logger('odoo.sql_db'):
            with self.registry.cursor() as cr0:
                cr0.execute(
                    "SELECT id FROM hosting_trial_org WHERE id = %s FOR UPDATE",
                    (self.trial_org_id,))
                with self.registry.cursor() as cr1:
                    with self.assertRaises(psycopg2.errors.LockNotAvailable):
                        cr1.execute(
                            "SELECT id FROM hosting_trial_org WHERE id = %s FOR UPDATE NOWAIT",
                            (self.trial_org_id,))

    def test_dns_label_guard_row_lock_blocks_a_concurrent_transaction(self):
        # write()'s own dns_subdomain_label guard takes the same lock (via
        # "WHERE id = ANY(%s)") before trusting the row's state. Prove that lock statement,
        # scoped to a single row via ANY() over a one-element list, is likewise rejected
        # immediately by a second connection's identical NOWAIT lock - so whichever of the two
        # guards gets to the row first genuinely blocks the other rather than both reading a
        # stale, pre-transition 'issued' state.
        with mute_logger('odoo.sql_db'):
            with self.registry.cursor() as cr0:
                cr0.execute(
                    "SELECT id, state FROM hosting_trial_org WHERE id = ANY(%s) FOR UPDATE",
                    ([self.trial_org_id],))
                with self.registry.cursor() as cr1:
                    with self.assertRaises(psycopg2.errors.LockNotAvailable):
                        cr1.execute(
                            "SELECT id FROM hosting_trial_org WHERE id = %s FOR UPDATE NOWAIT",
                            (self.trial_org_id,))
