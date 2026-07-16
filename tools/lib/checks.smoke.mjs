// tools/lib/checks.smoke.mjs — fixture-based, no fs, no network.
import assert from "node:assert/strict";
import { obligationOrder, obligationCitations, checkCitationParity, checkVectorSelfConsistency, slugify, headingSlugs, checkLinks } from "./checks.mjs";

const PROFILE = `
# fixture
| id | article |
|---|---|
| \`x.alpha\` | Art. 1 |
\`\`\`ts
const M: SourceManifest = {
  id: "x",
  version: "1.0.0",
  facts: [{ name: "f", type: "boolean" }],
  obligations: [
    { id: "x.alpha", regulation: "Art. 1", citationUrl: "https://e.eu/a", requires: { kind: "exists", family: "A" } },
    { id: "x.beta", regulation: "Art. 2", requires: { kind: "exists", family: "B" } },
  ],
};
\`\`\``;

// --- parsing: manifest header id:"x" must NOT leak into the obligation list ---
assert.deepEqual(obligationOrder(PROFILE), ["x.alpha", "x.beta"]);
assert.deepEqual(obligationCitations(PROFILE), [["x.alpha", "https://e.eu/a"]]);

// --- citation parity ---
const reg = (...entries) => ({ version: 1, entries });
const good = reg({ doc: "d", clauseId: "x.alpha", url: "https://e.eu/a" });
assert.deepEqual(checkCitationParity(PROFILE, good, { doc: "d" }), []);
// x.beta has no citationUrl and no entry — CORRECT (SHOULD, not MUST). Never flag.
assert.equal(checkCitationParity(PROFILE, good, { doc: "d" }).length, 0);
// orphan clauseId
assert.match(checkCitationParity(PROFILE, reg({ doc: "d", clauseId: "x.alpha", url: "https://e.eu/a" }, { doc: "d", clauseId: "x.ghost", url: "https://e.eu/g" }), { doc: "d" })[0], /clauseId "x.ghost" matches no obligation/);
// declared citationUrl with no registry row
assert.match(checkCitationParity(PROFILE, reg(), { doc: "d" })[0], /obligation "x.alpha" declares citationUrl .* but has no registry entry/);
// URL mismatch on a correctly-named clause
assert.match(checkCitationParity(PROFILE, reg({ doc: "d", clauseId: "x.alpha", url: "https://e.eu/WRONG" }), { doc: "d" })[0], /registers .*WRONG.* but the profile cites/);
// duplicate clauseId
assert.match(checkCitationParity(PROFILE, reg({ doc: "d", clauseId: "x.alpha", url: "https://e.eu/a" }, { doc: "d", clauseId: "x.alpha", url: "https://e.eu/a" }), { doc: "d" })[0], /duplicate entry for clauseId "x.alpha"/);
// rows for another doc are ignored
assert.deepEqual(checkCitationParity(PROFILE, reg({ doc: "d", clauseId: "x.alpha", url: "https://e.eu/a" }, { doc: "other", clauseId: "zz.nope", url: "https://e.eu/z" }), { doc: "d" }), []);

// --- vector self-consistency ---
const ORDER = ["a", "b", "c"];
const V = (results, coverageRatio) => ({ name: "01-v", profile: "p", expected: { coverageRatio, results } });
const R = (id, status) => ({ obligationId: id, status });
assert.deepEqual(checkVectorSelfConsistency("01-v.json", V([R("a", "satisfied"), R("b", "satisfied"), R("c", "missing")], 2 / 3), ORDER), []);
// vacuous truth: applicable === 0 ⇒ 1
assert.deepEqual(checkVectorSelfConsistency("01-v.json", V([R("a", "not-applicable"), R("b", "not-applicable"), R("c", "not-applicable")], 1), ORDER), []);
assert.match(checkVectorSelfConsistency("01-v.json", V([R("a", "not-applicable"), R("b", "not-applicable"), R("c", "not-applicable")], 0), ORDER)[0], /coverageRatio 0 contradicts its own results/);
// honest denominator: not-applicable excluded
assert.deepEqual(checkVectorSelfConsistency("01-v.json", V([R("a", "satisfied"), R("b", "expired"), R("c", "not-applicable")], 0.5), ORDER), []);
assert.match(checkVectorSelfConsistency("01-v.json", V([R("a", "satisfied"), R("b", "expired"), R("c", "not-applicable")], 1 / 3), ORDER)[0], /contradicts its own results/);
// author order enforced
assert.match(checkVectorSelfConsistency("01-v.json", V([R("b", "satisfied"), R("a", "satisfied"), R("c", "missing")], 2 / 3), ORDER)[0], /author order/);
// missing an obligation entirely
assert.match(checkVectorSelfConsistency("01-v.json", V([R("a", "satisfied"), R("b", "satisfied")], 1), ORDER)[0], /author order/);
// name must match filename stem
assert.match(checkVectorSelfConsistency("99-other.json", V([R("a", "satisfied"), R("b", "satisfied"), R("c", "satisfied")], 1), ORDER)[0], /"name" is "01-v" but the filename stem is "99-other"/);
// float tolerance: 5/6 stored at full double precision must pass
// (fixture needs 6 applicable with 5 satisfied so derived === 5/6; the plan's
// original 3-result fixture computed 2/3 and could never match — fixed here)
const ORDER6 = ["a", "b", "c", "d", "e", "f"];
assert.deepEqual(checkVectorSelfConsistency("03-x.json", { name: "03-x", expected: { coverageRatio: 0.8333333333333334, results: [R("a", "satisfied"), R("b", "satisfied"), R("c", "satisfied"), R("d", "satisfied"), R("e", "satisfied"), R("f", "missing")] } }, ORDER6).filter((e) => /coverageRatio/.test(e)), []);

// --- slugify: the double-hyphen trap ---
// GitHub replaces EACH space with "-" and does NOT collapse runs. Dropping the
// em-dash leaves two spaces ⇒ "--". A collapsing slugifier false-reds a CORRECT link.
assert.equal(slugify("3. Requirement — satisfaction quantifiers over the corpus"), "3-requirement--satisfaction-quantifiers-over-the-corpus");
assert.equal(slugify("7.1 ObligationReport"), "71-obligationreport");
assert.equal(slugify("1. The abstract corpus record (normative)"), "1-the-abstract-corpus-record-normative");
// headings inside fenced code blocks are not headings
assert.deepEqual([...headingSlugs("# Real\n\n```sh\n# not a heading\n```\n")], ["real"]);

// --- links ---
const files = new Map([
  // "## Local" lives HERE — [self](#local) is a same-file anchor (the plan's
  // fixture had it only in c.md, which made the self-link a false failure)
  ["a/b.md", "## Local\n\n[x](../c.md#some-heading) [dir](../conformance/) [ext](https://e.eu) [self](#local) [dead](../nope.md) [bad-anchor](../c.md#ghost)"],
  ["c.md", "## Some heading\n"],
]);
const exists = (p) => ["a/b.md", "c.md", "conformance"].includes(p);
const errs = checkLinks({ files, exists });
assert.equal(errs.length, 2, `expected exactly 2, got ${JSON.stringify(errs)}`);
assert.ok(errs.some((e) => /dead relative link → \.\.\/nope\.md/.test(e)));
assert.ok(errs.some((e) => /#ghost/.test(e) && /heading that does not exist/.test(e)));
console.log("checks smoke OK");
