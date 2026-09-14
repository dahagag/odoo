import { InMemoryAwsGateway } from '@stack/aws-gateway';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { AwsProvisioner, ProvisionerConfigError, StartExecutionError, buildProvisioner } from '../src/org/awsProvisioner';
import { StubProvisioner } from '../src/org/provisioner';
import { createOrg, getOrgRecord } from '../src/org/record';

const CREATE_CONFIG = { defaultRegion: 'us-east-1', trialDurationDays: 14 };

const FULL_CONFIG = {
  stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:org-lifecycle',
  baseAmiId: 'ami-0123456789abcdef0',
  tofuModuleGitSha: 'abc123def',
  dnsDomainSuffix: 'orgs.example',
};

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
      const jobId = 'job-1';

      await provisioner.issue(org, jobId);

      const [[executionArn, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(executionArn).toContain(`org-${org.orgId}-${jobId}`);
      expect(execution.input).toEqual({
        orgId: org.orgId,
        jobId,
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

      await expect(provisioner.issue(org, 'job-1')).rejects.toBeInstanceOf(ProvisionerConfigError);

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

      await provisioner.destroy((await getOrgRecord(gateway, org.orgId))!, 'job-2');

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toEqual({
        orgId: org.orgId,
        jobId: 'job-2',
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

      await provisioner.destroy((await getOrgRecord(gateway, org.orgId))!, 'job-3');

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toMatchObject({ amiId: 'ami-pending', tofuModuleGitSha: 'pending-sha' });
    });

    it('fails fast without calling AWS when no deployment version has ever been recorded (an org issued under StubProvisioner)', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await expect(provisioner.destroy(org, 'job-7')).rejects.toBeInstanceOf(ProvisionerConfigError);

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

      await provisioner[action]((await getOrgRecord(gateway, org.orgId))!, 'job-4');

      const [[, execution]] = [...gateway.stepFunctions.executions.entries()];
      expect(execution.input).toEqual({
        orgId: org.orgId,
        jobId: 'job-4',
        action,
        instanceId: 'i-0123456789abcdef0',
      });
    });

    it.each(['suspend', 'wake'] as const)('%s fails fast without calling AWS when no instance id has been recorded', async (action) => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await expect(provisioner[action](org, 'job-5')).rejects.toBeInstanceOf(ProvisionerConfigError);
      expect(gateway.stepFunctions.executions.size).toBe(0);
    });
  });

  describe('StartExecution retry safety', () => {
    it('treats a name collision as a successful retry rather than an error', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

      await provisioner.issue(org, 'same-job-id');
      const firstArn = (await getOrgRecord(gateway, org.orgId))?.lastExecutionArn;

      // A retried call with the same job id derives the same execution name (ADR-0019) - Step
      // Functions itself recognizes it as the same execution rather than starting a second one.
      await expect(provisioner.issue(org, 'same-job-id')).resolves.toBeUndefined();

      expect(gateway.stepFunctions.executions.size).toBe(1);
      expect((await getOrgRecord(gateway, org.orgId))?.lastExecutionArn).toBe(firstArn);
    });

    it('surfaces any other StartExecution failure as a clear, actionable error', async () => {
      const gateway = new InMemoryAwsGateway();
      const org = await makeOrg(gateway);
      const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
      gateway.stepFunctions.startExecution = async () => { throw new Error('Step Functions is unavailable'); };

      const error = await provisioner.issue(org, 'job-6').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(StartExecutionError);
      expect((error as Error).message).toMatch('Step Functions is unavailable');
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
