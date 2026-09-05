import { Component, xml } from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { registry } from "@web/core/registry";
import { Dialog } from "@web/core/dialog/dialog";
import { user } from "@web/core/user";
import { useService } from "@web/core/utils/hooks";
import { session } from "@web/session";

// Settle window (ms) after the last ACTION_MANAGER:UPDATE bus event before the prompt is
// allowed to open - see HostingOnboardingPromptLauncher below.
const ACTION_SETTLE_DELAY = 500;

// Stable path for the Trial Onboarding Guide teach doc, authored separately (#122). Kept
// here so the Org Registration "Getting Started" link (#112's view) and this prompt agree
// on the same destination without duplicating the literal string in two places.
export const ONBOARDING_GUIDE_URL = "/hosting/static/docs/index.html";

// First-login orientation to trial mechanics only (seats, expiry/extension, invites,
// suspend/Wake) - not product/CRM education, which is crm_methodology's separate teach docs.
// Direction agreed in docs/design/121-onboarding-prompt/README.md.
export class HostingOnboardingPrompt extends Component {
    static props = { close: Function };
    static components = { Dialog };
    static template = "hosting.HostingOnboardingPrompt";

    setup() {
        this.orm = useService("orm");
        this.guideUrl = ONBOARDING_GUIDE_URL;
        // Escape (Dialog.js's onEscape -> dismiss()) awaits env.dialogData.dismiss, then
        // always calls env.dialogData.close itself - wiring markSeen() here (write only, no
        // close of our own) makes Escape write the flag too, without double-closing.
        this.env.dialogData.dismiss = () => this.markSeen();
    }

    async markSeen() {
        // hosting_onboarding_seen alone in this write: res.users.write() only self-sudos a
        // user's own record when every key is in SELF_WRITEABLE_FIELDS (docs/agents/
        // odoo-19-development.md's "One-time, per-user UI state" note) - batching it with
        // another field here would silently drop the sudo and fail the ACL check instead.
        try {
            await this.orm.write("res.users", [user.userId], { hosting_onboarding_seen: true });
        } catch {
            // Swallowed: the dialog must still close (below, or via Dialog.js's own
            // dismiss()) even if the write fails - see the Hoot test covering this path.
        }
    }

    async onDismiss() {
        await this.markSeen();
        this.props.close();
    }
}

// Renders nothing itself; only decides, once per webclient boot, whether to open the
// prompt above. Session info (populated before the webclient starts) is the seam - see
// ir_http.py's session_info() override - so this needs no RPC of its own to decide.
//
// Opening is deferred until ACTION_MANAGER:UPDATE bus events go quiet for
// ACTION_SETTLE_DELAY, rather than done immediately in setup() or on the first such event:
// the webclient's boot sequence fires more than one of these in quick succession while it
// resolves the URL into the user's default action (loadRouterState() -> loadState()/
// doAction(), web/static/src/webclient/webclient.js), and the action service
// unconditionally closes every open dialog on each one (action_service.js's doAction ->
// dialog.closeAll()) - opening on the first event loses the race against a later one and
// the prompt never actually reaches the user.
class HostingOnboardingPromptLauncher extends Component {
    static props = {};
    static template = xml`<t/>`;

    setup() {
        if (!session.hosting_onboarding_pending) {
            return;
        }
        const dialog = useService("dialog");
        const open = () => {
            this.env.bus.removeEventListener("ACTION_MANAGER:UPDATE", scheduleOpen);
            dialog.add(HostingOnboardingPrompt, {});
        };
        let timer = browser.setTimeout(open, ACTION_SETTLE_DELAY);
        function scheduleOpen() {
            browser.clearTimeout(timer);
            timer = browser.setTimeout(open, ACTION_SETTLE_DELAY);
        }
        this.env.bus.addEventListener("ACTION_MANAGER:UPDATE", scheduleOpen);
    }
}

registry.category("main_components").add("hosting.HostingOnboardingPromptLauncher", {
    Component: HostingOnboardingPromptLauncher,
});
