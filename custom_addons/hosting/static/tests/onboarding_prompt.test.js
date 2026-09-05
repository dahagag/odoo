import { expect, test } from "@odoo/hoot";
import { click } from "@odoo/hoot-dom";
import { animationFrame } from "@odoo/hoot-mock";
import { makeDialogMockEnv, mountWithCleanup, onRpc } from "@web/../tests/web_test_helpers";
import { HostingOnboardingPrompt } from "@hosting/js/onboarding_prompt";

async function mountPrompt(close = () => {}) {
    const env = await makeDialogMockEnv();
    await mountWithCleanup(HostingOnboardingPrompt, { env, props: { close } });
}

test("shows the trial-mechanics content, not a product tour", async () => {
    await mountPrompt();
    expect(".modal-title").toHaveText("Welcome to your trial");
    expect(".modal-body").toHaveText(/Seats/);
    expect(".modal-body").toHaveText(/Expiry/);
    expect(".modal-body").toHaveText(/Inviting teammates/);
    expect(".modal-body").toHaveText(/Suspend/);
});

test("carries a link to the full Getting Started guide", async () => {
    await mountPrompt();
    expect(".modal-footer a").toHaveAttribute("href", "/hosting/static/docs/index.html");
});

test("dismissing marks the flag seen on the current user only, and closes", async () => {
    let writeArgs;
    onRpc("res.users", "write", ({ args }) => {
        writeArgs = args;
        return true;
    });
    let closed = false;
    await mountPrompt(() => {
        closed = true;
    });

    await click(".modal-footer .btn-primary");
    await animationFrame();

    expect(writeArgs[1]).toEqual({ hosting_onboarding_seen: true });
    expect(closed).toBe(true);
});

test("a failed write still closes the dialog instead of trapping the user", async () => {
    onRpc("res.users", "write", () => {
        throw new Error("boom");
    });
    let closed = false;
    await mountPrompt(() => {
        closed = true;
    });

    await click(".modal-footer .btn-primary");
    await animationFrame();

    expect(closed).toBe(true);
});
