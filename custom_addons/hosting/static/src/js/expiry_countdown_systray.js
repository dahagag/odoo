import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useBus, useService } from "@web/core/utils/hooks";
import { routerBus } from "@web/core/browser/router";
import { deserializeDate, today } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";

// Days remaining until `hosting.org.registration.expiry_date` on this instance, colored by
// tier (issue #137's acceptance criteria - the 7-day boundary is the settled green/yellow
// cut, not the 3-day one from the prototype's throwaway styling).
export const EXPIRY_TIER_GREEN = "green";
export const EXPIRY_TIER_YELLOW = "yellow";
export const EXPIRY_TIER_RED = "red";

export function expiryTierOf(daysLeft) {
    if (daysLeft > 7) {
        return EXPIRY_TIER_GREEN;
    }
    if (daysLeft > 0) {
        return EXPIRY_TIER_YELLOW;
    }
    return EXPIRY_TIER_RED;
}

export function expiryDaysLabel(daysLeft) {
    if (daysLeft < 0) {
        return _t("Expired %(days)sd ago", { days: Math.abs(daysLeft) });
    }
    if (daysLeft === 0) {
        return _t("Expires today");
    }
    return _t("%(days)sd left", { days: daysLeft });
}

// Variant C from the prototype (`prototype/137-expiry-countdown-systray`): an always-expanded
// labeled chip, no click needed to read the one fact that matters.
export class ExpiryCountdownSystray extends Component {
    static props = {};
    static template = xml`
        <span t-if="state.daysLeft !== null"
              class="o_hosting_expiry_countdown_systray badge d-flex align-items-center gap-1 me-2"
              t-attf-class="o_hosting_expiry_countdown_systray--{{tier}}">
            <span class="o_hosting_expiry_countdown_systray_dot" role="presentation"/>
            <t t-esc="label"/>
        </span>`;

    setup() {
        // Read-only, no sudo: relies on the ACL already established in ir.model.access.csv
        // (base.group_user, read-only) for hosting.org.registration - the same boundary #112
        // set for the Org Registration view itself.
        this.orm = useService("orm");
        this.state = useState({ daysLeft: null });

        onWillStart(() => this._fetchDaysLeft());
        // Re-fetch on every in-app navigation (Odoo's backend routes client-side without a
        // full page reload) so the count doesn't go stale across a long-lived session.
        useBus(routerBus, "ROUTE_CHANGE", () => this._fetchDaysLeft());
    }

    async _fetchDaysLeft() {
        // A failed lookup (offline, RPC error) hides the chip rather than raising: neither
        // onWillStart nor the unawaited useBus callback has an error boundary above it here,
        // so an uncaught rejection would otherwise surface as a webclient-level error dialog.
        let registration;
        try {
            [registration] = await this.orm.searchRead(
                "hosting.org.registration",
                [],
                ["expiry_date"],
                { limit: 1 },
            );
        } catch {
            this.state.daysLeft = null;
            return;
        }
        this.state.daysLeft =
            registration && registration.expiry_date
                ? Math.round(deserializeDate(registration.expiry_date).diff(today(), "days").days)
                : null;
    }

    get tier() {
        return expiryTierOf(this.state.daysLeft);
    }

    get label() {
        return _t("Trial: %(label)s", { label: expiryDaysLabel(this.state.daysLeft) });
    }
}

registry.category("systray").add("hosting.ExpiryCountdownSystray", {
    Component: ExpiryCountdownSystray,
}, { sequence: 1 });
