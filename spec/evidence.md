# RaC Evidence — The Evidence Corpus and the Family Registry

This file is the normative specification of the **evidence model** of
Regulation-as-Code (RaC): the shape of a corpus record, and the **family
registry** that links a `Requirement`'s `family` to the receipts that satisfy
it. It is frozen at v1.

`grammar.md` treats a requirement's `family` as an opaque string and `evaluation.md`
matches corpus receipts to requirements by that string. This file defines what a
corpus record is, what `family` means, and how the two sides agree on a family —
without ever closing the set of families.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as described in RFC 2119 / RFC 8174.

Notation in this file is TypeScript-ish, matching the shipped type definitions.
All record fields are immutable (`readonly`); the modifier is elided in examples
for brevity.

---

## 1. The abstract corpus record (normative)

The **evidence corpus** is a read-only set of normalized records — one per piece
of evidence a workspace has accrued. Each record is a `CorpusReceipt`:

```ts
interface CorpusReceipt {
  family: string;       // evidence-family discriminator (§2)
  claimId: string;      // stable identifier of the underlying claim/receipt
  issuedAt: string;     // ISO 8601 instant the evidence was produced
  active: boolean;      // currently in force (not revoked, not expired)
  eventType?: string;   // optional sub-family discriminator (§4)
}
```

A `CorpusReceipt` is a **normalized summary**, not a wire format. An
implementation produces it via an adapter that projects whatever underlying
evidence it holds (a signed receipt, a database row, an attestation) down to
these five fields. The evaluator (`evaluation.md`) reasons over `CorpusReceipt`
and nothing else; it never sees the underlying evidence.

### 1.1 Field semantics and how evaluation uses each

- **`family`** — the evidence-family discriminator, an opaque string (§2). A
  leaf requirement (`exists` / `fresh` / `count`) selects only receipts whose
  `family` is **string-equal** to the requirement's `family`. This is the
  primary join key between the authored grammar and the corpus.
- **`claimId`** — the receipt's stable identifier. The evaluator surfaces it as
  the report's **`evidenceClaimId`**: when a requirement selects a receipt
  (the `exists`/`fresh` hit, the first `count` match, or the carried member of
  an `all`/`any` fold), that receipt's `claimId` becomes the result's
  `evidenceClaimId` (`evaluation.md` §7.2). It is otherwise the consumer's
  handle for "which receipt proved this".
- **`issuedAt`** — an ISO 8601 timestamp marking when the evidence was produced.
  The `fresh` requirement's age arithmetic (`evaluation.md` §5.2) consumes it:
  `ageDays(issuedAt, now) = floor((now − issuedAt) / 86_400_000)` decides
  `satisfied` / `at-risk` / `expired`. Behaviour is undefined for a non-ISO
  value; producers **MUST** emit a valid ISO 8601 instant.
- **`active`** — whether the receipt is currently in force (not revoked, not
  expired at source). By default only active receipts count toward a requirement:
  `where.activeOnly` defaults to **`true`**, and the `newestActive` helper used by
  `exists` and `fresh` considers only active receipts regardless
  (`evaluation.md` §5.6). Setting `activeOnly: false` lets inactive receipts
  count — meaningful only for `count`, which scans the full filtered set.
- **`eventType?`** — an optional sub-family discriminator (§4). A receipt that
  does not set it leaves it `undefined`; a `where.eventType` filter then **never**
  matches that receipt. A requirement with no `where` ignores it entirely.

### 1.2 The corpus is the evaluator's only evidence

Reconciliation takes the corpus as a read-only array and **MUST NOT** mutate it
(`evaluation.md` §1.1). The corpus carries no clock and no facts — time enters
the evaluator only through the injected `now`, and applicability is decided
purely from facts. A `CorpusReceipt` therefore needs no fields beyond the five
above; anything else an adapter knows stays in the adapter.

---

## 2. The open family registry (normative)

A **family** is an opaque, **case-sensitive** string that names a *kind* of
evidence. It is the discriminator that ties an authored requirement to the
receipts that can satisfy it.

The registry is **OPEN**. There is no closed, RaC-defined set of families. An
implementer **MAY** mint a new family by choosing a string and emitting
`CorpusReceipt`s that carry it; no central registration, allocation, or approval
step exists or is required. RaC neither enumerates nor constrains the family set
— `grammar.md` §3 deliberately treats `family` as an opaque string for exactly
this reason.

The matching rule is exact-string equality:

