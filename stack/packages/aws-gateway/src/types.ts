/**
 * `AwsGateway`'s own vocabulary (docs/dynamodb-access-patterns.md, docs/adr/0019,
 * docs/adr/0020). Deliberately narrower than the raw AWS SDK shapes: the point of the seam is
 * that stack logic depends on this restricted contract, never on the SDK directly (this
 * ticket's Implementation Decisions). In particular `DynamoCondition` is not a general
 * DynamoDB ConditionExpression - it covers exactly the patterns this stack needs (the lock's
 * `attribute_not_exists`, the seat counter's numeric ceiling), and `AwsSdkGateway` compiles each
 * one to a real ConditionExpression.
 */

// ---- Step Functions -------------------------------------------------------------------------

export interface StartExecutionInput {
  stateMachineArn: string;
  /** Caller-derived, e.g. `trial-<orgId>-<jobId>` (docs/adr/0019) - never auto-generated. */
  executionName: string;
  input: Record<string, unknown>;
}

export interface StartExecutionResult {
  executionArn: string;
}

export type ExecutionStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';

export interface DescribeExecutionResult {
  status: ExecutionStatus;
  startDate?: Date;
  stopDate?: Date;
  error?: string;
  cause?: string;
}

export interface ExecutionHistoryEvent {
  timestamp: Date;
  type: string;
  name?: string;
  error?: string;
  cause?: string;
}

export interface GetExecutionHistoryResult {
  events: ExecutionHistoryEvent[];
  nextToken?: string;
}

export interface StepFunctionsGateway {
  startExecution(input: StartExecutionInput): Promise<StartExecutionResult>;
  describeExecution(executionArn: string): Promise<DescribeExecutionResult>;
  getExecutionHistory(executionArn: string, nextToken?: string): Promise<GetExecutionHistoryResult>;
}

// ---- DynamoDB --------------------------------------------------------------------------------

export type DynamoKey = Record<string, string | number>;
export type DynamoItem = Record<string, unknown>;

export type DynamoCondition =
  | { type: 'attribute_not_exists'; attribute: string }
  | { type: 'attribute_exists'; attribute: string }
  | { type: 'attribute_equals'; attribute: string; value: string | number }
  | { type: 'numeric_less_than_or_equal'; attribute: string; value: number }
  /** One of several legal values (e.g. the org lifecycle state machine's multi-source
   * transitions - `destroy` is legal from both `active` and `suspended`, docs/adr/0034's
   * lifecycle port). A single `attribute_equals` can't express that; this is the narrowest
   * addition that can (this ticket, #278: "the seam covers exactly the patterns this stack
   * needs"). */
  | { type: 'attribute_in'; attribute: string; values: (string | number)[] };

export interface GetItemInput {
  table: string;
  key: DynamoKey;
}

export interface PutItemInput {
  table: string;
  item: DynamoItem;
  condition?: DynamoCondition;
}

export interface UpdateItemInput {
  table: string;
  key: DynamoKey;
  /** Attributes to set, and only these - unlike `putItem`, every other attribute already on the
   * item is left untouched. This is what lets two concurrent writers that each only care about
   * different attributes of the same item (e.g. a lifecycle transition writing `state`/
   * `lastJobId` alongside a `dnsSubdomainLabel` edit) avoid clobbering each other's change with a
   * stale full-item overwrite (#278's org record store). */
  set: DynamoItem;
  condition?: DynamoCondition;
}

export interface QueryInput {
  table: string;
  indexName?: string;
  partitionKey: { name: string; value: string | number };
  sortKeyPrefix?: { name: string; value: string | number };
  limit?: number;
  cursor?: string;
}

export interface QueryResult {
  items: DynamoItem[];
  nextCursor?: string;
}

export interface TransactPut {
  put: PutItemInput;
}

export interface TransactIncrement {
  /** Atomically adds `delta` (negative to decrement) to a numeric attribute, optionally gated
   * by `condition` - the seat-counter-against-the-cap write (this ticket's Implementation
   * Decisions: "written transactionally with the seat item — the invariant cannot rely on a
   * scan"). */
  increment: {
    table: string;
    key: DynamoKey;
    attribute: string;
    delta: number;
    condition?: DynamoCondition;
  };
}

export interface TransactDelete {
  delete: {
    table: string;
    key: DynamoKey;
    condition?: DynamoCondition;
  };
}

export interface TransactUpdate {
  update: {
    table: string;
    key: DynamoKey;
    set: DynamoItem;
    condition?: DynamoCondition;
  };
}

export type TransactWriteItem = TransactPut | TransactIncrement | TransactDelete | TransactUpdate;

export interface TransactWriteInput {
  items: TransactWriteItem[];
}

export interface DynamoDbGateway {
  getItem(input: GetItemInput): Promise<DynamoItem | undefined>;
  /** Throws `ConditionalCheckFailedError` when `condition` is not satisfied. */
  putItem(input: PutItemInput): Promise<void>;
  /** Partial update (see `UpdateItemInput.set`); throws `ConditionalCheckFailedError` when
   * `condition` is not satisfied. */
  updateItem(input: UpdateItemInput): Promise<void>;
  query(input: QueryInput): Promise<QueryResult>;
  /** All-or-nothing; throws `TransactionCanceledError` (carrying each item's outcome) when any
   * item's condition fails. */
  transactWrite(input: TransactWriteInput): Promise<void>;
}

// ---- Cost Explorer ---------------------------------------------------------------------------

export interface GetCostAndUsageInput {
  /** Inclusive ISO date (Cost Explorer's own convention: end is exclusive). */
  start: string;
  end: string;
  granularity: 'DAILY' | 'MONTHLY';
  filterTagKey?: string;
  filterTagValue?: string;
}

export interface CostAmount {
  start: string;
  end: string;
  unblendedCost: number;
  unit: string;
}

export interface GetCostAndUsageResult {
  amounts: CostAmount[];
}

export interface CostExplorerGateway {
  getCostAndUsage(input: GetCostAndUsageInput): Promise<GetCostAndUsageResult>;
}

// ---- EC2 ---------------------------------------------------------------------------------------

export type Ec2PowerState = 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated';

export interface Ec2Gateway {
  describeInstanceState(instanceId: string): Promise<Ec2PowerState>;
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
}

// ---- The seam ----------------------------------------------------------------------------------

/** One interface covering every AWS call the stack makes (this ticket's Implementation
 * Decisions). All stack logic depends on this, never on an AWS SDK client directly. */
export interface AwsGateway {
  readonly stepFunctions: StepFunctionsGateway;
  readonly dynamoDb: DynamoDbGateway;
  readonly costExplorer: CostExplorerGateway;
  readonly ec2: Ec2Gateway;
}
