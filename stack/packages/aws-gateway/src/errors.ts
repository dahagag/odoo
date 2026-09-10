/** Mirrors real DynamoDB/Step Functions failure modes so a fake-backed test proves the same
 * error-handling code path a real-AWS-backed run would take (this ticket's Testing Decisions:
 * "the fake must reject calls the real one would reject, or logic tests built on it prove
 * nothing"). */

export class ConditionalCheckFailedError extends Error {
  constructor(message = 'The conditional request failed') {
    super(message);
    this.name = 'ConditionalCheckFailedError';
  }
}

export class TransactionCanceledError extends Error {
  /** One entry per transact item, in order; `undefined` for an item whose condition passed
   * (matches DynamoDB's own `CancellationReasons` shape, which always has one entry per item so
   * the caller can tell *which* item failed). */
  readonly cancellationReasons: (string | undefined)[];

  constructor(cancellationReasons: (string | undefined)[]) {
    super('TransactionCanceledError');
    this.name = 'TransactionCanceledError';
    this.cancellationReasons = cancellationReasons;
  }
}

export class ExecutionAlreadyExistsError extends Error {
  constructor(readonly executionArn: string) {
    super('ExecutionAlreadyExists');
    this.name = 'ExecutionAlreadyExists';
  }
}
