---
status: superseded by ADR-0034 and ADR-0037
---

# Real-time Trial Org log viewer via CloudWatch subscription, a shared Lambda, and Odoo's own bus

**Superseded:** the log viewer is rebuilt in the administration stack's staff app and the
CloudWatch forwarder retargets to the stack — see
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md) for the ownership move,
[ADR-0037](0037-odoo-has-no-public-ingress.md) for the constraint that forces it, and
[#199](https://github.com/dahagag/odoo/issues/199) for the rebuild, all under epic
[#193](https://github.com/dahagag/odoo/issues/193).

This is superseded rather than amended because the *delivery mechanism* below cannot survive the
move, not just its host: an HMAC-signed POST from a Hosting Account Lambda into an Odoo webhook
controller, plus Odoo's own bus for live tailing, both require Odoo to have a public listener,
which ADR-0037 removes. Leaving this implementation in place would have left a support tool
unreachable behind a private Odoo.

What carries forward is the shape of the pipe, not the endpoint: a CloudWatch Logs subscription
filter per Trial Org log group feeding **one shared Lambda** declared in the static foundation
(the per-trial-Lambda cost objection below still holds), with the log group's name identifying
which org each event belongs to. [ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md)'s
narrow instance profile — the thing that gets logs into that group at all — is unaffected.

**Everything below is the original decision. It is superseded — implement nothing from it
except what the note above explicitly preserves.**

`hosting_admin` gives technical support a live-tailing, auto-refreshing view of a Trial Org's
Odoo application log — filterable by org and by user — so support can diagnose a problem with a
client live, the way Render's log viewer works. This is push-based, not polling: a CloudWatch
Logs subscription filter on each Trial Org's log group ([ADR-0021](0021-trial-org-ec2-power-state-and-instance-profile-boundary.md)'s
narrow instance profile is what gets logs into that group in the first place) feeds **one shared
Lambda**, declared once in the OpenTofu static foundation ([ADR-0016](0016-opentofu-for-static-and-per-trial-provisioning.md))
rather than provisioned per trial — a Lambda per disposable 14-day Trial Org would work against
the cost-consciousness this whole design has held to elsewhere. The shared Lambda reads the
log-group name off each event to know which Trial Org it's forwarding for.

**Delivery into Odoo.** The Lambda POSTs new log lines to an Odoo webhook controller, HMAC-signed
(the same pattern as Stripe/GitHub webhooks) so nothing else can inject fake log lines into a live
support session. The controller verifies the signature, then publishes onto Odoo's own
`bus.bus` — Odoo 19 ships this as a genuine WebSocket service (`addons/bus/controllers/websocket.py`,
`addons/bus/models/ir_websocket.py`), not old-style longpolling — on a channel scoped to that
Trial Org's log viewer. An open browser tab already subscribed to that channel receives new lines
live, the same mechanism Odoo's own chat notifications use.

We rejected a dedicated API Gateway WebSocket API that the browser would connect to directly.
It's a legitimate real-time pattern, but it would mean operating two separate real-time channels
(Odoo's bus for everything else in the product, a second WebSocket just for this) and building
connection-ID tracking and reconnect handling that Odoo's bus already solves — for no throughput
or cost advantage once Odoo's bus is confirmed to be WebSocket-based already, not the polling
implementation that would have made a second channel worth it.

**Read scope.** `hosting_admin`'s IAM role additionally gets `logs:FilterLogEvents`/
`GetLogEvents`/`DescribeLogStreams`, resource-scoped per Trial Org's own log group — the same
per-org isolation the write side (ADR-0021's instance profile) already has, so a support employee
viewing one org's live logs can't read another's.

**User filter.** Filtering by user requires Odoo's own log lines to carry a user identifier, which
its standard logger doesn't reliably do (it logs the DB name and request path, not the acting
user's login). A custom logging filter/formatter is added to the base AMI's Odoo configuration to
stamp the acting user's login onto relevant log lines specifically so this filter works, rather
than shipping a filter that only works when a user's name happens to already appear in a line.
