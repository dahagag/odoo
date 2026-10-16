import os

from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestCrmMethodologyStagingAccess(TransactionCase):
    """dev.domain.com staging access tiers (#339, docs/adr/0040, docs/adr/0041).

    The seed-users file lives in the unconditional 'data' list (not 'demo'), so it is already
    loaded in every installed test database - no convert_file() bootstrapping needed, unlike
    test_crm_methodology_demo.py's --with-demo-gated personas.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.early_adopter_acme = cls.env.ref(
            'crm_methodology.crm_methodology_staging_user_early_adopter_acme')
        cls.early_adopter_globex = cls.env.ref(
            'crm_methodology.crm_methodology_staging_user_early_adopter_globex')
        cls.stakeholder = cls.env.ref('crm_methodology.crm_methodology_staging_user_stakeholder')
        cls.group_early_adopter = cls.env.ref('crm_methodology.group_staging_early_adopter')
        cls.group_stakeholder = cls.env.ref('crm_methodology.group_staging_stakeholder')

    # -- Seed data installs cleanly / expected logins exist with expected groups -------------

    def test_seed_installs_expected_early_adopter_logins_with_expected_groups(self):
        self.assertEqual(self.early_adopter_acme.login, 'early-adopter-acme')
        self.assertEqual(self.early_adopter_globex.login, 'early-adopter-globex')

        self.assertTrue(self.early_adopter_acme.has_group('crm_methodology.group_staging_early_adopter'))
        self.assertTrue(self.early_adopter_acme.has_group('base.group_portal'))
        self.assertFalse(self.early_adopter_acme.has_group('base.group_user'))

    def test_seed_installs_expected_stakeholder_login_with_expected_groups(self):
        self.assertEqual(self.stakeholder.login, 'stakeholder-ops')

        self.assertTrue(self.stakeholder.has_group('crm_methodology.group_staging_stakeholder'))
        self.assertTrue(self.stakeholder.has_group('crm_methodology.crm_methodology_group_viewer'))
        # "Odoo UI viewing, not full base.group_user" per ADR-0041 - the Viewer privilege this
        # group implies does grant base.group_user itself (required to reach the backend at all,
        # same as crm_methodology_group_viewer always has), but never sales_team's own groups.
        self.assertFalse(self.stakeholder.has_group('sales_team.group_sale_salesman'))
        self.assertFalse(self.stakeholder.has_group('sales_team.group_sale_manager'))
        self.assertFalse(self.stakeholder.has_group('base.group_portal'))

    # -- No account is created with a committed or default password -------------------------

    def test_seed_accounts_have_no_stored_password_hash(self):
        # res.users.password is deliberately unreadable through the ORM (invisible, redacted on
        # read) - the only legitimate way to prove no password was committed is to read the
        # actual column the ORM writes to.
        seed_users = self.early_adopter_acme | self.early_adopter_globex | self.stakeholder
        self.env.cr.execute(
            "SELECT login, password FROM res_users WHERE id = ANY(%s)",
            (seed_users.ids,),
        )
        rows = dict(self.env.cr.fetchall())
        self.assertEqual(set(rows), {'early-adopter-acme', 'early-adopter-globex', 'stakeholder-ops'})
        for login, password_hash in rows.items():
            self.assertFalse(password_hash, f"{login} must not have a stored password hash")

    def test_no_password_field_is_set_in_the_seed_data_xml(self):
        seed_xml_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), 'data', 'crm_methodology_staging_seed_users.xml',
        )
        with open(seed_xml_path, encoding='utf-8') as seed_xml_file:
            seed_xml = seed_xml_file.read()
        self.assertNotIn('<field name="password"', seed_xml)

    # -- implied_ids direction: early-adopter group implies base.group_portal, never reverse ---

    def test_early_adopter_group_implies_portal_not_the_reverse(self):
        group_portal = self.env.ref('base.group_portal')

        self.assertIn(group_portal, self.group_early_adopter.implied_ids)
        self.assertNotIn(self.group_early_adopter, group_portal.implied_ids)

        # The reversed direction would make every portal user a member of our group (the exact
        # CWE-863 regression flagged on #339): confirm a plain portal user, with no membership
        # in our group at all, is not implicitly treated as one.
        plain_portal_user = self.env['res.users'].create({
            'name': "Plain Portal User",
            'login': 'plain-portal-user-no-adopter-group',
            'group_ids': [(6, 0, [group_portal.id])],
        })
        self.assertFalse(plain_portal_user.has_group('crm_methodology.group_staging_early_adopter'))

    # -- Write access on opportunities, scoped by the "linked-to-me" record rule -------------

    def test_early_adopter_can_create_and_edit_only_their_own_opportunity(self):
        own_partner = self.early_adopter_acme.partner_id
        other_partner = self.early_adopter_globex.partner_id

        own_lead = self.env['crm.lead'].create({
            'name': "Acme Evaluation Opportunity",
            'type': 'opportunity',
            'partner_id': own_partner.id,
        })
        other_lead = self.env['crm.lead'].create({
            'name': "Globex Evaluation Opportunity",
            'type': 'opportunity',
            'partner_id': other_partner.id,
        })

        own_lead_as_adopter = own_lead.with_user(self.early_adopter_acme)
        other_lead_as_adopter = other_lead.with_user(self.early_adopter_acme)

        # Read/write their own linked opportunity.
        self.assertTrue(own_lead_as_adopter.name)
        own_lead_as_adopter.write({'name': "Acme Evaluation Opportunity - edited"})

        # Create a new opportunity for themselves.
        created = self.env['crm.lead'].with_user(self.early_adopter_acme).create({
            'name': "Acme New Opportunity",
            'type': 'opportunity',
            'partner_id': own_partner.id,
        })
        self.assertTrue(created)

        # Cannot see or touch another adopter's opportunity.
        with self.assertRaises(AccessError):
            other_lead_as_adopter.read(['name'])

        with self.assertRaises(AccessError):
            own_lead_as_adopter.unlink()

    def test_stakeholder_can_read_but_not_write_create_or_unlink_opportunities(self):
        lead = self.env['crm.lead'].create({
            'name': "Stakeholder Visibility Opportunity",
            'type': 'opportunity',
        })
        lead_as_stakeholder = lead.with_user(self.stakeholder)

        self.assertTrue(lead_as_stakeholder.name)

        with self.assertRaises(AccessError):
            lead_as_stakeholder.write({'name': "Edited by Stakeholder"})

        with self.assertRaises(AccessError):
            self.env['crm.lead'].with_user(self.stakeholder).create({
                'name': "Created by Stakeholder",
                'type': 'opportunity',
            })

        with self.assertRaises(AccessError):
            lead_as_stakeholder.unlink()
