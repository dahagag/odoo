from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCrmMethodology(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.meddic = cls.env.ref('crm_methodology.crm_methodology_meddic')
        cls.spin = cls.env.ref('crm_methodology.crm_methodology_spin')
        cls.none_methodology = cls.env.ref('crm_methodology.crm_methodology_none')
        cls.call_activity_type = cls.env.ref('mail.mail_activity_data_call')
        cls.team = cls.env['crm.team'].create({'name': "Methodology Test Team"})
        cls.economic_buyer = cls.env['res.partner'].create({'name': "Test Economic Buyer"})
        cls.champion = cls.env['res.partner'].create({'name': "Test Champion"})
        cls.client = cls.env['res.partner'].create({
            'name': "Test MEDDIC Client",
            'methodology_id': cls.meddic.id,
        })

    def _create_lead(self, **extra):
        return self.env['crm.lead'].create({
            'name': "Test Opportunity",
            'type': 'opportunity',
            'partner_id': self.client.id,
            'team_id': self.team.id,
            **extra,
        })

    def test_new_partner_defaults_to_none_methodology(self):
        partner = self.env['res.partner'].create({'name': "Undecided Client"})
        self.assertEqual(partner.methodology_id, self.none_methodology)

    def test_reference_methodologies_ship_with_expected_requirements_and_playbook_questions(self):
        sandler = self.env.ref('crm_methodology.crm_methodology_sandler')

        self.assertEqual(self.meddic.name, "MEDDIC")
        self.assertEqual(
            self.meddic.requirement_ids.mapped('property_label'),
            ["Metrics", "Economic Buyer", "Decision Process", "Decision Criteria", "Identify Pain", "Champion"],
        )
        self.assertTrue(self.meddic.playbook_question_ids)

        self.assertEqual(sandler.name, "Sandler Selling System")
        self.assertEqual(
            sandler.requirement_ids.mapped('property_label'),
            ["Pain", "Budget", "Decision-Making Process"],
        )
        self.assertTrue(sandler.playbook_question_ids)

        self.assertEqual(self.spin.name, "SPIN Selling")
        self.assertFalse(self.spin.requirement_ids)
        self.assertEqual(
            self.spin.playbook_question_ids.mapped('question'),
            [
                "Situation: What does your current process look like?",
                "Problem: Where does that process create difficulty?",
                "Implication: What does that difficulty cost you when it happens?",
                "Need-payoff: How would it help if that were solved?",
            ],
        )

    def test_lead_defaults_methodology_from_partner(self):
        lead = self._create_lead()
        self.assertEqual(lead.methodology_id, self.meddic)

    def test_lead_methodology_stays_editable_and_not_retroactive(self):
        lead = self._create_lead()
        lead.methodology_id = self.spin
        self.client.methodology_id = self.none_methodology
        self.assertEqual(lead.methodology_id, self.spin, "changing the client later must not touch existing leads")

    def test_action_set_won_blocks_on_missing_block_requirement(self):
        lead = self._create_lead()
        with self.assertRaises(ValidationError):
            lead.action_set_won()

    def test_action_set_won_succeeds_once_block_requirements_filled(self):
        lead = self._create_lead()
        lead.action_sync_methodology_properties()
        lead.lead_properties = {
            'meddic_economic_buyer': self.economic_buyer.id,
            'meddic_champion': self.champion.id,
        }
        lead.action_set_won()
        self.assertEqual(lead.probability, 100)

    def test_action_set_lost_blocks_on_missing_block_requirement(self):
        strict_methodology = self.env['crm.methodology'].create({'name': "Lost-Gated Methodology"})
        self.env['crm.methodology.requirement'].create({
            'methodology_id': strict_methodology.id,
            'property_key': 'lost_gate_field',
            'property_label': "Lost Reason Detail",
            'property_type': 'char',
            'checkpoint': 'lost',
            'enforcement': 'block',
        })
        lead = self._create_lead(methodology_id=strict_methodology.id)
        with self.assertRaises(ValidationError):
            lead.action_set_lost()

    def test_methodology_completion_computation(self):
        lead = self._create_lead()
        lead.action_sync_methodology_properties()
        self.assertEqual(lead.methodology_completion, 0.0)

        lead.lead_properties = {'meddic_economic_buyer': self.economic_buyer.id}
        self.assertEqual(lead.methodology_completion, 50.0)

        lead.lead_properties = {
            'meddic_economic_buyer': self.economic_buyer.id,
            'meddic_champion': self.champion.id,
        }
        self.assertEqual(lead.methodology_completion, 100.0)

    def test_methodology_with_no_block_requirements_is_always_100(self):
        lead = self._create_lead(methodology_id=self.spin.id)
        self.assertEqual(lead.methodology_completion, 100.0)

    def test_qualification_completion_report_groups_by_team_and_methodology_and_averages(self):
        # Two MEDDIC leads on the same team: one fully qualified, one not at all.
        # The report (crm_lead_action_methodology_completion / its pivot view) groups
        # opportunities by team then methodology and measures the mean completion across
        # the group, not the sum, so a manager sees "50%", not "100".
        fully_qualified = self._create_lead()
        fully_qualified.action_sync_methodology_properties()
        fully_qualified.lead_properties = {
            'meddic_economic_buyer': self.economic_buyer.id,
            'meddic_champion': self.champion.id,
        }
        unqualified = self._create_lead()
        unqualified.action_sync_methodology_properties()

        leads = fully_qualified | unqualified
        [(_, _, avg_completion)] = self.env['crm.lead']._read_group(
            domain=[('id', 'in', leads.ids)],
            groupby=['team_id', 'methodology_id'],
            aggregates=['methodology_completion:avg'],
        )
        self.assertEqual(avg_completion, 50.0, "the group's completion must be averaged, not summed")

    def test_methodology_property_keys_scopes_qualification_tab_to_own_methodology(self):
        # The team's Properties are shared across every methodology assigned to it (docs/adr/0005),
        # so the Qualification tab widget relies on this field to show only the current
        # opportunity's own methodology fields instead of the team's full superset.
        meddic_lead = self._create_lead()
        self.assertEqual(
            set(meddic_lead.methodology_property_keys.split(",")),
            set(self.meddic.requirement_ids.mapped('property_key')),
        )
        spin_lead = self._create_lead(methodology_id=self.spin.id)
        self.assertEqual(spin_lead.methodology_property_keys, "")

    def test_sync_materializes_missing_properties_on_team(self):
        lead = self._create_lead()
        self.assertEqual(lead.methodology_properties_to_sync, len(self.meddic.requirement_ids))
        lead.action_sync_methodology_properties()
        self.assertEqual(lead.methodology_properties_to_sync, 0)
        team_keys = {d['name'] for d in self.team.lead_properties_definition or []}
        self.assertEqual(team_keys, set(self.meddic.requirement_ids.mapped('property_key')))

    def test_quotation_creation_blocked_by_ad_hoc_requirement(self):
        # Build a minimal fixture rather than relying on seed data, so this asserts the generic
        # checkpoint mechanism itself, independent of MEDDIC's specific field choices.
        strict_methodology = self.env['crm.methodology'].create({'name': "Strict Test Methodology"})
        self.env['crm.methodology.requirement'].create({
            'methodology_id': strict_methodology.id,
            'property_key': 'strict_test_field',
            'property_label': "Strict Field",
            'property_type': 'char',
            'checkpoint': 'quotation',
            'enforcement': 'block',
        })
        lead = self._create_lead(methodology_id=strict_methodology.id)
        with self.assertRaises(ValidationError):
            self.env['sale.order'].create({
                'partner_id': self.client.id,
                'opportunity_id': lead.id,
            })

    def test_playbook_wizard_opens_on_matching_activity(self):
        lead = self._create_lead(methodology_id=self.spin.id)
        activity = lead.activity_schedule(activity_type_id=self.call_activity_type.id, summary="Discovery call")
        result = activity.action_feedback()
        self.assertEqual(result.get('res_model'), 'crm.methodology.playbook.wizard')

    def test_playbook_skip_still_completes_the_activity(self):
        lead = self._create_lead(methodology_id=self.spin.id)
        activity = lead.activity_schedule(activity_type_id=self.call_activity_type.id, summary="Discovery call")
        wizard_action = activity.action_feedback()
        wizard = self.env[wizard_action['res_model']].browse(wizard_action['res_id'])
        wizard.action_skip()
        self.assertFalse(activity.exists() and activity.active, "activity should be done (archived) after skip")
        self.assertTrue(
            "skipped" in " ".join(lead.message_ids.mapped('body')).lower(),
            "skip should still leave a trace in chatter",
        )

    def test_forbidden_user_cannot_create_methodology(self):
        salesperson = self.env['res.users'].create({
            'name': "Plain Salesperson",
            'login': "plain_salesperson_methodology_test",
            'group_ids': [(6, 0, self.env.ref('sales_team.group_sale_salesman').ids)],
        })
        with self.assertRaises(AccessError):
            self.env['crm.methodology'].with_user(salesperson).create({'name': "Should not be allowed"})

    def test_default_methodology_cannot_be_deleted(self):
        with self.assertRaises(Exception):
            self.none_methodology.unlink()

    def test_default_methodology_cannot_be_archived(self):
        with self.assertRaises(ValidationError):
            self.none_methodology.active = False

    def test_only_one_methodology_can_be_default(self):
        other = self.env['crm.methodology'].create({'name': "Aspiring Default"})
        with self.assertRaises(ValidationError):
            other.is_default = True

    def test_sync_rejects_property_key_reused_with_a_different_type(self):
        strict_methodology = self.env['crm.methodology'].create({'name': "Type-Conflict Methodology"})
        self.env['crm.methodology.requirement'].create({
            'methodology_id': strict_methodology.id,
            'property_key': 'conflicting_key',
            'property_label': "Conflicting Field",
            'property_type': 'char',
        })
        self.team.lead_properties_definition = [{
            'name': 'conflicting_key', 'string': "Conflicting Field", 'type': 'boolean',
        }]
        lead = self._create_lead(methodology_id=strict_methodology.id)
        with self.assertRaises(UserError):
            lead.action_sync_methodology_properties()

    def test_playbook_preserves_attachments_selected_on_mark_done(self):
        lead = self._create_lead(methodology_id=self.spin.id)
        activity = lead.activity_schedule(activity_type_id=self.call_activity_type.id, summary="Discovery call")
        attachment = self.env['ir.attachment'].create({'name': "notes.txt", 'datas': b''})
        wizard_action = activity.action_feedback(attachment_ids=[attachment.id])
        wizard = self.env[wizard_action['res_model']].browse(wizard_action['res_id'])
        self.assertEqual(wizard.attachment_ids, attachment)
        wizard.action_skip()
        message = lead.message_ids.sorted('id')[-1]
        self.assertIn(attachment, message.attachment_ids)
