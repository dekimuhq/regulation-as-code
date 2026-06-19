# RaC Receipt — The Reproducible, Signed Evaluation Receipt

This file is the normative specification of the **evaluation receipt** of
Regulation-as-Code (RaC): a self-contained, signed record that binds *what was
evaluated* to *what came out*, so that a third party — given only the public
spec and the same inputs — can independently reproduce the evaluation and check
the signature. It is frozen at v1.

`compilation.md` defines how a source manifest compiles to a canonical IR with a
content hash (`manifestHash`). `evaluation.md` defines how an IR plus a corpus
plus facts reconcile to an `ObligationReport`. `evidence.md` defines the corpus
record. This file ties those three together into one verifiable artifact: the
receipt carries four content digests — **`manifestHash`**, **`factsHash`**,
**`corpusDigest`**, and **`reportHash`** — and an Ed25519 signature over the
canonical commitment to them, so the chain *inputs → IR → report* is checkable
end to end by anyone.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as described in RFC 2119 / RFC 8174.

Notation in this file is TypeScript-ish, matching the shipped type definitions.
All record fields are immutable (`readonly`); the modifier is elided in examples
for brevity. The canonicalization and hashing contract — RFC 8785 (JSON
Canonicalization Scheme) serialization followed by `sha256` in lowercase hex —
is the **same contract** defined in `compilation.md` §5; this file reuses it
verbatim and does not redefine it. Throughout, `canonicalize(x)` denotes the RFC
8785 JCS serialization of `x` to UTF-8 bytes, and `hashCanonical(x)` denotes
`lowerhex(sha256(utf8(canonicalize(x))))`. The reference implementation factors
both identically to `compilation.md`.

> **Naming note.** The spec discriminator for the receipt is
> **`rac.evaluation.v1`**. The reference implementation currently emits the
> string `compass.evaluation.v1` for the byte-identical structure (the spec is
> the open, rebranded surface; the private engine retains the original name).
> Apart from this one discriminator string, the structure, the canonical
> signed object, and the algorithm match the implementation exactly. A verifier
> targeting this spec MUST treat `rac.evaluation.v1` as the discriminator and
> SHOULD accept `compass.evaluation.v1` as its reference-implementation alias.

---

## 1. The receipt shape (normative)

An RaC evaluation receipt is the record:

```ts
interface EvaluationReceipt {
  kind: "rac.evaluation.v1";   // discriminator (see naming note above)
  input: EvaluationInput;      // §2 — what was evaluated (with three binding digests)
  reportHash: string;          // §2.4 — fourth binding digest: hash of the canonical report
  report: ObligationReport;    // the evaluation output (evaluation.md §7)
  keyId: string;               // §3 — identifies the signing key
  alg: string;                 // §3 — signature algorithm; "Ed25519" in v1
  signature: string;           // §3 — base64url signature over the canonical signed object
}
```

The field set and ordering above are the receipt; an implementation **MUST**
populate exactly these seven members and **MUST NOT** add or omit any. The
`report` member carries the full `ObligationReport` as defined in
`evaluation.md` §7 — including its `evaluatedAt`, root status, coverage, and the
per-requirement result tree — so the receipt is self-contained for human
inspection without re-running the engine.

The receipt is split deliberately: `input` plus `reportHash` form the **signed
commitment** (§3), while `report` itself is carried *outside* the signed bytes
and bound back in only via `reportHash`. This keeps the signed payload small and
stable while still cryptographically pinning the full report (§5 shows how a
verifier re-binds `report` to `reportHash`).

---

## 2. `EvaluationInput` — what was evaluated (normative)

```ts
interface EvaluationInput {
  manifestId: string;       // §2.1 — IR `id` of the evaluated manifest
  manifestVersion: string;  // §2.1 — IR `version` (author's human release label)
  manifestHash: string;     // §2.2 — content hash of the IR (binding digest #1)
  factsHash: string;        // §2.3 — content hash of the facts (binding digest #2)
  corpusDigest: string;     // §2.4 — content digest of the corpus (binding digest #3)
  engineVersion: string;    // §2.5 — version string of the evaluating engine
  evaluatedAt: string;      // §2.6 — ISO 8601 instant the evaluation clock was set
}
```

