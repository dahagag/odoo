from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'dev_e2e_smoke_test_post_deploy')
class TestStagingDeployVerification(TransactionCase):
    """dev.domain.com staging's post-deploy smoke check (#203 Testing Decisions, #342):
    "a smoke check the pipeline runs after deploy: the instance answers, the expected modules
    are installed, and demo data is present." The existing browser-tour test
    (test_browser_tour_smoke.py) already covers "the instance answers" (it needs a running HTTP
    server to drive). These two tests cover the other two clauses, against whatever database
    they're pointed at - a local/CI test database when run via `scripts/dev.sh test
    dev_e2e_smoke_test`, or the live staging instance's own database when run post-deploy
    (docs/agents/local-development.md's "Browser tests" section; CI wiring in
    deploy-odoo-staging, .github/workflows/ci.yml).

    Tagged separately ('dev_e2e_smoke_test_post_deploy') from the browser tour above so a
    post-deploy CI step can select just these two (no Chrome/websocket-client dependency,
    unlike docker/odoo-staging.Dockerfile's image - see that Dockerfile's own comment on why it
    skips google-chrome).
    """

    def test_crm_methodology_module_is_installed(self):
        """docker/odoo-staging-entrypoint.sh always installs crm_methodology on every staging
        boot (ADR-0041's drop-and-recreate-then-self-heal step) - if it isn't 'installed', the
        self-heal step never completed."""
        module = self.env['ir.module.module'].search([('name', '=', 'crm_methodology')], limit=1)
        self.assertTrue(module, "crm_methodology module record not found")
        self.assertEqual(
            module.state,
            'installed',
            "crm_methodology must be in state 'installed' for staging to be considered seeded",
        )

    def test_staging_seed_users_present_with_expected_groups_and_no_password(self):
        """ADR-0041 Testing section: 'after a seed, the expected logins exist with the expected
        groups, and no account is created with a committed or default password.' These are the
        staging seed accounts from
        custom_addons/crm_methodology/data/crm_methodology_staging_seed_users.xml (#339) -
        unconditional 'data' (not 'demo'), so they exist whenever crm_methodology is installed,
        matching the entrypoint's unconditional '-i crm_methodology' self-heal (no --with-demo
        needed for these specific records)."""
        users = self.env['res.users'].sudo()
        early_adopter_group = self.env.ref('crm_methodology.group_staging_early_adopter')
        stakeholder_group = self.env.ref('crm_methodology.group_staging_stakeholder')

        expected_logins = {
            'early-adopter-acme': early_adopter_group,
            'early-adopter-globex': early_adopter_group,
            'stakeholder-ops': stakeholder_group,
        }

        # res.users.password is a compute field that always returns '' in Odoo 19, including
        # under sudo() - asserting on it directly would pass unconditionally regardless of what's
        # actually stored. Read the stored hash straight from res_users instead, matching
        # custom_addons/crm_methodology/tests/test_crm_methodology_staging_access.py's approach.
        self.env.cr.execute(
            "SELECT login, password FROM res_users WHERE login = ANY(%s)",
            (list(expected_logins),),
        )
        password_hashes = dict(self.env.cr.fetchall())

        for login, expected_group in expected_logins.items():
            user = users.search([('login', '=', login)], limit=1)
            self.assertTrue(user, f"expected seeded staging login {login!r} not found")
            self.assertIn(
                expected_group,
                user.group_ids,
                f"{login!r} must carry the {expected_group.name!r} group",
            )
            self.assertFalse(
                password_hashes.get(login),
                f"{login!r} must have no stored password hash until the staging entrypoint's "
                "SSM-sourced post-install step (#338) sets one - a non-empty password here "
                "would mean a committed or default credential.",
            )
