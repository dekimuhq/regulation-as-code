// A SCOPED JSON Schema validator — deliberately NOT a general draft 2020-12
// implementation. It supports exactly the keywords conformance/vectors.schema.json
// uses today. Anything else is a LOUD FAILURE via assertSupported(), never a
// silent pass: a schema that grows a keyword this file does not implement MUST
// break CI rather than quietly stop validating. That guard is what makes a
// hand-rolled subset safe — do not weaken it.
//
// Why zero-dep instead of ajv: this is a CC0 spec repo with no package.json, no
// lockfile and no runtime. Pulling npm + a transitive dep tree in to gain a
// general validator we do not need would add permanent supply-chain surface and
// dependabot churn to a repo whose only artifacts are markdown and JSON. Our
// structural peer (anchors-spec) is likewise dependency-free.

const SUPPORTED = new Set([
  "$schema", "title", "description", // annotations — parsed, ignored
  "type", "properties", "required", "additionalProperties", "items",
  "const", "enum", "minLength", "minItems", "minimum", "maximum", "format",
]);

const TYPE_OK = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
};

const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// RFC 3339 date-time. JSON Schema treats `format` as an annotation by default;
// we validate it deliberately — a vector's `now`/`issuedAt` drive the oracle's
// date maths, so a malformed timestamp is a real defect, not a style nit.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Throws on any keyword this validator does not implement. Call before validate(). */
export function assertSupported(schema, path = "#") {
  if (schema === null || typeof schema !== "object") return;
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED.has(k)) {
      throw new Error(`schema-mini: unsupported keyword "${k}" at ${path} — this validator implements a scoped subset of draft 2020-12. Implement the keyword in tools/lib/schema-mini.mjs (and cover it in the smoke), or move the repo to a full validator.`);
    }
  }
  for (const [k, v] of Object.entries(schema.properties ?? {})) assertSupported(v, `${path}/properties/${k}`);
  if (schema.items) assertSupported(schema.items, `${path}/items`);
}

/** @returns {string[]} human-readable errors; [] means valid. */
export function validate(schema, data, path = "(root)") {
  const errs = [];
  if ("const" in schema && JSON.stringify(data) !== JSON.stringify(schema.const)) {
    return [`${path}: must equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`];
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(data))) {
    return [`${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`];
  }
  if (schema.type) {
    const ok = TYPE_OK[schema.type];
    if (!ok) return [`${path}: schema-mini does not implement type "${schema.type}"`];
    if (!ok(data)) return [`${path}: expected ${schema.type}, got ${typeName(data)}`];
  }
  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) errs.push(`${path}: string shorter than minLength ${schema.minLength}`);
    if (schema.format === "date-time" && !DATE_TIME.test(data)) errs.push(`${path}: "${data}" is not an RFC 3339 date-time`);
  }
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) errs.push(`${path}: ${data} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) errs.push(`${path}: ${data} > maximum ${schema.maximum}`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) errs.push(`${path}: ${data.length} items < minItems ${schema.minItems}`);
    if (schema.items) data.forEach((d, i) => errs.push(...validate(schema.items, d, `${path}[${i}]`)));
  }
  if (TYPE_OK.object(data)) {
    for (const r of schema.required ?? []) if (!(r in data)) errs.push(`${path}: missing required property "${r}"`);
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const k of Object.keys(data)) if (!allowed.has(k)) errs.push(`${path}: unexpected property "${k}"`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in data) errs.push(...validate(sub, data[k], path === "(root)" ? k : `${path}.${k}`));
    }
  }
  return errs;
}
