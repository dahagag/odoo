import { ConditionalCheckFailedError, ExecutionAlreadyExistsError, TransactionCanceledError } from './errors';
// Type-only import: does not pull @aws-sdk/client-dynamodb in at runtime (the lazy dynamic
// imports below still do that), only at compile time.
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type {
  AwsGateway,
  CostExplorerGateway,
  DescribeExecutionResult,
  DynamoCondition,
  DynamoDbGateway,
  DynamoItem,
  Ec2Gateway,
  Ec2PowerState,
  GetCostAndUsageInput,
  GetCostAndUsageResult,
  GetExecutionHistoryResult,
  GetItemInput,
  PutItemInput,
  QueryInput,
  QueryResult,
  StartExecutionInput,
  StartExecutionResult,
  StepFunctionsGateway,
  TransactWriteInput,
} from './types';

export interface AwsSdkGatewayConfig {
  region: string;
  /** Maps this seam's logical table name (e.g. `orgs`) to the physical DynamoDB table name, so
   * callers never hardcode an environment-specific table name (this ticket's Config decision:
   * environment facts are configuration, not constants). */
  dynamoTableNames: Record<string, string>;
}

/** This seam only ever round-trips `string`/`number`/`boolean` (`docs/dynamodb-access-
 * patterns.md`) - anything else reaching here is a caller bug. Coercing it with `String(value)`
 * would silently store a corrupted-looking-plausible value (`"undefined"`, `"[object
 * Object]"`) instead of failing where the mistake was made. */
function marshalValue(value: unknown): AttributeValue {
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  throw new Error(`Unsupported DynamoDB attribute value: ${JSON.stringify(value)}`);
}

function unmarshalItem(item: Record<string, AttributeValue> | undefined): DynamoItem | undefined {
  if (!item) return undefined;
  const result: DynamoItem = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.N !== undefined) result[key] = Number(value.N);
    else if (value.BOOL !== undefined) result[key] = value.BOOL;
    else if (value.S !== undefined) result[key] = value.S;
    // A real DynamoDB item can carry NULL/L/M/set attributes this seam has never written and
    // does not understand; silently falling through to `value.S` (`undefined`) would leave the
    // key present with a bogus value instead of surfacing that the record holds something this
    // seam was never built to read.
    else throw new Error(`Unsupported DynamoDB attribute type for "${key}": ${JSON.stringify(value)}`);
  }
  return result;
}

function marshalItem(item: DynamoItem): Record<string, AttributeValue> {
  const result: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(item)) result[key] = marshalValue(value);
  return result;
}

/** Compiles this seam's restricted `DynamoCondition` into a real ConditionExpression. The
 * attribute name is always aliased through `ExpressionAttributeNames` so a condition on a
 * DynamoDB reserved word (e.g. `state`) never breaks. */
function compileCondition(condition: DynamoCondition | undefined): {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, AttributeValue>;
} {
  if (!condition) return {};
  const nameAlias = '#cond_attr';
  switch (condition.type) {
    case 'attribute_not_exists':
      return {
        ConditionExpression: `attribute_not_exists(${nameAlias})`,
        ExpressionAttributeNames: { [nameAlias]: condition.attribute },
      };
    case 'attribute_exists':
      return {
        ConditionExpression: `attribute_exists(${nameAlias})`,
        ExpressionAttributeNames: { [nameAlias]: condition.attribute },
      };
    case 'attribute_equals':
      return {
        ConditionExpression: `${nameAlias} = :cond_value`,
        ExpressionAttributeNames: { [nameAlias]: condition.attribute },
        ExpressionAttributeValues: { ':cond_value': marshalValue(condition.value) },
      };
    case 'numeric_less_than_or_equal':
      return {
        ConditionExpression: `${nameAlias} <= :cond_value`,
        ExpressionAttributeNames: { [nameAlias]: condition.attribute },
        ExpressionAttributeValues: { ':cond_value': { N: String(condition.value) } },
      };
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const exhaustive: never = condition;
      throw new Error(`Unhandled DynamoCondition: ${JSON.stringify(exhaustive)}`);
    }
  }
}

