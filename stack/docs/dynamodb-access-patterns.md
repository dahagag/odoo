# DynamoDB access patterns: the org record store

Single-table design (this ticket's Implementation Decisions), one physical table (logical name
`orgs`), holding every Trial Org and Client Org record and everything that hangs off one - seats,
and (per `DynamoIdempotencyStore`, `stack/apps/api/src/idempotency/store.ts`) idempotency
records. **Distinct from** the existing per-Trial-Org lock table
([ADR-0020](../../docs/adr/0020-dynamodb-per-trial-org-lock-and-stale-lock-recovery.md), logical
name `locks` here) - that table exists for a different purpose and stays as it is; nothing here
overloads it.

This ticket designs the key schema and the access patterns the lifecycle port (#196) needs; it
writes no org records itself (Out of Scope: "Trial Org and Client Org lifecycle logic").

## Key schema

| Item type | `pk` | `sk` | Notes |
|---|---|---|---|
| Org record | `org#<orgId>` | *(none - single item)* | `type`, `state`, `name`, `domain`, `seatsUsed`, `seatsTotal`, `expiryDate`, `opportunityId`. |
| Seat | `org#<orgId>` | `seat#<seatId>` | Lets "list seats for an org" be a `Query` on `pk` alone. |
| Idempotency record | `idempotency#<key>` | *(none)* | `status`, `body` (`stack/apps/api/src/idempotency/store.ts`). Shares this table rather than a table of its own. |

## Access patterns and how each is served

1. **Fetch an org by id.** `GetItem` on `pk = org#<orgId>`. Served today by
   `readOrgRegistration` (`stack/apps/api/src/orgRegistration.ts`), the one read path this
   ticket wires end to end.
2. **List orgs by state.** `Query` a GSI keyed by `gsi1pk = state#<state>` (partition), with the
   org's own `pk` projected as the sort key so pagination is stable. `AwsGateway.dynamoDb.query`'s
   `indexName` parameter carries the GSI name; the fake (`InMemoryAwsGateway`) doesn't model a
   separate GSI projection, since it always holds the whole item anyway (see the comment on
   `InMemoryDynamoDbGateway` in `stack/packages/aws-gateway/src/inMemory.ts`).
3. **List orgs by expiry date (the auto-destroy sweep).** `Query` a second GSI keyed by
   `gsi2pk = expiry-sweep` (a single fixed partition, since the sweep always scans "everything
   with an expiry date") with `gsi2sk = <expiryDate ISO string>` as the sort key, so the sweep
   queries `gsi2sk <= now` instead of a full-table scan. A Client Org is never written into this
   GSI (`docs/contexts/hosting/CONTEXT.md`'s Auto-Destroy entry: "never applicable to a Client
   Org").
4. **List orgs by Opportunity.** `Query` a third GSI keyed by `gsi3pk = opportunity#<opportunityId>`
   - `hosting_admin`'s side of the mirror (ADR-0034) looks up an org by the Opportunity it was
   issued from.
5. **List seats for an org.** `Query` on `pk = org#<orgId>`, `sk` begins_with `seat#` - the base
   table, no GSI needed, because seats are already stored under their org's own partition key.
6. **Seat count against the cap.** Not a separate access pattern so much as a write-time
   invariant: the org item carries a `seatsUsed` counter attribute, incremented in the same
   `TransactWriteItems` call that writes the new seat item, conditioned on
   `seatsUsed <= seatsTotal - 1` (`AwsGateway.dynamoDb.transactWrite`'s `increment` item, with a
   `numeric_less_than_or_equal` condition - see
   `stack/packages/aws-gateway/test/inMemory.test.ts`'s seat-counter test). This is what this
   ticket's Implementation Decisions mean by "the invariant cannot rely on a scan": a scan-then-
   write could race two concurrent seat creations past the cap, where the transactional
   increment cannot.

## What this ticket does not decide

Whether patterns 2-4 above use three separate GSIs or fewer, wide-projection GSIs (DynamoDB
allows up to 20 GSIs per table, so cost is not the binding constraint) is left to #196, which is
the ticket that actually writes org records and can size real item throughput against it. What's
fixed here is the key *shape* each pattern needs, not the final index count.
