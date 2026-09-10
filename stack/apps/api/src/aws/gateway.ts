import { AwsSdkGateway, InMemoryAwsGateway, type AwsGateway } from '@stack/aws-gateway';
import type { Env } from '../config/env';

/** Chooses the fake or the real `AwsGateway` from config (`STACK_AWS_MODE`), so nothing else in
 * this app constructs an `AwsSdkGateway`/`InMemoryAwsGateway` directly - the one place that
 * decides is this factory. */
export function buildAwsGateway(env: Env): AwsGateway {
  if (env.STACK_AWS_MODE === 'fake') {
    return new InMemoryAwsGateway();
  }
  return new AwsSdkGateway({
    region: env.AWS_REGION,
    dynamoTableNames: {
      orgs: env.DYNAMO_TABLE_ORGS,
      locks: env.DYNAMO_TABLE_LOCKS,
    },
  });
}
