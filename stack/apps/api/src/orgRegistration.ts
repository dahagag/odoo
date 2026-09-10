import type { AwsGateway } from '@stack/aws-gateway';
import type { OrgState, OrgType } from '@stack/domain';

export interface OrgRegistration {
  orgId: string;
  type: OrgType;
  state: OrgState;
  name: string;
  domain: string;
  seatsUsed: number;
  seatsTotal: number;
  expiryDate?: string;
}

/** Reads an org record from the single-table store (docs/dynamodb-access-patterns.md's "fetch
 * an org by id" pattern) and maps it to the Org Registration shape both surfaces return.
 * Deliberately the only place either route touches `awsGateway.dynamoDb` directly - the
 * lifecycle port (#196) is what actually writes these records; this ticket only wires the read
 * path so the seam is exercised end to end. */
export async function readOrgRegistration(gateway: AwsGateway, orgId: string): Promise<OrgRegistration | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: 'orgs', key: { pk: `org#${orgId}` } });
  if (!item) return undefined;
  return {
    orgId,
    type: item.type as OrgType,
    state: item.state as OrgState,
    name: item.name as string,
    domain: item.domain as string,
    seatsUsed: item.seatsUsed as number,
    seatsTotal: item.seatsTotal as number,
    expiryDate: item.expiryDate as string | undefined,
  };
}
