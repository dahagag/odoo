import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  ExpiryNotSupportedError,
  IllegalTransitionError,
  InvalidDnsLabelError,
  OrgNotFoundError,
  ProvisionerFailedError,
} from '../src/org/errors';
import type { Provisioner } from '../src/org/provisioner';
import { StubProvisioner } from '../src/org/provisioner';
import {
  applyTransition,
  checkOrgStatus,
  createOrg,
  EXPIRY_SWEEP_INDEX,
  EXPIRY_SWEEP_PARTITION,
  extendOrgExpiry,
  getOrgRecord,
  orgPk,
  ORGS_TABLE,
  queryOrgIds,
  STATE_INDEX,
  statePartition,
  updateDnsSubdomainLabel,
} from '../src/org/record';

const CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };

function trialInput(overrides: Partial<Parameters<typeof createOrg>[1]> = {}) {
  return {
    type: 'trial' as const,
    name: 'Acme Evaluation',
    domain: 'acme.example',
    seatsTotal: 25,
    dnsSubdomainLabel: 'acme-eval',
    ...overrides,
  };
}

/** Captures every call it receives, and lets a test make one action reject on demand - used for
 * the "provisioner failure prevents the state change entirely" and "distinct job ids" Acceptance
 * Criteria without needing real AWS. */
class SpyProvisioner implements Provisioner {
  readonly calls: { action: string; orgId: string; jobId: string }[] = [];
  failing: Partial<Record<'issue' | 'suspend' | 'wake' | 'destroy', Error>> = {};

  private async record(action: 'issue' | 'suspend' | 'wake' | 'destroy', org: { orgId: string }, jobId: string): Promise<void> {
    this.calls.push({ action, orgId: org.orgId, jobId });
    const failure = this.failing[action];
    if (failure) throw failure;
  }

  issue(org: { orgId: string }, jobId: string) { return this.record('issue', org, jobId); }
  suspend(org: { orgId: string }, jobId: string) { return this.record('suspend', org, jobId); }
  wake(org: { orgId: string }, jobId: string) { return this.record('wake', org, jobId); }
  destroy(org: { orgId: string }, jobId: string) { return this.record('destroy', org, jobId); }
  async checkStatus(): Promise<void> {}
  async getAuditTrail(): Promise<import('../src/org/provisioner').AuditTrail> {
    return { available: false };
  }
}

