# Contributing

Thanks for helping improve the **Regulation-as-Code (RaC)** specification.

## Developer Certificate of Origin (DCO)

All contributions are made under the repository's CC0 1.0 dedication. Sign off every commit to certify you have the right to contribute it:

```
git commit -s -m "your message"
```

This appends a `Signed-off-by:` line, asserting the [Developer Certificate of Origin](https://developercertificate.org/).

## v1 stability

The grammar is **frozen at v1**. Changes to normative behavior (grammar, compilation, evaluation, receipt) require an **RFC** — see `rfcs/README.md` and `GOVERNANCE.md`. Editorial improvements (typos, clarifications, examples, conformance vectors) can be opened as ordinary PRs.

## Proposing a new profile

A regulation profile (e.g. AI-Act, DORA) is a `SourceManifest` plus its citations, placed under `profiles/<regulation>/v1.md`. New profiles ship continuously and do **not** require an RFC. To propose one:

1. Add `profiles/<regulation>/v1.md` following the structure of `profiles/gdpr/v1.md`.
2. Bind requirements to evidence families documented in `spec/evidence.md` (or add a new family binding there).
3. Include at least one conformance vector under `conformance/vectors/` exercising the profile.
4. Cite the authoritative legal source (e.g. EUR-Lex) via `citationUrl` for each obligation where a stable citation exists (`citationUrl` is a SHOULD, not a MUST — see `spec/grammar.md` §4).

## Pull requests

Use the PR template. State whether the change is **normative** or **editorial**, and which spec file(s) it touches.

## Conduct

Participation is governed by `CODE_OF_CONDUCT.md`.
