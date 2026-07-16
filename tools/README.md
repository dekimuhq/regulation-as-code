# tools/ — structural validation

Repo tooling, not spec content. One command, no dependencies, no network:

```sh
node tools/validate.mjs
```

Exits 0 when clean; prints every failure and exits 1 otherwise. CI runs the two
smokes first (`tools/lib/*.smoke.mjs`), then the validator.

## What it checks — three families

1. **Vectors** — every `conformance/vectors/*.json` validates against
   `conformance/vectors.schema.json`, and each vector's `expected` block is
   internally coherent: `name` matches the filename stem, `results` list every
   profile obligation exactly once in author order, and `coverageRatio` equals
   `satisfied / applicable` (not-applicable excluded; `1` when applicable is 0 —
   the honest denominator, per `conformance/assertions.md`).
2. **Citations** — every `profiles/citations.json` row binds to a real obligation
   in the profile, and every obligation that declares a `citationUrl` has a
   matching registry row. `citationUrl` is a SHOULD, not a MUST — obligations
   without one are never flagged.
3. **Links** — every relative link and `#anchor` across the repo's markdown
   resolves. External URLs are out of scope (audited elsewhere).

## The oracle boundary

The normative oracle for a profile is the shipped reconciliation engine, which
is private — the round-trip checker "lives outside this CC0 repo"
(`conformance/assertions.md` § Running the suite). This validator therefore
**cannot** decide whether a vector's per-obligation `status` is the *right
answer* for its corpus. It verifies only that each vector is internally coherent
and consistent with the profile it names — arithmetic and set-comparison over
content already in the repo. Do not add status derivation, `fresh`/`maxAgeDays`
date maths, or applicability derivation from `appliesWhen`; the full boundary is
documented at the top of `tools/lib/checks.mjs`.

## schema-mini is a scoped subset — by design

`tools/lib/schema-mini.mjs` is **not** a general JSON Schema implementation. It
supports exactly the keywords `vectors.schema.json` uses today. The load-bearing
safety feature is the unknown-keyword guard: `assertSupported()` walks the schema
first and **throws** on any keyword it does not implement, so a schema that grows
`oneOf`/`$ref`/`pattern` breaks CI loudly instead of silently validating less.

To add a keyword: implement it in `schema-mini.mjs`, add it to `SUPPORTED`, and
cover both the accept and reject paths in `schema-mini.smoke.mjs`.

## Contributing

All commits require DCO sign-off (`git commit -s`) — see
[../CONTRIBUTING.md](../CONTRIBUTING.md). CI enforces it.
