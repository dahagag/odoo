import { ExecutionAlreadyExists } from '@aws-sdk/client-sfn';
import { describe, expect, it, vi } from 'vitest';
import { AwsSdkGateway } from '../src/awsSdk';
import { ConditionalCheckFailedError, ExecutionAlreadyExistsError, TransactionCanceledError } from '../src/errors';

/**
 * Exercises `AwsSdkGateway` against a mocked AWS SDK client `send()` - never live AWS (this
 * ticket's Testing Decisions) - the way `test_trial_org_aws_provisioner.py` exercises
 * `AwsProvisioner` against a fake boto3 client. `InMemoryAwsGateway`'s own tests
 * (`test/inMemory.test.ts`) prove the fake rejects what a real DynamoDB would; this file proves
 * the *real* gateway sends what a real DynamoDB/Step Functions client expects, including the
 * `IndexName` passthrough `docs/dynamodb-access-patterns.md`'s GSI-backed patterns depend on.
 */
function conditionalCheckFailed(): Error {
  return Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
}

function transactionCanceled(...codes: (string | undefined)[]): Error {
  return Object.assign(new Error('TransactionCanceledException'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((code) => ({ Code: code })),
  });
}

describe('AwsSdkGateway dynamoDb', () => {
  it('marshals getItem and unmarshals the response', async () => {
    const send = vi.fn().mockResolvedValue({ Item: { pk: { S: 'org#1' }, seatsUsed: { N: '3' }, active: { BOOL: true } } });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    const item = await gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'org#1' } });

    expect(item).toEqual({ pk: 'org#1', seatsUsed: 3, active: true });
    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('GetItemCommand');
    expect(command.input).toEqual({ TableName: 'physical-orgs', Key: { pk: { S: 'org#1' } } });
  });

  it('passes consistentRead through as ConsistentRead (#298: a strongly consistent post-poll re-read)', async () => {
    const send = vi.fn().mockResolvedValue({ Item: { pk: { S: 'org#1' } } });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'org#1' }, consistentRead: true });

    const [command] = send.mock.calls[0];
    expect(command.input.ConsistentRead).toBe(true);
  });

  it('rejects marshaling an unsupported attribute value instead of coercing it', async () => {
    const send = vi.fn();
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await expect(gateway.dynamoDb.putItem({ table: 'orgs', item: { pk: 'org#1', tags: ['a'] } }))
      .rejects.toThrow(/Unsupported DynamoDB attribute value/);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects unmarshaling a real DynamoDB attribute type this seam has never written (e.g. NULL)', async () => {
    const send = vi.fn().mockResolvedValue({ Item: { pk: { S: 'org#1' }, deletedAt: { NULL: true } } });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await expect(gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'org#1' } }))
      .rejects.toThrow(/Unsupported DynamoDB attribute type/);
  });

  it('maps ConditionalCheckFailedException to ConditionalCheckFailedError', async () => {
    const send = vi.fn().mockRejectedValue(conditionalCheckFailed());
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await expect(gateway.dynamoDb.putItem({
      table: 'orgs',
      item: { pk: 'org#1' },
      condition: { type: 'attribute_not_exists', attribute: 'pk' },
    })).rejects.toBeInstanceOf(ConditionalCheckFailedError);
  });

  it('passes indexName through on query (docs/dynamodb-access-patterns.md pattern 2-4)', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [] });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await gateway.dynamoDb.query({
      table: 'orgs',
      indexName: 'gsi1-by-state',
      partitionKey: { name: 'gsi1pk', value: 'state#active' },
    });

    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input.IndexName).toBe('gsi1-by-state');
    expect(command.input.TableName).toBe('physical-orgs');
  });

  it('rejects a query passing both sortKeyPrefix and sortKeyAtMost, never sending a malformed request (#282 code review)', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [] });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await expect(gateway.dynamoDb.query({
      table: 'orgs',
      partitionKey: { name: 'pk', value: 'x' },
      sortKeyPrefix: { name: 'sk', value: 'a' },
      sortKeyAtMost: { name: 'sk', value: 'b' },
    })).rejects.toThrow('mutually exclusive');
    expect(send).not.toHaveBeenCalled();
  });

  it('updateItem sends a SET expression scoped to the given attributes with an IN condition', async () => {
    const send = vi.fn().mockResolvedValue({});
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: 'org#1' },
      set: { state: 'destroyed', lastJobId: 'job-2' },
      condition: { type: 'attribute_in', attribute: 'state', values: ['active', 'suspended'] },
    });

    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('UpdateItemCommand');
    expect(command.input.TableName).toBe('physical-orgs');
    expect(command.input.UpdateExpression).toBe('SET #set_attr0 = :set_value0, #set_attr1 = :set_value1');
    expect(command.input.ConditionExpression).toBe('#cond_attr IN (:cond_value0, :cond_value1)');
    expect(command.input.ExpressionAttributeNames).toEqual({
      '#set_attr0': 'state',
      '#set_attr1': 'lastJobId',
      '#cond_attr': 'state',
    });
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':set_value0': { S: 'destroyed' },
      ':set_value1': { S: 'job-2' },
      ':cond_value0': { S: 'active' },
      ':cond_value1': { S: 'suspended' },
    });
  });

  it('updateItem maps ConditionalCheckFailedException to ConditionalCheckFailedError', async () => {
    const send = vi.fn().mockRejectedValue(conditionalCheckFailed());
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    await expect(gateway.dynamoDb.updateItem({
      table: 'orgs',
      key: { pk: 'org#1' },
      set: { state: 'active' },
      condition: { type: 'attribute_in', attribute: 'state', values: ['issued'] },
    })).rejects.toBeInstanceOf(ConditionalCheckFailedError);
  });

  it('maps TransactionCanceledException to TransactionCanceledError with per-item reasons', async () => {
    const send = vi.fn().mockRejectedValue(transactionCanceled(undefined, 'ConditionalCheckFailed'));
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: { orgs: 'physical-orgs' } },
      { dynamoDb: { send } as never },
    );

    const error = await gateway.dynamoDb.transactWrite({
      items: [
        { put: { table: 'orgs', item: { pk: 'seat#1' } } },
        {
          increment: {
            table: 'orgs',
            key: { pk: 'org#1' },
            attribute: 'seatsUsed',
            delta: 1,
            condition: { type: 'numeric_less_than_or_equal', attribute: 'seatsUsed', value: 24 },
          },
        },
      ],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransactionCanceledError);
    expect((error as TransactionCanceledError).cancellationReasons).toEqual([undefined, 'ConditionalCheckFailed']);
  });
});

