# RaC Compilation — Lowering a SourceManifest to a Compiled IR

This file is the normative specification of **compilation**: the deterministic,
fail-closed lowering of an authored [`SourceManifest`](grammar.md#5-sourcemanifest)
to a content-hashed compiled intermediate representation (IR). It is frozen at
v1.

Compilation runs a fixed, ordered pipeline of **static checks** over the source.
If any check fails, compilation produces a list of stable error codes and emits
no manifest. If every check passes, compilation normalizes the obligations into
a canonical form, computes a `sha256` content hash over that canonical form, and
emits a `CompiledManifest` carrying the hash and a topological evaluation order.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as described in RFC 2119 / RFC 8174.

Notation in this file is TypeScript-ish, matching the shipped type definitions.
All record fields are immutable (`readonly`); the modifier is elided in examples
for brevity.

---

## 1. Input and output

Compilation is a total function from a `SourceManifest` to a `CompileResult`:

```ts
function compile(source: SourceManifest): CompileResult;
```

- The **input** is a [`SourceManifest`](grammar.md#5-sourcemanifest) (§5 of
  `grammar.md`): a versioned bundle of one typed `FactSchema` and one or more
  `Obligation`s.
- The **output** is a `CompileResult`, a discriminated union on `ok`:

```ts
type CompileResult =
  | { ok: true;  manifest: CompiledManifest }
  | { ok: false; errors: CompileError[] };

interface CompileError {
  code: CompileErrorCode;   // §3 — stable, assert on these, not on message text
  obligationId?: string;    // present for per-obligation errors
  message: string;          // human-readable; non-normative
}
```

- Compilation **MUST** be deterministic: `compile` applied twice to the same
  `source` **MUST** return the same `ok` discriminator, and on success the same
  `manifestHash`.
- Compilation **MUST** fail closed. A `compile` implementation **MUST NOT** emit
  a `CompiledManifest` while any static check (§3) has failed.
- An implementation **MUST** treat `error.code` as the stable contract. The
  human-readable `message` is non-normative and **MUST NOT** be relied upon by
  consumers. The optional `obligationId` field **MUST** be present on every
  per-obligation error (every code except `schema-invalid` and
  `dependency-cycle`, which are manifest-scoped) and identifies the offending
  obligation.

---

## 2. `CompiledManifest`

A successful compile emits a `CompiledManifest`: the content-addressed, statically
validated, evaluation-ready form of the source.

```ts
interface CompiledManifest {
  id: string;
  version: string;
  manifestHash: string;            // §5 — sha256 hex of the canonical IR
  atRiskWindowDays: number;
  factSchema: FactSchema;
  obligations: Obligation[];       // canonical form (§4)
  evalOrder: string[];             // §6 — topological order over dependsOn
}
```

The discriminator for the wire form of a compiled manifest is `rac.manifest.v1`.

- **`id`** — copied verbatim from `source.id`. The manifest identifier (e.g. the
  regulation profile slug).
- **`version`** — copied verbatim from `source.version`. The authored semver
  string. Distinct from `manifestHash`: `version` is the author's human-facing
  release label; `manifestHash` is the machine-verifiable content identity.
- **`manifestHash`** — the `sha256`, in lowercase hex, of the canonical IR
  (§4–§5). This is the content-addressed version pin: two `SourceManifest`s with
  identical semantic content **MUST** produce the same `manifestHash`, and any
  semantic change **MUST** change it. See §5 for the exact contract.
- **`atRiskWindowDays`** — copied verbatim from `source.atRiskWindowDays`. The
  look-ahead window (in days) for at-risk reporting of `fresh` requirements; see
  `grammar.md` §5.
- **`factSchema`** — copied verbatim from `source.facts`. The manifest's
  `FactSchema` (`grammar.md` §1). Note the field is renamed from `facts` (source)
  to `factSchema` (compiled).
- **`obligations`** — the source obligations in canonical form (§4). The set of
  obligations is identical to the source; only serialization is canonicalized.
- **`evalOrder`** — the list of obligation `id`s in a topological order over the
  `dependsOn` dependency graph, dependencies before dependents (§6).

---

## 3. The static-check pipeline

Compilation runs the following checks **in this order**. Step 1 is a hard gate:
if the source is not schema-valid, compilation returns immediately with a single
`schema-invalid` error and runs no further check (the later steps assume a
well-typed source). Steps 2–4 **accumulate** errors: every failing obligation
contributes its error(s), and compilation reports the full accumulated list
rather than stopping at the first failure. After steps 2–4, if the accumulated
error list is non-empty, compilation returns `{ ok: false, errors }` and emits
no manifest.

Each error code below is stable and **MUST** match exactly. The eight codes are
the closed `CompileErrorCode` set:

```ts
type CompileErrorCode =
  | "schema-invalid"
  | "duplicate-id"
  | "unknown-fact"
  | "fact-type-mismatch"
  | "unknown-family"
  | "unknown-dependency"
  | "dependency-cycle"
  | "nested-dependson-invalid";
```

### 3.1 Step 1 — schema validity (`schema-invalid`)

The source **MUST** validate against the `SourceManifest` schema (the structural
shapes and closed constraints normatively specified throughout `grammar.md` — fact
kinds, condition/requirement kinds, the array-iff-`in` value rule of §2.2, the
count-op subset of §3.2, required non-empty fields, etc.).

- **Trigger:** the source fails structural schema validation.
- **Effect:** compilation returns immediately with exactly one error
  `{ code: "schema-invalid", message }` and performs no further check. The
  message carries the underlying validation detail (non-normative).

This early return also guards the remaining steps: steps 2–6 **MAY** assume the
source is structurally well-typed.

### 3.2 Step 2 — id uniqueness (`duplicate-id`)

Obligation `id`s **MUST** be unique within the manifest (`grammar.md` §5).

- **Trigger:** two or more obligations share the same `id`.
- **Effect:** one `{ code: "duplicate-id", obligationId, message }` error is
  emitted for each obligation whose `id` was already seen earlier in source
  order.

### 3.3 Step 3 — per-obligation static type/family checks

For each obligation, both its `appliesWhen` (`Condition`) and its `requires`
(`Requirement`) are statically checked against the declared `FactSchema` and the
evidence-family registry. These checks are the **compile-time enforcement of the
normative semantic rules** stated in `grammar.md` (the per-op fact-typing rules
of §2.1/§2.2 and the `dependsOn` placement rule of §3.3) — `grammar.md` states
them as author obligations; the compiler enforces them.

#### `unknown-fact`

Every `fact` / `compare` condition **MUST** reference a `FactDef` declared in the
manifest's `FactSchema` (`grammar.md` §5).

- **Trigger:** a `fact` or `compare` condition names a fact that has no matching
  `FactDef`.
- **Effect:** `{ code: "unknown-fact", obligationId, message }`. (Checked
  recursively through `all` / `any` / `not` condition trees.)

#### `fact-type-mismatch`

This is the compile-time enforcement of the per-op fact-typing rules normatively
stated in `grammar.md` §2.1 and §2.2. A condition's operator **MUST** match the
declared `type` of the fact it references:

- A `kind: "fact"` condition **MUST** reference a `boolean` fact (`grammar.md`
  §2.1). Referencing a `number` or `enum` fact triggers the error.
- A `compare` with an ordering op (`lt`, `lte`, `gt`, `gte`) **MUST** reference a
  `number` fact (`grammar.md` §2.2).
- A `compare` with `op: "in"` **MUST** reference an `enum` fact (`grammar.md`
  §2.2).

- **Trigger:** any of the above operator/fact-type pairings is violated for a
  fact that *does* exist (a missing fact yields `unknown-fact` instead, and a
  `compare` short-circuits — a missing fact in a `compare` reports only
  `unknown-fact`, not also `fact-type-mismatch`).
- **Effect:** `{ code: "fact-type-mismatch", obligationId, message }`.

#### `unknown-family`

Every leaf requirement (`exists`, `fresh`, `count`) **MUST** name an evidence
`family` that is a member of the evidence-family registry.

- **Trigger:** an `exists` / `fresh` / `count` requirement names a `family` that
  is not in the registry of receipt families.
- **Effect:** `{ code: "unknown-family", obligationId, message }`. (Checked
  recursively through `all` / `any` requirement trees.)

#### `nested-dependson-invalid`

This is the compile-time enforcement of the `dependsOn` placement rule
normatively stated in `grammar.md` §3.3: `dependsOn` **MUST** appear only as the
whole of an obligation's top-level `requires`, never nested inside an `all` /
`any` of-list.

- **Trigger:** a `dependsOn` requirement appears as a member of an `all` or `any`
  requirement.
- **Effect:** `{ code: "nested-dependson-invalid", obligationId, message }`.

### 3.4 Step 4 — dependency resolution and acyclicity

The compiler collects every `dependsOn` edge from each obligation's `requires`
(via the recursive `dependencyEdges` walk over `dependsOn` / `all` / `any`),
builds a dependency graph (`id → ids it depends on`), and validates it.

#### `unknown-dependency`

Every obligation referenced by a `dependsOn` edge **MUST** be defined in the same
manifest (compared against the set of obligation `id`s).

- **Trigger:** a `dependsOn` names an `obligationId` that is not in the
  manifest's id set.
- **Effect:** one `{ code: "unknown-dependency", obligationId, message }` per
  unresolved edge. The dangling edge is excluded from the graph before the
  topological sort (only resolvable edges are kept), so an unknown dependency
  does not also masquerade as a cycle.

#### `dependency-cycle`

The `dependsOn` graph **MUST** be acyclic. The compiler runs a Kahn-style
topological sort (§6); a `null` result indicates a cycle.

- **Trigger:** the dependency graph contains a cycle (a topological order
  covering all nodes does not exist).
- **Effect:** `{ code: "dependency-cycle", message }` (manifest-scoped, no
  `obligationId`).

After steps 2–4, if `errors.length > 0`, compilation returns
`{ ok: false, errors }`.

---

## 4. Canonicalization

When all static checks pass, the compiler constructs the canonical IR — the exact
value over which the content hash is computed — and the canonical `obligations`
array carried in the `CompiledManifest`.

The canonical IR is the object:

```ts
const ir = {
  id:               source.id,
  version:          source.version,
  atRiskWindowDays: source.atRiskWindowDays,
  factSchema:       source.facts,
  obligations:      source.obligations,
};
```

Canonicalization rules:

- The canonical IR **MUST** consist of exactly these five members and no others.
  In particular it **MUST NOT** include `manifestHash` (it is the output of
  hashing the IR — including it would be circular) and **MUST NOT** include
  `evalOrder` (a derived index, not part of content identity). Two manifests that
  differ only in derived/index fields therefore share a `manifestHash`.
- Canonical key ordering is **not** a property of the `ir` object's construction
  order; it is imposed entirely by the canonical serialization (§5), which sorts
  every object's keys lexicographically. Implementations therefore **MUST NOT**
  rely on insertion order and **MUST NOT** introduce any ordering normalization
  of their own beyond the serialization in §5.
- The `obligations` array is carried through **in author order**. Compilation
  **MUST NOT** reorder, deduplicate, or otherwise permute the obligations array
  for canonicalization or for the emitted `CompiledManifest.obligations`. Array
  order is significant content and is preserved by the serialization (arrays are
  serialized positionally). "Canonical form" for obligations means canonical
  *serialization* (lexicographic object-key order, no insignificant whitespace),
  **not** array reordering.

The `CompiledManifest.obligations` field carries the same obligations; their
canonical *serialization* (not their array order) is what §5 hashes.

---

## 5. `manifestHash` — the content hash contract

`manifestHash` is the `sha256` of the canonical serialization of the IR (§4),
rendered as lowercase hexadecimal. This is the content-addressed version pin.

The contract is exact so that two independent implementations compute identical
hashes for identical content:

1. **Canonical serialization (RFC 8785 / JSON Canonicalization Scheme).** The IR
   is serialized to a single canonical JSON string with:
   - every object's keys sorted **lexicographically** (by UTF-16 code unit of the
     raw, unescaped key strings);
   - **no insignificant whitespace** (no spaces, no newlines between tokens);
   - standard JSON string escaping for strings and keys;
   - arrays serialized **positionally** in their existing order (arrays are
     never reordered);
   - object members whose value is `undefined` **omitted** (an `undefined`
     value is not a JSON value and contributes nothing);
   - `null`, finite `number`, `boolean`, and `string` rendered as their JSON
     forms.
   - Serialization **MUST** reject non-finite numbers, functions, and other
     non-JSON values rather than emitting a degenerate form; the IR's value
     space (objects, arrays, strings, finite numbers, booleans, null) is closed
     and contains none of these.
