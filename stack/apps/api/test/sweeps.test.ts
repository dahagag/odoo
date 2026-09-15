import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { applyTransition, createOrg, getOrgRecord, ORGS_TABLE, orgPk } from '../src/org/record';
import { StubProvisioner } from '../src/org/provisioner';
import { sweepAutoDestroy, sweepIdleSuspend } from '../src/org/sweeps';

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

/** Backdates `orgId`'s `lastActivityAt` directly - the sweep itself never lets time pass, so a
 * test simulates an idle org this way rather than actually waiting out `IDLE_TIMEOUT_MINUTES`. */
async function backdateActivity(gateway: InMemoryAwsGateway, orgId: string, minutesAgo: number) {
  await gateway.dynamoDb.updateItem({
    table: ORGS_TABLE,
    key: { pk: orgPk(orgId) },
    set: { lastActivityAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() },
  });
}

describe('sweepIdleSuspend (#282: idle-suspend sweep)', () => {
  it('leaves an active org with recent activity alone', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    const result = await sweepIdleSuspend(gateway, new StubProvisioner(), { idleTimeoutMinutes: 30 });

    expect(result).toEqual({ action: 'suspend', orgIds: [] });
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'active' });
  });

  it('suspends an active org idle past the timeout', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    await backdateActivity(gateway, org.orgId, 45);

    const result = await sweepIdleSuspend(gateway, new StubProvisioner(), { idleTimeoutMinutes: 30 });

    expect(result).toEqual({ action: 'suspend', orgIds: [org.orgId] });
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'suspended' });
  });

  it.each(['issued', 'suspended', 'destroyed'] as const)('ignores a non-active org (%s)', async (targetState) => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    const provisioner = new StubProvisioner();
    if (targetState !== 'issued') await applyTransition(gateway, provisioner, org.orgId, 'issue');
    if (targetState === 'suspended' || targetState === 'destroyed') await applyTransition(gateway, provisioner, org.orgId, 'suspend');
    if (targetState === 'destroyed') await applyTransition(gateway, provisioner, org.orgId, 'destroy');

    const result = await sweepIdleSuspend(gateway, provisioner, { idleTimeoutMinutes: 30 });

    expect(result.orgIds).toEqual([]);
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: targetState });
  });

  it('never wakes a suspended org - only the explicit wake action does', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'suspend');

    await sweepIdleSuspend(gateway, provisioner, { idleTimeoutMinutes: 30 });

    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'suspended' });
  });

  it('tolerates an org that raced away from active between the query and the transition', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await backdateActivity(gateway, org.orgId, 45);
    // Races the org out of 'active' between sweepIdleSuspend's query and its own applyTransition
    // call, simulated the same way the concurrency tests in orgRecord.test.ts do: mutate state
    // directly, out from under the sweep.
    await gateway.dynamoDb.updateItem({ table: ORGS_TABLE, key: { pk: orgPk(org.orgId) }, set: { state: 'suspended' } });

    await expect(sweepIdleSuspend(gateway, provisioner, { idleTimeoutMinutes: 30 })).resolves.toEqual({ action: 'suspend', orgIds: [] });
  });
});

describe('sweepAutoDestroy (#282: auto-destroy sweep)', () => {
  async function pastExpiryTrialOrg(gateway: InMemoryAwsGateway) {
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await gateway.dynamoDb.updateItem({
      table: ORGS_TABLE,
      key: { pk: orgPk(org.orgId) },
      set: { expiryDate: new Date(Date.now() - 60_000).toISOString(), gsi2sk: new Date(Date.now() - 60_000).toISOString() },
    });
    return org;
  }

  it('leaves an unexpired org alone', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput(), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    const result = await sweepAutoDestroy(gateway, new StubProvisioner());

    expect(result).toEqual({ action: 'destroy', orgIds: [] });
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'active' });
  });

  it('destroys an active Trial Org past its expiry date, setting the snapshot-retention marker', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await pastExpiryTrialOrg(gateway);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');

    const result = await sweepAutoDestroy(gateway, new StubProvisioner());

    expect(result).toEqual({ action: 'destroy', orgIds: [org.orgId] });
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'destroyed' });
    const after = await getOrgRecord(gateway, org.orgId);
    expect(after?.snapshotRetentionUntil).toBeDefined();
  });

  it('destroys a suspended Trial Org past its expiry date', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await pastExpiryTrialOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'suspend');

    const result = await sweepAutoDestroy(gateway, provisioner);

    expect(result).toEqual({ action: 'destroy', orgIds: [org.orgId] });
  });

  it('ignores an issued (never provisioned) org past its expiry date', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await pastExpiryTrialOrg(gateway);

    const result = await sweepAutoDestroy(gateway, new StubProvisioner());

    expect(result).toEqual({ action: 'destroy', orgIds: [] });
    await expect(getOrgRecord(gateway, org.orgId)).resolves.toMatchObject({ state: 'issued' });
  });

  it('never selects a Client Org, regardless of any date field it carries', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await createOrg(gateway, trialInput({ type: 'client', dnsSubdomainLabel: 'acme-client' }), CONFIG);
    await applyTransition(gateway, new StubProvisioner(), org.orgId, 'issue');
    // A Client Org carries no expiryDate at all - even writing an arbitrary date-shaped field
    // directly onto the record must not make it a candidate, since the sweep's own query never
    // conditions on `expiryDate` itself, only on the `gsi2sk` attribute `createOrg`/
    // `applyTransition` never write for a Client Org in the first place.
    await gateway.dynamoDb.updateItem({ table: ORGS_TABLE, key: { pk: orgPk(org.orgId) }, set: { someOtherDateField: '2000-01-01T00:00:00.000Z' } });

    const result = await sweepAutoDestroy(gateway, new StubProvisioner());

    expect(result).toEqual({ action: 'destroy', orgIds: [] });
  });

  it('tolerates an org that raced to destroyed already between the query and the transition', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await pastExpiryTrialOrg(gateway);
    const provisioner = new StubProvisioner();
    await applyTransition(gateway, provisioner, org.orgId, 'issue');
    await applyTransition(gateway, provisioner, org.orgId, 'destroy');

    await expect(sweepAutoDestroy(gateway, provisioner)).resolves.toEqual({ action: 'destroy', orgIds: [] });
  });
});
