import { beforeEach, expect, test } from "@odoo/hoot";
import { mockDate } from "@odoo/hoot-mock";
import { defineModels, fields, models, mountWithCleanup } from "@web/../tests/web_test_helpers";
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
