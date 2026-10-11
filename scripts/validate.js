// Valida un gameday.json contra data/schema.json.
// Uso: node scripts/validate.js [ruta]   (exporta validateGameday para el bot)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaPath = new URL('../data/schema.json', import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

export function validateGameday(data) {
  const ok = validate(data);
  return { ok, errors: ok ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'data/gameday.json';
  const { ok, errors } = validateGameday(JSON.parse(readFileSync(file, 'utf8')));
  if (ok) {
    console.log(`✓ ${file} es válido`);
  } else {
    console.error(`✗ ${file} no valida:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
}
