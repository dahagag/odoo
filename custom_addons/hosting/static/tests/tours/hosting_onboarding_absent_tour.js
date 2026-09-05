import { registry } from "@web/core/registry";

// The onboarding prompt (#121) must not reappear on a later login for a user who has
// already dismissed it. The fixture (hosting_onboarding_seen already true) is set up by the
// test.py that starts this tour.
registry.category("web_tour.tours").add("hosting_onboarding_absent_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "The onboarding prompt does not reappear for a user who already saw it",
            trigger: "body:not(:has(.modal-title:contains(Welcome to your trial)))",
            run: () => {},
        },
    ],
});
