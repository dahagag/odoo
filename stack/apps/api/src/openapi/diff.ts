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

/** The named security schemes an operation accepts (docs/adr/0036 assigns a distinct scheme to
 * each surface - `orgToken` vs `sigv4`). Flattens OpenAPI's `security` array-of-requirement-
 * objects, since this contract never combines two schemes into one AND'd requirement. */
function securitySchemesOf(operation: OperationObject): Set<string> {
  const schemes = new Set<string>();
  for (const requirement of operation.security ?? []) {
    for (const name of Object.keys(requirement)) schemes.add(name);
  }
  return schemes;
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

      const previousSchemes = securitySchemesOf(previousOp);
      const currentSchemes = securitySchemesOf(currentOp);
      for (const scheme of previousSchemes) {
        if (!currentSchemes.has(scheme)) {
          // An existing caller credentialed for `scheme` (e.g. an org token, docs/adr/0036)
          // can no longer authenticate against this operation at all - as breaking as removing
          // the operation itself.
          issues.push(`removed security scheme "${scheme}" for ${label}`);
        }
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
