// tools/lib/schema-mini.smoke.mjs — no fs, no network.
// Proves: (a) the real vectors.schema.json is fully supported; (b) unknown
// keywords throw LOUDLY (the guard that makes a scoped validator safe);
// (c) each implemented keyword actually rejects a violation.
import assert from "node:assert/strict";
import { assertSupported, validate } from "./schema-mini.mjs";

// (a) every keyword the real schema uses is implemented
const realSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "t", type: "object", additionalProperties: false,
  required: ["name", "profile"],
  properties: {
    name: { type: "string", minLength: 1 },
    profile: { const: "gdpr/v1" },
    now: { type: "string", format: "date-time" },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    results: { type: "array", minItems: 8, items: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { enum: ["satisfied", "missing"] } } } },
  },
};
assert.doesNotThrow(() => assertSupported(realSchema));

// (b) THE GUARD: an unimplemented keyword must throw, never silently pass
assert.throws(() => assertSupported({ type: "object", properties: { a: { pattern: "^x$" } } }), /unsupported keyword "pattern"/);
assert.throws(() => assertSupported({ oneOf: [] }), /unsupported keyword "oneOf"/);
assert.throws(() => assertSupported({ $ref: "#/x" }), /unsupported keyword "\$ref"/);
// (b2) the guard is TOTAL over keyword FORMS validate() does not implement:
// subschema-valued additionalProperties (validate only handles the boolean form)
assert.throws(() => assertSupported({ type: "object", additionalProperties: { type: "string" } }), /subschema-valued "additionalProperties"/);
// a format other than date-time (validate would silently ignore it)
assert.throws(() => assertSupported({ type: "string", format: "email" }), /unsupported format "email"/);
// tuple-form items (validate only handles a single subschema)
assert.throws(() => assertSupported({ type: "array", items: [{ type: "string" }] }), /tuple-form "items"/);
// and it reaches keywords nested under items-of-items
assert.throws(() => assertSupported({ type: "array", items: { type: "array", items: { type: "object", properties: { z: { $ref: "#/z" } } } } }), /unsupported keyword "\$ref" at #\/items\/items\/properties\/z/);

// (c) per-keyword rejection
const ok = { name: "n", profile: "gdpr/v1", now: "2026-06-19T00:00:00.000Z", ratio: 1, results: Array.from({ length: 8 }, () => ({ status: "satisfied" })) };
assert.deepEqual(validate(realSchema, ok), []);
assert.match(validate(realSchema, { ...ok, profile: "gdpr/v2" })[0], /must equal "gdpr\/v1"/);         // const
assert.match(validate(realSchema, { ...ok, name: "" })[0], /minLength/);                                // minLength
assert.match(validate(realSchema, { ...ok, ratio: 1.5 })[0], /maximum/);                                // maximum
assert.match(validate(realSchema, { ...ok, ratio: -1 })[0], /minimum/);                                 // minimum
assert.match(validate(realSchema, { ...ok, now: "19-06-2026" })[0], /RFC 3339 date-time/);              // format
assert.match(validate(realSchema, { ...ok, results: [{ status: "satisfied" }] })[0], /minItems/);        // minItems
assert.match(validate(realSchema, { ...ok, results: [...ok.results.slice(1), { status: "bogus" }] })[0], /is not one of/); // enum (in items)
assert.match(validate(realSchema, { ...ok, extra: 1 })[0], /unexpected property "extra"/);              // additionalProperties:false
assert.match(validate(realSchema, { profile: "gdpr/v1" })[0], /missing required property "name"/);      // required
assert.match(validate(realSchema, { ...ok, name: 5 })[0], /expected string, got number/);               // type
// null must report as "null", not "object"
assert.match(validate({ type: "object" }, null)[0], /expected object, got null/);
// nested paths are reported usefully
assert.match(validate(realSchema, { ...ok, results: [...ok.results.slice(1), { status: "bogus" }] })[0], /results\[7\]/);
console.log("schema-mini smoke OK");
