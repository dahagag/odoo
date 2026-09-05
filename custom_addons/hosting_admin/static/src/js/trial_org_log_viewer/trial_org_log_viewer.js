import { Component, onPatched, onWillDestroy, onWillStart, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";

// The bus channel prefix and notification type this widget subscribes to must match
// custom_addons/hosting_admin/models/trial_org.py's TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX /
// TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE exactly (docs/adr/0023) - there is no shared constant
// between Python and JS to import from, so a change to either side must update both.
const TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX = "hosting_admin.trial_org_log-";
const TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE = "hosting_admin.trial_org_log_lines";

// Caps how many lines this live-tailing widget keeps in memory/DOM at once. A long support
// session could otherwise accumulate an unbounded number of lines for as long as the form stays
// open; nothing in the acceptance criteria asks for scrollback beyond "live tail", so oldest
// lines are simply dropped once this is exceeded.
const MAX_LINES = 500;

export class HostingTrialOrgLogViewer extends Component {
    static template = "hosting_admin.TrialOrgLogViewer";
    static props = standardWidgetProps;

    setup() {
        this.busService = useService("bus_service");
        this.state = useState({ lines: [], userFilter: "" });
        this.scrollContainerRef = useRef("scrollContainer");
        this.channel = null;
        this.onLogLines = this.onLogLines.bind(this);

        onWillStart(() => {
            const trialOrgId = this.props.record.resId;
            // A not-yet-saved Trial Org has no log group/channel yet - nothing to subscribe to.
            if (!trialOrgId) {
                return;
            }
            this.trialOrgId = trialOrgId;
            this.channel = `${TRIAL_ORG_LOG_BUS_CHANNEL_PREFIX}${trialOrgId}`;
            this.busService.addChannel(this.channel);
            this.busService.subscribe(TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE, this.onLogLines);
        });

        onWillDestroy(() => {
            if (!this.channel) {
                return;
            }
            this.busService.unsubscribe(TRIAL_ORG_LOG_BUS_NOTIFICATION_TYPE, this.onLogLines);
            this.busService.deleteChannel(this.channel);
        });

        // Follow the tail: scroll to bottom after every render that added lines, same as a
        // terminal `tail -f`. Done in onPatched (post-render), not from onLogLines itself, since
        // the DOM hasn't reflowed to the new line count yet at the point state is written.
        onPatched(() => {
            const container = this.scrollContainerRef.el;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        });
    }

    onLogLines(payload) {
        // bus_service.js dispatches by notification type alone, on one event bus shared by
        // every tab/widget subscribed to it in this browser session - not scoped to the
        // channel a given widget added. A second Trial Org's log viewer open at the same time
        // would otherwise receive these lines too, so the originating Trial Org id (stamped by
        // the controller, custom_addons/hosting_admin/controllers/log_webhook.py) must be
        // checked here before appending anything.
        if (payload.trial_org_id !== this.trialOrgId) {
            return;
        }
        const next = this.state.lines.concat(payload.lines);
        this.state.lines = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    }

    /** Lines matching the current user filter (a plain case-insensitive substring match against
     * each line's message - the login a future base-AMI change stamps onto log lines,
     * docs/adr/0023, is plain text within that message, not a separate structured field). */
    get filteredLines() {
        const filter = this.state.userFilter.trim().toLowerCase();
        if (!filter) {
            return this.state.lines;
        }
        return this.state.lines.filter((line) => (line.message || "").toLowerCase().includes(filter));
    }

    onUserFilterInput(ev) {
        this.state.userFilter = ev.target.value;
    }
}

registry.category("view_widgets").add("hosting_trial_org_log_viewer", {
    component: HostingTrialOrgLogViewer,
});
