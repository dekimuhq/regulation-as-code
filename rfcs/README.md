# RFCs

Normative changes to the **Regulation-as-Code (RaC)** specification — anything affecting the grammar, compilation, evaluation, or receipt semantics — go through this RFC process. See `../GOVERNANCE.md` for what counts as normative and what ships continuously without an RFC.

## Numbering

RFCs are numbered sequentially: `rfcs/0001-short-slug.md`, `rfcs/0002-short-slug.md`, … The number is assigned when the PR is opened (use the next free integer).

## Lifecycle

1. **Draft** — open a PR adding `rfcs/NNNN-slug.md`. Status: `Draft`.
2. **Discussion** — a minimum **14-day** public discussion period. Status: `Discussion`.
3. **Steward consensus** — the Steward records a decision in the RFC.
4. **Accepted** or **Rejected** — the final status is written into the RFC. Accepted RFCs are merged and the affected spec files updated.

## RFC template

```markdown
# RFC NNNN: <title>

- Status: Draft | Discussion | Accepted | Rejected
- Opened: YYYY-MM-DD
- Affects: spec/grammar.md | spec/compilation.md | spec/evaluation.md | spec/receipt.md

## Summary
One paragraph.

## Motivation
What problem does this solve? Why is it normative?

## Specification
The precise change, in normative language.

## Compatibility
Impact on existing manifests, compiled IR hashes, and receipts.

## Alternatives considered
```
