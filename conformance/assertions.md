# RaC Conformance Assertions — `gdpr/v1`

The vectors in [`vectors/`](vectors/) are the executable conformance suite for the
`gdpr/v1` profile. Each carries a fixed `now`, declared `facts`, an evidence
`corpus`, and the **`expected`** report (`coverageRatio` + per-obligation
`status`). The expected values are not authored by hand — they are the output of
the **shipped reconciliation engine**, which is the normative **oracle**. A
conforming implementation MUST reproduce, for every vector, the exact
per-obligation status and coverage ratio recorded in its `expected` block.

The key words **MUST** / **MUST NOT** are RFC 2119 / RFC 8174.

An implementation reconciling the `gdpr/v1` profile:

- **MUST** fail closed on facts validation — every non-`optional` fact in the
  profile schema (`processesPersonalData`, `usesAiFeatures`) MUST be present, or
  reconciliation MUST throw and emit no report. `dpiaResidualRiskHigh` is
  `optional` and MAY be absent.

- **MUST** return `not-applicable` for the six personal-data obligations
  (`gdpr.lawful-basis`, `gdpr.purpose-limitation`, `gdpr.retention`,
  `gdpr.privacy-notice`, `gdpr.subject-rights`, `gdpr.erasure`) when
  `processesPersonalData` is `false`. *(Vector 01.)*

- **MUST** return `not-applicable` for `gdpr.dpia` (Art. 35) when
  `usesAiFeatures` is `false`, regardless of the personal-data facts.
  *(Vectors 01, 02, 03.)*

- **MUST** return `not-applicable` for `gdpr.prior-consultation` (Art. 36) unless
  **both** `usesAiFeatures` **and** `dpiaResidualRiskHigh` are `true` — an
  `all`-of-two-facts gate. A high-residual-risk trigger is required; a low/medium
  risk processor is never false-red. *(Vectors 01, 02, 03 ⇒ not-applicable;
  vector 04 ⇒ applicable.)*

- **MUST** return `1` for `coverageRatio` when no obligation applies
  (`applicable === 0`) — the vacuous-truth case, not `0` and not `NaN`.
  *(Vector 01.)*

- **MUST** return `missing` for an applicable `exists`/`fresh` obligation whose
  corpus carries no satisfying active receipt, and a `coverageRatio` of `0` when
  every applicable obligation is `missing`. *(Vector 02.)*

- **MUST** treat the coverage denominator as the **honest denominator** —
  `not-applicable` obligations are excluded; `satisfied / applicable`. With 6
  applicable and 5 satisfied the ratio MUST be `0.8333…`. *(Vector 03.)*

- **MUST** return `satisfied` for an `exists` obligation when an active receipt
  of the bound family is present (`ACR`→lawful-basis, `APuR`→purpose-limitation,
  `ASR`→subject-rights, `FORGET`→erasure, `AIR`→dpia). *(Vector 04 — in vector
  03 `usesAiFeatures` is false, so the `AIR`-bound dpia obligation is
  `not-applicable`, not `satisfied`.)*

- **MUST** apply the `fresh` boundaries with the manifest's `maxAgeDays` (365 for
  `ARR`/`ANR`) and manifest-level `atRiskWindowDays` (30): an active receipt aged
  `> maxAgeDays + atRiskWindowDays` (here 400 days > 395) MUST be `expired`,
  while an in-window receipt MUST be `satisfied`. *(Vector 03: ARR expired,
  ANR satisfied.)*

- **MUST** scope `gdpr.prior-consultation` to the `dpia.prior_consultation_resolved`
  AIR event via the `where.eventType` filter — a bare `dpia.completed` AIR (which
  satisfies `gdpr.dpia`, Art. 35) MUST NOT by itself satisfy `gdpr.prior-consultation`
  (Art. 36). Both events present ⇒ both obligations `satisfied`. *(Vector 04.)*

- **MUST** emit `results` in author order (the order of the profile's
  obligations), independent of internal evaluation order. *(All vectors list
  `expected.results` in author order.)*

## Running the suite

The round-trip checker lives **outside this CC0 repo** (it imports the private
`@dekimuhq/compass-*` packages) and is run from that workspace:

```
node scripts/rac-conformance-check.mjs <path-to>/conformance/vectors
```

It compiles the `gdpr/v1` source manifest and calls
`reconcile(manifest, corpus, facts, new Date(now))` per vector, comparing each
`expected` status and `coverageRatio` against real engine output. Output is
`PASS` or `FAIL (n)`. Any other conforming implementation MAY substitute its own
runner so long as it reproduces every vector's `expected` block.
