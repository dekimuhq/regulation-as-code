# RaC Grammar — Authored Obligation Grammar

This file is the normative specification of the **authored grammar** of
Regulation-as-Code (RaC): the regulation-agnostic shapes an author writes to
encode a regulation as a machine-evaluable `SourceManifest`. It is frozen at v1.

The grammar is deliberately small and closed. An obligation is a pair of
expressions: a **`Condition`** (when does this apply to a workspace?) and a
**`Requirement`** (what evidence satisfies it?), plus prose remediation. A
manifest bundles a typed **fact schema** and a list of obligations.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as described in RFC 2119 / RFC 8174.

Notation in this file is TypeScript-ish, matching the shipped type definitions.
All record fields are immutable (`readonly`); the modifier is elided in examples
for brevity. Array fields are `readonly` arrays.

> The **evidence family** concept and the evidence corpus that `Requirement`s
> quantify over are specified in a sibling file (see `evidence.md` for the
> evidence family registry). Within this file a `family` is an opaque string
> identifier; this file MUST NOT enumerate or constrain the registry.

---

## 1. FactSchema

A manifest declares the typed facts an author may reference. A workspace later
supplies values for these facts; applicability (`Condition`) is evaluated
against those values.

```ts
type FactType = "boolean" | "number" | "enum";

interface FactDef {
  name: string;
  type: FactType;
  values?: string[];   // allowed values; required iff type === "enum"
  optional?: boolean;
}

type FactSchema = FactDef[];

type FactValue = boolean | number | string;
type WorkspaceFacts = Record<string, FactValue>;
```

### 1.1 Rules

- A `FactDef` **MUST** carry a non-empty `name` and a `type` from the closed set
  `boolean | number | enum`.
- `values` **MUST** be present and non-empty **iff** `type === "enum"`. A
  non-enum `FactDef` **MUST NOT** carry `values`; an enum `FactDef` **MUST**
  carry at least one allowed value.
- A workspace's facts (`WorkspaceFacts`) **MUST** validate against the schema:
  - A `number` fact's value **MUST** be a number; a `boolean` fact's value
    **MUST** be a boolean; an `enum` fact's value **MUST** be a string drawn
    from that fact's declared `values`.
  - A `FactValue` is always one of `boolean | number | string` — the
    representation of an enum value is a `string`.

### 1.2 `optional` — fail-open

- A `FactDef` with `optional: true` **MAY** be omitted by a workspace. A
  default-absent optional fact **MUST** evaluate as its zero value, and for the
  boolean facts referenced by `kind: "fact"` that zero value is `false` — i.e.
  an omitted optional fact reads as "not applicable" and fails **open** (the
  obligation does not become applicable on its account).
- A non-optional (`optional` absent or `false`) fact is **required**: a
  workspace that omits it fails **closed**, and validation **MUST** reject the
  workspace as missing a required fact rather than silently defaulting it.
- Rationale: `optional` lets a manifest add a new applicability fact without
  forcing every existing workspace to supply it, while non-optional facts stay
  strict.

---

## 2. Condition — applicability boolean algebra

A `Condition` answers: **does this obligation apply to this workspace?** It is a
boolean expression over the typed facts.

```ts
type CompareOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in";

type Condition =
  | { kind: "always" }
  | { kind: "fact"; fact: string }
  | { kind: "compare"; fact: string; op: CompareOp; value: FactValue | string[] }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] }
  | { kind: "not"; cond: Condition };
```

### 2.1 The six condition kinds

- **`always`** — always true. The obligation applies to every workspace
  unconditionally.
- **`fact`** — true when the named **boolean** fact is true. `fact` **MUST**
  reference a fact whose declared `type` is `boolean`; it **MUST NOT** be used on
  `number` or `enum` facts (use `compare` for those).
- **`compare`** — `{ fact, op, value }`, true when `fact op value` holds.
- **`all`** — conjunction; true when **every** member of `of` is true. `of`
  **MUST** contain at least one `Condition`.
- **`any`** — disjunction; true when **at least one** member of `of` is true.
  `of` **MUST** contain at least one `Condition`.
