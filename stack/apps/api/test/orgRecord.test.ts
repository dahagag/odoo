import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import {
  ConcurrentWriteError,
  DnsLabelImmutableError,
  DnsLabelInUseError,
  IllegalTransitionError,
  OrgNotFoundError,
} from '../src/org/errors';
import type { Provisioner } from '../src/org/provisioner';
import { StubProvisioner } from '../src/org/provisioner';
import { applyTransition, createOrg, getOrgRecord, updateDnsSubdomainLabel } from '../src/org/record';

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

  it('a Client Org has no expiry date populated', async () => {
    const gateway = new InMemoryAwsGateway();

    const org = await createOrg(gateway, trialInput({ type: 'client', dnsSubdomainLabel: 'acme-client' }), CONFIG);

    expect(org.expiryDate).toBeUndefined();
  });

  it('honors an explicit region override instead of the configured default', async () => {
    const gateway = new InMemoryAwsGateway();

    const org = await createOrg(gateway, trialInput({ region: 'eu-west-1', dnsSubdomainLabel: 'acme-eu' }), CONFIG);

    expect(org.region).toBe('eu-west-1');
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

    await expect(applyTransition(gateway, provisioner, org.orgId, 'issue')).rejects.toThrow('Step Functions is unavailable');

    const afterFailure = await getOrgRecord(gateway, org.orgId);
    expect(afterFailure?.state).toBe('issued');
    expect(afterFailure?.lastJobId).toBeUndefined();
  });

  it('404s for an org that does not exist', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(applyTransition(gateway, new StubProvisioner(), '11111111-1111-4111-8111-111111111111', 'issue'))
      .rejects.toBeInstanceOf(OrgNotFoundError);
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