class AwsSdkDynamoDbGateway implements DynamoDbGateway {
  private client: import('@aws-sdk/client-dynamodb').DynamoDBClient | undefined;

  /** `client` mirrors `AwsProvisioner.__init__`'s `client=None` parameter
   * (custom_addons/hosting_admin/models/provisioner.py): a test injects a fake/mock client
   * without needing the real AWS SDK to be reachable, or even instantiable, in a test run. */
  constructor(private readonly config: AwsSdkGatewayConfig, client?: import('@aws-sdk/client-dynamodb').DynamoDBClient) {
    this.client = client;
  }

  private async getClient() {
    if (!this.client) {
      // Lazy so importing this module never requires the AWS SDK to be installed/reachable at
      // all in a test run (mirrors the lazy `import boto3` in
      // custom_addons/hosting_admin/models/provisioner.py's AwsProvisioner.client).
      const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      this.client = new DynamoDBClient({ region: this.config.region });
    }
    return this.client;
  }

  private tableName(logicalName: string): string {
    const physical = this.config.dynamoTableNames[logicalName];
    if (!physical) throw new Error(`No physical DynamoDB table configured for "${logicalName}"`);
    return physical;
  }

  async getItem(input: GetItemInput): Promise<DynamoItem | undefined> {
    const { GetItemCommand } = await import('@aws-sdk/client-dynamodb');
    const client = await this.getClient();
    const response = await client.send(new GetItemCommand({
      TableName: this.tableName(input.table),
      Key: marshalItem(input.key),
    }));
    return unmarshalItem(response.Item as never);
  }

  async putItem(input: PutItemInput): Promise<void> {
    const { PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const client = await this.getClient();
    try {
      await client.send(new PutItemCommand({
        TableName: this.tableName(input.table),
        Item: marshalItem(input.item),
        ...compileCondition(input.condition),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ConditionalCheckFailedError(error.message);
      }
      throw error;
    }
  }

  async query(input: QueryInput): Promise<QueryResult> {
    const { QueryCommand } = await import('@aws-sdk/client-dynamodb');
    const client = await this.getClient();
    let keyConditionExpression = '#pk = :pk';
    const names: Record<string, string> = { '#pk': input.partitionKey.name };
    const values: Record<string, AttributeValue> = { ':pk': marshalValue(input.partitionKey.value) };
    if (input.sortKeyPrefix) {
      keyConditionExpression += ' AND begins_with(#sk, :sk)';
      names['#sk'] = input.sortKeyPrefix.name;
      values[':sk'] = marshalValue(input.sortKeyPrefix.value);
    }
    const response = await client.send(new QueryCommand({
      TableName: this.tableName(input.table),
      IndexName: input.indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      Limit: input.limit,
      ExclusiveStartKey: input.cursor
        ? JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
        : undefined,
    }));
    return {
      items: (response.Items ?? []).map((item) => unmarshalItem(item as never) as DynamoItem),
      nextCursor: response.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(response.LastEvaluatedKey), 'utf8').toString('base64url')
        : undefined,
    };
  }

  async transactWrite(input: TransactWriteInput): Promise<void> {
    const { TransactWriteItemsCommand } = await import('@aws-sdk/client-dynamodb');
    const client = await this.getClient();
    const transactItems = input.items.map((writeItem) => {
      if ('put' in writeItem) {
        return {
          Put: {
            TableName: this.tableName(writeItem.put.table),
            Item: marshalItem(writeItem.put.item),
            ...compileCondition(writeItem.put.condition),
          },
        };
      }
      if ('increment' in writeItem) {
        const { table, key, attribute, delta, condition } = writeItem.increment;
        const compiled = compileCondition(condition);
        return {
          Update: {
            TableName: this.tableName(table),
            Key: marshalItem(key),
            UpdateExpression: 'ADD #inc_attr :delta',
            ExpressionAttributeNames: { '#inc_attr': attribute, ...compiled.ExpressionAttributeNames },
            ExpressionAttributeValues: { ':delta': { N: String(delta) }, ...compiled.ExpressionAttributeValues },
            ConditionExpression: compiled.ConditionExpression,
          },
        };
      }
      return {
        Delete: {
          TableName: this.tableName(writeItem.delete.table),
          Key: marshalItem(writeItem.delete.key),
          ...compileCondition(writeItem.delete.condition),
        },
      };
    });

    try {
      await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems as never }));
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        const reasons = ((error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [])
          .map((reason) => reason.Code);
        throw new TransactionCanceledError(reasons);
      }
      throw error;
    }
  }
}

