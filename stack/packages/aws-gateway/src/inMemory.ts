import { ConditionalCheckFailedError, ExecutionAlreadyExistsError, TransactionCanceledError } from './errors';
import type {
  AwsGateway,
  CostExplorerGateway,
  DescribeExecutionResult,
  DynamoCondition,
  DynamoDbGateway,
  DynamoItem,
  Ec2Gateway,
  Ec2PowerState,
  ExecutionStatus,
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

function keyOf(key: Record<string, string | number>): string {
  return JSON.stringify(Object.keys(key).sort().map((k) => [k, key[k]]));
}

function evaluateCondition(item: DynamoItem | undefined, condition: DynamoCondition | undefined): string | undefined {
  if (!condition) return undefined;
  switch (condition.type) {
    case 'attribute_not_exists':
      return item && item[condition.attribute] !== undefined ? 'ConditionalCheckFailed' : undefined;
    case 'attribute_exists':
      return !item || item[condition.attribute] === undefined ? 'ConditionalCheckFailed' : undefined;
    case 'attribute_equals':
      return item?.[condition.attribute] === condition.value ? undefined : 'ConditionalCheckFailed';
    case 'numeric_less_than_or_equal': {
      // A DynamoDB ConditionExpression referencing a missing attribute fails the condition
      // outright - it has no implicit zero. Defaulting to 0 here would let the fake accept an
      // increment a real conditional write would reject (this ticket's Testing Decisions: "the
      // fake must reject calls the real one would reject").
      const value = item?.[condition.attribute];
      if (value === undefined) return 'ConditionalCheckFailed';
      return Number(value) <= condition.value ? undefined : 'ConditionalCheckFailed';
    }
    /* istanbul ignore next -- exhaustiveness guard */
    default: {
      const exhaustive: never = condition;
      throw new Error(`Unhandled DynamoCondition: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * In-memory `DynamoDbGateway`. Deliberately simplified relative to real DynamoDB: `query`
 * scans the named table's full item set rather than reading a real secondary index's own
 * projection, because the fake always holds the complete item anyway — there is no separate
 * GSI storage to keep in sync. What it does reproduce faithfully is the part stack logic
 * actually depends on: conditional writes fail exactly when the real ones would (this ticket's
 * Testing Decisions), and `transactWrite` is all-or-nothing.
 */
class InMemoryDynamoDbGateway implements DynamoDbGateway {
  private readonly tables = new Map<string, Map<string, DynamoItem>>();

  private table(name: string): Map<string, DynamoItem> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  async getItem(input: GetItemInput): Promise<DynamoItem | undefined> {
    const item = this.table(input.table).get(keyOf(input.key));
    return item ? { ...item } : undefined;
  }

  async putItem(input: PutItemInput): Promise<void> {
    const table = this.table(input.table);
    const key = keyOf(this.extractKey(input.item));
    const failure = evaluateCondition(table.get(key), input.condition);
    if (failure) throw new ConditionalCheckFailedError();
    table.set(key, { ...input.item });
  }

  async query(input: QueryInput): Promise<QueryResult> {
    const table = this.table(input.table);
    let items = [...table.values()].filter(
      (item) => item[input.partitionKey.name] === input.partitionKey.value,
    );
    if (input.sortKeyPrefix) {
      const { name, value } = input.sortKeyPrefix;
      items = items.filter((item) => String(item[name] ?? '').startsWith(String(value)));
    }
    items.sort((a, b) => {
      const sortAttr = input.sortKeyPrefix?.name;
      if (!sortAttr) return 0;
      return String(a[sortAttr] ?? '').localeCompare(String(b[sortAttr] ?? ''));
    });

    const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString('utf8')) : 0;
    const limit = input.limit ?? items.length;
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const nextCursor = nextOffset < items.length
      ? Buffer.from(String(nextOffset), 'utf8').toString('base64url')
      : undefined;
    return { items: page.map((item) => ({ ...item })), nextCursor };
  }

  async transactWrite(input: TransactWriteInput): Promise<void> {
    // Validate every item's condition against current state before mutating anything, so a
    // failure partway through never leaves earlier items in this same call applied - the
    // "all-or-nothing" guarantee stack logic (the seat-counter write, this ticket's
    // Implementation Decisions) depends on.
    const reasons: (string | undefined)[] = input.items.map((writeItem) => {
      if ('put' in writeItem) {
        const table = this.table(writeItem.put.table);
        const key = keyOf(this.extractKey(writeItem.put.item));
        return evaluateCondition(table.get(key), writeItem.put.condition);
      }
      if ('increment' in writeItem) {
        const table = this.table(writeItem.increment.table);
        return evaluateCondition(table.get(keyOf(writeItem.increment.key)), writeItem.increment.condition);
      }
      const table = this.table(writeItem.delete.table);
      return evaluateCondition(table.get(keyOf(writeItem.delete.key)), writeItem.delete.condition);
    });

    if (reasons.some((reason) => reason !== undefined)) {
      throw new TransactionCanceledError(reasons);
    }

    for (const writeItem of input.items) {
      if ('put' in writeItem) {
        const table = this.table(writeItem.put.table);
        table.set(keyOf(this.extractKey(writeItem.put.item)), { ...writeItem.put.item });
      } else if ('increment' in writeItem) {
        const { table: tableName, key, attribute, delta } = writeItem.increment;
        const table = this.table(tableName);
        const existing = table.get(keyOf(key)) ?? { ...key };
        const current = Number(existing[attribute] ?? 0);
        table.set(keyOf(key), { ...existing, [attribute]: current + delta });
      } else {
        const table = this.table(writeItem.delete.table);
        table.delete(keyOf(writeItem.delete.key));
      }
    }
  }

  /** Single-table design (this ticket's Implementation Decisions) fixes the key attribute names
   * as `pk` and, where the item has one, `sk` - so the fake can read an item's own key back out
   * of it without a separate per-table schema declaring which attributes are the key. */
  private extractKey(item: DynamoItem): Record<string, string | number> {
    const key: Record<string, string | number> = {};
    for (const name of ['pk', 'sk']) {
      const value = item[name];
      if (typeof value === 'string' || typeof value === 'number') key[name] = value;
    }
    return key;
  }
}

interface ExecutionRecord {
  status: ExecutionStatus;
  input: Record<string, unknown>;
  startDate: Date;
  stopDate?: Date;
  events: GetExecutionHistoryResult['events'];
}

/** In-memory `StepFunctionsGateway`. Every started execution defaults to `RUNNING`; tests move
 * it to a terminal status with `InMemoryAwsGateway.completeExecution` below rather than this
 * class polling anything itself. */
class InMemoryStepFunctionsGateway implements StepFunctionsGateway {
  readonly executions = new Map<string, ExecutionRecord>();
  private readonly nameToArn = new Map<string, string>();
  private sequence = 0;

  async startExecution(input: StartExecutionInput): Promise<StartExecutionResult> {
    const existingArn = this.nameToArn.get(input.executionName);
    if (existingArn) {
      // Mirrors boto3's ExecutionAlreadyExists: Step Functions itself recognizes a StartExecution
      // retry with the same name (docs/adr/0019) rather than starting a second execution.
      throw new ExecutionAlreadyExistsError(existingArn);
    }
    this.sequence += 1;
    const executionArn = `arn:aws:states:fake:000000000000:execution:fake-state-machine:${input.executionName}#${this.sequence}`;
    this.nameToArn.set(input.executionName, executionArn);
    this.executions.set(executionArn, {
      status: 'RUNNING',
      input: input.input,
      startDate: new Date(),
      events: [{ timestamp: new Date(), type: 'ExecutionStarted' }],
    });
    return { executionArn };
  }

  async describeExecution(executionArn: string): Promise<DescribeExecutionResult> {
    const execution = this.mustGet(executionArn);
    return {
      status: execution.status,
      startDate: execution.startDate,
      stopDate: execution.stopDate,
    };
  }

  async getExecutionHistory(executionArn: string): Promise<GetExecutionHistoryResult> {
    const execution = this.mustGet(executionArn);
    return { events: execution.events };
  }

  private mustGet(executionArn: string): ExecutionRecord {
    const execution = this.executions.get(executionArn);
    if (!execution) throw new Error(`No such fake execution: ${executionArn}`);
    return execution;
  }
}

class InMemoryCostExplorerGateway implements CostExplorerGateway {
  /** Seeded by tests; a real Cost Explorer call is fully out of scope here (this ticket's Out
   * of Scope: "Cost data and projection"). */
  amounts: GetCostAndUsageResult['amounts'] = [];

  async getCostAndUsage(_input: GetCostAndUsageInput): Promise<GetCostAndUsageResult> {
    return { amounts: this.amounts };
  }
}

class InMemoryEc2Gateway implements Ec2Gateway {
  private readonly states = new Map<string, Ec2PowerState>();

  async describeInstanceState(instanceId: string): Promise<Ec2PowerState> {
    return this.states.get(instanceId) ?? 'stopped';
  }

  async startInstance(instanceId: string): Promise<void> {
    this.states.set(instanceId, 'running');
  }

  async stopInstance(instanceId: string): Promise<void> {
    this.states.set(instanceId, 'stopped');
  }
}

/** The AWS fake this ticket's Implementation Decisions call for: "stack logic tests run with no
 * network and no credentials." Exposes its sub-gateways' concrete classes (not just the
 * `AwsGateway` interface) so a test can seed/inspect state directly, mirroring how
 * `StubProvisioner` in `hosting_admin` stays a plain no-op while a test targeting `AwsProvisioner`
 * injects its own fake boto3 client. */
export class InMemoryAwsGateway implements AwsGateway {
  readonly dynamoDb = new InMemoryDynamoDbGateway();
  readonly stepFunctions = new InMemoryStepFunctionsGateway();
  readonly costExplorer = new InMemoryCostExplorerGateway();
  readonly ec2 = new InMemoryEc2Gateway();

  /** Test helper: moves a started execution to a terminal status, since nothing in this fake
   * runs a real state machine to reach one on its own. */
  completeExecution(executionArn: string, status: Exclude<ExecutionStatus, 'RUNNING'>, error?: string, cause?: string): void {
    const execution = this.stepFunctions.executions.get(executionArn);
    if (!execution) throw new Error(`No such fake execution: ${executionArn}`);
    execution.status = status;
    execution.stopDate = new Date();
    execution.events.push({ timestamp: execution.stopDate, type: `Execution${status[0]}${status.slice(1).toLowerCase()}`, error, cause });
  }
}
