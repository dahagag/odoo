import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { AwsProvisioner, ProvisionerConfigError, StartExecutionError, buildProvisioner } from '../src/org/awsProvisioner';
import type { LifecycleOperation } from '../src/org/lifecycleOperation';
import { StubProvisioner } from '../src/org/provisioner';
import { createOrg, getOrgRecord } from '../src/org/record';

const CREATE_CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };

const FULL_CONFIG = {
  stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
  baseAmiId: 'ami-0123456789abcdef0',
  tofuModuleGitSha: 'abc123def',
  dnsDomainSuffix: 'orgs.example',
};

const operation = (id: string): LifecycleOperation => ({ id: `lop_${id}` });

async function makeOrg(gateway: InMemoryAwsGateway) {
  return createOrg(gateway, {
    type: 'trial',
    name: 'Acme Evaluation',
    domain: 'acme.example',
    seatsTotal: 25,
    dnsSubdomainLabel: 'acme-eval',
  }, CREATE_CONFIG);
}

describe('AwsProvisioner (#280)', () => {
  it('requires a stateMachineArn to construct at all', () => {
    const gateway = new InMemoryAwsGateway();
    expect(() => new AwsProvisioner(gateway, { ...FULL_CONFIG, stateMachineArn: '' }))
      .toThrow(ProvisionerConfigError);
  });

  describe('issue', () => {
    it('starts an execution with the expected name/input, stages pending version fields, and records the execution ARN - leaving audit fields untouched', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
      const lifecycleOperation = operation('issue-1');

      await provisioner.issue(org, lifecycleOperation);

      const [[executionArn, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(executionArn).toContain(lifecycleOperation.id);
      expect(execution.input).toEqual({
        orgId: org.orgId,
        operationId: lifecycleOperation.id,
        action: 'issue',
        amiId: FULL_CONFIG.baseAmiId,
        tofuModuleGitSha: FULL_CONFIG.tofuModuleGitSha,
        dnsRecordName: `acme-eval.${FULL_CONFIG.dnsDomainSuffix}`,
      });

      const updated = await getOrgRecord(gateway, org.orgId);
      expect(updated?.pendingAmiId).toBe(FULL_CONFIG.baseAmiId);
      expect(updated?.pendingTofuModuleGitSha).toBe(FULL_CONFIG.tofuModuleGitSha);
      expect(updated?.lastExecutionArn).toBe(executionArn);
      expect(updated?.amiId).toBeUndefined();
      expect(updated?.tofuModuleGitSha).toBeUndefined();
    });

    it.each([
      ['baseAmiId', { ...FULL_CONFIG, baseAmiId: undefined }],
      ['tofuModuleGitSha', { ...FULL_CONFIG, tofuModuleGitSha: undefined }],
      ['dnsDomainSuffix', { ...FULL_CONFIG, dnsDomainSuffix: undefined }],
    ])('fails fast without calling AWS when %s is not configured', async (_name, config) => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, config);

      await expect(provisioner.issue(org, operation('missing-config'))).rejects.toBeInstanceOf(ProvisionerConfigError);

      expect(gateway.stepFunctions.executions.size).toBe(0);
      expect((await getOrgRecord(gateway, org.orgId))?.pendingAmiId).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('includes the DNS record name, the recorded deployment version, and the snapshot retention window', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      await gateway.dynamoDb.updateItem({
        table: 'orgs',
        key: { pk: `org#${org.orgId}` },
        set: { amiId: 'ami-recorded', tofuModuleGitSha: 'recorded-sha' },
      });
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await provisioner.destroy((await getOrgRecord(gateway, org.orgId))!, operation('destroy-1'));

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toEqual({
        orgId: org.orgId,
        operationId: 'lop_destroy-1',
        action: 'destroy',
        amiId: 'ami-recorded',
        tofuModuleGitSha: 'recorded-sha',
        dnsRecordName: `acme-eval.${FULL_CONFIG.dnsDomainSuffix}`,
        snapshotRetentionDays: 7,
      });
    });

    it('falls back to the pending deployment version when nothing has been recorded yet', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      await gateway.dynamoDb.updateItem({
        table: 'orgs',
        key: { pk: `org#${org.orgId}` },
        set: { pendingAmiId: 'ami-pending', pendingTofuModuleGitSha: 'pending-sha' },
      });
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await provisioner.destroy((await getOrgRecord(gateway, org.orgId))!, operation('destroy-pending'));

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toMatchObject({ amiId: 'ami-pending', tofuModuleGitSha: 'pending-sha' });
    });

    it('fails fast without calling AWS when no deployment version has ever been recorded (an org issued under StubProvisioner)', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await expect(provisioner.destroy(org, operation('destroy-missing-version'))).rejects.toBeInstanceOf(ProvisionerConfigError);

      expect(gateway.stepFunctions.executions.size).toBe(0);
    });
  });

  describe('suspend/wake', () => {
    it.each(['suspend', 'wake'] as const)('%s omits deployment-version fields and carries the instance id', async (action) => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      await gateway.dynamoDb.updateItem({
        table: 'orgs',
        key: { pk: `org#${org.orgId}` },
        set: { instanceId: 'i-0123456789abcdef0' },
      });
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await provisioner[action]((await getOrgRecord(gateway, org.orgId))!, operation(`${action}-1`));

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toEqual({
        orgId: org.orgId,
        operationId: `lop_${action}-1`,
        action,
        instanceId: 'i-0123456789abcdef0',
      });
    });

    it.each(['suspend', 'wake'] as const)('%s fails fast without calling AWS when no instance id has been recorded', async (action) => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await expect(provisioner[action](org, operation(`${action}-missing-instance`))).rejects.toBeInstanceOf(ProvisionerConfigError);
      expect(gateway.stepFunctions.executions.size).toBe(0);
    });
  });

  describe('StartExecution retry safety', () => {
    it('treats a running execution collision as a successful retry rather than an error', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      const lifecycleOperation = operation('same-request');
      await provisioner.issue(org, lifecycleOperation);
      const firstArn = (await getOrgRecord(gateway, org.orgId))?.lastExecutionArn;

      // A reclaimed leader has the same stable execution name and attaches to the in-flight run.
      await expect(provisioner.issue(org, lifecycleOperation)).resolves.toBeUndefined();

      expect(gateway.stepFunctions.executions.size).toBe(1);
      expect((await getOrgRecord(gateway, org.orgId))?.lastExecutionArn).toBe(firstArn);
    });

    it('treats a succeeded execution collision as the completed same operation', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
      const lifecycleOperation = operation('already-succeeded');
      await provisioner.issue(org, lifecycleOperation);
      const [[executionArn]] = [...gateway.stepFunctions.executions.entries()];
      gateway.completeExecution(executionArn, 'SUCCEEDED');

      await expect(provisioner.issue(org, lifecycleOperation)).resolves.toBeUndefined();
      expect(gateway.stepFunctions.executions.size).toBe(1);
    });

    it('surfaces any other StartExecution failure as a clear, actionable error', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
      gateway.stepFunctions.startExecution = async () => { throw new Error('Step Functions is unavailable'); };

      const error = await provisioner.issue(org, operation('start-failure')).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(StartExecutionError);
      expect((error as Error).message).toMatch('Step Functions is unavailable');
    });

    it('reuses the first writer\'s immutable snapshot when configuration changes before a reclaim', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const lifecycleOperation = operation('frozen-input');
      const first = new AwsProvisioner(gateway, FULL_CONFIG);
      await first.issue(org, lifecycleOperation);

      const changed = new AwsProvisioner(gateway, {
        ...FULL_CONFIG,
        baseAmiId: 'ami-changed-after-first-write',
        tofuModuleGitSha: 'changed-sha',
        dnsDomainSuffix: 'changed.example',
      });
      await changed.issue(org, lifecycleOperation);

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toMatchObject({
        operationId: lifecycleOperation.id,
        amiId: FULL_CONFIG.baseAmiId,
        tofuModuleGitSha: FULL_CONFIG.tofuModuleGitSha,
        dnsRecordName: `acme-eval.${FULL_CONFIG.dnsDomainSuffix}`,
      });
      const snapshot = await gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: `lifecycle-operation#${lifecycleOperation.id}` } });
      expect(snapshot?.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60));
    });

    it('does not attach a reclaimed request to a failed execution', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
      const lifecycleOperation = operation('failed-run');
      await provisioner.issue(org, lifecycleOperation);
      const [[executionArn]] = [...gateway.stepFunctions.executions.entries()];
      gateway.completeExecution(executionArn, 'FAILED');

      await expect(provisioner.issue(org, lifecycleOperation)).rejects.toBeInstanceOf(StartExecutionError);
      expect(gateway.stepFunctions.executions.size).toBe(1);
    });
  });
});

describe('buildProvisioner (#280)', () => {
  it('stays on StubProvisioner when no state machine ARN is configured, unchanged from #278', () => {
    const gateway = new InMemoryAwsGateway();
    const provisioner = buildProvisioner(loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), gateway);
    expect(provisioner).toBeInstanceOf(StubProvisioner);
  });

  it('switches every org to AwsProvisioner once a state machine ARN is configured', () => {
    const gateway = new InMemoryAwsGateway();
    const provisioner = buildProvisioner(loadEnv({
      NODE_ENV: 'test',
      STEP_FUNCTIONS_STATE_MACHINE_ARN: FULL_CONFIG.stateMachineArn,
    } as unknown as NodeJS.ProcessEnv), gateway);
    expect(provisioner).toBeInstanceOf(AwsProvisioner);
  });
});
