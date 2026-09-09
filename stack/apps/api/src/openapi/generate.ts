import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { API_VERSION } from '@stack/domain';
import { registry } from './registry';

/** Generates the OpenAPI document from the registry above - i.e. from the same Zod schemas the
 * routes validate requests/responses against, so the document cannot drift from what the server
 * actually accepts (this ticket's Implementation Decisions, docs/adr/0036). */
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Administration Stack API',
      version: API_VERSION,
      description: 'Odoo/staff-app/client-app contract for the Trial Org and Client Org record of truth (docs/adr/0034, docs/adr/0036).',
    },
    servers: [],
  });
}

const OUTPUT_PATH = path.join(__dirname, '..', '..', 'openapi', 'openapi.json');

if (require.main === module) {
  const document = generateOpenApiDocument();
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}
