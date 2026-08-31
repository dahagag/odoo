from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestBrowserTourSmoke(HttpCase):

    def test_user_menu_tour(self):
        self.start_tour("/odoo", "dev_e2e_smoke_test_user_menu", login="admin")
