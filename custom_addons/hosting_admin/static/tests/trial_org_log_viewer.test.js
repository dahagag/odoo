import { describe, destroy, expect, test } from "@odoo/hoot";
import { click, edit, queryAllTexts } from "@odoo/hoot-dom";
import { animationFrame, Deferred } from "@odoo/hoot-mock";
import {
    defineModels,
    getService,
    mockService,
    models,
    mountView,
    MockServer,
} from "@web/../tests/web_test_helpers";
import { defineBusModels } from "@bus/../tests/bus_test_helpers";

class HostingTrialOrg extends models.Model {
    _name = "hosting.trial.org";
    _records = [{ id: 42 }];
}

defineModels([HostingTrialOrg]);
defineBusModels();
describe.current.tags("desktop");

const CHANNEL = "hosting_admin.trial_org_log-42";
const NOTIFICATION_TYPE = "hosting_admin.trial_org_log_lines";

const viewData = {
    type: "form",
    resModel: "hosting.trial.org",
    resId: 42,
    arch: /* xml */ `<form><widget name="hosting_trial_org_log_viewer"/></form>`,
};

function sendLines(lines, { channel = CHANNEL, trialOrgId = 42 } = {}) {
    MockServer.env["bus.bus"]._sendone(channel, NOTIFICATION_TYPE, { trial_org_id: trialOrgId, lines });
}

describe("hosting_trial_org_log_viewer", () => {
    test("appends incoming log lines live", async () => {
        await mountView(viewData);
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(0);

        sendLines([{ timestamp: 1, message: "line one" }]);
        await animationFrame();
        expect(queryAllTexts(".o_hosting_trial_org_log_viewer_line")).toEqual(["line one"]);

        sendLines([{ timestamp: 2, message: "line two" }]);
        await animationFrame();
        expect(queryAllTexts(".o_hosting_trial_org_log_viewer_line")).toEqual(["line one", "line two"]);
    });

    test("filters lines by a substring match against the message", async () => {
        await mountView(viewData);
        sendLines([
            { timestamp: 1, message: "log line for alice@acme.example.com" },
            { timestamp: 2, message: "log line for bob@acme.example.com" },
        ]);
        await animationFrame();
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(2);

        await click(".o_hosting_trial_org_log_viewer_user_filter");
        await edit("alice");
        await animationFrame();
        expect(queryAllTexts(".o_hosting_trial_org_log_viewer_line")).toEqual([
            "log line for alice@acme.example.com",
        ]);
    });

    test("filter match is case-insensitive", async () => {
        await mountView(viewData);
        sendLines([{ timestamp: 1, message: "log line for ALICE@acme.example.com" }]);
        await animationFrame();

        await click(".o_hosting_trial_org_log_viewer_user_filter");
        await edit("alice");
        await animationFrame();
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(1);
    });

    test("clearing the filter shows every line again", async () => {
        await mountView(viewData);
        sendLines([
            { timestamp: 1, message: "log line for alice@acme.example.com" },
            { timestamp: 2, message: "log line for bob@acme.example.com" },
        ]);
        await animationFrame();

        await click(".o_hosting_trial_org_log_viewer_user_filter");
        await edit("alice");
        await animationFrame();
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(1);

        await edit("");
        await animationFrame();
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(2);
    });

    test("ignores lines published for a different Trial Org", async () => {
        // bus_service.js dispatches by notification type alone, on one event bus shared by
        // every widget subscribed to it in the same browser session - not scoped to the
        // channel a given widget added. Simulate a second Trial Org's log viewer also open in
        // this same session (its own addChannel call) to reproduce that shared-bus condition,
        // then confirm a message on ITS channel doesn't leak into this widget (docs/adr/0023).
        await mountView(viewData);
        getService("bus_service").addChannel("hosting_admin.trial_org_log-99");
        sendLines([{ timestamp: 1, message: "someone else's trial org" }], {
            channel: "hosting_admin.trial_org_log-99",
            trialOrgId: 99,
        });
        await animationFrame();
        expect(".o_hosting_trial_org_log_viewer_line").toHaveCount(0);

        sendLines([{ timestamp: 2, message: "our own trial org" }]);
        await animationFrame();
        expect(queryAllTexts(".o_hosting_trial_org_log_viewer_line")).toEqual(["our own trial org"]);
    });

    test("subscribes on mount and tears the channel down when the view closes", async () => {
        const addedChannels = [];
        const deletedChannels = [];
        mockService("bus_service", {
            addChannel(channel) {
                addedChannels.push(channel);
                return super.addChannel(channel);
            },
            deleteChannel(channel) {
                deletedChannels.push(channel);
                return super.deleteChannel(channel);
            },
        });

        const component = await mountView(viewData);
        expect(addedChannels).toEqual([CHANNEL]);
        expect(deletedChannels).toEqual([]);

        destroy(component);
        expect(deletedChannels).toEqual([CHANNEL]);
    });

    test("waits for a slow addChannel to settle before deleting on early destroy", async () => {
        // addChannel() only sends BUS:ADD_CHANNEL once the shared worker has finished starting,
        // so it can still be pending when the widget is destroyed right after mounting (e.g.
        // the user switches away from the tab immediately). deleteChannel() must not fire until
        // that add has actually settled, or the delayed add could land after the delete and
        // leave the channel subscribed forever.
        const addChannelDeferred = new Deferred();
        const deletedChannels = [];
        mockService("bus_service", {
            addChannel(channel) {
                return addChannelDeferred.then(() => super.addChannel(channel));
            },
            deleteChannel(channel) {
                deletedChannels.push(channel);
                return super.deleteChannel(channel);
            },
        });

        const component = await mountView(viewData);
        destroy(component);
        await animationFrame();
        expect(deletedChannels).toEqual([]);

        addChannelDeferred.resolve();
        await animationFrame();
        expect(deletedChannels).toEqual([CHANNEL]);
    });

    test("still deletes the channel if a pending addChannel rejects", async () => {
        // A rejected addChannel (e.g. the shared worker failed to start) must not turn into an
        // unhandled rejection that skips deleteChannel entirely.
        const addChannelDeferred = new Deferred();
        const deletedChannels = [];
        mockService("bus_service", {
            addChannel() {
                return addChannelDeferred;
            },
            deleteChannel(channel) {
                deletedChannels.push(channel);
                return super.deleteChannel(channel);
            },
        });

        const component = await mountView(viewData);
        destroy(component);
        addChannelDeferred.reject(new Error("worker failed to start"));
        await animationFrame();
        expect(deletedChannels).toEqual([CHANNEL]);
    });
});