describe('createOrg (this ticket\'s Acceptance Criteria)', () => {
  it('creates a Trial Org in the issued state with a defaulted region, unique label, and blank deployment fields', async () => {
    const gateway = new InMemoryAwsGateway();

    const org = await createOrg(gateway, trialInput(), CONFIG);

    expect(org.state).toBe('issued');
    expect(org.type).toBe('trial');
    expect(org.region).toBe('us-east-1');
    expect(org.dnsSubdomainLabel).toBe('acme-eval');
    expect(org.amiId).toBeUndefined();
    expect(org.tofuModuleGitSha).toBeUndefined();
    expect(org.pendingAmiId).toBeUndefined();
    expect(org.pendingTofuModuleGitSha).toBeUndefined();
    expect(org.seatsUsed).toBe(0);
    expect(org.expiryDate).toBeDefined();

    await expect(getOrgRecord(gateway, org.orgId)).resolves.toEqual(org);
  });

  it('defaults a stored record with no inviteType attribute to targeted, for an org created before that field existed (CodeRabbit, PR #296)', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    // Simulates an org record written by an earlier `createOrg` that never wrote `inviteType` at
    // all - not something `createOrg` itself can produce today, so it's written directly.
    const stored = (await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: orgPk(org.orgId) } }))!;
    const { inviteType: _inviteType, ...withoutInviteType } = stored;
    await gateway.dynamoDb.putItem({ table: ORGS_TABLE, item: withoutInviteType });

    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ inviteType: 'targeted' });
  });

  it('a Client Org has no expiry date populated', async () => {
    const gateway = new InMemoryAwsGateway();

    const org = await createOrg(gateway, trialInput({ type: 'client', dnsSubdomainLabel: 'acme-client' }), CONFIG);

    expect(org.expiryDate).toBeUndefined();
  });

  it('rejects a second org with an already-used dnsSubdomainLabel', async () => {
    const gateway = new InMemoryAwsGateway();
    await createOrg(gateway, trialInput(), CONFIG);

    await expect(createOrg(gateway, trialInput({ domain: 'other.example' }), CONFIG))
      .rejects.toBeInstanceOf(DnsLabelInUseError);
  });

  it('never lets two concurrent creations with the same dnsSubdomainLabel both succeed', async () => {
    const gateway = new InMemoryAwsGateway();

    const results = await Promise.allSettled([
      createOrg(gateway, trialInput({ domain: 'first.example' }), CONFIG),
      createOrg(gateway, trialInput({ domain: 'second.example' }), CONFIG),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DnsLabelInUseError);
  });

  it('derives dnsSubdomainLabel from name when omitted (#303, matching _slugify_dns_label)', async () => {
    const gateway = new InMemoryAwsGateway();
    const { dnsSubdomainLabel: _dnsSubdomainLabel, ...input } = trialInput({ name: 'Acme! Evaluation Org' });

    const org = await createOrg(gateway, input, CONFIG);

    expect(org.dnsSubdomainLabel).toBe('acme-evaluation-org');
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ dnsSubdomainLabel: 'acme-evaluation-org' });
  });

  it('uses an explicitly supplied dnsSubdomainLabel as-is rather than deriving one', async () => {
    const gateway = new InMemoryAwsGateway();

    const org = await createOrg(gateway, trialInput({ name: 'Acme Evaluation', dnsSubdomainLabel: 'custom-label' }), CONFIG);

    expect(org.dnsSubdomainLabel).toBe('custom-label');
  });

  it('runs an auto-derived label through the same uniqueness-reservation transaction as an explicit one', async () => {
    const gateway = new InMemoryAwsGateway();
    await createOrg(gateway, trialInput({ dnsSubdomainLabel: 'acme-evaluation-org', domain: 'first.example' }), CONFIG);
    const { dnsSubdomainLabel: _dnsSubdomainLabel, ...input } = trialInput({ name: 'Acme Evaluation Org', domain: 'second.example' });

    await expect(createOrg(gateway, input, CONFIG)).rejects.toBeInstanceOf(DnsLabelInUseError);
  });

  it('rejects a punctuation-only name that slugifies to an invalid label, rather than writing an empty dnsSubdomainLabel', async () => {
    const gateway = new InMemoryAwsGateway();
    const { dnsSubdomainLabel: _dnsSubdomainLabel, ...input } = trialInput({ name: '!!!' });

    await expect(createOrg(gateway, input, CONFIG)).rejects.toBeInstanceOf(InvalidDnsLabelError);
  });
});

describe('updateDnsSubdomainLabel (this ticket\'s Acceptance Criteria)', () => {
  it('allows the label to change while issued', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);

    const updated = await updateDnsSubdomainLabel(gateway, org.orgId, 'acme-relabeled');

    expect(updated.dnsSubdomainLabel).toBe('acme-relabeled');
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ dnsSubdomainLabel: 'acme-relabeled' });
    // the old label reservation is released, so it's free for another org to claim.
    await expect(createOrg(gateway, trialInput({ dnsSubdomainLabel: 'acme-eval', domain: 'reuse.example' }), CONFIG))
      .resolves.toMatchObject({ dnsSubdomainLabel: 'acme-eval' });
  });

  it('rejects a change once the org has left issued', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    await expect(updateDnsSubdomainLabel(gateway, org.orgId, 'acme-relabeled'))
      .rejects.toBeInstanceOf(DnsLabelImmutableError);
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ dnsSubdomainLabel: 'acme-eval' });
  });

  it('rejects a change to a label already in use by another org', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await createOrg(gateway, trialInput({ dnsSubdomainLabel: 'taken', domain: 'other.example' }), CONFIG);

    await expect(updateDnsSubdomainLabel(gateway, org.orgId, 'taken')).rejects.toBeInstanceOf(DnsLabelInUseError);
  });

  it('404s for an org that does not exist', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(updateDnsSubdomainLabel(gateway, '11111111-1111-4111-8111-111111111111', 'x'))
      .rejects.toBeInstanceOf(OrgNotFoundError);
  });
});

