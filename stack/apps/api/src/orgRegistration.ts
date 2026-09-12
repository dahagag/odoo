import type { AwsGateway } from '@stack/aws-gateway';
import type { OrgState, OrgType } from '@stack/domain';
import { ORGS_TABLE, orgPk } from './org/record';

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
 * an org by id" pattern) and maps it to the Org Registration shape both surfaces return - the
 * org-facing/admin *read* path's own narrower projection of the full `OrgRecord` (`org/record.ts`
 * owns the org item's write path and its full shape, #278). */
export async function readOrgRegistration(gateway: AwsGateway, orgId: string): Promise<OrgRegistration | undefined> {
  const item = await gateway.dynamoDb.getItem({ table: ORGS_TABLE, key: { pk: orgPk(orgId) } });
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
