from datetime import timedelta

from odoo import fields
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestExpiryCountdownSystrayTour(HttpCase):

    def test_systray_renders_the_green_tier_for_a_far_out_expiry(self):
        self.env['hosting.org.registration'].create({
            'name': "Acme Trial",
            'prospect_domain': "acme.example.com",
            'seats_used': 3,
            'seat_cap': 5,
            'expiry_date': fields.Date.today() + timedelta(days=10),
        })
        self.start_tour("/odoo", "hosting_expiry_countdown_systray_tour", login="admin")

    def test_systray_shows_no_countdown_for_a_client_org(self):
        # A Client Org's registration has no expiry_date at all (docs/contexts/hosting/
        # CONTEXT.md: "no expiry window") - issue #201's User Story #6 requires the countdown
        # to be absent, not rendered broken.
        self.env['hosting.org.registration'].create({
            'name': "Acme Client Org",
            'prospect_domain': "acme.example.com",
            'seats_used': 3,
            'seat_cap': 5,
        })
        self.start_tour("/odoo", "hosting_expiry_countdown_systray_absent_tour", login="admin")
