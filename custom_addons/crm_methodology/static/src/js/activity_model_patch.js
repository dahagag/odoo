/** @odoo-module **/

import { Activity } from "@mail/core/common/activity_model";
import { patch } from "@web/core/utils/patch";

// `action_feedback` can return a real ir.actions.act_window (the Sales Methodology playbook
// wizard) instead of its usual message id. The stock "Mark Done" button (markAsDone) discards
// whatever action_feedback returns, so that action would otherwise never open. This patch opens
// it when present, and behaves exactly like the original method otherwise.
patch(Activity.prototype, {
    async markAsDone(attachmentIds = []) {
        const result = await this.store.env.services.orm.call("mail.activity", "action_feedback", [[this.id]], {
            attachment_ids: attachmentIds,
            feedback: this.feedback,
        });
        this.store.activityBroadcastChannel?.postMessage({
            type: "RELOAD_CHATTER",
            payload: { id: this.res_id, model: this.res_model },
        });
        if (result && typeof result === "object" && result.res_model) {
            await this.store.env.services.action.doAction(result);
        }
    },
});
