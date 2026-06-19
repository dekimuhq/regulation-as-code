# RaC ↔ OSCAL — Crossmap and the EU-Obligation Gap

This file maps Regulation-as-Code (RaC) concepts to their nearest counterparts in
[OSCAL](https://pages.nist.gov/OSCAL/) (the NIST Open Security Controls
Assessment Language), states where the two shapes diverge, and positions RaC
against OSCAL's coverage of EU legal obligations.

It is **positioning and a concept crossmap**, not a schema mapping. RaC is
**OSCAL-adjacent**: it borrows the spirit of a machine-readable compliance
language but does **not** claim conformance to the OSCAL JSON/XML/YAML schema.
See [§3 Honesty guardrail](#3-honesty-guardrail) for the explicit boundary.

The RaC concept names below are the ones defined in the sibling spec files; each
links to its normative source.

---

## 0. The two shapes in one sentence

OSCAL models **security controls and the assessment of them** — catalogs of
controls (e.g. NIST SP 800-53), profiles that tailor a baseline, component
definitions, and assessment artifacts (plans, results, findings, POA&M). RaC
models **legal obligations as typed predicates over a verifiable evidence
corpus** — an applicability `Condition` paired with a satisfaction `Requirement`,
reconciled deterministically into a signed, recomputable receipt.

They overlap in intent (express compliance so a machine can reason about it) and
diverge in subject (security controls vs. legal obligations) and in evidence
discipline (attached artifact references vs. independently verifiable anchored
receipts).

---

## 1. Concept crossmap

Each row maps a RaC concept to its **nearest** OSCAL concept. "Nearest" means
closest in role, not equivalent — the **Divergence** column is where the shapes
actually differ. The mapping is **one-directional and approximate**: it exists to
orient an OSCAL-literate reader, not to assert interchangeability.

| RaC concept | Nearest OSCAL concept | Divergence (why they are not the same shape) |
|---|---|---|
| [`Obligation`](../spec/grammar.md#4-obligation) — `appliesWhen` (`Condition`) + `requires` (`Requirement`) + `remediation` | control-implementation / `implemented-requirement` | The RaC obligation carries an **executable applicability predicate** (`appliesWhen`) and a **machine-evaluable satisfaction predicate** (`requires`), not prose control-implementation text. OSCAL's implemented-requirement is narrative-and-statement oriented and assumes a human (or external tool) judges satisfaction; a RaC obligation is *decided* by the evaluator, not asserted by a narrator. |
| [`Requirement`](../spec/grammar.md#3-requirement--satisfaction-quantifiers-over-the-corpus) — `exists` / `fresh` / `count` / `all` / `any` / `dependsOn` | assessment objective / assessment method | A RaC `Requirement` is a **machine-evaluable quantifier over the evidence corpus** (e.g. "a `fresh` receipt in this family no older than N days", "`count gte n`"). An OSCAL assessment objective + method describes a **human assessment procedure** (examine / interview / test) to be carried out by an assessor; it is a procedure to follow, not a predicate that evaluates to a status. |
| [`rac.evaluation.v1`](../spec/receipt.md#1-the-receipt-shape-normative) receipt | assessment-results / `finding` | A RaC receipt is **reproducible and cryptographically signed**: it binds `manifestHash`, `factsHash`, `corpusDigest`, and `reportHash`, so **anyone** can recompute the [`ObligationReport`](../spec/evaluation.md#71-obligationreport) from the same inputs and confirm the result. OSCAL assessment-results are an assessor's **recorded findings** — authoritative because of who signed off, not because a third party can re-derive them from pinned inputs. |
| [`CorpusReceipt`](../spec/evidence.md#1-the-abstract-corpus-record-normative) (one item of the evidence corpus) | observation / evidence | A RaC `CorpusReceipt` summarizes an **independently verifiable anchored receipt** — the underlying evidence is itself a signed, externally checkable artifact (see [evidence.md §2 family registry](../spec/evidence.md#2-the-open-family-registry-normative)). OSCAL observations attach or **reference** evidence artifacts (a link, a relevant-evidence pointer); the verifiability of the artifact is out of band, not a property the model guarantees. |
| [`SourceManifest`](../spec/grammar.md#5-sourcemanifest) → [`CompiledManifest`](../spec/compilation.md#2-compiledmanifest) | catalog + profile | A RaC manifest is a **total program with a content-hash version pin** (`manifestHash` = sha256 of the canonical IR — see [compilation.md](../spec/compilation.md#2-compiledmanifest)). Every obligation is statically validated and a topological `evalOrder` is fixed at compile time. An OSCAL catalog is a **library of controls** and a profile **selects/tailors a baseline** from it; neither is a compiled, content-addressed, totally-evaluable program — they are documents to be interpreted by tooling, not an IR with a binding digest. |
| [`FactSchema`](../spec/grammar.md#1-factschema) / [`WorkspaceFacts`](../spec/evaluation.md#1-inputs-and-output) | system-characteristics / `prop` (properties) | RaC facts are **typed applicability inputs** (`boolean` / `number` / `enum`) declared by the manifest and supplied by a workspace, validated fail-closed before any obligation runs ([evaluation.md §3](../spec/evaluation.md#3-fact-validation-fail-closed)). OSCAL system-characteristics and properties describe a system descriptively (free-form props, metadata); they are not a closed typed schema that an applicability predicate is evaluated against. |

### 1.1 What has no clean counterpart

Two RaC features have no direct OSCAL analogue and are listed here rather than
forced into a row:

- **The five-status model** (`satisfied` / `at-risk` / `expired` / `missing` /
  `not-applicable`, [evaluation.md §2](../spec/evaluation.md#2-the-status-model)),
  including the `at-risk` grace window driven by `atRiskWindowDays`. OSCAL has no
  time-decay status for evidence freshness.
- **Determinism as a contract** — RaC reconciliation is a pure function of
  `(manifest, corpus, facts, now)` with no clock or I/O
  ([evaluation.md §1.1](../spec/evaluation.md#11-purity)). OSCAL assessment-results
  do not promise byte-identical reproduction from pinned inputs.

---

## 2. The EU-obligation gap

OSCAL is **US- and cyber-security-control oriented**. Its catalogs, baselines,
and assessment models are built around security control frameworks (NIST SP
800-53 and peers), and OSCAL-based submission is **mandated for FedRAMP from
September 2026**. That is exactly the territory it serves well.

What OSCAL does **not** carry is a **machine-readable obligation profile for EU
law** — GDPR, the AI Act, or DORA — expressed as obligations bound to verifiable
evidence. OSCAL models *security controls and their assessment*; it does not
model an **EU legal obligation** ("when special-category data is processed, a
fresh DPIA receipt MUST exist") as a typed predicate that evaluates against a
corpus of independently verifiable receipts. The shape an EU obligation needs —
executable applicability, a satisfaction quantifier over evidence, a citation to
the authoritative legal text, and a freshness/grace model — is not the shape
OSCAL's control-and-assessment models provide.

**RaC fills the EU-obligation gap.** Its grammar encodes an EU regulation as a
[`SourceManifest`](../spec/grammar.md#5-sourcemanifest) of obligations, each with
a `citationUrl` to the legal source (see the
[GDPR v1 reference profile](../profiles/gdpr/v1.md)), and reconciles it into a
reproducible signed receipt. This is **complementary**, not competitive: where a
consumer's pipeline expects OSCAL, RaC can **export toward OSCAL
assessment-results** — projecting an [`ObligationReport`](../spec/evaluation.md#71-obligationreport)
into OSCAL findings so a RaC evaluation can ride alongside an existing OSCAL
assessment flow. The RaC receipt remains the authoritative, recomputable record;
the OSCAL projection is a downstream interchange convenience.

> Stated factually: OSCAL has no EU GDPR/AI-Act/DORA machine-readable obligation
> profile bound to verifiable evidence today. RaC supplies one and can hand its
> results to an OSCAL consumer that wants them in OSCAL's shape.

---

## 3. Honesty guardrail

The boundaries of the claims in this file, stated plainly:

- **RaC is OSCAL-adjacent — not OSCAL.** It draws on the same idea (compliance a
  machine can reason about) but is a distinct grammar with a different subject and
  a different evidence model.
- **RaC does not claim OSCAL-schema conformance.** A RaC artifact is **not** a
  valid OSCAL document, and nothing here asserts that it validates against the
  OSCAL JSON/XML/YAML schema. The crossmap in §1 is an approximate, one-way
  orientation aid, not a guarantee of interchange. RaC is **not a substitute for
  OSCAL**.
- **RaC complements OSCAL — it rides alongside it, it does not replace it.** For
  US security-control assessment and FedRAMP submission, OSCAL is the right tool.
  RaC addresses the EU-obligation space OSCAL does not cover, and exports toward
  OSCAL where a pipeline expects it.
- **No superlatives.** This file makes no claim that RaC is the first, the only,
  or that no other approach exists. The gap is described factually: OSCAL has no
  EU-obligation profile; RaC provides one. Adoption, breadth, and maturity of any
  approach in this space are out of scope for this document.

---

## 4. References

- RaC grammar — [`spec/grammar.md`](../spec/grammar.md)
- RaC compilation — [`spec/compilation.md`](../spec/compilation.md)
- RaC evaluation — [`spec/evaluation.md`](../spec/evaluation.md)
- RaC evidence corpus + family registry — [`spec/evidence.md`](../spec/evidence.md)
- RaC receipt (`rac.evaluation.v1`) — [`spec/receipt.md`](../spec/receipt.md)
- GDPR v1 reference profile — [`profiles/gdpr/v1.md`](../profiles/gdpr/v1.md)
- OSCAL — <https://pages.nist.gov/OSCAL/>
