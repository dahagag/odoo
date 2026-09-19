import { registry } from "@web/core/registry";

// Proves the real Python -> ORM -> systray render path for a Client Org: a registration
// record exists but carries no expiry_date, so the countdown must be absent rather than
// rendered broken (issue #201's User Story #6). The fixture is set up by the test.py that
// starts this tour.
registry.category("web_tour.tours").add("hosting_expiry_countdown_systray_absent_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "No expiry countdown chip is shown for a Client Org's registration",
            trigger: "body:not(:has(.o_hosting_expiry_countdown_systray))",
            run: () => {},
        },
    ],
});
