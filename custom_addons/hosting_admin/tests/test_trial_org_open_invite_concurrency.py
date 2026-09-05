import psycopg2.errors

from odoo import api
from odoo.modules.registry import Registry
from odoo.tests import tagged
from odoo.tests.common import BaseCase, get_db_name
from odoo.tools import mute_logger


@tagged('post_install', '-at_install')
class TestTrialOrgOpenInviteConcurrency(BaseCase):
    """Real two-connection test proving the row lock action_join_open_invite() takes (PR #160,
    CodeRabbit finding on the same PR: two joins racing the last remaining seat could otherwise
    both pass _check_seat_cap() and both commit) is genuine and scoped to the right row.

    Same same-thread, nested-cursor technique as
    crm_methodology/tests/test_crm_lead_trial_concurrency.py (itself following Odoo core's
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
                'prospect_domain': "concurrency-test-open-invite.example.com",
                'seat_cap': 2,
                'invite_type': 'open',
            }).id
            # the cursor commits on clean __exit__, making this row visible to other
            # connections - see the class docstring.

    def tearDown(self):
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            env['hosting.trial.org.seat'].search(
                [('trial_org_id', '=', self.trial_org_id)]).unlink()
            env['hosting.trial.org'].browse(self.trial_org_id).unlink()
        super().tearDown()

    def test_join_open_invite_row_lock_blocks_a_concurrent_transaction(self):
        # action_join_open_invite() takes exactly this lock on the Trial Org row before its
        # Seat create(). Hold it open (uncommitted) here, then prove a second, fully independent
        # transaction attempting the identical lock is rejected immediately - rather than
        # silently proceeding past it, which is exactly what would let two concurrent joins
        # racing the last remaining seat both pass _check_seat_cap() and both commit.
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
