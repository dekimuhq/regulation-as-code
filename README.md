# Regulation-as-Code (RaC)

**Regulation-as-Code (RaC)** is an open, regulation-agnostic grammar for
expressing legal obligations as typed predicates over a verifiable evidence
corpus. An author encodes a regulation as a `SourceManifest` — a typed fact
schema plus a list of obligations, each pairing a `Condition` ("does this apply
to a workspace?") with a `Requirement` ("what evidence satisfies it?"). Reconciling
a manifest against a workspace's facts and its evidence produces a deterministic
per-obligation report, and from that report a reproducible, signed
`rac.evaluation.v1` receipt that anyone can independently re-run and verify against
this public spec. RaC fills the EU-obligation gap that
[OSCAL](https://pages.nist.gov/OSCAL/) — the NIST controls-assessment language,
which is US/cyber-oriented and ships no EU-obligation profile — does not cover. It
is **OSCAL-adjacent, not OSCAL**: it borrows the spirit of a machine-readable
compliance language without claiming conformance to the OSCAL schema.

The spec is **CC0 1.0** (public domain). The reference implementation is a
separate project and is not part of this repository.

## Type discriminators

- `rac.manifest.v1` — the wire form of a compiled manifest (the content-hashed IR).
- `rac.evaluation.v1` — the reproducible, signed evaluation receipt.

## Specification

The normative spec lives under `spec/`:

- [`spec/grammar.md`](spec/grammar.md) — the authored grammar: facts, conditions, requirements, obligations, and the `SourceManifest`.
- [`spec/compilation.md`](spec/compilation.md) — static checks, canonical `manifestHash`, and the topological evaluation order.
- [`spec/evaluation.md`](spec/evaluation.md) — the five-state status model, reconciliation, and honest coverage.
- [`spec/evidence.md`](spec/evidence.md) — the abstract evidence corpus, the OPEN family registry, and the anchors reference binding.
- [`spec/receipt.md`](spec/receipt.md) — the reproducible, algorithm-agile `rac.evaluation.v1` receipt and its verification contract.

Reference profile, crossmap, and conformance suite:

- [`profiles/gdpr/v1.md`](profiles/gdpr/v1.md) — the GDPR reference profile (8 obligations) proving the grammar on a real regulation.
- [`crossmap/oscal.md`](crossmap/oscal.md) — the OSCAL concept crossmap and the EU-obligation gap.
- [`conformance/`](conformance/) — executable conformance vectors (`vectors/*.json` against `vectors.schema.json`) plus [`conformance/assertions.md`](conformance/assertions.md).

## Worked example

A minimal manifest with one boolean fact and one `exists` obligation:

```ts
const manifest: SourceManifest = {
  id: "example-profile",
  version: "1.0.0",
  atRiskWindowDays: 30,
  facts: [
    { name: "processes_personal_data", type: "boolean" },
  ],
  obligations: [
    {
      id: "lawful-basis",
      regulation: "GDPR Art. 6",
      appliesWhen: { kind: "fact", fact: "processes_personal_data" },
      requires: { kind: "exists", family: "ACR" },
      remediation: "Record a consent / lawful-basis receipt (ACR).",
    },
  ],
};
```

When the workspace fact `processes_personal_data` is `true` and the corpus holds
an active receipt in family `ACR`, the obligation evaluates to **`satisfied`**;
with the same fact true but no such receipt, it is **`missing`**. When the fact
is `false`, `appliesWhen` is false and the obligation is **`not-applicable`** —
excluded from the honest coverage denominator.

## License & governance

- **License:** [CC0 1.0](LICENSE) — the spec text is dedicated to the public domain.
- **Governance:** see [GOVERNANCE.md](GOVERNANCE.md).
- **Security / vulnerability disclosure:** `security@dekimu.com` (see [SECURITY.md](SECURITY.md)).

Maintained by Dekimu.