> A requirement's `family` matches a corpus receipt **iff** the two `family`
> strings are **equal** (byte-for-byte, case-sensitive). There is no
> normalization, no aliasing, no prefix or namespace matching, and no
> case-folding. `"AIR"` does not match `"air"`, and `"INVOICE"` does not match
> `"Invoice"`.

Because matching is pure string equality, a family that appears in a requirement
but in no receipt simply yields no matches (the requirement reads `missing` for
`exists`/`fresh`, or an unmet count) — an unknown family is never an error.
Conversely, a family that appears in receipts but in no requirement is inert.

### 2.1 Profiles bind families (normative)

RaC's core (grammar, compilation, evaluation, this evidence model) is
family-agnostic. The *meaning* of a particular family — what real-world event a
receipt in that family attests, and which producer mints it — lives in a
**profile**: a regulation-specific binding layered on top of the core.

- A profile **SHOULD** document, explicitly and exhaustively, **which families
  it binds** and what each one means, so that authors and corpus producers agree
  on the same strings.
- A profile **MAY** reuse families defined by another profile (e.g. the
  reference binding below) or mint its own; either way it **SHOULD** state which.
- Two profiles that use the same family string are asserting they mean the same
  evidence kind. Profiles that mean *different* things **MUST** use *different*
  family strings; collision of meaning under one string is an authoring error a
  profile **MUST** avoid.

> The GDPR profile (forthcoming — see the GDPR profile spec) binds the reference
> families in §3 (e.g. `AIR` for DPIAs, `FORGET` for verifiable erasure). It is
> the canonical worked example of a profile selecting families from the
> reference binding; it does not extend or close the registry.

---

## 3. Reference binding — the anchors families (informative)

> **This section is INFORMATIVE — it is NOT normative and NOT a closed set.**
> The families below are the **reference binding** that the GDPR profile uses;
> they originate in the Dekimu *anchors* receipt formats. They are documented
> here so an implementer can adopt a known, interoperable vocabulary instead of
> minting their own — **not** because RaC requires them. An RaC implementation
> that binds entirely different families is fully conformant. Nothing in this
> section constrains the open registry of §2.

The reference binding comprises **14 anchors families** plus **one non-anchors
evidence source** (`FORGET`). Each is a `family` string a `CorpusReceipt` may
carry and a requirement may reference.

### 3.1 The 14 anchors families

| Family   | One-line meaning (reference binding) |
|----------|--------------------------------------|
| `APR`    | Action / Processing Receipt — a recorded action or processing event. |
| `ACR`    | Consent Receipt — a recorded grant of consent. |
| `ARR`    | Rights / Request Receipt — a data-subject right exercised and recorded. |
| `ALR`    | Lineage Receipt — a recorded data-flow / lineage step. |
| `ATR`    | Transfer Receipt — a recorded (cross-border) data transfer. |
| `APuR`   | Purpose Receipt — a recorded processing purpose. |
| `AER`    | Erasure Receipt — a recorded erasure handled through the receipt pipeline. |
| `AAR`    | Access Receipt — a recorded access to or disclosure of data. |
| `ADR`    | Decision Receipt — a recorded (automated) decision. |
| `ANR`    | Notification Receipt — a recorded notification (e.g. breach / data-subject). |
| `ASR`    | Subject-request Receipt — a recorded handling of a subject request. |
| `ABR`    | Breach Receipt — a recorded breach event. |
| `AIR`    | Impact / Assessment Receipt — a recorded impact assessment such as a DPIA. |
| `ATokR`  | Token / Tokenization Receipt — a recorded tokenization event. |

These map one-to-one to the locked `AnchorsFamily` union in the reference
implementation. The exact wire formats are an anchors concern and are **out of
scope** for this spec; RaC sees only the projected `CorpusReceipt`.

### 3.2 `FORGET` — non-anchors evidence source

`FORGET` is **not** an anchors family. It names **proof-of-erasure /
proof-of-forgetting** destruction receipts: verifiable evidence that data was
actually destroyed (the GDPR Art. 17 erasure capability), produced by retention
enforcement rather than by an anchors mint.

It is kept distinct from the 14 anchors families because it evidences a
different thing: unlike an `ASR` (which evidences a *handled request* and so
cannot be required for a right nobody exercised without a false red), a
destruction receipt is produced by enforcement itself — so a requirement like
`exists FORGET` is a capability signal with no false-red.

The presence of `FORGET` alongside the 14 anchors families is exactly why the
registry is open rather than closed: even the reference binding already mixes
two distinct evidence origins under one uniform `family` mechanism.

---

## 4. `eventType` — the sub-family discriminator

