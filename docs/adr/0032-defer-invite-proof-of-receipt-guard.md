# Defer an invite proof-of-receipt guard until the org-facing login layer exists

`hosting.trial.org.action_join_open_invite` and `hosting.trial.org.seat.action_invite` are both
gated only by domain-match against the rep-set expected domain (the guard from
[ADR-0026](0026-two-trial-invitation-paths-with-domain-guard.md)). Neither checks that the caller
actually received the specific Open Invite Link or self-service invite — knowing (or guessing) a
Trial Org's or Seat's id plus a same-domain-looking email is enough.

`action_join_open_invite` is live-exploitable today: `hosting.trial.org`/`hosting.trial.org.seat`
grant no `base.group_user` access at all (`docs/adr/0018`), but the method carries its own
`sudo()` boundary specifically so an ordinary authenticated Odoo user (not a Platform operator)
can call it — proven by `custom_addons/hosting_admin/tests/test_trial_org_open_invite.py`'s
`test_ordinary_user_can_join_via_open_invite_despite_no_direct_model_access`. Any authenticated
user in this Odoo instance can call it today via RPC or the ORM shell, for any Trial Org id.

We considered designing the proof-of-receipt mechanism now — a token on `hosting.trial.org` (or a
new model), generated at issuance (ticket #109's "Issue Trial" action), verified by the
not-yet-built org-facing login/controller layer — so that layer and the issuance flow would have
a settled contract to build against. Rejected for now: the token's shape depends heavily on how
that login/controller layer ends up working (session handling, whether the link itself carries the
token or a separate confirmation step does), which hasn't been designed yet. Designing the token
first risks designing it twice.

We also considered patching `action_join_open_invite` now (e.g. narrowing its `sudo()` boundary)
to close the live gap without waiting for the full design. Rejected: the exposure is bounded to
already-authenticated internal Odoo users, not the public — materially smaller than an anonymous
outsider reaching it, since there is no portal or login controller exposing it externally yet.

**Decision**: defer designing and building the proof-of-receipt guard until the org-facing
login/controller layer's own design begins. Accept the residual risk in the interim: an
authenticated internal Odoo user could join or invite into a Trial Org they weren't meant to,
given a same-domain-looking email and a guessed/known id. Revisit when that controller layer's
design work starts, at which point the guard's shape should be settled alongside it rather than
in isolation.

[#161](https://github.com/dahagag/odoo/issues/161) and
[#110](https://github.com/dahagag/odoo/issues/110) are closed as addressed by this decision.
