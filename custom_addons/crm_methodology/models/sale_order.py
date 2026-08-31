from odoo import api, models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    @api.model_create_multi
    def create(self, vals_list):
        opportunity_ids = {vals['opportunity_id'] for vals in vals_list if vals.get('opportunity_id')}
        if opportunity_ids:
            self.env['crm.lead'].browse(opportunity_ids)._check_methodology_checkpoint('quotation')
        return super().create(vals_list)