`eventType` is an **optional** sub-family discriminator captured on a
`CorpusReceipt` at production time. Its purpose is to distinguish *events within
one family* so a requirement can demand a specific event without a coarse,
family-wide match.

For example, within the reference `AIR` family a producer might emit:

- `dpia.completed` — a DPIA was completed; and
- `dpia.prior_consultation_resolved` — the Art. 36 prior-consultation step was
  resolved.

Both are `AIR` receipts, but a requirement that needs the prior-consultation
event specifically can scope to it with `where.eventType:
["dpia.prior_consultation_resolved"]` rather than matching any `AIR`.

Matching against `ReceiptFilter.eventType` is exactly as `evaluation.md` §5.6
and `grammar.md` §3.2 specify:

- When a requirement's `where.eventType` is **omitted**, any event within the
  family matches (the discriminator is ignored).
- When `where.eventType` is **present** it is a non-empty `string[]`; a receipt
  matches only if its `eventType` is **string-equal** to one of the listed
  values.
- A receipt that carries **no** `eventType` (`undefined`) **never** matches a
  non-empty `eventType` filter. This is the same fail-shut rule as
  `evaluation.md`: an adapter that does not set `eventType` leaves the receipt
  invisible to any event-scoped requirement, never silently matching it.

`eventType` strings are themselves opaque and per-family; like family strings,
their meaning is bound by a profile, and the same case-sensitive exact-equality
rule applies.

---

## 5. Worked example — a non-anchors binding (informative)

> Informative. This example exists to **prove the registry is genuinely open**:
> it uses families RaC has never heard of and that are not in the reference
> binding of §3, yet evaluates by exactly the same rules.

Suppose a fictional implementer, *Acme Books*, encodes a fiscal-records
regulation. They have nothing to do with anchors or GDPR. They mint two of their
**own** families:

- **`INVOICE`** — a recorded issued invoice (their own signed-record format),
  with `eventType` values `invoice.issued` and `invoice.voided`.
- **`AUDIT`** — a recorded external audit attestation.

Their adapter projects each into a `CorpusReceipt`:

```ts
const corpus: CorpusReceipt[] = [
  { family: "INVOICE", claimId: "inv-2026-0001", issuedAt: "2026-01-04T09:00:00Z", active: true, eventType: "invoice.issued" },
  { family: "AUDIT",   claimId: "audit-fy25",    issuedAt: "2026-02-01T00:00:00Z", active: true },
];
```

A tiny obligation in their profile references the `INVOICE` family directly:

```ts
const obligation: Obligation = {
  id: "fiscal.invoice-on-file",
  regulation: "Acme Fiscal Code §4",
  appliesWhen: { kind: "always" },
  requires: {
    kind: "exists",
    family: "INVOICE",
    where: { eventType: ["invoice.issued"] },
  },
  remediation: "Issue and record at least one invoice for the period.",
};
```

Evaluation needs no RaC change to handle this. The `exists` requirement selects
`newestActive(corpus, "INVOICE", { eventType: ["invoice.issued"] })`, finds
`inv-2026-0001` (active, `eventType` is `invoice.issued`), and the obligation is
`satisfied` with `evidenceClaimId = "inv-2026-0001"`. The `AUDIT` receipt is
inert here (no requirement references it). Had the `INVOICE` receipt carried no
`eventType`, the event-scoped filter would have rejected it and the obligation
would read `missing` — the §4 fail-shut rule, applied to a family the core never
defined.

This is the whole point: `INVOICE` and `AUDIT` are first-class families purely
because *Acme* chose those strings and bound them in their profile. The open
registry of §2 makes RaC a genuine open standard, not a fixed Dekimu family list.

---

## 6. Conformance summary

A conforming implementation:

- **MUST** treat a `CorpusReceipt` as the five-field record
  `{ family, claimId, issuedAt, active, eventType? }` (§1), produce it via an
  adapter, and treat the corpus as read-only;
- **MUST** treat `family` as an opaque, case-sensitive string and match a
  requirement to a receipt by **exact string equality** of `family` (§2), with
  no normalization, aliasing, or namespacing;
- **MUST NOT** treat the family set as closed — an implementer **MAY** mint new
  families freely, and an unknown family is never an error (§2);
- **MUST** match `where.eventType` by exact string equality, treating a receipt
  with no `eventType` as a non-match against any non-empty filter (§4);
- **SHOULD**, when defining a profile, document exactly which families it binds
  and what each means (§2.1);
- **MAY** adopt the reference binding (the 14 anchors families + `FORGET`, §3) —
  which is **informative**, not required — or bind entirely different families
  (§5) and remain fully conformant.