class AwsSdkStepFunctionsGateway implements StepFunctionsGateway {
  private client: import('@aws-sdk/client-sfn').SFNClient | undefined;

  constructor(private readonly config: AwsSdkGatewayConfig, client?: import('@aws-sdk/client-sfn').SFNClient) {
    this.client = client;
  }

  private async getClient() {
    if (!this.client) {
      const { SFNClient } = await import('@aws-sdk/client-sfn');
      this.client = new SFNClient({ region: this.config.region });
    }
    return this.client;
  }

  async startExecution(input: StartExecutionInput): Promise<StartExecutionResult> {
    const { StartExecutionCommand, ExecutionAlreadyExists } = await import('@aws-sdk/client-sfn');
    const client = await this.getClient();
    try {
      const response = await client.send(new StartExecutionCommand({
        stateMachineArn: input.stateMachineArn,
        name: input.executionName,
        input: JSON.stringify(input.input),
      }));
      if (!response.executionArn) throw new Error('StartExecution returned no executionArn');
      return { executionArn: response.executionArn };
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        throw new ExecutionAlreadyExistsError(this.reconstructExecutionArn(input));
      }
      throw error;
    }
  }

  private reconstructExecutionArn(input: StartExecutionInput): string {
    // Same reconstruction AwsProvisioner._execution_arn() falls back to on this exact retry
    // path (docs/adr/0019) - built from the unqualified state machine ARN StartExecution was
    // just called with.
    const unqualified = input.stateMachineArn.split(':').slice(0, 7).join(':');
    return `${unqualified.replace(':stateMachine:', ':execution:')}:${input.executionName}`;
  }

  async describeExecution(executionArn: string): Promise<DescribeExecutionResult> {
    const { DescribeExecutionCommand } = await import('@aws-sdk/client-sfn');
    const client = await this.getClient();
    const response = await client.send(new DescribeExecutionCommand({ executionArn }));
    return {
      status: response.status as DescribeExecutionResult['status'],
      startDate: response.startDate,
      stopDate: response.stopDate,
      error: (response as { error?: string }).error,
      cause: (response as { cause?: string }).cause,
    };
  }

  async getExecutionHistory(executionArn: string, nextToken?: string): Promise<GetExecutionHistoryResult> {
    const { GetExecutionHistoryCommand } = await import('@aws-sdk/client-sfn');
    const client = await this.getClient();
    const response = await client.send(new GetExecutionHistoryCommand({
      executionArn,
      nextToken,
      reverseOrder: false,
    }));
    const events = (response.events ?? []).map((event) => {
      const detail = event.stateEnteredEventDetails
        ?? event.stateExitedEventDetails
        ?? event.taskFailedEventDetails
        ?? event.taskTimedOutEventDetails
        ?? event.executionFailedEventDetails
        ?? event.executionTimedOutEventDetails
        ?? event.executionAbortedEventDetails
        ?? {};
      return {
        timestamp: event.timestamp ?? new Date(0),
        type: String(event.type),
        name: (detail as { name?: string }).name,
        error: (detail as { error?: string }).error,
        cause: (detail as { cause?: string }).cause,
      };
    });
    return { events, nextToken: response.nextToken };
  }
}

class AwsSdkCostExplorerGateway implements CostExplorerGateway {
  private client: import('@aws-sdk/client-cost-explorer').CostExplorerClient | undefined;

  constructor(client?: import('@aws-sdk/client-cost-explorer').CostExplorerClient) {
    this.client = client;
  }