describe('extendOrgExpiry (#312)', () => {
  it('pushes expiryDate out by additionalDays from its current value', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);

    const extended = await extendOrgExpiry(gateway, org.orgId, 5);

    const expected = new Date(new Date(org.expiryDate!).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(extended.expiryDate).toBe(expected);
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ expiryDate: expected });
  });

  it('rejects a Client Org, which has no expiryDate to extend', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, { type: 'client', name: 'Acme Client', domain: 'acme.example', seatsTotal: 25 }, CONFIG);

    await expect(extendOrgExpiry(gateway, org.orgId, 5)).rejects.toBeInstanceOf(ExpiryNotSupportedError);
  });

  it('falls back to now for a Trial Org whose expiryDate is somehow blank', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    // Simulate a pre-existing record from before expiryDate always got set (fromItem's own
    // inviteType-defaulting precedent) rather than one createOrg could ever produce today -
    // putItem a full replacement item with no expiryDate/gsi2sk attribute at all.
    const { expiryDate: _drop, ...withoutExpiry } = org;
    await gateway.dynamoDb.putItem({
      table: ORGS_TABLE,
      item: { pk: orgPk(org.orgId), ...withoutExpiry, gsi1pk: statePartition(org.state), gsi1sk: orgPk(org.orgId) },
    });

    const before = Date.now();
    const extended = await extendOrgExpiry(gateway, org.orgId, 5);
    const expiry = new Date(extended.expiryDate!).getTime();

    expect(expiry).toBeGreaterThan(before + 4 * 24 * 60 * 60 * 1000);
    expect(expiry).toBeLessThan(before + 6 * 24 * 60 * 60 * 1000);
  });

  it('404s for an org that does not exist', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(extendOrgExpiry(gateway, '11111111-1111-4111-8111-111111111111', 5))
      .rejects.toBeInstanceOf(OrgNotFoundError);
  });

  it('two genuinely concurrent extends on the same org both land - no lost update', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);

    const results = await Promise.allSettled([
      extendOrgExpiry(gateway, org.orgId, 3),
      extendOrgExpiry(gateway, org.orgId, 7),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const expected = new Date(new Date(org.expiryDate!).getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ expiryDate: expected });
  });
});

