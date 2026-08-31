import { registry } from "@web/core/registry";
import { stepUtils } from "@web_tour/tour_utils";

// Covers exactly the gap plain Python/ORM tests can't reach: whether the browser's native
// "Mark Done" button actually surfaces the Playbook wizard action, not just whether the server
// returns the right action dict. A prior version of this module returned the right action from
// Python while the button silently discarded it - only a real browser test catches that class
// of bug.
registry.category("web_tour.tours").add("crm_methodology_playbook_tour", {
    url: "/odoo",
    steps: () => [
        ...stepUtils.goToAppSteps("crm.crm_menu_root"),
        {
            trigger: ".o_kanban_record:contains('Tour Test Opportunity')",
            run: "click",
        },
        {
            trigger: ".o-mail-Activity-markDone",
            run: "click",
        },
        {
            trigger: ".o-mail-ActivityMarkAsDone button[aria-label='Done']",
            run: "click",
        },
        {
            trigger: ".o_dialog tr:has(td:contains('Situation')) td[name='answer']",
            run: "click",
        },
        {
            trigger: ".o_dialog tr:has(td:contains('Situation')) td[name='answer'] textarea",
            run: "edit Manual CSV exports, twice a week",
        },
        {
            trigger: ".o_dialog button:contains('Confirm')",
            run: "click",
            expectUnloadPage: true, // action_confirm reloads the page so the chatter picks up
                                    // the new message; see crm_methodology_playbook_wizard.py.
        },
        {
            trigger: ".o-mail-Message:contains('Playbook answered')",
        },
    ],
});