`EvaluationInput` is the complete, minimal description of the evaluation's
inputs. Three of the four **binding digests** live here (`manifestHash`,
`factsHash`, `corpusDigest`); the fourth (`reportHash`) is a sibling of `input`
on the receipt (§2.7). Together these four digests are the reproducibility
contract: matching all four against freshly recomputed values (§5) is what makes
the receipt *reproducible*.

### 2.1 `manifestId` / `manifestVersion`

`manifestId` is the IR's `id` and `manifestVersion` is the IR's `version`, both
copied verbatim from the `CompiledManifest` (`compilation.md` §4). `version` is
the author's human-facing release label; it is **not** a content identity —
`manifestHash` is. Both are carried for provenance and human readability; the
machine-verifiable identity of the evaluated rules is `manifestHash`.

### 2.2 `manifestHash` — binding digest #1

`manifestHash` is the content hash of the compiled IR, exactly as defined in
`compilation.md` §5: `hashCanonical` over the five-member IR

```
{ id, version, atRiskWindowDays, factSchema, obligations }
```

excluding `manifestHash` and the derived `evalOrder`. A producer **MUST** copy
the `manifestHash` field already present on the `CompiledManifest` it evaluated;
that value is fixed by `compilation.md` §5 and is the same digest a verifier
recomputes from the manifest source (§5.1). Two IRs with identical semantic
content share a `manifestHash`; any semantic change yields a different one.

### 2.3 `factsHash` — binding digest #2

`factsHash` is `hashCanonical(facts)` where `facts` is the `WorkspaceFacts`
object passed to reconciliation (`evaluation.md` §3) — the keyed snapshot of the
workspace state, validated against the IR's `factSchema`. The hash is taken over
the *canonical* serialization of the facts object (RFC 8785), so key order and
insignificant formatting do not affect it. Identical facts ⇒ identical
`factsHash`.

### 2.4 `corpusDigest` — binding digest #3

`corpusDigest` is a content digest of the evidence corpus (`evidence.md` §1) the
engine saw. It is **order-independent**: the producer projects each
`CorpusReceipt` to its four reproducibility-relevant fields

```
{ claimId, family, issuedAt, active }
```

(dropping the optional `eventType` and any adapter-specific extras), sorts the
projected rows ascending by `claimId` (byte/codepoint comparison), and computes
`hashCanonical` over the sorted array:

```
corpusDigest = hashCanonical( sortByClaimId( corpus.map(project4) ) )
```

Sorting by `claimId` makes the digest invariant to the order in which the corpus
was assembled.

> **Reproducibility caveat (informative).** `corpusDigest` is order-independent,
> but the engine's tie-breaking on receipts with **equal `issuedAt`** is
> array-order sensitive (`evaluation.md`). Two corpora with the same
> `corpusDigest` but different array order can therefore reconcile to different
> reports if a tie exists. A producer that wants a re-run to reproduce the same
> report **SHOULD** pass a deterministically-ordered corpus to the engine. The
> digest pins *which receipts* were present; deterministic input order pins
> *which one wins a tie*.

### 2.5 `engineVersion`

`engineVersion` is the version string of the engine that produced the report. It
is provenance only — it does **not** enter `manifestHash`, `reportHash`, or the
signed object beyond being a member of `input`. A verifier MAY use it to select a
compatible engine before re-running (§5), but the reproducibility check is
defined by the digests, not by string-matching `engineVersion`.

### 2.6 `evaluatedAt`

`evaluatedAt` is the ISO 8601 instant copied from the report
(`report.evaluatedAt`, i.e. `now.toISOString()` from reconciliation —
`evaluation.md` §3). It is the **evaluation clock**: freshness statuses
(`satisfied | at-risk | expired`) are all computed relative to this instant. A
verifier re-running the evaluation **MUST** use `new Date(input.evaluatedAt)` as
`now`, not the wall clock — otherwise freshness drifts and the report will not
reproduce.

