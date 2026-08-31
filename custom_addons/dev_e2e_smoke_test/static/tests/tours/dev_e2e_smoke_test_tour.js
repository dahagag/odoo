import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("dev_e2e_smoke_test_user_menu", {
    url: "/odoo",
    steps: () => [
        {
            trigger: ".o_user_menu button",
            run: "click",
        },
        {
            trigger: ".dropdown-item:contains('Log out')",
        },
    ],
});