2. **UTF-8 encoding.** The canonical JSON string **MUST** be encoded to bytes as
   **UTF-8** (no BOM) before hashing.
3. **Digest.** Compute `sha256` over those UTF-8 bytes.
4. **Encoding of the digest.** Render the 32-byte digest as **lowercase
   hexadecimal**, two zero-padded hex characters per byte, yielding a 64-character
   string. That string is `manifestHash`.

Stated as a single pipeline:

```
manifestHash = lowerhex( sha256( utf8( canonicalize(ir) ) ) )
```

where `canonicalize` is the RFC 8785 JCS serialization above. The reference
implementation factors this as `hashCanonical(ir)`, which is
`canonicalize` (the JCS serializer) followed by `sha256` (lowercase hex). An
implementation **MUST** match this pipeline byte-for-byte; any deviation in key
ordering, whitespace, escaping, array order, encoding, or hex casing produces a
divergent hash and is non-conformant.

Because `manifestHash` is computed over the IR — which excludes `manifestHash`
and `evalOrder` — it is stable under recompilation and depends only on the
authored content (`id`, `version`, `atRiskWindowDays`, the fact schema, and the
ordered obligations).

---

## 6. `evalOrder` — topological evaluation order

`evalOrder` is a permutation of the obligation `id`s such that every obligation
appears **after** all obligations it depends on (via `dependsOn`). Evaluators
**MUST** be able to evaluate obligations in `evalOrder` and have each
`dependsOn` target already evaluated when its dependent is reached.

