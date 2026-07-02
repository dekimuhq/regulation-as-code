# Governance

This document defines how the **Regulation-as-Code (RaC)** specification is maintained.

## Scope

- The specification text in this repository is dedicated to the public domain under **CC0 1.0** (see `LICENSE`). Implementations are licensed separately by their authors.
- The format short-name is **RaC**.
- Stable type discriminators defined by this spec:
  - `rac.manifest.v1` — a compiled obligation manifest.
  - `rac.evaluation.v1` — a signed, reproducible evaluation receipt.

## Steward

The specification is maintained by a **Steward**. The current Steward is **Dekimu**.

The Steward:

- merges pull requests after the process below is satisfied;
- maintains the frozen v1 state of the grammar;
- publishes accepted RFCs and profile additions;
- is the point of contact for security disclosures at `security@dekimu.com`.

## v1 stability rule

The **grammar** (`spec/grammar.md`) is frozen at v1. Any change to the grammar — adding, removing, or altering a fact type, condition kind, requirement kind, obligation field, or manifest field — is a normative change and **requires an accepted RFC**.

The same RFC requirement applies to normative changes in `spec/compilation.md`, `spec/evaluation.md`, and `spec/receipt.md`, because implementations interoperate on those semantics.

## RFC process

Normative changes go through the RFC process in `rfcs/`:

1. **Draft** — open a PR adding an RFC under `rfcs/`.
2. **Discussion** — a minimum **14-day** public discussion period.
3. **Steward consensus** — the Steward records a decision.
4. **Accepted / Rejected** — accepted RFCs are merged and the affected spec files updated in the same or a follow-up PR.

## What ships continuously (no RFC)

The following are **not** gated by the RFC cadence and may be merged by the Steward continuously:

- new **regulation profiles** under `profiles/` (e.g. a future AI-Act or DORA profile);
- new **evidence-family bindings** documented under `spec/evidence.md` (the family registry is intentionally open);
- editorial fixes (typos, clarifications, examples) that do not change normative behavior.

## Dormancy and succession

If the Steward is **dormant for more than 90 days** (no merged PRs and no response to opened issues), any prior Steward, or any group of **3 or more** people who have each landed a substantive PR, may restart maintenance: announce intent in an issue, wait 14 days for objection, and assume the Steward role if none is sustained.

## Contact

Security and disclosure: `security@dekimu.com`.