describe('applyTransition (this ticket\'s What to build/Acceptance Criteria)', () => {
  async function issuedOrg(gateway: InMemoryAwsGateway) {
    return createOrg(gateway, trialInput(), CONFIG);
  }

  it('issue moves issued -> active and calls the provisioner with a freshly minted job id', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new SpyProvisioner();

    const result = await applyTransition(gateway, provisioner, org.orgId, 'issue');

    expect(result.state).toBe('active');
    expect(provisioner.calls).toEqual([{ action: 'issue', orgId: org.orgId, jobId: result.lastJobId }]);
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'active', lastJobId: result.lastJobId });
  });

  it('writes lastJobStatus: running (and clears lastJobError) in the same call as the new state (ADR-0019, #281)', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    await gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { lastJobStatus: 'failed', lastJobError: 'stale failure from a previous job' },
    });

    const result = await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    expect(result.lastJobStatus).toBe('running');
    expect(result.lastJobError).toBe('');
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ lastJobStatus: 'running', lastJobError: '' });
  });

  it('runs the full lifecycle: issued -> active -> suspended -> active -> destroyed', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();

    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('active');

    await applyTransition(gateway, provisioner, org.orgId, 'suspend');
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('suspended');

    await applyTransition(gateway, provisioner, org.orgId, 'wake');
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('active');

    await applyTransition(gateway, provisioner, org.orgId, 'destroy');
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('destroyed');
  });

  it('destroy is legal directly from suspended too', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'suspend');

    await applyTransition(gateway, provisioner, org.orgId, 'destroy');

    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('destroyed');
  });

  it('two calls to the same action mint distinct job ids', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new SpyProvisioner();

    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'suspend');
    await applyTransition(gateway, provisioner, org.orgId, 'wake');

    const jobIds = provisioner.calls.map((call) => call.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
  });

  it.each([
    ['suspend', 'issued'],
    ['wake', 'issued'],
    ['destroy', 'issued'],
    ['wake', 'active'],
    ['issue', 'active'],
  ] as const)('rejects %s from %s, leaving state unchanged', async (action, _startState) => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    if (_startState === 'active') await applyTransition(gateway, provisioner, org.orgId, 'issue');

    const before = await getOrgRecord(gateway, org.orgId);
    await expect(applyTransition(gateway, provisioner, org.orgId, action)).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toEqual(before);
  });

  it('rejects every action once destroyed', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'destroy');

    for (const action of ['issue', 'suspend', 'wake', 'destroy'] as const) {
      await expect(applyTransition(gateway, provisioner, org.orgId, action)).rejects.toBeInstanceOf(IllegalTransitionError);
    }
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('destroyed');
  });

  it('a provisioner failure prevents the state change entirely - no partial write', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new SpyProvisioner();
    provisioner.failing.issue = new Error('Step Functions is unavailable');

    const error = await applyTransition(gateway, provisioner, org.orgId, 'issue').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProvisionerFailedError);
    expect((error as Error).message).toMatch('Step Functions is unavailable');

    const afterFailure = await getOrgRecord(gateway, org.orgId);
    expect(afterFailure?.state).toBe('issued');
    expect(afterFailure?.lastJobId).toBeUndefined();
  });

  it('404s for an org that does not exist', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(applyTransition(gateway, new StubProvisioner(), '11111111-1111-4111-8111-111111111111', 'issue'))
      .rejects.toBeInstanceOf(OrgNotFoundError);
  });

  it('a failure in the final DynamoDB write (after the provisioner already succeeded) is never mistaken for a provisioner failure', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    const infraFailure = new Error('DynamoDB is throttling this table');
    gateway.dynamoDb.updateItem = async () => { throw infraFailure; };

    const error = await applyTransition(gateway, provisioner, org.orgId, 'issue').catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(ProvisionerFailedError);
    expect(error).toBe(infraFailure);
  });

  it('two genuinely concurrent identical transitions on the same org resolve to exactly one winner', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');

    const results = await Promise.allSettled([
      applyTransition(gateway, provisioner, org.orgId, 'suspend'),
      applyTransition(gateway, provisioner, org.orgId, 'suspend'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrentWriteError);
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('suspended');
  });

  it('issue and wake both (re)start the idle-timeout clock by setting lastActivityAt (#282)', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();

    const afterIssue = await applyTransition(gateway, provisioner, org.orgId, 'issue');
    expect(afterIssue.lastActivityAt).toBeDefined();

    await applyTransition(gateway, provisioner, org.orgId, 'suspend');
    const afterWake = await applyTransition(gateway, provisioner, org.orgId, 'wake');
    expect(afterWake.lastActivityAt).toBeDefined();
  });

  it('destroy always sets a snapshot-retention marker, whatever triggered it (#282: "every destroy ... leaves the org with a snapshot-retention marker set")', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');

    const result = await applyTransition(gateway, provisioner, org.orgId, 'destroy');

    expect(result.snapshotRetentionUntil).toBeDefined();
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ snapshotRetentionUntil: result.snapshotRetentionUntil });
  });

  it('two different concurrent transitions fired from active (suspend and destroy) never corrupt the record - the persisted state always ends up destroyed', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await issuedOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');

    const results = await Promise.allSettled([
      applyTransition(gateway, provisioner, org.orgId, 'suspend'),
      applyTransition(gateway, provisioner, org.orgId, 'destroy'),
    ]);

    // Either interleaving is legal (suspend-then-destroy both apply; or destroy wins outright
    // and suspend is rejected once it can no longer see a legal source state) - what must never
    // happen is an invalid state or both calls silently reporting success against a stale write.
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConcurrentWriteError);
    }
    expect((await getOrgRecord(gateway, org.orgId))?.state).toBe('destroyed');
  });
});