The order is produced by a Kahn-style topological sort over the dependency graph
built in §3.4 (`id → resolvable dependency ids`):

- The sort repeatedly emits any not-yet-emitted node all of whose dependencies
  are already emitted, until no node remains or no progress can be made in a pass.
- If every node is emitted, the resulting list is `evalOrder`.
- If progress stalls before all nodes are emitted, a cycle exists and the sort
  returns `null`, which compilation reports as `dependency-cycle` (§3.4). A
  successful compile therefore always carries a total `evalOrder` over all
  obligations.

`evalOrder` is a derived index over the obligations and is **not** part of the
content hash (§4–§5): two manifests with identical content produce identical
`evalOrder`, but `evalOrder` does not itself contribute to `manifestHash`.

---

## 7. Conformance summary

A conforming compiler:

- **MUST** run the checks of §3 in order, returning `schema-invalid` alone on a
  schema failure and otherwise accumulating `duplicate-id`, `unknown-fact`,
  `fact-type-mismatch`, `unknown-family`, `unknown-dependency`,
  `dependency-cycle`, and `nested-dependson-invalid` into one error list;
- **MUST** emit no `CompiledManifest` when any error is present (fail closed);
- **MUST** compute `manifestHash` exactly per §5 (RFC 8785 canonical JSON →
  UTF-8 → `sha256` → lowercase hex) over the five-member IR of §4, excluding
  `manifestHash` and `evalOrder`;
- **MUST** preserve obligation array order through canonicalization and into the
  emitted manifest;
- **MUST** emit a total topological `evalOrder` (§6) on success;
- **MUST** treat `CompileError.code` (not `message`) as the stable contract.
