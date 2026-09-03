# Generalize the teach-doc pipeline for a second addon (Hosting onboarding)

The Onboarding Guide's doc, HyperFrames video, and Puppeteer screenshots are built through the
existing teach-doc pipeline (`scripts/docs_build/`, established by
[ADR-0007](0007-self-contained-teach-docs-served-from-static.md) and
[ADR-0008](0008-hyperframes-for-teach-doc-video.md)) rather than a second, separate mechanism —
same self-contained-HTML format, same HyperFrames video embedding, same authoring conventions. The
pipeline currently hardcodes both its source (`docs/teach/`) and output
(`custom_addons/crm_methodology/static/docs/`) to one addon; it's lightly parameterized (an
addon-name argument selecting `docs/teach-<addon>/` as source and
`custom_addons/<addon>/static/docs/` as output) so `hosting` becomes a second target without
forking the script. Going from one consumer to two is the point at which a single hardcoded path
stops paying for itself — forking would leave two build scripts drifting out of sync with every
future change to either, and hand-authoring without the pipeline would abandon its self-contained-
HTML and video-embedding conventions for the one addon that needs them just as much.

**Screenshot capture and staleness.** The Onboarding Guide's screenshots are captured with
Puppeteer against the `hosting`/`hosting_admin` addons running in the existing local dev stack
(`compose.yaml`) — not against a real AWS-hosted Trial Org, which would mean paying to keep a
Trial-Org-like environment alive indefinitely just to be photographed. Each capture run is tagged
with the addon code's git SHA (the same versioning vocabulary
[ADR-0024](0024-per-trial-org-deployment-versioning.md) introduced for Trial Orgs themselves, reused
here for a different purpose: detecting when *documentation* has drifted from *code*, not
auditing what a specific customer's environment ran). A docs build can compare its screenshots'
tagged SHA against the addons' current SHA and flag when a recapture is due, rather than silently
shipping stale UI screenshots indefinitely.
