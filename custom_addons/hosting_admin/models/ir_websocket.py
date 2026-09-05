from odoo import models
from odoo.exceptions import AccessError

from odoo.addons.hosting_admin.models.trial_org import TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX


class IrWebsocket(models.AbstractModel):
    _inherit = 'ir.websocket'

    def _build_bus_channel_list(self, channels):
        """Drop any Trial Org log-viewer channel (docs/adr/0023) the connecting client asked
        to subscribe to unless that user actually has read access to the named Trial Org. The
        channel name embeds the Trial Org's own id and is therefore guessable, so this check -
        not channel secrecy - is what actually keeps one Trial Org's live log tail from leaking
        into an unrelated session."""
        channels = super()._build_bus_channel_list(channels)
        return [
            channel for channel in channels
            if not isinstance(channel, str)
            or not channel.startswith(TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX)
            or self._can_subscribe_trial_org_log_channel(channel)
        ]

    def _can_subscribe_trial_org_log_channel(self, channel):
        trial_org_id = channel[len(TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX):]
        if not trial_org_id.isdigit():
            return False
        trial_org = self.env['hosting.trial.org'].browse(int(trial_org_id))
        if not trial_org.exists():
            return False
        try:
            trial_org.check_access('read')
        except AccessError:
            return False
        return True
