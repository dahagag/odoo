import { registry } from "@web/core/registry";

// Proves the real session_info -> launcher -> dialog path end to end for a user's first
// login (the Hoot suite in static/tests/onboarding_prompt.test.js only exercises the
// component against a stubbed session). The fixture is set up by the test.py that starts
// this tour.
registry.category("web_tour.tours").add("hosting_onboarding_prompt_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "The first-login onboarding prompt is shown",
            trigger: ".modal-title:contains(Welcome to your trial)",
            run: () => {},
        },
        {
            content: "Dismiss it",
            trigger: ".modal-footer .btn-primary:contains(Got it)",
            run: "click",
        },
        {
            content: "The prompt is gone once dismissed",
            trigger: "body:not(:has(.modal-title:contains(Welcome to your trial)))",
            run: () => {},
        },
    ],
});
