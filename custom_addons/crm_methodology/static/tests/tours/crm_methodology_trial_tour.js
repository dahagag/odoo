import { registry } from "@web/core/registry";
import { stepUtils } from "@web_tour/tour_utils";

// Covers exactly the gap plain Python/ORM tests can't reach: this session found three real
// regressions - an AccessError thrown by a clickable field that should have been inert, a
// countdown that silently stayed blank for every non-admin user, and translations that
// silently fell back to English - and all 63 TransactionCase tests stayed green through every
// one of them, because none of them actually render a form in a browser. This tour drives the
// real Issue Trial / Extend Trial wizards through the browser and checks what a user would
// actually see.
registry.category("web_tour.tours").add("crm_methodology_trial_tour", {
    url: "/odoo",
    steps: () => [
        ...stepUtils.goToAppSteps("crm.crm_menu_root"),
        {
            trigger: ".o_kanban_record:contains('Tour Test Trial Opportunity')",
            run: "click",
        },
        {
            trigger: "a.nav-link:contains('Trial')",
            run: "click",
        },
        {
            trigger: "button:contains('Issue Trial')",
            run: "click",
        },
        {
            trigger: ".o_dialog div[name='prospect_domain'] input",
            run: "edit tour-trial.example.com",
        },
        {
            trigger: ".o_dialog div[name='invite_email'] input",
            run: "edit ceo@tour-trial.example.com",
        },
        {
            trigger: ".o_dialog footer button:contains('Issue Trial')",
            run: "click",
            expectUnloadPage: true, // action_confirm reloads the page so the chatter and the
                                    // Trial tab's fields pick up the newly-linked Trial Org.
        },
        {
            trigger: "a.nav-link:contains('Trial')",
            run: "click",
        },
        {
            // The countdown wrapper text ("... left" in English) - this is exactly the field
            // that silently rendered blank under the compute_sudo bug, and silently stayed in
            // English under the missing odoo-python marker bug.
            trigger: ".o_field_widget[name='trial_expiry_display']:contains('left')",
        },
        {
            // Regression check for the no_open fix: trial_org_id used to be a clickable link
            // that threw an AccessError for anyone outside the Hosting Administrator group.
            // Clicking it now must do nothing - if that guard ever regresses, the AccessError
            // dialog this used to throw would block every step after this one.
            trigger: ".o_field_widget[name='trial_org_id']",
            run: "click",
        },
        {
            trigger: "button:contains('Extend Trial')",
            run: "click",
        },
        {
            trigger: ".o_dialog footer button:contains('Extend Trial')",
            run: "click",
            expectUnloadPage: true,
        },
        {
            trigger: ".o-mail-Message:contains('Trial Org extended')",
        },
    ],
});
