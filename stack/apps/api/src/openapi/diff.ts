/**
 * Minimal breaking-change detector between two generated OpenAPI documents (this ticket's
 * Implementation Decisions: "CI to fail on a breaking contract change"). Deliberately not a
 * general-purpose OpenAPI diff tool - it checks exactly the shapes of change this contract
 * cares about: a removed path/operation/response, a newly required request field, a removed
 * response field a consumer may already read, or a security scheme an operation stops
 * accepting (docs/adr/0036 - an org token or SigV4 caller that could authenticate before can no
 * longer authenticate at all).
 */

interface JsonSchema {
  $ref?: string;
  required?: string[];
  properties?: Record<string, unknown>;
}

interface MediaTypeObject {
  schema?: JsonSchema;
}

interface OperationObject {
  requestBody?: { content?: Record<string, MediaTypeObject> };
  responses?: Record<string, { content?: Record<string, MediaTypeObject> }>;
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiDocument {
  paths?: Record<string, Record<string, OperationObject>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

function resolveSchema(doc: OpenApiDocument, schema: JsonSchema | undefined): JsonSchema {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? '';
    return doc.components?.schemas?.[name] ?? {};
  }
  return schema;
}

function jsonSchemaOf(doc: OpenApiDocument, content: Record<string, MediaTypeObject> | undefined): JsonSchema {
  return resolveSchema(doc, content?.['application/json']?.schema);
}

/** Each OpenAPI Security Requirement Object in `security` is its own alternative (OR'd against
 * the others); the scheme names inside one object are AND'd together. Kept as one Set per
 * alternative (not flattened) so a change that merges separately-sufficient alternatives into
 * one combined requirement (docs/adr/0036: an orgToken-only or SigV4-only caller losing access)
 * is still caught as breaking. */
function securityAlternativesOf(operation: OperationObject): Set<string>[] {
  return (operation.security ?? []).map((requirement) => new Set(Object.keys(requirement)));
}

function isSubsetOf(smaller: Set<string>, larger: Set<string>): boolean {
  for (const scheme of smaller) if (!larger.has(scheme)) return false;
  return true;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Returns one human-readable line per breaking change found; an empty array means the change
 * from `previous` to `current` is safe. */
export function findBreakingChanges(previous: OpenApiDocument, current: OpenApiDocument): string[] {
  const issues: string[] = [];
  const previousPaths = previous.paths ?? {};
  const currentPaths = current.paths ?? {};

  for (const [pathKey, previousMethods] of Object.entries(previousPaths)) {
    const currentMethods = currentPaths[pathKey];
    if (!currentMethods) {
      issues.push(`removed path: ${pathKey}`);
      continue;
    }

    for (const method of HTTP_METHODS) {
      const previousOp = previousMethods[method];
      if (!previousOp) continue;
      const label = `${method.toUpperCase()} ${pathKey}`;
      const currentOp = currentMethods[method];
      if (!currentOp) {
        issues.push(`removed operation: ${label}`);
        continue;
      }

      for (const status of Object.keys(previousOp.responses ?? {})) {
        if (!(currentOp.responses ?? {})[status]) {
          issues.push(`removed response ${status} for ${label}`);
        }
      }

      const previousAlternatives = securityAlternativesOf(previousOp);
      const currentAlternatives = securityAlternativesOf(currentOp);
      for (const previousAlt of previousAlternatives) {
        const stillSatisfiable = currentAlternatives.some((currentAlt) => isSubsetOf(currentAlt, previousAlt));
        if (!stillSatisfiable) {
          // A caller credentialed for exactly `previousAlt` (e.g. an org token alone,
          // docs/adr/0036) can no longer satisfy any current alternative - as breaking as
          // removing the operation itself.
          issues.push(`removed security requirement "${[...previousAlt].sort().join('+')}" for ${label}`);
        }
      }
      if (previousAlternatives.length === 0 && currentAlternatives.length > 0) {
        // The operation accepted anonymous callers before (e.g. /healthz, /readyz today) and
        // now rejects every one of them with a 401 - as breaking, in the other direction, as
        // the removed-scheme case above.
        issues.push(`newly required authentication for ${label}`);
      }

      const previousRequired = new Set(jsonSchemaOf(previous, previousOp.requestBody?.content).required ?? []);
      const currentRequired = new Set(jsonSchemaOf(current, currentOp.requestBody?.content).required ?? []);
      for (const field of currentRequired) {
        if (!previousRequired.has(field)) {
          issues.push(`new required request field "${field}" for ${label}`);
        }
      }

      for (const status of ['200', '201']) {
        const previousResponseSchema = jsonSchemaOf(previous, previousOp.responses?.[status]?.content);
        const currentResponseSchema = jsonSchemaOf(current, currentOp.responses?.[status]?.content);
        for (const field of Object.keys(previousResponseSchema.properties ?? {})) {
          if (!(currentResponseSchema.properties ?? {})[field]) {
            issues.push(`removed response field "${field}" (${status}) for ${label}`);
          }
        }
      }
    }
  }

  return issues;
}
