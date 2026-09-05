import { registry } from "@web/core/registry";

// Proves the real session_info -> launcher -> dialog path end to end for a user's first
// login (the Hoot suite in static/tests/onboarding_prompt.test.js only exercises the
// component against a stubbed session). The fixture is set up by the test.py that starts
// this tour.
//
// Triggers key off the dialog's own contentClass (.o_hosting_onboarding_prompt), not its
// translated title text or copy - the test database only ever has en_US installed today,
// but a text-based trigger would silently break the moment that stops being true, since it
// would be looking for English copy against a UI rendered in another language.
registry.category("web_tour.tours").add("hosting_onboarding_prompt_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "The first-login onboarding prompt is shown",
            trigger: ".o_hosting_onboarding_prompt",
            run: () => {},
        },
        {
            content: "Dismiss it",
            trigger: ".o_hosting_onboarding_prompt .modal-footer .btn-primary",
            run: "click",
        },
        {
            content: "The prompt is gone once dismissed",
            trigger: "body:not(:has(.o_hosting_onboarding_prompt))",
            run: () => {},
        },
    ],
});
