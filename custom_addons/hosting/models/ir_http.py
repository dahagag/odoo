from odoo import models


class IrHttp(models.AbstractModel):
    # Exposes whether the first-login onboarding prompt (#121) is still pending for this
    # session, so the client can decide on webclient boot without an extra RPC round-trip
    # (docs/agents/odoo-19-development.md's "One-time, per-user UI state" note).
    _inherit = 'ir.http'

    def session_info(self):
        session_info = super().session_info()
        session_info['hosting_onboarding_pending'] = bool(
            session_info.get('uid')
            and not session_info.get('is_public')
            and not self.env.user.hosting_onboarding_seen,
        )
        return session_info
