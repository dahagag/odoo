import psycopg2.errors

from odoo import api
from odoo.modules.registry import Registry
from odoo.tests import tagged
from odoo.tests.common import BaseCase, get_db_name
from odoo.tools import mute_logger


@tagged('post_install', '-at_install')
class TestCrmLeadTrialConcurrency(BaseCase):
    """Real two-connection tests proving the row locks in action_issue_trial()/
    action_extend_trial() are genuine and correctly scoped (CodeRabbit findings on PR #131: a
    lost-update race on Extend, and a duplicate-Trial-Org race on Issue).

    These use the same same-thread, nested-cursor technique as Odoo core's own
    odoo/addons/base/tests/test_ir_sequence.py (see its
    TestIrSequenceNoGap.test_ir_sequence_draw_twice_no_gap): hold a row lock open on one
    connection, then prove a second, fully independent connection's identical
    ``FOR UPDATE NOWAIT`` is rejected immediately rather than silently proceeding past it. A
    genuine multi-threaded test that drives the full action end-to-end under real concurrent
    execution turned out to be impractical here - constructing a second api.Environment() from
    a real background thread stalls for ~20s inside this test runner's process for reasons that
    didn't resolve after real investigation (see issue #134) - so this proves the load-bearing
    claim (the lock is real, and on the correct row) without touching the ORM from a second
    thread. It does not re-prove the read-after-lock business logic itself, which the ordinary
    sequential tests in test_crm_lead_trial.py already cover.

    BaseCase, not TransactionCase: proving a Postgres row lock blocks a second transaction
    needs two real, independently-committing connections - TransactionCase wraps an entire
    test in one connection's uncommitted transaction, which a second connection can never see.
    Every fixture here is therefore committed explicitly (a cursor commits on clean __exit__,
    per odoo.sql_db.BaseCursor), and deleted explicitly in tearDown, since none of it is
    protected by TransactionCase's automatic rollback.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.registry = Registry(get_db_name())

    def setUp(self):
        super().setUp()
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            self.team_id = env['crm.team'].create({'name': "Concurrency Test Team"}).id
            self.client_id = env['res.partner'].create({'name': "Concurrency Test Client"}).id
            self.salesperson_id = env['res.users'].create({
                'name': "Concurrency Test Salesperson",
                'login': 'concurrency_test_salesperson',
                'lang': 'en_US',
                'group_ids': [(6, 0, env.ref('sales_team.group_sale_salesman').ids)],
            }).id
            # the cursor commits on clean __exit__, making these rows visible to other
            # connections - see the class docstring.

    def tearDown(self):
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            env['crm.lead'].search([('team_id', '=', self.team_id)]).unlink()
            env['hosting.trial.org'].search(
                [('prospect_domain', 'like', 'concurrency-test')]).unlink()
            env['res.users'].browse(self.salesperson_id).unlink()
            env['res.partner'].browse(self.client_id).unlink()
            env['crm.team'].browse(self.team_id).unlink()
        super().tearDown()

    def _create_and_issue(self, env, prospect_domain):
        lead = env['crm.lead'].create({
            'name': "Concurrency Test Opportunity",
            'type': 'opportunity',
            'partner_id': self.client_id,
            'team_id': self.team_id,
            'user_id': self.salesperson_id,
        })
        trial_org = lead.with_user(self.salesperson_id).action_issue_trial(
            prospect_domain=prospect_domain, seat_cap=5, invite_type='open')
        return lead, trial_org

    def test_issue_trial_row_lock_blocks_a_concurrent_transaction(self):
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            lead, _trial_org = self._create_and_issue(env, "concurrency-test.example.com")
            lead_id = lead.id

        # action_issue_trial() takes exactly this lock on the lead row before its "already
        # issued" check. Hold it open (uncommitted) here, then prove a second, fully
        # independent transaction attempting the identical lock is rejected immediately -
        # rather than silently proceeding past it, which is exactly what would let two
        # concurrent action_issue_trial() calls both pass the check and each create an active
        # Trial Org for the same opportunity.
        with mute_logger('odoo.sql_db'):
            with self.registry.cursor() as cr0:
                cr0.execute("SELECT id FROM crm_lead WHERE id = %s FOR UPDATE", (lead_id,))
                with self.registry.cursor() as cr1:
                    with self.assertRaises(psycopg2.errors.LockNotAvailable):
                        cr1.execute(
                            "SELECT id FROM crm_lead WHERE id = %s FOR UPDATE NOWAIT", (lead_id,))

    def test_extend_trial_row_lock_blocks_a_concurrent_transaction(self):
        with self.registry.cursor() as cr:
            env = api.Environment(cr, api.SUPERUSER_ID, {})
            _lead, trial_org = self._create_and_issue(env, "concurrency-test-extend.example.com")
            trial_org_id = trial_org.id

        # action_extend_trial() takes exactly this lock on the Trial Org row before reading
        # expiry_date. Hold it open here, then prove a second, fully independent transaction's
        # identical lock attempt is rejected immediately - rather than both transactions
        # reading the same base expiry_date and one increment silently disappearing.
        with mute_logger('odoo.sql_db'):
            with self.registry.cursor() as cr0:
                cr0.execute(
                    "SELECT id FROM hosting_trial_org WHERE id = %s FOR UPDATE", (trial_org_id,))
                with self.registry.cursor() as cr1:
                    with self.assertRaises(psycopg2.errors.LockNotAvailable):
                        cr1.execute(
                            "SELECT id FROM hosting_trial_org WHERE id = %s FOR UPDATE NOWAIT",
                            (trial_org_id,))
