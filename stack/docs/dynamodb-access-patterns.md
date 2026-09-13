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
| Org record | `org#<orgId>` | *(none - single item)* | `type`, `state`, `region`, `dnsSubdomainLabel`, `name`, `domain`, `seatsUsed`, `seatsTotal`, `expiryDate`, `opportunityId`, `amiId`/`tofuModuleGitSha`/`pendingAmiId`/`pendingTofuModuleGitSha` (ADR-0024), `lastJobId`/`lastJobAction` (ADR-0019). |
| DNS label reservation | `dnslabel#<label>` | *(none)* | `orgId` - the mechanism the lifecycle port (#278: `stack/apps/api/src/org/record.ts`) uses to make `dnsSubdomainLabel` uniqueness atomic at create time: reserved in the same `transactWrite` as the org item itself (`attribute_not_exists` on its own `pk`), released and re-reserved atomically when the label changes while `issued`. |
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

   The condition's threshold (`seatsTotal - 1` above) is a value the *caller* supplies per call,
   not something `AwsGateway` reads off the item itself - the seam only knows "increment this
   attribute if it is currently `<=` this number," not "the org's own cap." A caller that
   derives the threshold from a stale or wrong `seatsTotal` still race-safely enforces *that*
   threshold; it does not race-safely enforce the org's actual cap. Reading the org's current
   `seatsTotal` and deriving the threshold from it as one logical operation is the lifecycle
   port's (#196) job, not this seam's.

   Concretely: **`seatsTotal` must be treated as immutable once an org is issued** unless and
   until #196 changes the seat-creation path to read the item's current `seatsTotal` and derive
   the threshold from it in the same transaction (rather than from a value computed earlier).
   `docs/contexts/hosting/CONTEXT.md`'s Seat entry already describes it as "set per-trial at
   issuance," not something a later action edits - so today's contract already matches this
   constraint; it is recorded here so a change that makes `seatsTotal` mutable knows it must
   revisit this write path too.

## Seam additions the lifecycle port (#278) needed

`AwsGateway.dynamoDb` (`stack/packages/aws-gateway`) gained two things this ticket's own
Implementation Decisions didn't anticipate, needed once the lifecycle port actually had a
multi-source transition and a same-item field it must change without touching others:

- **`attribute_in` condition.** `destroy` is legal from both `active` and `suspended` - a single
  `attribute_equals` condition can't express "one of several values." `attribute_in` is the
  narrowest addition that can, mirroring how `numeric_less_than_or_equal` was added earlier for
  the seat counter's own need. This is what makes `applyTransition`'s conditional write the
  actual concurrency guard: checked against whatever is truly current at write time, exactly one
  of two genuinely concurrent transitions on the same org commits.
- **`updateItem` (and a matching `transactWrite` `update` item).** `putItem` replaces the whole
  item; two logically-independent concurrent writers to the same org item (a lifecycle
  transition changing `state`, a `dnsSubdomainLabel` edit changing that one field) would
  otherwise silently clobber each other's change via a stale full-item overwrite (the classic
  lost-update problem). `updateItem` sets only the given attributes, so each writer's own
  condition is the only thing that can reject it - it can never discard a concurrent, unrelated
  field change it never read.

## What this ticket does not decide

Whether patterns 2-4 above use three separate GSIs or fewer, wide-projection GSIs (DynamoDB
allows up to 20 GSIs per table, so cost is not the binding constraint) is left to #196, which is
the ticket that actually writes org records and can size real item throughput against it. What's
fixed here is the key *shape* each pattern needs, not the final index count.
