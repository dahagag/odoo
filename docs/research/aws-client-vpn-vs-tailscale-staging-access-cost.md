# AWS Client VPN vs Tailscale: staging access-mechanism cost

Research date: 2026-09-27. Scope: reference material for the dev.domain.com staging
access-mechanism decision (see
[ADR-0040](../adr/0040-dev-domain-com-staging-has-no-public-surface-tailscale-only.md),
tracked as GitHub issue #203/#336). Staging has no public surface and needs a VPN-like
access mechanism for roughly 13 named users split across three access tiers — engineering,
internal stakeholders, and external early-adopter clients. This note prices AWS Client VPN
(plus ACM Private CA, if used for certificate issuance) against Tailscale's published
per-seat plans, against primary sources only (`aws.amazon.com` pricing pages and
`tailscale.com/pricing`). It does not recommend a choice — it exists to inform the ADR's
access-mechanism comparison.

**As-of date and re-verification caveat.** All dollar figures, tier boundaries, and plan
limits below were fetched from AWS's and Tailscale's own pricing pages on 2026-09-27. Both
vendors can and do change pricing, plan names, and plan limits over time — Tailscale in
particular ships pricing-page updates without the same change-control cadence as an AWS
service. Anyone relying on this note later than a few months from the research date should
re-fetch both pricing pages directly rather than trust these figures as current.

## 1. AWS Client VPN pricing model

There is no dedicated `aws.amazon.com/client-vpn/pricing` page — fetching it returns
`HTTP 404 Not Found`, confirmed directly in this session. Client VPN pricing instead lives
on the general AWS VPN pricing page, alongside Site-to-Site VPN.
Source: [AWS VPN pricing](https://aws.amazon.com/vpn/pricing/).

The page's own worked example (quoted verbatim) is the only place on the page that states
the billing units and rates together:

> "You create an AWS Client VPN endpoint in US East (Ohio) and associate it with one
> subnet. You then create 10 Client VPN connections to your AWS Client VPN endpoint. These
> connections are active for one hour.
> - AWS Client VPN endpoint hourly fee: For this AWS Region, you pay $0.10 per hour in AWS
>   Client VPN endpoint hourly fees.
> - AWS Client VPN connection hourly fee: Ten AWS Client VPN connections were active for 1
>   hour. You pay $0.50 per hour in AWS Client VPN connection fees.
>
> In this scenario, you pay $0.60 per hour for AWS Client VPN."
>
> Source: [AWS VPN pricing](https://aws.amazon.com/vpn/pricing/).

Two billing units, quoted directly:
- **$0.10 per hour**, labeled on the page as the "Client VPN endpoint hourly fee." The
  example associates the endpoint with exactly one subnet, so the page's own text does not
  independently distinguish "per endpoint" from "per subnet association" — with only one
  subnet in the example, the two are numerically identical. AWS's Client VPN Administrator
  Guide documents that a single endpoint can be associated with multiple subnets (one per
  AZ is a standard HA pattern), and the working assumption used throughout this note — as
  directed by the ADR's cost modeling — is that this $0.10/hour fee is charged **per subnet
  association**, not as a flat per-endpoint charge, consistent with how AWS bills
  multi-subnet Client VPN deployments in practice. This distinction was not independently
  confirmed against a second AWS primary-source sentence in this session and should be
  re-verified (e.g. against the Client VPN Administrator Guide's own billing notes) before
  being treated as settled; see [Unverified / could not confirm](#unverified--could-not-confirm).
- **$0.05 per connection per hour**, derived directly from the example's arithmetic (10
  connections × 1 hour → $0.50 total connection fee ÷ 10 = $0.05/connection-hour). The page
  never states "$0.05" as a standalone figure; only the $0.50-for-10-connections total is
  printed, so this per-unit rate is arithmetic on the quoted example, not a separately
  quoted line item.

### Data transfer and public IPv4 charges

The pricing page does **not** describe any Client-VPN-specific data-transfer or public-IPv4
rate. It instead points to standard EC2/VPC charges, stating (quoted):

> "Each Client VPN connection uses unique public IPv4 address for the tunnels. You will
> incur standard public IPv4 address charges on the IPv4 address that will be used for the
> tunnels."

and, on data transfer, that usage "incur[s] standard AWS data transfer charges for all data
transferred via the VPN connection" — with no Client-VPN-specific per-GB rate given on this
page. So: standard EC2/VPC data-transfer pricing applies as usual (see
[Amazon EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/) for the
current data-transfer tiers), and the public IPv4 charge is the account-wide public IPv4
address fee AWS introduced in February 2024 (billed per public IPv4 address per hour,
regardless of whether that address is attached to an EC2 instance, a NAT gateway, or — per
the quote above — a Client VPN tunnel endpoint). Neither of these is a Client-VPN-specific
line item; both are the same charges that would apply to any public IPv4 address or any
data transferred out of the VPC.
Source: [AWS VPN pricing](https://aws.amazon.com/vpn/pricing/).

## 2. ACM Private CA pricing

From AWS's Private CA pricing page:

- **General-purpose mode CA operation: $400 per month per private CA.**
- **Per-certificate pricing, general-purpose mode, tiered by certificates issued per
  calendar month per Region:**

  | Certificates issued per month | Price per certificate |
  |---|---|
  | 1 – 1,000 | $0.75 |
  | 1,001 – 10,000 | $0.35 |
  | 10,001+ | $0.001 |

- A cheaper **short-lived certificate mode** also exists ($50/month CA operation fee,
  $0.058 per certificate at all volumes), not used in the estimates below since the ADR's
  scenario (long-lived mutual-auth client certs for ~13 named users) fits the
  general-purpose mode's use case, not the short-lived-cert use case.
- AWS's own framing: "you pay a monthly fee for the operation of each private certificate
  authority (CA), the private certificates you issue each month, and the use of the Online
  Certificate Status Protocol (OCSP)" — OCSP itself (not used in the estimates below) is
  priced separately at $0.06 per queried certificate/month plus $0.20 per 100,000 queries.

Source: [AWS Private CA pricing](https://aws.amazon.com/private-ca/pricing/).

## 3. Worked cost estimate: two topologies

Both topologies assume a **self-managed OpenSSL CA** (no ACM Private CA fee) for mutual-TLS
client certificates, since Client VPN's own architecture supports bringing your own CA and
this is the cheaper default; the ACM Private CA delta is estimated separately below. Both
assume a **730 hours/month** convention (AWS's own commonly-used average — 365 days ÷ 12
months × 24 hours ≈ 730) for converting hourly fees into a monthly figure.

**Usage assumption (shared across both topologies):** ~13 named users, connecting
intermittently at roughly 4 hours/week each. 4 hrs/week × ~4.33 weeks/month ≈ 17.3
hours/user/month (using the standard 52 weeks/year ÷ 12 months ≈ 4.33 weeks/month
conversion). Total connection-hours/month ≈ 13 users × 17.3 hrs/user/month ≈ 225 connection-
hours/month. This total connection-hour figure does not change between the two topologies
below — only how many endpoints and subnet associations exist to serve it changes.

### (a) One shared Client VPN endpoint, 2 subnet associations (one per AZ, for HA)

- Subnet association cost: 2 subnets × $0.10/hour × 730 hours/month = **$146.00/month**
- Connection-hour cost: 225 connection-hours/month × $0.05/connection-hour ≈ **$11.25/month**
- **Total monthly estimate: ≈ $157.25/month**

### (b) Three separate Client VPN endpoints (one per access tier), each with 2 subnet associations

Assumed user split across the three tiers (documented assumption, not derived from any
source): engineering (6 users), internal stakeholders (4 users), external early-adopter
clients (3 users) — 13 users total, matching topology (a). The split only matters for how
usage is distributed across endpoints; total connection-hours stay the same as (a) because
total headcount and per-user usage haven't changed.

- Subnet association cost: 3 endpoints × 2 subnets each = 6 subnet associations × $0.10/hour
  × 730 hours/month = **$438.00/month**
- Connection-hour cost: same total usage as (a), 225 connection-hours/month × $0.05/connection-
  hour ≈ **$11.25/month** (unaffected by how many endpoints that usage is spread across)
- **Total monthly estimate: ≈ $449.25/month**

### Delta: (b) − (a)

**≈ $449.25 − $157.25 = $292.00/month more for the three-endpoint topology.**

This entire delta is arithmetically just the four extra, always-on subnet associations: (6
− 2) subnet associations × $0.10/hour × 730 hours/month = 4 × $73.00 = $292.00/month. None
of the delta comes from usage — the connection-hour line item is identical in both
topologies ($11.25/month) because the same 13 users generate the same ~225 connection-hours
regardless of how many endpoints route that traffic. The delta is driven entirely by the
extra persistent subnet-association fees, which accrue 24/7 whether or not anyone is
actually connected.

### ACM Private CA delta (if used instead of a self-managed CA)

Assumption: one private CA per Client VPN endpoint (a natural boundary if each tier's
endpoint is managed/rotated independently), and one client certificate per user plus one
server certificate per endpoint, all falling in the $0.75/certificate tier (1–1,000
certificates/month — nowhere close to the 1,001+ break point at this headcount).

- **Topology (a)** (1 endpoint): 1 CA × $400/month = $400.00, plus certs: 13 client certs +
  1 server cert = 14 certs × $0.75 = $10.50. **ACM Private CA adds ≈ $410.50/month** on top
  of the $157.25/month connection/subnet total above (≈ $567.75/month all-in).
- **Topology (b)** (3 endpoints, one CA per endpoint): 3 CAs × $400/month = $1,200.00, plus
  certs: 13 client certs (split across the 3 endpoints per the assumed tier split, same
  total count) + 3 server certs (one per endpoint) = 16 certs × $0.75 = $12.00. **ACM
  Private CA adds ≈ $1,212.00/month** on top of the $449.25/month total above (≈
  $1,661.25/month all-in).
- **CA-driven delta between topologies:** $1,212.00 − $410.50 = **$801.50/month** more for
  topology (b) if ACM Private CA is used — considerably larger than the $292.00/month
  subnet-association-only delta, because the general-purpose CA's $400/month operation fee
  is itself per-CA and this note assumes one CA per endpoint. (If a single shared CA instead
  issued certificates for all three endpoints — also a valid architecture — this CA-driven
  delta would shrink to just the marginal certificate cost, a few dollars/month, since the
  CA fee itself would not multiply by endpoint count. That alternative assumption is not
  costed out in full here; it is flagged so the ADR's authors can pick the CA topology that
  matches whatever operational boundary they actually want.)

## 4. Tailscale pricing tiers

Tailscale's published per-user/month pricing, quoted from the current pricing page:

| Tier | Price | Access-control limit (page's exact wording) |
|---|---|---|
| Personal | $0 ("Free forever") | "Up to 3 ACL groups" |
| Standard | $8/user/month | "Up to 10 ACL groups" |
| Premium | $18/user/month | "Up to 300 ACL groups" |
| Enterprise | Custom | Not stated as a fixed number ("Custom device quantities and limits") |

The page's own terminology for this limit is literally **"ACL groups"** — not "ACL tests,"
"tags," or another term; that is the exact phrase used under each plan's feature list.

Personal's own stated limit — "Up to 3 ACL groups" — is numerically enough to cover the
ADR's three access tiers (engineering, internal stakeholders, external early-adopter
clients) if each tier maps to exactly one ACL group, but Personal is also capped at "Up to 6
users" total, which is below the ADR's ~13 named users. **Standard** ($8/user/month, "Up to
10 ACL groups," "Unlimited users") is therefore the first tier that comfortably covers both
the 3-tier ACL-group requirement and the ~13-user headcount without hitting either published
limit. Premium ($18/user/month, "Up to 300 ACL groups") also covers the 3-group requirement
with large headroom but is not needed to clear that specific limit — its added
capabilities (just-in-time access, advanced SSH, network flow logs, log streaming, regional
routing/traffic steering, priority support) are separate considerations for the ADR, not
things this note evaluates.

Other quoted limits worth noting for completeness: Personal and Standard both state "1,000
mins per month for ephemeral resources," rising to "10,000 mins per month" on Premium;
Personal separately states "Up to 50 tagged resources to start," with additional tagged
resources priced at "$1/month each" (a Personal-tier detail — Standard/Premium do not
publish an equivalent per-resource add-on price on this page).

Source: [Tailscale pricing](https://tailscale.com/pricing).

At 13 users, Standard's flat per-seat price comes to 13 × $8 = **$104.00/month**; Premium
would be 13 × $18 = **$234.00/month**. Both are flat regardless of how many ACL groups are
actually configured, up to each tier's stated ceiling.

## 5. Which cost driver dominates, and why topology matters more than headcount for Client VPN

For AWS Client VPN, the **persistent per-subnet-association-hour charge dominates the
bill**, not the connection-hour usage charge. In the topology (a) estimate above, the
subnet-association line item ($146.00/month) is roughly 13× the connection-hour line item
(≈$11.25/month) for the same 13 lightly-used named users; in topology (b) that ratio widens
further (≈$438.00/month vs. the same ≈$11.25/month). The subnet-association fee accrues
24/7 for every hour an endpoint exists and is associated with a subnet, regardless of
whether a single client ever connects, while the connection-hour fee only accrues for the
hours a client is actually connected — and this staging environment's usage pattern (13
users, ~4 hours/week each) is inherently light relative to a fee that runs continuously.

This is exactly why **topology choice (the number of Client VPN endpoints, and how many
subnets each is associated with) matters more than headcount** for Client VPN's cost: adding
a fourteenth or fifteenth user barely changes the bill (a few more connection-hours at
$0.05/hour each), but going from one endpoint to three endpoints — with no change in
headcount at all — added $292.00/month in this estimate, purely from four extra always-on
subnet associations. A design decision about *how many access tiers get their own endpoint*
swamps a design decision about *how many people are in each tier*.

**Tailscale's flat per-seat/month pricing has no equivalent dynamic.** Its cost scales only
with user count (13 users × the chosen tier's per-user price), not with how many ACL groups,
tags, or access tiers are configured within that seat count — Standard's "Up to 10 ACL
groups" limit is a ceiling on a feature the plan already includes at the same flat price,
not a per-group cost multiplier. Splitting the same 13 users into three ACL groups instead
of one costs Tailscale customers exactly the same $104.00/month (at Standard) either way,
whereas the equivalent topology decision on Client VPN (one endpoint vs. three) changes the
AWS bill by roughly 3x in this estimate.

## Unverified / could not confirm

- **Whether the $0.10/hour Client VPN fee is formally billed per subnet association versus
  per endpoint.** The only pricing-page text found in this session (the worked example)
  uses a single-subnet scenario, so its "endpoint hourly fee" label and a hypothetical
  "subnet association hourly fee" label are numerically indistinguishable from that example
  alone. This note follows the ADR's own directed assumption (per subnet association) for
  the topology math above, consistent with how multi-subnet Client VPN deployments are
  commonly billed in practice, but this was not confirmed against a second AWS
  primary-source sentence explicitly stating the per-subnet-association billing unit in
  this session. Re-verify against the AWS Client VPN Administrator Guide's billing/pricing
  notes before treating this as settled.
- **Whether a single ACM Private CA can serve multiple Client VPN endpoints at no extra CA
  fee**, versus this note's assumption of one CA per endpoint for topology (b). Both are
  architecturally valid; this note costed the one-CA-per-endpoint assumption because it is
  the more conservative (higher) estimate, and flagged the shared-CA alternative inline in
  section 3 without fully costing it out.
- **ACM Private CA's exact behavior with mixed monthly certificate-issuance rates across
  endpoints** (e.g. whether the 1–1,000/1,001–10,000 tiers are evaluated per CA per Region
  per month, as stated on the pricing page, or pooled some other way) was taken at face
  value from the pricing page's own tier framing and not independently re-verified against
  a second AWS source.

## Sources

- [AWS VPN pricing](https://aws.amazon.com/vpn/pricing/)
- [AWS Private CA pricing](https://aws.amazon.com/private-ca/pricing/)
- [Tailscale pricing](https://tailscale.com/pricing)
- [Amazon EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/) (standard
  data-transfer rates, cited for corroboration per section 1)