- **`not`** — negation of `cond`.

### 2.2 `CompareOp` and value typing

`CompareOp` is the closed set `eq | ne | lt | lte | gt | gte | in`.

- The **ordering** operators `lt`, `lte`, `gt`, `gte` **MUST** reference a
  `number` fact and carry a scalar `number` `value`.
- The **membership** operator `in` **MUST** reference an `enum` fact and carry a
  `value` that is a `string[]` (the set the fact's value must belong to). `in`
  is the **only** op whose `value` is an array; every other op's `value` **MUST**
  be a scalar `FactValue`, never an array, and conversely an array `value`
  **MUST** only ever appear with `in`.
- The **equality** operators `eq` and `ne` **MAY** reference a `boolean`,
  `number`, or `enum` fact, with a scalar `value` of the matching type.

> The scalar-vs-array constraint (array iff `in`) is structurally enforced by
> the manifest schema. The per-op fact-type constraints (ordering ⇒ number,
> `in` ⇒ enum, `eq`/`ne` ⇒ boolean|number|enum) are normative semantic rules
> resolved against the declared `FactSchema`; an author **MUST** honor them and
> a profile **SHOULD** be checked against them at authoring time.

---

## 3. Requirement — satisfaction quantifiers over the corpus

A `Requirement` answers: **what evidence makes this obligation satisfied?** It is
a quantifier/algebra expression over the **evidence corpus** — the set of
receipts available for a workspace (see `evidence.md`).

```ts
type CountOp = "gte" | "lte" | "eq";

interface ReceiptFilter {
  activeOnly?: boolean;
  eventType?: string[];   // sub-family match; non-empty when present
}

type Requirement =
  | { kind: "exists"; family: string; where?: ReceiptFilter }
  | { kind: "fresh"; family: string; maxAgeDays: number; where?: ReceiptFilter }
  | { kind: "count"; family: string; op: CountOp; n: number; where?: ReceiptFilter }
  | { kind: "all"; of: Requirement[] }
  | { kind: "any"; of: Requirement[] }
  | { kind: "dependsOn"; obligationId: string };
```

### 3.1 The six requirement kinds

- **`exists`** — satisfied when at least one receipt in `family` (matching
  `where`, if given) exists in the corpus.
- **`fresh`** — satisfied when at least one matching receipt in `family` exists
  **and** is no older than `maxAgeDays`. `maxAgeDays` **MUST** be a positive
  number (days).
- **`count`** — satisfied when the number of matching receipts in `family`
  satisfies `count op n`. `op` is a `CountOp` (`gte | lte | eq`); `n` **MUST**
  be a non-negative integer.
- **`all`** — conjunction; satisfied when **every** member of `of` is
  satisfied. `of` **MUST** contain at least one `Requirement`.
- **`any`** — disjunction; satisfied when **at least one** member of `of` is
  satisfied. `of` **MUST** contain at least one `Requirement`.
- **`dependsOn`** — satisfied when the obligation named by `obligationId` is
  itself satisfied. See §3.3 for the placement constraint.

### 3.2 `ReceiptFilter`

`where` narrows which receipts in a `family` count toward the requirement:

- **`activeOnly`** — when `true`, only currently-active (non-revoked,
  non-expired) receipts count.
- **`eventType`** — restrict to receipts whose sub-family discriminator is one
  of the listed values. When present it **MUST** be a non-empty `string[]`. A
  receipt that carries no event-type discriminator **MUST NOT** match a
  non-empty `eventType` list. Omitting `eventType` matches any event within the
  family.
- A `Requirement` with no `where` ignores both filters entirely (back-compatible
  with receipts that carry an event-type discriminator).

`CountOp` is the closed set `gte | lte | eq`. Note it is a strict subset of
`CompareOp`: a count requirement **MUST NOT** use `ne`, `lt`, `gt`, `lte`-vs-…
— only `gte`, `lte`, `eq` are valid count operators.

### 3.3 `dependsOn` placement (normative)

- `dependsOn` **MUST** appear only at the **top level** of an obligation's
  `requires` — i.e. as the obligation's whole `requires`, never as a member of a
  nested `all` or `any`. Authors **MUST NOT** embed `dependsOn` inside an `all`
  or `any` of-list.
- `obligationId` **MUST** be a non-empty string and **SHOULD** reference an
  obligation defined in the same `SourceManifest`.

---

## 4. Obligation

An `Obligation` binds an applicability `Condition` to a satisfaction
`Requirement`, with human-readable remediation.

```ts
interface Obligation {
  id: string;
  regulation: string;
  citationUrl?: string;
  appliesWhen: Condition;
  requires: Requirement;
  remediation: string;
}
```

- `id` **MUST** be a non-empty string, unique within its `SourceManifest`.
- `regulation` **MUST** be a non-empty string naming the regulation (or
  article/clause) this obligation encodes.
- `citationUrl`, when present, **MUST** be a valid URL pointing at the
  authoritative legal source; authors **SHOULD** provide it for every
  obligation.
- `appliesWhen` **MUST** be a valid `Condition` (§2). When it evaluates `false`
  for a workspace, the obligation is **not applicable** and its `requires` is not
  evaluated.
- `requires` **MUST** be a valid `Requirement` (§3). When `appliesWhen` is
  `true`, the obligation is **satisfied** iff `requires` is satisfied by the
  corpus.
- `remediation` **MUST** be a non-empty string describing what to do when the
  obligation applies but is not satisfied.

---

## 5. SourceManifest

A `SourceManifest` is the top-level authored artifact: a versioned bundle of one
typed fact schema and one or more obligations.

```ts
interface SourceManifest {
  id: string;
  version: string;          // semver
  atRiskWindowDays: number;
  facts: FactSchema;
  obligations: Obligation[];
}
```

- `id` **MUST** be a non-empty string identifying the manifest (e.g. the
  regulation profile slug).
- `version` **MUST** be a non-empty string and **SHOULD** be a valid
  [semver](https://semver.org/) version.
- `atRiskWindowDays` **MUST** be a non-negative number: the look-ahead window (in
  days) within which a soon-to-lapse `fresh` requirement is reported as
  *at-risk* rather than satisfied. `0` disables the at-risk window.
- `facts` is the manifest's `FactSchema` (§1). Every `fact` / `compare`
  reference in any obligation's `appliesWhen` **MUST** resolve to a `FactDef` in
  this schema.
- `obligations` **MUST** contain at least one `Obligation`, and their `id`s
  **MUST** be unique within the manifest.

---

## 6. Worked example

A complete, valid manifest with one fact and one obligation. A workspace that
processes special-category personal data must hold a fresh DPIA receipt.

```ts
const manifest: SourceManifest = {
  id: "example-profile",
  version: "1.0.0",
  atRiskWindowDays: 30,

  facts: [
    {
      name: "processes_special_category_data",
      type: "boolean",
    },
  ],

  obligations: [
    {
      id: "dpia-required-for-special-category",
      regulation: "GDPR Art. 35(3)(b)",
      citationUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",

      // Applies only when the workspace processes special-category data.
      appliesWhen: { kind: "fact", fact: "processes_special_category_data" },

      // Satisfied by a DPIA evidence receipt no older than 365 days,
      // restricted to the "dpia.completed" sub-family event.
      requires: {
        kind: "fresh",
        family: "AIR", // opaque here; see evidence.md for the family registry
        maxAgeDays: 365,
        where: {
          activeOnly: true,
          eventType: ["dpia.completed"],
        },
      },

      remediation:
        "Complete a Data Protection Impact Assessment and record a DPIA receipt before processing special-category personal data.",
    },
  ],
};
```

This manifest is well-formed under every rule above: the enum/values constraint
is vacuous (no enum fact), the single obligation has a unique non-empty `id`, its
`appliesWhen` references a declared boolean fact via `kind: "fact"`, its
`requires` is a `fresh` requirement with a positive `maxAgeDays` and a non-empty
`eventType` list, and `dependsOn` is absent (so the §3.3 placement rule is
trivially honored).
