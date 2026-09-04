// PROTOTYPE — throwaway code answering "what should the expiry countdown look like?"
// (issue #137). Three structurally different systray treatments of the same
// `hosting.org.registration.expiry_date` fact, switchable via ?systray_variant=A|B|C
// and a floating bottom bar. Never meant to reach dev/19.0 - captured on
// prototype/137-expiry-countdown-systray and dropped before this addon's real PR merges.
import { Component, useState, onWillStart, onMounted, onWillUnmount, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const VARIANTS = ["A", "B", "C"];
const VARIANT_NAMES = {
    A: "Compact pill",
    B: "Ring gauge + popover",
    C: "Always-expanded chip",
};
// Quick-preview buttons so the color tiers can be checked without editing the DB record
// for every scenario - this override is prototype-only scaffolding, never persisted.
const SIMULATE_PRESETS = [10, 3, 1, 0, -2];

function tierOf(daysLeft) {
    if (daysLeft > 3) return "green";
    if (daysLeft >= 1) return "yellow";
    return "red";
}

const TIER_COLORS = {
    green: { bg: "#2e7d32", bgSoft: "#e8f5e9", text: "#1b5e20" },
    yellow: { bg: "#f9a825", bgSoft: "#fff8e1", text: "#8d6e00" },
    red: { bg: "#c62828", bgSoft: "#ffebee", text: "#8e0000" },
};

function daysLabel(daysLeft) {
    if (daysLeft < 0) return `Expired ${Math.abs(daysLeft)}d ago`;
    if (daysLeft === 0) return "Expires today";
    return `${daysLeft}d left`;
}

// --- Variant A: compact colored pill, icon + abbreviated text only. ---------------------
class VariantA extends Component {
    static props = ["daysLeft"];
    static template = xml`
        <span t-attf-style="background:{{colors.bg}};color:#fff;padding:2px 10px;border-radius:12px;
                             font-size:12px;font-weight:600;display:inline-flex;align-items:center;
                             gap:4px;line-height:1.6;white-space:nowrap;">
            <i class="fa fa-clock-o" role="img"/>
            <t t-esc="label"/>
        </span>`;
    get colors() {
        return TIER_COLORS[tierOf(this.props.daysLeft)];
    }
    get label() {
        return daysLabel(this.props.daysLeft);
    }
}

// --- Variant B: circular "gauge" icon depleting toward expiry, click opens a small panel. ---
class VariantB extends Component {
    static props = ["daysLeft", "orgName"];
    static template = xml`
        <div style="position:relative;display:inline-block;">
            <button class="btn p-0" t-on-click="toggleOpen"
                    style="background:none;border:none;line-height:0;" title="Trial expiry">
                <svg width="28" height="28" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e0e0e0" stroke-width="4"/>
                    <circle cx="18" cy="18" r="15.5" fill="none" t-att-stroke="colors.bg" stroke-width="4"
                            stroke-linecap="round" t-att-stroke-dasharray="dashArray"
                            transform="rotate(-90 18 18)"/>
                    <text x="18" y="22" text-anchor="middle" font-size="11" t-att-fill="colors.text"
                          font-weight="700"><t t-esc="props.daysLeft &lt; 0 ? '!' : props.daysLeft"/></text>
                </svg>
            </button>
            <div t-if="state.open"
                 style="position:absolute;top:34px;right:0;z-index:1000;background:#fff;
                        border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.15);
                        padding:10px 12px;width:220px;font-size:13px;">
                <div style="font-weight:600;margin-bottom:4px;" t-esc="props.orgName"/>
                <div t-att-style="'color:' + colors.text">
                    <t t-esc="label"/>
                </div>
                <div class="text-muted" style="margin-top:6px;font-size:11px;">
                    See Org Registration for full details.
                </div>
            </div>
        </div>`;
    setup() {
        this.state = useState({ open: false });
    }
    toggleOpen() {
        this.state.open = !this.state.open;
    }
    get colors() {
        return TIER_COLORS[tierOf(this.props.daysLeft)];
    }
    get label() {
        return daysLabel(this.props.daysLeft);
    }
    get dashArray() {
        // 14-day trial window assumed for the ring's fill; clamps at the ends so an
        // expired or far-out value doesn't draw a garbage arc.
        const total = 14;
        const remaining = Math.max(0, Math.min(total, this.props.daysLeft));
        const circumference = 2 * Math.PI * 15.5;
        const filled = (remaining / total) * circumference;
        return `${filled} ${circumference}`;
    }
}

// --- Variant C: always-expanded labeled chip, more prominent than an icon-only treatment. ---
class VariantC extends Component {
    static props = ["daysLeft"];
    static template = xml`
        <span t-attf-style="background:{{colors.bgSoft}};color:{{colors.text}};
                             border:1px solid {{colors.bg}};padding:3px 10px 3px 8px;border-radius:4px;
                             font-size:12px;font-weight:600;display:inline-flex;align-items:center;
                             gap:6px;white-space:nowrap;">
            <span t-attf-style="width:8px;height:8px;border-radius:50%;background:{{colors.bg}};display:inline-block;"/>
            Trial: <t t-esc="label"/>
        </span>`;
    get colors() {
        return TIER_COLORS[tierOf(this.props.daysLeft)];
    }
    get label() {
        return daysLabel(this.props.daysLeft);
    }
}

const VARIANT_COMPONENTS = { A: VariantA, B: VariantB, C: VariantC };

// --- Wrapper: the single systray entry. Renders the selected variant plus the throwaway
// floating switcher (variant cycling + simulate-days presets) described in the prototype
// skill's UI.md. ------------------------------------------------------------------------
export class PrototypeExpirySystray extends Component {
    static props = [];
    static components = VARIANT_COMPONENTS;
    static template = xml`
        <div class="o_prototype_expiry_systray" style="display:flex;align-items:center;padding:0 6px;">
            <t t-if="state.record">
                <t t-component="VARIANT_COMPONENTS[state.variant]"
                   daysLeft="effectiveDaysLeft" orgName="state.record.name"/>
            </t>
            <t t-else="">
                <span class="text-muted" style="font-size:12px;">No Org Registration record</span>
            </t>
        </div>
        <div style="position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2000;
                     background:#2b2145;color:#fff;border-radius:24px;box-shadow:0 4px 16px rgba(0,0,0,.35);
                     padding:8px 14px;display:flex;align-items:center;gap:10px;font-size:13px;
                     font-family:sans-serif;">
            <button class="btn btn-sm btn-link text-white p-0" t-on-click="prevVariant"
                    style="text-decoration:none;">◀</button>
            <span style="min-width:170px;text-align:center;">
                Variant <t t-esc="state.variant"/> — <t t-esc="VARIANT_NAMES[state.variant]"/>
            </span>
            <button class="btn btn-sm btn-link text-white p-0" t-on-click="nextVariant"
                    style="text-decoration:none;">▶</button>
            <span style="opacity:.5;">|</span>
            <span>Simulate:</span>
            <t t-foreach="SIMULATE_PRESETS" t-as="d" t-key="d">
                <button class="btn btn-sm btn-outline-light py-0 px-2" t-on-click="() => this.simulate(d)"
                        t-att-style="d === state.override ? 'font-weight:700;' : ''">
                    <t t-esc="d"/>d
                </button>
            </t>
            <button class="btn btn-sm btn-outline-light py-0 px-2" t-on-click="() => this.simulate(null)">
                real
            </button>
            <span style="opacity:.5;">|</span>
            <span t-attf-style="font-weight:700;color:{{tierColorHex}};">
                <t t-esc="effectiveDaysLeft"/>d → <t t-esc="tierOf(effectiveDaysLeft)"/>
            </span>
        </div>`;

    setup() {
        this.orm = useService("orm");
        this.VARIANT_COMPONENTS = VARIANT_COMPONENTS;
        this.VARIANT_NAMES = VARIANT_NAMES;
        this.SIMULATE_PRESETS = SIMULATE_PRESETS;
        this.tierOf = tierOf;
        this.state = useState({
            variant: this._variantFromUrl(),
            override: null,
            record: null,
        });

        onWillStart(async () => {
            const records = await this.orm.searchRead(
                "hosting.org.registration",
                [],
                ["name", "expiry_date"],
                { limit: 1 },
            );
            this.state.record = records[0] || null;
        });

        this._onKeydown = (ev) => {
            const target = ev.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
            }
            if (ev.key === "ArrowLeft") this.prevVariant();
            if (ev.key === "ArrowRight") this.nextVariant();
        };
        onMounted(() => window.addEventListener("keydown", this._onKeydown));
        onWillUnmount(() => window.removeEventListener("keydown", this._onKeydown));
    }

    _variantFromUrl() {
        const requested = new URLSearchParams(window.location.search).get("systray_variant");
        return VARIANTS.includes(requested) ? requested : "A";
    }

    _pushVariantToUrl(variant) {
        const url = new URL(window.location.href);
        url.searchParams.set("systray_variant", variant);
        window.history.replaceState(window.history.state, "", url);
    }

    prevVariant() {
        const i = VARIANTS.indexOf(this.state.variant);
        this.state.variant = VARIANTS[(i - 1 + VARIANTS.length) % VARIANTS.length];
        this._pushVariantToUrl(this.state.variant);
    }

    nextVariant() {
        const i = VARIANTS.indexOf(this.state.variant);
        this.state.variant = VARIANTS[(i + 1) % VARIANTS.length];
        this._pushVariantToUrl(this.state.variant);
    }

    simulate(days) {
        this.state.override = days;
    }

    get realDaysLeft() {
        if (!this.state.record || !this.state.record.expiry_date) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(this.state.record.expiry_date + "T00:00:00");
        return Math.round((expiry - today) / (1000 * 60 * 60 * 24));
    }

    get effectiveDaysLeft() {
        if (this.state.override !== null) return this.state.override;
        return this.realDaysLeft ?? 0;
    }

    get tierColorHex() {
        return TIER_COLORS[tierOf(this.effectiveDaysLeft)].bg;
    }
}

registry.category("systray").add("hosting.PrototypeExpirySystray", { Component: PrototypeExpirySystray }, { sequence: 5 });