  private async getClient() {
    if (!this.client) {
      const { CostExplorerClient } = await import('@aws-sdk/client-cost-explorer');
      // Cost Explorer's API only exists in us-east-1, regardless of the stack's own region.
      this.client = new CostExplorerClient({ region: 'us-east-1' });
    }
    return this.client;
  }

  async getCostAndUsage(input: GetCostAndUsageInput): Promise<GetCostAndUsageResult> {
    const { GetCostAndUsageCommand } = await import('@aws-sdk/client-cost-explorer');
    const client = await this.getClient();
    const response = await client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: input.start, End: input.end },
      Granularity: input.granularity,
      Metrics: ['UnblendedCost'],
      Filter: input.filterTagKey
        ? { Tags: { Key: input.filterTagKey, Values: [input.filterTagValue ?? ''] } }
        : undefined,
    }));
    const amounts = (response.ResultsByTime ?? []).map((result) => ({
      start: result.TimePeriod?.Start ?? input.start,
      end: result.TimePeriod?.End ?? input.end,
      unblendedCost: Number(result.Total?.UnblendedCost?.Amount ?? '0'),
      unit: result.Total?.UnblendedCost?.Unit ?? 'USD',
    }));
    return { amounts };
  }
}

class AwsSdkEc2Gateway implements Ec2Gateway {
  private client: import('@aws-sdk/client-ec2').EC2Client | undefined;

  constructor(private readonly config: AwsSdkGatewayConfig, client?: import('@aws-sdk/client-ec2').EC2Client) {
    this.client = client;
  }

  private async getClient() {
    if (!this.client) {
      const { EC2Client } = await import('@aws-sdk/client-ec2');
      this.client = new EC2Client({ region: this.config.region });
    }
    return this.client;
  }

  async describeInstanceState(instanceId: string): Promise<Ec2PowerState> {
    const { DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
    const client = await this.getClient();
    const response = await client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;
    if (!state) throw new Error(`No such EC2 instance: ${instanceId}`);
    return state as Ec2PowerState;
  }

  async startInstance(instanceId: string): Promise<void> {
    const { StartInstancesCommand } = await import('@aws-sdk/client-ec2');
    const client = await this.getClient();
    await client.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
  }

  async stopInstance(instanceId: string): Promise<void> {
    const { StopInstancesCommand } = await import('@aws-sdk/client-ec2');
    const client = await this.getClient();
    await client.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
  }
}

/** Test-only injection point, one field per sub-gateway's own AWS SDK client type - lets a test
 * exercise `AwsSdkGateway`'s marshaling/error-mapping against a mock `send()` without either
 * touching live AWS or having to import the lazy dynamic-import machinery itself. */
export interface AwsSdkGatewayClients {
  dynamoDb?: import('@aws-sdk/client-dynamodb').DynamoDBClient;
  stepFunctions?: import('@aws-sdk/client-sfn').SFNClient;
  costExplorer?: import('@aws-sdk/client-cost-explorer').CostExplorerClient;
  ec2?: import('@aws-sdk/client-ec2').EC2Client;
}

/** Real `AwsGateway`: reaches AWS through ADR-0019's narrow cross-account role. Every AWS SDK
 * import is lazy (per sub-gateway, above) so constructing this class - and importing this
 * module - never requires the AWS SDK packages to be resolvable at all; only actually calling a
 * method does. */
export class AwsSdkGateway implements AwsGateway {
  readonly dynamoDb: DynamoDbGateway;
  readonly stepFunctions: StepFunctionsGateway;
  readonly costExplorer: CostExplorerGateway;
  readonly ec2: Ec2Gateway;

  constructor(config: AwsSdkGatewayConfig, clients: AwsSdkGatewayClients = {}) {
    this.dynamoDb = new AwsSdkDynamoDbGateway(config, clients.dynamoDb);
    this.stepFunctions = new AwsSdkStepFunctionsGateway(config, clients.stepFunctions);
    this.costExplorer = new AwsSdkCostExplorerGateway(clients.costExplorer);
    this.ec2 = new AwsSdkEc2Gateway(config, clients.ec2);
  }
}
