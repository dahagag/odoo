import { describe, expect, it } from 'vitest';
import { ConditionalCheckFailedError, ExecutionAlreadyExistsError, TransactionCanceledError } from '../src/errors';
import { InMemoryAwsGateway } from '../src/inMemory';

describe('InMemoryAwsGateway dynamoDb', () => {
  it('rejects a conditional put when attribute_not_exists is violated (lock acquire, ADR-0020)', async () => {
    const gateway = new InMemoryAwsGateway();
    await gateway.dynamoDb.putItem({
      table: 'locks',
      item: { pk: 'org#1', ownerArn: 'exec-1' },
      condition: { type: 'attribute_not_exists', attribute: 'pk' },
    });

    await expect(gateway.dynamoDb.putItem({
      table: 'locks',
      item: { pk: 'org#1', ownerArn: 'exec-2' },
      condition: { type: 'attribute_not_exists', attribute: 'pk' },
    })).rejects.toBeInstanceOf(ConditionalCheckFailedError);
  });

  it('rejects a conditional delete when the owner token no longer matches (stale-lock recovery, ADR-0020)', async () => {
    const gateway = new InMemoryAwsGateway();
    await gateway.dynamoDb.putItem({ table: 'locks', item: { pk: 'org#1', ownerArn: 'exec-1' } });

    await expect(gateway.dynamoDb.transactWrite({
      items: [{
        delete: {
          table: 'locks',
          key: { pk: 'org#1' },
          condition: { type: 'attribute_equals', attribute: 'ownerArn', value: 'exec-2' },
        },
      }],
    })).rejects.toBeInstanceOf(TransactionCanceledError);

    // The lock item must still be there - a failed conditional delete must not have removed it.
    await expect(gateway.dynamoDb.getItem({ table: 'locks', key: { pk: 'org#1' } }))
      .resolves.toEqual({ pk: 'org#1', ownerArn: 'exec-1' });
  });

  it('rejects a seat-counter increment past the cap (this ticket: the invariant cannot rely on a scan)', async () => {
    const gateway = new InMemoryAwsGateway();
    await gateway.dynamoDb.putItem({ table: 'orgs', item: { pk: 'org#1', seatCount: 25 } });

    await expect(gateway.dynamoDb.transactWrite({
      items: [{
        increment: {
          table: 'orgs',
          key: { pk: 'org#1' },
          attribute: 'seatCount',
          delta: 1,
          condition: { type: 'numeric_less_than_or_equal', attribute: 'seatCount', value: 24 },
        },
      }],
    })).rejects.toBeInstanceOf(TransactionCanceledError);

    await expect(gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'org#1' } }))
      .resolves.toEqual({ pk: 'org#1', seatCount: 25 });
  });

  it('applies a transactWrite all-or-nothing: one failing item leaves every item unapplied', async () => {
    const gateway = new InMemoryAwsGateway();
    await gateway.dynamoDb.putItem({ table: 'orgs', item: { pk: 'org#1', seatCount: 1 } });

    await expect(gateway.dynamoDb.transactWrite({
      items: [
        { put: { table: 'orgs', item: { pk: 'seat#1', orgId: 'org#1' } } },
        {
          increment: {
            table: 'orgs',
            key: { pk: 'org#1' },
            attribute: 'seatCount',
            delta: 1,
            condition: { type: 'numeric_less_than_or_equal', attribute: 'seatCount', value: 0 },
          },
        },
      ],
    })).rejects.toBeInstanceOf(TransactionCanceledError);

    await expect(gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: 'seat#1' } })).resolves.toBeUndefined();
  });

  it('queries by partition key and an optional sort-key prefix, paginating with limit/cursor', async () => {
    const gateway = new InMemoryAwsGateway();
    for (const state of ['active', 'active', 'issued']) {
      await gateway.dynamoDb.putItem({
        table: 'orgs',
        item: { pk: `state#${state}`, sk: `org#${Math.random()}`, state },
      });
    }

    const page1 = await gateway.dynamoDb.query({
      table: 'orgs',
      partitionKey: { name: 'pk', value: 'state#active' },
      limit: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await gateway.dynamoDb.query({
      table: 'orgs',
      partitionKey: { name: 'pk', value: 'state#active' },
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
  });
});

describe('InMemoryAwsGateway stepFunctions', () => {
  it('rejects a second startExecution with the same name (ExecutionAlreadyExists, ADR-0019 retry safety)', async () => {
    const gateway = new InMemoryAwsGateway();
    await gateway.stepFunctions.startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:fake',
      executionName: 'trial-1-job-1',
      input: { action: 'issue' },
    });

    await expect(gateway.stepFunctions.startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:fake',
      executionName: 'trial-1-job-1',
      input: { action: 'issue' },
    })).rejects.toBeInstanceOf(ExecutionAlreadyExistsError);
  });

  it('reports RUNNING until completeExecution moves it to a terminal status', async () => {
    const gateway = new InMemoryAwsGateway();
    const { executionArn } = await gateway.stepFunctions.startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:fake',
      executionName: 'trial-2-job-1',
      input: {},
    });

    await expect(gateway.stepFunctions.describeExecution(executionArn))
      .resolves.toMatchObject({ status: 'RUNNING' });

    gateway.completeExecution(executionArn, 'SUCCEEDED');

    await expect(gateway.stepFunctions.describeExecution(executionArn))
      .resolves.toMatchObject({ status: 'SUCCEEDED' });
    await expect(gateway.stepFunctions.getExecutionHistory(executionArn))
      .resolves.toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ type: 'ExecutionSucceeded' })]) });
  });
});

describe('InMemoryAwsGateway ec2', () => {
  it('starts and stops an instance, reporting its power state back', async () => {
    const gateway = new InMemoryAwsGateway();
    await expect(gateway.ec2.describeInstanceState('i-fake')).resolves.toBe('stopped');
    await gateway.ec2.startInstance('i-fake');
    await expect(gateway.ec2.describeInstanceState('i-fake')).resolves.toBe('running');
    await gateway.ec2.stopInstance('i-fake');
    await expect(gateway.ec2.describeInstanceState('i-fake')).resolves.toBe('stopped');
  });
});
