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
