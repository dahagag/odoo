import { registry } from "@web/core/registry";

// Proves the real Python -> ORM -> systray render path end to end (the Hoot suite in
// static/tests/expiry_countdown_systray.test.js only exercises the component against a fake
// in-memory model). The fixture's tier is asserted by the test.py that starts this tour.
registry.category("web_tour.tours").add("hosting_expiry_countdown_systray_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "Expiry countdown chip is visible in the systray, colored by tier",
            trigger: ".o_hosting_expiry_countdown_systray--green",
        },
    ],
});