### 2.7 The fourth binding digest: `reportHash`

`reportHash` is `hashCanonical(report)` over the full `ObligationReport`
(`evaluation.md` §7). It sits on the receipt as a sibling of `input` (not inside
`EvaluationInput`) because it commits to the *output*, not the inputs. It is the
fourth and final binding digest, and the only one whose preimage (`report`) is
carried in the receipt itself.

The four bound digests are therefore: **`manifestHash`** (the rules),
**`factsHash`** (the world state), **`corpusDigest`** (the evidence), and
**`reportHash`** (the verdict). The signature (§3) commits to all four at once.

---

## 3. Signature and algorithm agility (normative)

### 3.1 The signed object

The signature is computed over the canonical serialization of a four-member
**signed object** — *not* over the whole receipt:

```
signedBytes = canonicalize({ kind, alg, input, reportHash })
```

where `kind` is the discriminator, `alg` is the algorithm field (below), `input`
is the full `EvaluationInput` (§2), and `reportHash` is the fourth digest (§2.7).
A producer **MUST** sign exactly these bytes; a verifier **MUST** reconstruct
exactly these bytes from the receipt (`{ kind: receipt.kind, alg: receipt.alg,
input: receipt.input, reportHash: receipt.reportHash }`) and verify against them.

Three consequences follow from this field set:

- **`report` is not in the signed bytes.** It is bound only indirectly, through
  `reportHash`. A verifier therefore MUST separately re-hash `report` and check
  it equals `reportHash` (§5.3) — a valid signature alone does **not** prove the
  carried `report` matches; it proves the `reportHash` was signed.
- **`keyId` and `signature` are not in the signed bytes.** They are envelope
  metadata, not signed content; including them would be circular.
- **The four binding digests are all transitively signed.** `manifestHash`,
  `factsHash`, `corpusDigest` are signed via `input`; `reportHash` is signed
  directly. One signature commits to the entire inputs→verdict chain.

### 3.2 `alg` and `keyId`

`alg` is a field carried **on the receipt and inside the signed object**. The
reference algorithm for v1 is **`Ed25519`**, and the reference implementation
produces and accepts only `Ed25519`. Carrying `alg` as data — rather than
hard-coding it — is what gives the format **algorithm agility**: a future
post-quantum signature scheme (for example an ML-DSA / FIPS-204 lattice scheme)
can be adopted by minting receipts with a different `alg` value and the matching
key material, **without changing the receipt structure or the signed-object
construction**. No new cryptography is defined in this spec — `alg` only selects
among standard, externally-specified schemes; v1 verifiers reject any `alg`
other than `Ed25519` (§5.4).

Because `alg` is *inside* the signed bytes, an attacker cannot strip or downgrade
the algorithm without invalidating the signature: the algorithm a receipt claims
is the algorithm it was signed under.

`keyId` identifies the signing key. It is **self-asserted** by the receipt and is
**not** a trust anchor on its own — see §4 and §5.2.

### 3.3 Encoding

`signature` is the raw signature bytes encoded as **base64url** (the URL- and
filename-safe alphabet `A–Z a–z 0–9 - _`, *unpadded*). A verifier decodes
base64url back to bytes before checking. For Ed25519 the signature is 64 bytes;
the public key resolved for verification is 32 bytes.

---

## 4. Trust anchor — `keyId` resolution (normative)

A receipt's `keyId` is a **claim**, not proof. Verification requires a
`resolveKey(keyId) -> publicKey` function supplied by the verifier's environment,
and **that function is the trust anchor**: it **MUST** validate `keyId` against a
trusted issuer registry (or equivalent policy) before returning a key, and **MUST
NOT** blindly fetch or accept whatever key the receipt's `keyId` names. A
`resolveKey` that trusts the receipt's self-asserted key defeats the entire
signature model — an attacker could re-sign a forged report under their own key
and self-assert the matching `keyId`.