describe('AwsSdkGateway ses', () => {
  it('sends a SendEmailCommand shaped from the input', async () => {
    const send = vi.fn().mockResolvedValue({});
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { ses: { send } as never },
    );

    await gateway.ses.sendEmail({
      from: 'sign-in@example.com',
      to: 'someone@acme.example.com',
      subject: 'Your sign-in link',
      textBody: 'Use this link: https://app.example.com/sign-in/verify?token=abc',
    });

    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('SendEmailCommand');
    expect(command.input).toEqual({
      Source: 'sign-in@example.com',
      Destination: { ToAddresses: ['someone@acme.example.com'] },
      Message: {
        Subject: { Data: 'Your sign-in link' },
        Body: { Text: { Data: 'Use this link: https://app.example.com/sign-in/verify?token=abc' } },
      },
    });
  });
});

describe('AwsSdkGateway stepFunctions', () => {
  it('maps ExecutionAlreadyExists to ExecutionAlreadyExistsError, reconstructing the execution ARN', async () => {
    const send = vi.fn().mockRejectedValue(new ExecutionAlreadyExists({ message: 'exists', $metadata: {} }));
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { stepFunctions: { send } as never },
    );

    const error = await gateway.stepFunctions.startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:fake',
      executionName: 'trial-1-job-1',
      input: {},
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionAlreadyExistsError);
    expect((error as ExecutionAlreadyExistsError).executionArn).toBe(
      'arn:aws:states:us-east-1:000000000000:execution:fake:trial-1-job-1',
    );
  });
});

