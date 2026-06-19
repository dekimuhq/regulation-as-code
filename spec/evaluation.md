# RaC Evaluation — Reconciling a Compiled Manifest against Facts and Evidence

This file is the normative specification of **evaluation** (also called
*reconciliation*): the deterministic, pure scoring of a
[`CompiledManifest`](compilation.md#2-compiledmanifest) against a workspace's
declared facts and its **evidence corpus**, producing an `ObligationReport`. It
is frozen at v1.

Reconciliation never compiles, never fetches, never reads a clock. It takes a
manifest that has already passed compilation (§3 of `compilation.md`), the facts
that describe the workspace, the receipts that constitute its evidence, and an
injected evaluation instant; it emits a per-obligation report and a coverage
summary. Given identical inputs it **MUST** produce an identical report.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as described in RFC 2119 / RFC 8174.

Notation in this file is TypeScript-ish, matching the shipped type definitions.
All record fields are immutable (`readonly`); the modifier is elided in examples
for brevity.

---

## 1. Inputs and output

Reconciliation is a function of four inputs:

```ts
function reconcile(
  manifest: CompiledManifest,
  corpus: readonly CorpusReceipt[],
  facts: WorkspaceFacts,
  now: Date,
): ObligationReport;
```

- **`manifest`** — a [`CompiledManifest`](compilation.md#2-compiledmanifest): the
  content-hashed, statically validated, evaluation-ready form of a source. It
  carries the `factSchema`, the canonical `obligations`, the topological
  `evalOrder`, and the `atRiskWindowDays` look-ahead window. Reconciliation
  assumes the manifest is already compiled — it performs **no** static check
  (those are compilation's job) and trusts `evalOrder` to be a total topological
  order over `dependsOn`.
- **`corpus`** — a read-only array of `CorpusReceipt` (the **evidence corpus**),
  defined normatively in [`evidence.md`](evidence.md). Each receipt is treated
  here as the given shape
  `{ family, claimId, issuedAt, active, eventType? }`:
  - `family` — the evidence-family discriminator a requirement matches on;
  - `claimId` — the receipt's stable identifier, surfaced as evidence in the
    report;
  - `issuedAt` — an ISO 8601 timestamp; the `fresh` age arithmetic (§5.2)
    consumes it and behaviour is undefined for a non-ISO value;
  - `active` — whether the receipt is currently in force (not revoked, not
    expired);
  - `eventType?` — an optional sub-family discriminator that a `where.eventType`
    filter narrows on.
- **`facts`** — a `WorkspaceFacts`: the declared answers describing the
  workspace, keyed by fact name. Validated against the manifest's `factSchema`
  before any obligation is evaluated (§3).
- **`now`** — the injected evaluation instant, a JavaScript **`Date`**. It is the
  **only** notion of "current time" reconciliation has: all age arithmetic reads
  `now`, and the report's `evaluatedAt` is `now.toISOString()`. No
  implementation step **MAY** call `Date.now()`, read a wall clock, or perform
  any other I/O. (The 14:00-vs-00:00 floor of `ageDays` in §5.2 is determined by
  the time-of-day carried in `now`.)

The output is an `ObligationReport` (§7).

### 1.1 Purity

Reconciliation **MUST** be a pure function:

- **Deterministic** — same `(manifest, corpus, facts, now)` ⇒ byte-identical
  `ObligationReport`.
- **No I/O** — no network, no filesystem, no logging side effects.
- **No clock access** — time enters *only* through the injected `now`. An
  implementation **MUST NOT** read the ambient clock.
- **Non-mutating** — `corpus`, `facts`, and `manifest` are treated as read-only
  and **MUST NOT** be mutated.

---

## 2. The status model

Every obligation resolves to exactly one of **five** statuses. This is the closed
`ObligationStatus` set:

```ts
type ObligationStatus =
  | "satisfied"
  | "at-risk"
  | "expired"
  | "missing"
  | "not-applicable";
```

- **`satisfied`** — the obligation applies and its requirement is met by the
  corpus.
- **`at-risk`** — a `fresh` requirement's evidence is still inside the grace
  window but past its nominal age limit (§5.2). The only requirement kind that
  *directly* produces `at-risk` is `fresh`; `all` / `any` may surface it by
  combination.
- **`expired`** — a `fresh` requirement's evidence exists but is past the limit
  **plus** grace (§5.2).
- **`missing`** — the obligation applies but no satisfying evidence was found
  (no receipt for `exists`/`fresh`, an unmet `count`, or an unmet `dependsOn`).
- **`not-applicable`** — the obligation's `appliesWhen` is `false` for this
  workspace; its requirement is **not** evaluated.

### 2.1 Status ranking

Sub-results are combined by a fixed ordinal ranking — *higher means "more
satisfied"*:

```ts
const RANK = {
  satisfied: 4,
  "at-risk": 3,
  expired: 2,
  missing: 1,
  "not-applicable": 0,
};
```

So `satisfied (4) > at-risk (3) > expired (2) > missing (1) > not-applicable (0)`.

This ranking is consulted in exactly two places, both inside requirement
combination (§5.4):

- **`all`** selects the **worst** (lowest-ranked) sub-result;
- **`any`** selects the **best** (highest-ranked) sub-result.

`not-applicable` is included in the ranking table for completeness, but a leaf
requirement (`exists`/`fresh`/`count`) **MUST NOT** itself yield
`not-applicable` — that status arises only from `appliesWhen` being false at the
obligation level (§4) or from a `dependsOn` whose target is not applicable
(§5.5). The ranking is **not** used to combine `appliesWhen` conditions (those
are plain booleans, §6) and is **not** used in coverage (§7.1).

---

## 3. Fact validation (fail closed)

Before any obligation is evaluated, `facts` **MUST** be validated against the
manifest's `factSchema`. Validation produces a list of human-readable error
strings; an **empty** list means the facts conform. If the list is **non-empty**,
reconciliation **MUST** fail closed by throwing — it **MUST NOT** evaluate any
obligation against non-conforming facts and **MUST NOT** emit a report.

The validation rules are exactly:

1. **No undeclared facts.** Every key present in `facts` **MUST** correspond to a
   `FactDef` declared in `factSchema`. A key with no matching declaration is an
   `undeclared fact` error.
2. **Required facts present.** For each declared `FactDef` that is **not**
   `optional`, a value **MUST** be present (not `undefined`). A missing required
   fact is a `missing fact` error.
3. **Optional facts may be absent.** A declared `optional` fact that is
   `undefined` is **not** an error; it is simply skipped during validation. (Its
   downstream default is fail-open — see §3.1.)
4. **Type conformance** for facts that *are* present:
   - a `boolean` fact's value **MUST** be a JavaScript `boolean`;
   - a `number` fact's value **MUST** be a JavaScript `number`;
   - an `enum` fact's value **MUST** be a `string` that is a member of the
     `FactDef`'s declared `values` list.
   A present value violating its declared type is a type error
   (`must be boolean` / `must be number` / `must be one of …`).

All conformant; otherwise throw. The throw carries the joined error list
(non-normative message text); consumers **MUST** treat the throw itself — not the
message — as the contract.

### 3.1 Optional facts default to `false`

An obligation reads facts through two paths, and both treat an **absent** value
as fail-open:

- A boolean read of a fact (`kind: "fact"` condition, §6) resolves an absent or
  non-`true` fact to `false` — i.e. an unanswered boolean fact is treated as
  `false`, never as an error at evaluation time (validation already permitted its
  absence for `optional` facts).
- A `compare` condition (§6) on an **absent** fact (value `undefined`) evaluates
  to `false` without invoking the comparison operator.

This is consistent with `grammar.md` §1.2: an absent optional fact is fail-open —
it makes its dependent condition `false` rather than aborting evaluation.

---

## 4. Per-obligation evaluation

Obligations are evaluated **in `evalOrder`** — the manifest's topological order
over `dependsOn` (§6 of `compilation.md`). Evaluating in this order guarantees
that when a `dependsOn` obligation is reached, the status of its target has
already been computed and recorded (§5.5).

For each obligation `ob` taken in `evalOrder`:

1. **Applicability.** Evaluate `ob.appliesWhen` (a `Condition`, §6) against
   `facts`.
   - If it is **`false`**, the obligation is **`not-applicable`**: its result is
     `{ status: "not-applicable", evidenceClaimId: null, remediation: null,
     detail: "Does not apply to this workspace." }`, its status is recorded as
     `not-applicable`, and its `requires` is **not** evaluated.
   - If it is **`true`**, proceed to evaluate `ob.requires`.
2. **Requirement.** Resolve `ob.requires` to a `{ status, evidenceClaimId,
   detail }` triple:
   - If `ob.requires.kind === "dependsOn"`, resolve it against the
     already-recorded status of its target (§5.5) — **not** by the leaf
     requirement evaluator.
   - Otherwise, evaluate it against the corpus via the requirement evaluator
     (§5), passing `manifest.atRiskWindowDays` and `now`.
3. **Result assembly.** Build the `ObligationResult` (§7) from the resolved
   triple plus the obligation's `regulation` and `remediation` (the `remediation`
   field is nulled for `satisfied` / `not-applicable`, §7.2), and record the
   resolved status for later `dependsOn` lookups.

Although evaluation proceeds in `evalOrder`, the report's `results` array is
emitted in **author order** — the order of `manifest.obligations` — which is
stable and independent of `evalOrder` (§7).

---

## 5. Requirement evaluation against the corpus

This section specifies the leaf and combinator requirement kinds. Each yields a
`{ status, evidenceClaimId, detail }` triple. A leaf evaluator **never** yields
`not-applicable`.

Two corpus helpers underlie the leaves:

- **`newestActive(corpus, family, where?)`** — the single **active** receipt of
  `family`, matching the `where` event-type scope (§5.6), with the **latest**
  `issuedAt`; or `null` when none qualifies. Inactive receipts are never
  selected by `newestActive` regardless of `where.activeOnly`.
- **`ageDays(issuedAt, now)`** — whole elapsed days from `issuedAt` to `now`,
  computed as `floor((now − issuedAt) / 86_400_000)` (one day = 86 400 000 ms),
  flooring toward zero. A receipt issued less than 24 h ago has age `0`.

### 5.1 `exists`

```ts
{ kind: "exists"; family: string; where?: ReceiptFilter }
```

Select `newestActive(corpus, family, where)`.

- A receipt is found ⇒ **`satisfied`**, `evidenceClaimId` = that receipt's
  `claimId`.
- No active matching receipt ⇒ **`missing`**, `evidenceClaimId` = `null`.

`exists` only ever yields `satisfied` or `missing`. By default only active
receipts count (§5.6).

### 5.2 `fresh`

```ts
{ kind: "fresh"; family: string; maxAgeDays: number; where?: ReceiptFilter }
```

Select `newestActive(corpus, family, where)`; let `age = ageDays(hit.issuedAt,
now)`. The status is decided by these boundaries, evaluated in order:

1. **No active matching receipt** ⇒ **`missing`**, `evidenceClaimId` = `null`.
2. `age <= maxAgeDays` ⇒ **`satisfied`** (the bound is **inclusive** — an age
   exactly equal to `maxAgeDays` is satisfied).
3. `age <= maxAgeDays + atRiskWindowDays` ⇒ **`at-risk`** (the grace window
   extends the limit by `atRiskWindowDays`; its upper bound is also
   **inclusive** — an age exactly equal to `maxAgeDays + atRiskWindowDays` is
   at-risk, not expired).
4. otherwise (`age > maxAgeDays + atRiskWindowDays`) ⇒ **`expired`**.

The grace arithmetic is `maxAgeDays + atRiskWindowDays` where `atRiskWindowDays`
is the manifest-level look-ahead (`manifest.atRiskWindowDays`, identical for
every `fresh` requirement in the manifest), **not** a per-requirement field. In
every non-`missing` branch, `evidenceClaimId` is the selected receipt's
`claimId` — including for `at-risk` and `expired` (the stale receipt is still
the evidence on record).

Examples (with `maxAgeDays = 30`, `atRiskWindowDays = 7`): `age = 30` ⇒
`satisfied`; `age = 31` ⇒ `at-risk`; `age = 37` ⇒ `at-risk`; `age = 38` ⇒
`expired`.

### 5.3 `count`

```ts
{ kind: "count"; family: string; op: CountOp; n: number; where?: ReceiptFilter }
```

Count **all** receipts matching `family` and `where` (the full filtered set, not
just the newest) — let that count be `m`. Apply `op`:

- `op === "gte"` ⇒ met when `m >= n`;
- `op === "lte"` ⇒ met when `m <= n`;
- `op === "eq"` ⇒ met when `m === n`.

Status mapping:

- **met** ⇒ **`satisfied`**, `evidenceClaimId` = the first matching receipt's
  `claimId` if any matched, else `null` (an `lte` / `eq` requirement can be
  satisfied with zero matches, in which case `evidenceClaimId` is `null`).
- **not met** ⇒ **`missing`**, `evidenceClaimId` = `null`.

`count` only ever yields `satisfied` or `missing` — it **never** yields
`at-risk` or `expired`. As with the other leaves, only active receipts count by
default (§5.6).

### 5.4 `all` and `any` — combination

```ts
{ kind: "all"; of: Requirement[] }
{ kind: "any"; of: Requirement[] }
```

Each member of `of` is evaluated recursively to its own triple, then the members
are combined by the `RANK` ordering (§2.1):

- **`all`** reduces to the **worst** (minimum-rank) member triple — the combined
  status, `evidenceClaimId`, and detail are taken from that worst member. (`all`
  is conjunction: it is only `satisfied` when *every* member is `satisfied`, and
  otherwise surfaces the most-degraded member.)
- **`any`** reduces to the **best** (maximum-rank) member triple — the combined
  status, `evidenceClaimId`, and detail are taken from that best member. (`any`
  is disjunction: one `satisfied` member makes the whole thing `satisfied`.)

The reduction is a left fold over `of` in author order. On a **rank tie** the
fold keeps the **earlier** member (the accumulator is retained when the
candidate's rank is not strictly better): `all` keeps the earlier member when
`RANK[acc] <= RANK[next]`, and `any` keeps the earlier member when
`RANK[acc] >= RANK[next]`. This tie rule is deterministic but order-sensitive
only for the carried `evidenceClaimId`/`detail`; the combined **status** is
unaffected by ties (tied members share a status by definition).

### 5.5 `dependsOn`

```ts
{ kind: "dependsOn"; obligationId: string }
```

`dependsOn` is resolved at the **obligation** level (§4 step 2), not by the leaf
evaluator, by reading the **already-computed** status of the target obligation —
which `evalOrder` guarantees is present. Let `dep` be the recorded status of
`obligationId` (defaulting to **`missing`** if, defensively, no status was
recorded):

- `dep === "satisfied"` ⇒ this obligation is **`satisfied`**;
- `dep === "not-applicable"` ⇒ this obligation is **`not-applicable`**;
- any other `dep` (`at-risk` / `expired` / `missing`) ⇒ this obligation is
  **`missing`**.

`evidenceClaimId` is **always** `null` for a `dependsOn` result (the dependency,
not a receipt, is the evidence). `detail` names the target and its status. Note
that a target that is `at-risk` or `expired` collapses the dependent to
`missing` (not to the target's own status): the dependency contract is binary —
the target is either fully satisfied (or not applicable, which passes through) or
the dependent is unmet.

> A `dependsOn` evaluated by the leaf requirement evaluator (rather than the
> obligation-level resolver) would yield `missing` with detail "unresolved
> dependsOn", but compilation forbids nesting `dependsOn` inside `all`/`any`
> (`grammar.md` §3.3, enforced as `nested-dependson-invalid`), so a compiled
> manifest never reaches that path.

### 5.6 `where` — the receipt filter

`where` (a `ReceiptFilter`, `grammar.md` §3.2) narrows which receipts a leaf
considers, with two independent filters:

- **`activeOnly`** — defaults to **`true`** when `where` is omitted or
  `activeOnly` is unset: by default only active receipts count toward a
  requirement. Setting `activeOnly: false` lets inactive (revoked/expired)
  receipts count for that requirement. (`newestActive`, used by `exists` and
  `fresh`, considers only active receipts regardless; the `activeOnly: false`
  relaxation is meaningful for `count`, which scans the full filtered set.)
- **`eventType`** — a sub-family scope. When omitted, any event within the
  family matches. When present (a non-empty `string[]`), a receipt matches only
  if it carries an `eventType` that is a member of the list; a receipt with **no**
  `eventType` **never** matches a non-empty `eventType` list.

---

## 6. Condition evaluation (`appliesWhen`)

An obligation's `appliesWhen` is a `Condition` (`grammar.md` §2), evaluated to a
plain boolean against `facts`. The six kinds:

- **`always`** ⇒ `true`.
- **`fact`** ⇒ the boolean read of the named fact: `true` iff the fact's value is
  exactly `true` (an absent or non-`true` fact reads as `false`, §3.1).
- **`compare`** ⇒ if the named fact is `undefined`, `false`; otherwise the result
  of applying `op` to the fact's value and the comparison `value`.
- **`all`** ⇒ `true` iff **every** sub-condition is `true` (logical AND over the
  `of` list).
- **`any`** ⇒ `true` iff **at least one** sub-condition is `true` (logical OR
  over the `of` list).
- **`not`** ⇒ the negation of its single sub-condition.

`compare` operators evaluate as:

- **`eq`** ⇒ `actual === value` (strict equality);
- **`ne`** ⇒ `actual !== value`;
- **`lt` / `lte` / `gt` / `gte`** ⇒ numeric comparison, `true` only when **both**
  `actual` and `value` are numbers and the ordering holds; if either operand is
  not a number the result is `false`;
- **`in`** ⇒ `true` iff `value` is an array containing `actual` (membership of an
  enum value in a permitted set).

Condition evaluation reads **only** `facts` — never the corpus and never `now`.
Its result is a boolean (it never produces an `ObligationStatus`); the
`ObligationStatus` ranking of §2.1 plays no part here.

---

## 7. Output — `ObligationResult` and `ObligationReport`

### 7.1 `ObligationReport`

```ts
interface ObligationReport {
  manifestId: string;
  manifestVersion: string;
  manifestHash: string;
  evaluatedAt: string;                 // now.toISOString()
  results: ObligationResult[];
  coverage: {
    applicable: number;
    satisfied: number;
    ratio: number;
  };
}
```

- **`manifestId`** — copied from `manifest.id`.
- **`manifestVersion`** — copied from `manifest.version`.
- **`manifestHash`** — copied from `manifest.manifestHash`; pins the exact
  compiled content this report was produced from.
- **`evaluatedAt`** — `now.toISOString()`, the injected instant rendered as an
  ISO 8601 string. The report carries **no** other clock value.
- **`results`** — one `ObligationResult` per obligation, emitted in **author
  order** (the order of `manifest.obligations`), which is stable and independent
  of the internal `evalOrder` used during evaluation.
- **`coverage`** — the honest coverage summary (below).

**Coverage** is the **honest denominator**: it counts only obligations that
*apply*, excluding `not-applicable` ones.

- **`applicable`** = the number of results whose status is **not**
  `not-applicable`. Every status in `{ satisfied, at-risk, expired, missing }`
  counts toward `applicable`.
- **`satisfied`** = the number of results whose status is exactly `satisfied`.
  (An `at-risk` result is applicable but **not** counted as satisfied.)
- **`ratio`** = `satisfied / applicable`, **except** when `applicable === 0`, in
  which case `ratio = 1` — a vacuous "all applicable obligations satisfied" when
  nothing applies. Implementations **MUST** emit `1` (not `0`, not `NaN`) for the
  empty-applicable case, and consumers (UI/reporting) **MUST** guard on
  `applicable === 0` rather than presenting a `1.0` ratio as meaningful
  compliance over zero obligations.

### 7.2 `ObligationResult`

```ts
interface ObligationResult {
  obligationId: string;
  regulation: string;
  status: ObligationStatus;
  evidenceClaimId: string | null;
  remediation: string | null;
  detail: string;
}
```

- **`obligationId`** — the obligation's `id`.
- **`regulation`** — copied from the obligation's `regulation` field.
- **`status`** — one of the five statuses (§2).
- **`evidenceClaimId`** — the `claimId` of the receipt that satisfies (or
  best-matches) the obligation, or `null` when there is none. It is non-null only
  when a requirement actually selected a receipt (the `exists`/`fresh` hit, the
  first `count` match, or the carried member of an `all`/`any` fold); it is
  always `null` for `not-applicable` and for `dependsOn` results.
- **`remediation`** — the obligation's `remediation` text when the obligation is
  unmet, and **`null`** when `status` is `satisfied` **or** `not-applicable`. So
  `remediation` is non-null exactly for `at-risk`, `expired`, and `missing`.
- **`detail`** — a human-readable explanation of the status decision
  (non-normative text; consumers **MUST NOT** parse it as a contract).

---

## 8. Conformance summary

A conforming evaluator:

- **MUST** be pure (§1.1): deterministic, no I/O, no clock access — time enters
  only through the injected `now` (a `Date`), and `evaluatedAt` is
  `now.toISOString()`;
- **MUST** validate `facts` against `factSchema` and **fail closed** (throw, emit
  no report) on any validation error (§3); absent optional facts are fail-open
  and default a boolean read to `false` (§3.1);
- **MUST** evaluate obligations in `evalOrder` so each `dependsOn` target is
  resolved before its dependent (§4, §5.5), while emitting `results` in author
  order (§7.1);
- **MUST** resolve every obligation to exactly one of the five statuses
  `satisfied | at-risk | expired | missing | not-applicable` (§2), with leaf
  requirements never producing `not-applicable`;
- **MUST** apply the `fresh` boundaries exactly — `age <= maxAgeDays` ⇒
  `satisfied`, `age <= maxAgeDays + atRiskWindowDays` ⇒ `at-risk` (both bounds
  inclusive), beyond ⇒ `expired`, no receipt ⇒ `missing` (§5.2);
- **MUST** map `count` to `satisfied` when `m op n` holds and `missing`
  otherwise — never `at-risk` or `expired` (§5.3);
- **MUST** combine `all` to the worst-ranked member and `any` to the
  best-ranked member by the `RANK` ordering, breaking ties toward the earlier
  member (§5.4);
- **MUST** compute coverage over the honest denominator (excluding
  `not-applicable`), counting `at-risk` as applicable-but-not-satisfied, and
  emit `ratio = 1` when `applicable === 0` (§7.1);
- **MUST** null `remediation` for `satisfied` and `not-applicable`, and null
  `evidenceClaimId` for `not-applicable` and `dependsOn` results (§7.2).
