# AWS Organizations for the hosting foundation

Hosting Operations (Trial Orgs today, paid hosting later) runs in its own AWS Organizations
member account ("the Hosting Account"), separate from a Management account that owns billing
and Organization structure only. We chose this over putting everything in the single AWS
account created for the initial $200 credit, even though it's more setup before a single trial
has shipped: this infrastructure is meant to be the foundation for a real hosting business, and
migrating a live customer workload between AWS accounts later is painful (re-provisioning,
DNS cutover, IAM re-wiring) in a way that creating one extra account up front is not. The
Management account stays workload-free so billing/Organization administration is never coupled
to (or put at risk by) anything running in the Hosting Account.

Started minimal: Management + one Hosting Account, not a full multi-OU structure (e.g. no
separate Shared-Services or Log-Archive account yet). Add further accounts/OUs when a concrete
need appears (e.g. a Production-Customers OU when paid hosting launches).

**Update:** a third account, the Platform Account, was added to hold agentic-erp's own
production instance as it migrates off Render — see
[ADR-0015](0015-production-migrates-to-aws-platform-account.md). It is kept separate from the
Hosting Account for the same reason the Hosting Account is separate from Management: disposable,
frequently-created/destroyed trial-org infrastructure should never share an account boundary
with the production application and its data.
