import type { AwsGateway } from '@stack/aws-gateway';
import { ConditionalCheckFailedError } from '@stack/aws-gateway';

export interface IdempotencyRecord {
  status: number;
  body: unknown;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  /** Stores `record` under `key` only if no record is stored yet (a conditional write, not a
   * read-then-write) - a retried call from Odoo racing itself must still start at most one Step
   * Functions execution (this ticket's Implementation Decisions, preserving ADR-0019's
   * job-identity guarantee across the new HTTP hop). Returns the record that ends up stored:
   * `record` itself on a fresh key, or whatever a concurrent caller already stored first. */
  putIfAbsent(key: string, record: IdempotencyRecord): Promise<IdempotencyRecord>;
}

/** Local/dev/test-only store - a single process's plain Map, not durable and not shared across
 * instances. `DynamoIdempotencyStore` is what actually runs against AWS. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    return this.records.get(key);
  }

  async putIfAbsent(key: string, record: IdempotencyRecord): Promise<IdempotencyRecord> {
    const existing = this.records.get(key);
    if (existing) return existing;
    this.records.set(key, record);
    return record;
  }
}

/** Idempotency records share the org record store's single table (this ticket's Implementation
 * Decisions: single-table design) under `pk = idempotency#<key>` - a distinct item type in the
 * same table, not a table of its own. */
export class DynamoIdempotencyStore implements IdempotencyStore {
  constructor(private readonly gateway: AwsGateway, private readonly table = 'orgs') {}

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const item = await this.gateway.dynamoDb.getItem({ table: this.table, key: { pk: this.itemKey(key) } });
    if (!item) return undefined;
    return { status: item.status as number, body: JSON.parse(item.body as string) };
  }

  async putIfAbsent(key: string, record: IdempotencyRecord): Promise<IdempotencyRecord> {
    try {
      await this.gateway.dynamoDb.putItem({
        table: this.table,
        item: { pk: this.itemKey(key), status: record.status, body: JSON.stringify(record.body) },
        condition: { type: 'attribute_not_exists', attribute: 'pk' },
      });
      return record;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedError) {
        const existing = await this.get(key);
        if (existing) return existing;
      }
      throw error;
    }
  }

  private itemKey(key: string): string {
    return `idempotency#${key}`;
  }
}