describe('checkOrgStatus (#298: production entry point for Provisioner.checkStatus)', () => {
  /** Stands in for `AwsProvisioner.checkStatus` (#281) without any real AWS: records that it was
   * called, and - like the real implementation - writes whatever terminal outcome the test
   * configures directly onto the record, so `checkOrgStatus`'s own re-read is what a caller
   * actually observes. */
  class FakeCheckStatusProvisioner extends StubProvisioner {
    readonly calls: string[] = [];
    outcome: Record<string, unknown> = {};

    override async checkStatus(org: { orgId: string }): Promise<void> {
      this.calls.push(org.orgId);
      if (Object.keys(this.outcome).length === 0) return;
      await gatewayRef!.dynamoDb.updateItem({ table: ORGS_TABLE, key: { pk: orgPk(org.orgId) }, set: this.outcome });
    }
  }
  let gatewayRef: InMemoryAwsGateway | undefined;

  it('invokes checkStatus for the org and returns the promoted record on success', async () => {
    const gateway = new InMemoryAwsGateway();
    gatewayRef = gateway;
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    const provisioner = new FakeCheckStatusProvisioner();
    provisioner.outcome = { lastJobStatus: 'succeeded', lastJobError: '' };

    const result = await checkOrgStatus(gateway, provisioner, org.orgId);

    expect(provisioner.calls).toEqual([org.orgId]);
    expect(result.lastJobStatus).toBe('succeeded');
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ lastJobStatus: 'succeeded' });
  });

  it('invokes checkStatus for the org and returns the failure reason on failure', async () => {
    const gateway = new InMemoryAwsGateway();
    gatewayRef = gateway;
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    const provisioner = new FakeCheckStatusProvisioner();
    provisioner.outcome = { lastJobStatus: 'failed', lastJobError: 'States.Timeout' };

    const result = await checkOrgStatus(gateway, provisioner, org.orgId);

    expect(result.lastJobStatus).toBe('failed');
    expect(result.lastJobError).toBe('States.Timeout');
  });

  it('is a safe no-op for an org with no running job', async () => {
    const gateway = new InMemoryAwsGateway();
    gatewayRef = gateway;
    const org = await createOrg(gateway, trialInput(), CONFIG);
    const provisioner = new FakeCheckStatusProvisioner();

    const result = await checkOrgStatus(gateway, provisioner, org.orgId);

    expect(provisioner.calls).toEqual([org.orgId]);
    expect(result.state).toBe('issued');
  });

  it('404s for an org that does not exist', async () => {
    const gateway = new InMemoryAwsGateway();
    gatewayRef = gateway;
    await expect(checkOrgStatus(gateway, new StubProvisioner(), '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(OrgNotFoundError);
  });

  it('re-reads with a strongly consistent read, so a stale eventually-consistent read can never mask the promotion (CodeRabbit, PR #299)', async () => {
    const gateway = new InMemoryAwsGateway();
    gatewayRef = gateway;
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    const provisioner = new FakeCheckStatusProvisioner();
    provisioner.outcome = { lastJobStatus: 'succeeded', lastJobError: '' };
    const calls: (boolean | undefined)[] = [];
    const originalGetItem = gateway.dynamoDb.getItem.bind(gateway.dynamoDb);
    gateway.dynamoDb.getItem = async (input) => {
      calls.push(input.consistentRead);
      return originalGetItem(input);
    };

    await checkOrgStatus(gateway, provisioner, org.orgId);

    // The first read (before checkStatus runs) needs no such guarantee - only the re-read after
    // the provisioner's own write does.
    expect(calls).toEqual([undefined, true]);
  });
});

describe('GSI attributes queryOrgIds relies on (#282: "a small, additive extension to the record store\'s query capability")', () => {
  it('createOrg indexes a Trial Org under both STATE_INDEX and EXPIRY_SWEEP_INDEX', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);

    await expect(queryOrgIds(gateway, { indexName: STATE_INDEX, partitionKey: { name: 'gsi1pk', value: statePartition('issued') } }))
      .resolves.toEqual([org.orgId]);
    await expect(queryOrgIds(gateway, {
      indexName: EXPIRY_SWEEP_INDEX,
      partitionKey: { name: 'gsi2pk', value: EXPIRY_SWEEP_PARTITION },
      sortKeyAtMost: { name: 'gsi2sk', value: org.expiryDate },
    })).resolves.toEqual([org.orgId]);
  });

  it('createOrg never indexes a Client Org under EXPIRY_SWEEP_INDEX, even for a query far enough in the future to catch anything', async () => {
    const gateway = new InMemoryAwsGateway();
    await createOrg(gateway, trialInput({ type: 'client', dnsSubdomainLabel: 'acme-client' }), CONFIG);

    await expect(queryOrgIds(gateway, {
      indexName: EXPIRY_SWEEP_INDEX,
      partitionKey: { name: 'gsi2pk', value: EXPIRY_SWEEP_PARTITION },
      sortKeyAtMost: { name: 'gsi2sk', value: '9999-01-01T00:00:00.000Z' },
    })).resolves.toEqual([]);
  });

  it('applyTransition moves the org between STATE_INDEX partitions as its state changes', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    await expect(queryOrgIds(gateway, { indexName: STATE_INDEX, partitionKey: { name: 'gsi1pk', value: statePartition('issued') } }))
      .resolves.toEqual([]);
    await expect(queryOrgIds(gateway, { indexName: STATE_INDEX, partitionKey: { name: 'gsi1pk', value: statePartition('active') } }))
      .resolves.toEqual([org.orgId]);
  });

  it('getOrgRecord never leaks a gsi* attribute into the returned OrgRecord', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);

    const stored = await getOrgRecord(gateway, org.orgId);

    expect(Object.keys(stored ?? {}).some((key) => key.startsWith('gsi'))).toBe(false);
  });
});