describe('AwsSdkGateway costExplorer', () => {
  it('sends an ungrouped GetCostAndUsageCommand shaped from the input', async () => {
    const send = vi.fn().mockResolvedValue({
      ResultsByTime: [{
        TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
        Total: { UnblendedCost: { Amount: '12.50', Unit: 'USD' } },
      }],
    });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { costExplorer: { send } as never },
    );

    const result = await gateway.costExplorer.getCostAndUsage({
      start: '2025-01-01', end: '2025-01-08', granularity: 'DAILY',
    });

    expect(result.amounts).toEqual([{ start: '2025-01-01', end: '2025-01-02', unblendedCost: 12.5, unit: 'USD' }]);
    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('GetCostAndUsageCommand');
    expect(command.input).toMatchObject({
      TimePeriod: { Start: '2025-01-01', End: '2025-01-08' },
      Granularity: 'DAILY',
      GroupBy: undefined,
    });
  });

  it('requests GroupBy=TAG and parses each group\'s "<key>$<value>" key into tagValue, including the untagged group', async () => {
    const send = vi.fn().mockResolvedValue({
      ResultsByTime: [{
        TimePeriod: { Start: '2025-01-01', End: '2025-01-02' },
        Groups: [
          { Keys: ['TrialOrgId$abc-123'], Metrics: { UnblendedCost: { Amount: '5.00', Unit: 'USD' } } },
          { Keys: ['TrialOrgId$'], Metrics: { UnblendedCost: { Amount: '2.00', Unit: 'USD' } } },
        ],
      }],
    });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { costExplorer: { send } as never },
    );

    const result = await gateway.costExplorer.getCostAndUsage({
      start: '2025-01-01', end: '2025-01-08', granularity: 'DAILY', groupByTagKey: 'TrialOrgId',
    });

    expect(result.amounts).toEqual([
      { start: '2025-01-01', end: '2025-01-02', unblendedCost: 5, unit: 'USD', tagValue: 'abc-123' },
      { start: '2025-01-01', end: '2025-01-02', unblendedCost: 2, unit: 'USD', tagValue: '' },
    ]);
    const [command] = send.mock.calls[0];
    expect(command.input.GroupBy).toEqual([{ Type: 'TAG', Key: 'TrialOrgId' }]);
  });

  it('follows NextPageToken pagination', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({
        ResultsByTime: [{ TimePeriod: { Start: '2025-01-01', End: '2025-01-02' }, Total: { UnblendedCost: { Amount: '1', Unit: 'USD' } } }],
        NextPageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        ResultsByTime: [{ TimePeriod: { Start: '2025-01-02', End: '2025-01-03' }, Total: { UnblendedCost: { Amount: '2', Unit: 'USD' } } }],
      });
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { costExplorer: { send } as never },
    );

    const result = await gateway.costExplorer.getCostAndUsage({
      start: '2025-01-01', end: '2025-01-08', granularity: 'DAILY',
    });

    expect(result.amounts).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.NextPageToken).toBe('page-2');
  });
});

describe('AwsSdkGateway sns', () => {
  it('sends a PublishCommand shaped from the input', async () => {
    const send = vi.fn().mockResolvedValue({});
    const gateway = new AwsSdkGateway(
      { region: 'us-east-1', dynamoTableNames: {} },
      { sns: { send } as never },
    );

    await gateway.sns.publish({
      topicArn: 'arn:aws:sns:us-east-1:000000000000:cost-alerts',
      subject: 'AWS spend threshold crossed',
      message: 'Total spend has crossed $100.',
    });

    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe('PublishCommand');
    expect(command.input).toEqual({
      TopicArn: 'arn:aws:sns:us-east-1:000000000000:cost-alerts',
      Subject: 'AWS spend threshold crossed',
      Message: 'Total spend has crossed $100.',
    });
  });
});
