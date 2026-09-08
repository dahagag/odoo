# The Odoo-to-stack contract is REST with a generated, committed OpenAPI document

Part of the Hosting Operations completion epic
([#193](https://github.com/dahagag/odoo/issues/193)). Given
[ADR-0034](0034-administration-stack-owns-org-record-of-truth.md)'s split — the administration
stack owns the record of truth, `hosting_admin` becomes a CRM integration — this ADR fixes the
wire contract between them, ahead of and independently of the stack's own frontend framework
choice, which is deliberately still open.

The contract is **REST over HTTPS**, described by an **OpenAPI document generated from the
stack's own runtime validators**, committed to the repo, and gated in CI by a schema diff that
fails on a breaking change. Generated rather than hand-written, because a hand-maintained spec
describes what someone believed the API did at the time they last edited it; one emitted from the
validators the server actually enforces cannot drift from the server without the diff noticing.

Three consumers read this contract, and they are not equally trusted:

- `hosting_admin` (Odoo, staff plane) — reads and writes, authenticated with SigV4 under the IAM
  role on Odoo's instance profile, so there is no shared secret to store or rotate. This is only
  available once Odoo runs in AWS, which is why the Odoo↔stack integration lands after the
  production cutover.
- `hosting` (Odoo, on each org's own instance) — **read-only**, one endpoint, scoped by a per-org
  token issued at provision time, able to return only that org's own Org Registration.
- The staff app and the client app — the stack's own two surfaces.

Committing the document is what lets the contract be **tested from both sides against shared
examples**, so a breaking change fails CI in whichever language introduced it rather than at
runtime in the other one.

## Why not GraphQL

GraphQL is the obvious alternative for a control-plane API with two dissimilar frontends, and it
would genuinely suit the staff app's read patterns. It is rejected on the security boundary, not
on ergonomics.

A GraphQL API is a **single POST path**. Every request — a staff app fleet query, an
Odoo-initiated Trial Org issuance, an org reading its own registration — arrives as `POST
/graphql` with the operation in the body. That collapses the distinction our authorization
already depends on:

- **IAM cannot express it.** The SigV4 grant on Odoo's instance-profile role is scoped by HTTP
  method and resource path. Against one POST path, "may read an org's registration" and "may
  destroy an org" are the same IAM action on the same resource, so read-only enforcement stops
  being an IAM property at all.
- **The WAF cannot express it either.** Path- and method-based rules — the cheap, coarse layer
  that sits in front of everything and does not depend on our code being correct — see one path
  and one method and can distinguish nothing.
- **So enforcement moves into resolver code**, for a token that ships to *every* Trial Org
  instance. That token is the least trusted credential in the system: it lives on a
  customer-facing box we hand to a prospect, and ADR-0018's whole isolation argument was that
  such a box should not be one bug away from cross-org access. Making a resolver-level check the
  only thing standing between it and a mutation is the wrong place to spend that risk.

REST keeps the per-org read path a distinct method-and-path pair, which means IAM and the WAF can
both refuse a mutation before any of our code runs, and a resolver bug cannot promote a read
token into a write.

Two smaller considerations pointed the same way and are recorded for completeness: the
per-org read surface is a single fixed shape, so GraphQL's flexibility buys nothing where the
untrusted credential is; and REST plus OpenAPI has generated-client support in both Python and
TypeScript that needs no schema-stitching layer to maintain.

## What this does not decide

- **The stack's frontend framework.** Specifying the contract first is precisely what lets that
  decision be settled later without blocking any other child of the epic.
- **Endpoint-level design** — resource shapes, pagination, error envelopes, versioning strategy —
  which lands with the stack foundation in
  [#195](https://github.com/dahagag/odoo/issues/195) rather than here.
- **The AWS boundary inside the stack.** The stack's own `AwsGateway` seam is an internal
  boundary, not part of this contract.
