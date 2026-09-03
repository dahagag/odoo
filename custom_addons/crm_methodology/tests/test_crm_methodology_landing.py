from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestCrmMethodologyLanding(HttpCase):
    """Per docs/adr/0011: `/` is overridden with a public landing page, and
    `/odoo` is left untouched (it already resolves to Odoo's own backend and
    doubles as the demo)."""

    def test_landing_page_links_to_docs_and_demo(self):
        response = self.url_open('/')
        self.assertEqual(response.status_code, 200)
        body = response.text
        self.assertIn('/crm_methodology/static/docs/methodologies.html', body)
        self.assertIn('/crm_methodology/static/docs/sales-methodology-vs-odoo-crm.html', body)
        self.assertIn('/odoo', body)

    def test_odoo_route_is_unaffected(self):
        response = self.url_open('/odoo')
        self.assertEqual(response.status_code, 200)