Consequently, a positive `signatureValid` result (§5) means precisely *"signed by
whoever `resolveKey` trusts for this `keyId`"* — no more. The strength of the
guarantee is the strength of the registry behind `resolveKey`. This spec defines
the verification *mechanics*; the *trust policy* (which issuers are legitimate)
is deployment-specific and out of scope.

---

## 5. Verification contract (normative)

Given a receipt and a verification context

```ts
interface VerifyCtx {
  corpus: readonly CorpusReceipt[];   // the corpus to reproduce against
  compiled: CompiledManifest;         // the IR to reproduce against
  facts: WorkspaceFacts;              // the facts to reproduce against
  resolveKey: (keyId: string) => Uint8Array;  // §4 — the trust anchor
}
```

a verifier produces a three-field outcome:

```ts
interface VerifyResult {
  reproducible: boolean;     // §5.1 — inputs match AND a re-run reproduces reportHash
  signatureValid: boolean;   // §5.2–5.4 — signature checks out AND report binds to reportHash
  manifestMatches: boolean;  // §5.1 — supplied IR's content hash equals the signed manifestHash
}
```

The three results are **independent booleans** — a verifier **MUST** compute and
return all three; it **MUST NOT** collapse them into a single pass/fail. A
receipt can, for example, be `signatureValid: true` (properly signed by a trusted
key) yet `reproducible: false` (the supplied corpus/facts no longer match what
was evaluated), and that distinction is the point.

### 5.1 `manifestMatches` and `reproducible`

A verifier **MUST**:

1. **Recompute the manifest hash.** Compute `hashCanonical` over the supplied
   IR's five binding members `{ id, version, atRiskWindowDays, factSchema,
   obligations }` (`compilation.md` §5). Set `manifestMatches` true **iff** that
   recomputed hash equals `input.manifestHash` **and** the supplied
   `compiled.manifestHash` field also equals `input.manifestHash`. (Both checks
   guard against a `CompiledManifest` whose stored hash field disagrees with its
   own content.)
2. **Check the input digests.** Compute `corpusDigest(ctx.corpus)` (§2.4) and
   `factsHash(ctx.facts)` (§2.3) and require both to equal the receipt's
   `input.corpusDigest` and `input.factsHash` respectively. Call this
   `inputsMatch`.
3. **Re-run only if inputs and manifest match.** If `inputsMatch && manifestMatches`,
   re-run reconciliation deterministically — `reconcile(compiled, corpus, facts,
   new Date(input.evaluatedAt))` (`evaluation.md`), using the receipt's
   `evaluatedAt` as the clock (§2.6) — and set `reproducible` true **iff**
   `hashCanonical(rerun) === receipt.reportHash`. If the inputs or manifest do
   not match, `reproducible` is false **without** re-running. If the re-run
   throws, `reproducible` is false.

`reproducible: true` therefore means: the supplied manifest, corpus, and facts
are byte-for-byte the inputs the receipt commits to, **and** an independent
re-run of the public evaluation algorithm over them produces the exact report the
receipt committed to. That is the reproducibility guarantee.

### 5.2 / 5.3 / 5.4 `signatureValid`

A verifier computes `signatureValid` as follows, returning false on any thrown
error:

- **5.4 Reject unsupported `alg`.** If `receipt.alg !== "Ed25519"`,
  `signatureValid` is false. (A future PQC verifier adds its `alg` here; v1
  accepts only Ed25519.)
- **5.2 Verify the signature over the canonical signed object.** Reconstruct the
  signed bytes exactly as in §3.1 — `canonicalize({ kind: receipt.kind, alg:
  receipt.alg, input: receipt.input, reportHash: receipt.reportHash })` — resolve
  the public key via `resolveKey(receipt.keyId)` (§4, the trust anchor), and
  verify the base64url-decoded `signature` against those bytes under Ed25519.
- **5.3 Re-bind the report to `reportHash`.** Because `report` is outside the
  signed bytes (§3.1), the verifier **MUST** additionally require
  `hashCanonical(receipt.report) === receipt.reportHash`. `signatureValid` is
  true **iff** the Ed25519 check passes **and** this report re-binding holds.

This means `signatureValid: true` guarantees both that a trusted key signed the
four-digest commitment **and** that the `report` carried in the receipt is the
one that commitment pins. A receipt whose `report` body was swapped after signing
fails 5.3 and is `signatureValid: false` even though the raw Ed25519 check might
pass.

### 5.5 What a verifier needs

Per the contract above, an independent verifier needs only: this public spec
(for the compile + evaluate + canonicalize/hash algorithms), the three inputs
(`manifest`/IR, `facts`, `corpus`), and a `resolveKey` backed by a trusted issuer
registry. With those it can recompute `manifestHash` by compiling, re-run
evaluation to regenerate the report, recompute `factsHash` / `corpusDigest` /
`reportHash`, and verify the signature over the canonical signed object —
yielding `{ reproducible, signatureValid, manifestMatches }`. No access to the
original producer, no private state, and no implementation-specific secrets are
required.

---

## 6. Transport (informative)

This spec is **transport-agnostic**: an `EvaluationReceipt` is a structured
record, not a wire format, and it can be carried over any channel that preserves
its bytes — an HTTP body, a file, a database column, a message payload.

The **reference transport** is the Dekimu *anchors* envelope (see the public
`anchors-spec`), which provides a signed, versioned wire carrier with built-in
algorithm-agility and a verification renderer. When an RaC receipt is carried in
an anchors envelope, the envelope is the outer wire format and the
`EvaluationReceipt` is its payload; the four binding digests and the receipt
signature defined here are unchanged. This file deliberately does **not** restate
the envelope wire format — it is specified normatively in `anchors-spec`, and RaC
references it only as one concrete carrier among many.

---

## 7. Conformance summary

A conforming implementation:

- **MUST** shape a receipt as the seven-member record `{ kind, input,
  reportHash, report, keyId, alg, signature }` (§1), with `kind` =
  `rac.evaluation.v1` (a verifier SHOULD accept `compass.evaluation.v1` as the
  reference-implementation alias);
- **MUST** populate `EvaluationInput` as `{ manifestId, manifestVersion,
  manifestHash, factsHash, corpusDigest, engineVersion, evaluatedAt }` (§2),
  computing `manifestHash` per `compilation.md` §5, `factsHash` as
  `hashCanonical(facts)`, and `corpusDigest` as `hashCanonical` over the
  `claimId`-sorted four-field projection of the corpus (§2.4);
- **MUST** set `reportHash` to `hashCanonical(report)` over the full
  `ObligationReport` (§2.7), and copy `evaluatedAt` from `report.evaluatedAt`
  (§2.6);
- **MUST** sign exactly `canonicalize({ kind, alg, input, reportHash })` (§3.1)
  and encode the signature as unpadded base64url (§3.3);
- **MUST** carry `alg` as data, use `Ed25519` in v1, and reject any other `alg`
  on verification — preserving algorithm agility for future PQC schemes without
  changing the structure or the signed object (§3.2, §5.4);
- **MUST** treat `keyId` as self-asserted and resolve it only through a
  `resolveKey` trust anchor that validates against a trusted issuer registry
  (§4);
- **MUST** verify by computing all three of `manifestMatches`, `reproducible`,
  and `signatureValid` as independent booleans (§5), re-running reconciliation
  with `new Date(input.evaluatedAt)` as the clock and gating the re-run on
  `inputsMatch && manifestMatches` (§5.1), and re-binding `report` to
  `reportHash` as part of `signatureValid` (§5.3);
- **MAY** carry the receipt over any byte-preserving transport, with the anchors
  envelope as the reference carrier (§6) — which is **informative**, not
  required.
