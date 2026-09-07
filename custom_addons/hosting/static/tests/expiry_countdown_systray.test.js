import { beforeEach, expect, test } from "@odoo/hoot";
import { animationFrame, mockDate } from "@odoo/hoot-mock";
import { routerBus } from "@web/core/browser/router";
import { defineModels, fields, models, mountWithCleanup, onRpc } from "@web/../tests/web_test_helpers";
import { ExpiryCountdownSystray } from "@hosting/js/expiry_countdown_systray";

class HostingOrgRegistration extends models.Model {
    _name = "hosting.org.registration";

    expiry_date = fields.Date();

    _records = [];
}

defineModels({ HostingOrgRegistration });

beforeEach(() => mockDate("2026-09-10 00:00:00", 0));

async function mountSystrayWithExpiry(expiryDate) {
    HostingOrgRegistration._records = expiryDate ? [{ id: 1, expiry_date: expiryDate }] : [];
    await mountWithCleanup(ExpiryCountdownSystray);
}

test("more than 7 days left renders the green tier", async () => {
    await mountSystrayWithExpiry("2026-09-20"); // 10 days left
    expect(".o_hosting_expiry_countdown_systray--green").toHaveCount(1);
    expect(".o_hosting_expiry_countdown_systray").toHaveText("Trial: 10d left");
});

test("exactly 8 days left still renders the green tier", async () => {
    await mountSystrayWithExpiry("2026-09-18"); // 8 days left
    expect(".o_hosting_expiry_countdown_systray--green").toHaveCount(1);
});

test("exactly 7 days left renders the yellow tier", async () => {
    await mountSystrayWithExpiry("2026-09-17"); // 7 days left
    expect(".o_hosting_expiry_countdown_systray--yellow").toHaveCount(1);
    expect(".o_hosting_expiry_countdown_systray").toHaveText("Trial: 7d left");
});

test("1 day left renders the yellow tier", async () => {
    await mountSystrayWithExpiry("2026-09-11"); // 1 day left
    expect(".o_hosting_expiry_countdown_systray--yellow").toHaveCount(1);
});

test("expiry today renders the red tier", async () => {
    await mountSystrayWithExpiry("2026-09-10"); // 0 days left
    expect(".o_hosting_expiry_countdown_systray--red").toHaveCount(1);
    expect(".o_hosting_expiry_countdown_systray").toHaveText("Trial: Expires today");
});

test("expired registration renders the red tier", async () => {
    await mountSystrayWithExpiry("2026-09-05"); // 5 days ago
    expect(".o_hosting_expiry_countdown_systray--red").toHaveCount(1);
    expect(".o_hosting_expiry_countdown_systray").toHaveText("Trial: Expired 5d ago");
});

test("no Org Registration record renders nothing", async () => {
    await mountSystrayWithExpiry(null);
    expect(".o_hosting_expiry_countdown_systray").toHaveCount(0);
});

test("a failed lookup hides the chip instead of raising", async () => {
    onRpc("hosting.org.registration", "search_read", () => {
        throw new Error("boom");
    });
    await mountWithCleanup(ExpiryCountdownSystray);
    expect(".o_hosting_expiry_countdown_systray").toHaveCount(0);
});

test("does not inherit the systray corner-badge transform", async () => {
    // Regression test for issue #164: the chip must not carry Bootstrap's `badge` class,
    // which would make it match `.o_main_navbar .o_menu_systray .badge` and get shifted
    // by that rule's `transform: translate(-0.6em, -30%)`.
    await mountSystrayWithExpiry("2026-09-20"); // 10 days left
    const chip = document.querySelector(".o_hosting_expiry_countdown_systray");
    expect(chip.classList.contains("badge")).toBe(false);
    expect(getComputedStyle(chip).transform).toBe("none");
});

test("re-fetches on in-app navigation instead of staying stale", async () => {
    await mountSystrayWithExpiry("2026-09-20"); // 10 days left
    expect(".o_hosting_expiry_countdown_systray--green").toHaveCount(1);

    HostingOrgRegistration._records = [{ id: 1, expiry_date: "2026-09-11" }]; // 1 day left
    routerBus.trigger("ROUTE_CHANGE");
    await animationFrame();

    expect(".o_hosting_expiry_countdown_systray--yellow").toHaveCount(1);
});
