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

describe('checkStatus (#281)', () => {
  it('ignores an org with no running job', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

    await expect(provisioner.checkStatus(org)).resolves.toBeUndefined();

    expect((await getOrgRecord(gateway, org.orgId))?.lastJobStatus).toBeUndefined();
  });

  it('leaves a still-running execution alone', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastJobStatus: 'running' },
    });
    const running = (await getOrgRecord(gateway, org.orgId))!;

    await provisioner.checkStatus(running);

    expect((await getOrgRecord(gateway, org.orgId))?.lastJobStatus).toBe('running');
  });

  it('promotes the pending deployment version and marks the job succeeded', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    let current = (await getOrgRecord(gateway, org.orgId))!;
    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastJobStatus: 'running' },
    });
    current = (await getOrgRecord(gateway, org.orgId))!;
    gateway.completeExecution(current.lastExecutionArn!, 'SUCCEEDED');

    await provisioner.checkStatus(current);

    const updated = await getOrgRecord(gateway, org.orgId);
    expect(updated?.lastJobStatus).toBe('succeeded');
    expect(updated?.lastJobError).toBe('');
    expect(updated?.amiId).toBe(FULL_CONFIG.baseAmiId);
    expect(updated?.tofuModuleGitSha).toBe(FULL_CONFIG.tofuModuleGitSha);
  });

  it('surfaces a clear failure reason and does not mark the job running', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastJobStatus: 'running' },
    });
    const current = (await getOrgRecord(gateway, org.orgId))!;
    gateway.completeExecution(current.lastExecutionArn!, 'FAILED', 'States.TaskFailed', 'tofu apply exited 1');

    await provisioner.checkStatus(current);

    const updated = await getOrgRecord(gateway, org.orgId);
    expect(updated?.lastJobStatus).toBe('failed');
    expect(updated?.lastJobError).toBe('States.TaskFailed: tofu apply exited 1');
    expect(updated?.amiId).toBeUndefined();
  });

  it('leaves the job running when describeExecution itself fails (transient AWS trouble)', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastJobStatus: 'running' },
    });
    const current = (await getOrgRecord(gateway, org.orgId))!;
    gateway.stepFunctions.describeExecution = async () => { throw new Error('Step Functions is unavailable'); };

    await expect(provisioner.checkStatus(current)).resolves.toBeUndefined();

    expect((await getOrgRecord(gateway, org.orgId))?.lastJobStatus).toBe('running');
  });
});

describe('getAuditTrail (#281)', () => {
  it('renders unavailable for an org with no recorded execution', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);

    await expect(provisioner.getAuditTrail(org)).resolves.toEqual({ available: false });
  });

  it('renders unavailable when describeExecution itself fails, rather than raising', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    const current = (await getOrgRecord(gateway, org.orgId))!;
    gateway.stepFunctions.describeExecution = async () => { throw new Error('Step Functions is unavailable'); };

    await expect(provisioner.getAuditTrail(current)).resolves.toEqual({ available: false });
  });

  it('renders overall status, timing, and step detail (including a failed step) from the execution history', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    // lastJobAction/lastJobId are written by applyTransition (record.ts), not by the provisioner
    // itself (ADR-0019) - set directly here to isolate this test to AwsProvisioner's own
    // getAuditTrail behavior.
    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: `org#${org.orgId}` },
      set: { lastJobAction: 'issue', lastJobId: 'job-1' },
    });
    const current = (await getOrgRecord(gateway, org.orgId))!;
    gateway.completeExecution(current.lastExecutionArn!, 'FAILED', 'States.TaskFailed', 'tofu apply exited 1');

    const trail = await provisioner.getAuditTrail(current);

    expect(trail.available).toBe(true);
    if (!trail.available) throw new Error('unreachable');
    expect(trail.action).toBe('issue');
    expect(trail.jobId).toBe('job-1');
    expect(trail.status).toBe('FAILED');
    expect(trail.stepsAvailable).toBe(true);
    expect(trail.steps.length).toBeGreaterThanOrEqual(2);
    const failedStep = trail.steps.at(-1)!;
    expect(failedStep.error).toBe('States.TaskFailed');
    expect(failedStep.cause).toBe('tofu apply exited 1');
  });

  it('keeps overall status but marks steps unavailable, with the AWS error name as the reason, when history alone fails', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    const current = (await getOrgRecord(gateway, org.orgId))!;
    const historyError = new Error('access denied');
    historyError.name = 'AccessDeniedException';
    gateway.stepFunctions.getExecutionHistory = async () => { throw historyError; };

    const trail = await provisioner.getAuditTrail(current);

    expect(trail.available).toBe(true);
    if (!trail.available) throw new Error('unreachable');
    expect(trail.status).toBe('RUNNING');
    expect(trail.stepsAvailable).toBe(false);
    expect(trail.stepsUnavailableReason).toBe('AccessDeniedException');
    expect(trail.steps).toEqual([]);
  });

  it('follows a paginated execution history to completion rather than stopping at the first page', async () => {
    const gateway = new InMemoryAwsGateway();
    const org = await makeOrg(gateway);
    const provisioner = new AwsProvisioner(gateway, FULL_CONFIG);
    await provisioner.issue(org, 'job-1');
    const current = (await getOrgRecord(gateway, org.orgId))!;

    const pages = [
      { events: [{ timestamp: new Date(0), type: 'ExecutionStarted' }], nextToken: 'page-2' },
      { events: [{ timestamp: new Date(1), type: 'TaskStateEntered', name: 'RunTofu' }], nextToken: 'page-3' },
      { events: [{ timestamp: new Date(2), type: 'TaskStateExited', name: 'RunTofu' }], nextToken: undefined },
    ];
    const seenTokens: (string | undefined)[] = [];
    gateway.stepFunctions.getExecutionHistory = async (_executionArn, nextToken) => {
      seenTokens.push(nextToken);
      return pages[seenTokens.length - 1];
    };

    const trail = await provisioner.getAuditTrail(current);

    expect(seenTokens).toEqual([undefined, 'page-2', 'page-3']);
    if (!trail.available) throw new Error('unreachable');
    expect(trail.steps).toHaveLength(3);
    expect(trail.steps.map((step) => step.type)).toEqual(['ExecutionStarted', 'TaskStateEntered', 'TaskStateExited']);
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
