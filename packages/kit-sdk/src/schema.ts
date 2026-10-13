import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import type { JsonSchema, JsonValue } from './types.js';

/** Schemas are compiled only by the trusted background host, never in the renderer. */
export function compileSchema(schema: JsonSchema): (input: unknown) => JsonValue {
  assertJsonValue(schema, 256 * 1024);
  const Validator = String(schema.$schema ?? '').includes('2020-12') ? Ajv2020 : Ajv;
  const ajv = new Validator({
    strict: true,
    allErrors: true,
    validateFormats: false,
    logger: false,
    removeAdditional: false,
    useDefaults: false,
    coerceTypes: false,
  });
  const validate = ajv.compile(schema);
  return (input) => {
    assertJsonValue(input, 256 * 1024);
    if (!validate(input))
      throw new Error(
        `Kit schema validation failed: ${ajv.errorsText(validate.errors, { dataVar: 'input' })}`,
      );
    return structuredClone(input) as JsonValue;
  };
}
export function assertJsonValue(value: unknown, maxBytes = 256 * 1024): asserts value is JsonValue {
  const seen = new Set<object>();
  let count = 0;
  function visit(child: unknown, depth: number): void {
    if (depth > 40 || ++count > 10000) throw new Error('Kit value exceeds structural limits');
    if (child === null || typeof child === 'string' || typeof child === 'boolean') return;
    if (typeof child === 'number') {
      if (!Number.isFinite(child)) throw new Error('Kit numbers must be finite');
      return;
    }
    if (typeof child !== 'object') throw new Error('Kit values must be JSON serializable');
    if (seen.has(child)) throw new Error('Kit value contains cycles');
    seen.add(child);
    if (!Array.isArray(child) && ![Object.prototype, null].includes(Object.getPrototypeOf(child)))
      throw new Error('Kit values must be plain JSON objects');
    for (const [key, nested] of Object.entries(child)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('Kit value contains a reserved object key');
      visit(nested, depth + 1);
    }
    seen.delete(child);
  }
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes)
    throw new Error('Kit value exceeds size limit');
}
