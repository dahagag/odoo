# Administration Stack

The system of record for every Trial Org and Client Org (`docs/adr/0034`,
`docs/contexts/hosting/CONTEXT.md`'s **Administration Stack** entry). This directory holds this
ticket's skeleton: the monorepo, the API contract, and the AWS boundary seam. No Trial Org/Client
Org lifecycle logic lives here yet - that's `hosting_admin`'s current job until it ports over in
[#196](https://github.com/dahagag/odoo/issues/196).

## Layout

- `packages/domain` - shared contract vocabulary (`OrgType`, `OrgState`, `ProblemDetails`,
  pagination, the idempotency header name). No AWS SDK, no HTTP framework.
- `packages/aws-gateway` - the `AwsGateway` seam (`docs/dynamodb-access-patterns.md`): one
  interface covering every AWS call the stack makes, a real implementation (`AwsSdkGateway`,
  lazy AWS SDK imports) and an in-memory fake (`InMemoryAwsGateway`) that rejects what the real
  one would reject.
- `packages/api-client` - the TypeScript client the staff app and client app (later tickets) use
  against the committed OpenAPI contract.
- `apps/api` - the HTTP service: health/readiness, the two ADR-0036 surfaces (org-scoped,
  admin/SigV4), the idempotency seam, and the OpenAPI generator + breaking-change gate.

## Running locally

```bash
cd stack
npm install
npm run openapi:generate   # writes apps/api/openapi/openapi.json from the Zod schemas
npm run typecheck
npm run test
npm run dev --workspace apps/api   # starts the API against InMemoryAwsGateway (STACK_AWS_MODE=fake, the default)
```

No AWS account or credentials are needed for any of the above - `STACK_AWS_MODE` only switches to
`real` (constructing `AwsSdkGateway`) when explicitly set, and no test ever does (this ticket's
Testing Decisions: "No test may touch live AWS").

## The OpenAPI contract

`apps/api/openapi/openapi.json` is generated, not hand-written, from the same Zod schemas
(`apps/api/src/openapi/registry.ts`) the routes validate against - see `docs/adr/0036`. Three
checks keep it honest:

- `npm run openapi:check` (root) regenerates the document and fails if the working tree's copy
  drifted from it.
- `apps/api`'s own `openapiContract.test.ts` asserts the same thing as part of the normal test
  run.
- `npm run openapi:breaking-check` diffs the current generated document against the committed
  one at a base ref (default `origin/dev/19.0`) and fails on a breaking change (a removed
  path/operation/response, a newly required request field, or a removed response field) -
  `apps/api/src/openapi/diff.ts` is the diff itself, unit-tested independently of git.

## Deployment

Out of scope for this ticket (see the epic's #202, "AWS deploy pipeline"). `apps/api` ships a
`Dockerfile` so it is buildable and runnable, without yet deciding how it reaches the Platform
Account.
