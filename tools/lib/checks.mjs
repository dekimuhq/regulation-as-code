// Pure structural checks. No fs, no network — every function takes already-read
// strings/objects and returns string[] of failures ([] = clean). The runner
// (tools/validate.mjs) owns all I/O.
//
// ── SCOPE BOUNDARY — READ BEFORE ADDING A CHECK ─────────────────────────────
// The normative ORACLE for a profile is the shipped reconciliation engine, which
// is PRIVATE (conformance/assertions.md § Running the suite: the round-trip
// checker "lives outside this CC0 repo"). This repo therefore CANNOT decide
// whether a vector's per-obligation `status` is the right answer for its corpus.
// What it CAN decide, with no oracle, is whether a vector is internally coherent
// and consistent with the profile it names — arithmetic and set-comparison over
// content already in the repo. That is the entire remit of this file.
//
// Do NOT add: status derivation from the corpus, `fresh`/`maxAgeDays` date
// maths, or applicability derivation from `appliesWhen`. Applicability is pure
// fact-logic and therefore tempting, but transcribing `appliesWhen` semantics
// here would create a SECOND, UNAUTHORITATIVE evaluator inside the repo whose
// own README states "the reference implementation is a separate project and is
// not part of this repository". Drift between the two would be silent and this
// one would be wrong. The line is: arithmetic over a vector's OWN `expected`
// block = in scope; anything that computes what `expected` should contain = out.
import { dirname, join, normalize } from "node:path/posix";

// Obligation ids live in the §2.2 literal manifest. Slice from `obligations: [`
// so the manifest header (`id: "gdpr"`) can never leak in, and match only DOTTED
// ids as a second guard. Verified: both guards independently yield the same 8.
export function obligationOrder(profileMd) {
  const i = profileMd.indexOf("obligations: [");
  if (i === -1) return [];
  return [...profileMd.slice(i).matchAll(/id:\s*"([\w-]+\.[\w.-]+)"/g)].map((m) => m[1]);
}

/** [obligationId, citationUrl][] — a citationUrl belongs to the most recent id.
 *  Verified against profiles/gdpr/v1.md: the id always precedes its citationUrl. */
export function obligationCitations(profileMd) {
  const i = profileMd.indexOf("obligations: [");
  if (i === -1) return [];
  const out = [];
  let current = null;
  for (const m of profileMd.slice(i).matchAll(/id:\s*"([\w-]+\.[\w.-]+)"|citationUrl:\s*"(https?:[^"]+)"/g)) {
    if (m[1]) current = m[1];
    else if (current) out.push([current, m[2]]);
  }
  return out;
}

/** Binds profiles/citations.json rows to the profile's obligations.
 *  BOUNDARY vs the monorepo: scripts/link-audit/lib/citation-surfaces.mjs:44-85
 *  compares URL *sets* (source citationUrls ↔ registry urls) across repos and
 *  ignores clauseId entirely — its own smoke fabricates `clauseId: c${i}`.
 *  Set parity is necessary but NOT sufficient: swap two rows' clauseIds and the
 *  URL set is unchanged, so the monorepo passes while the registry is wrong.
 *  This check binds id→url, which nothing else does. */
export function checkCitationParity(profileMd, citations, { doc = "gdpr-v1" } = {}) {
  const errs = [];
  const order = obligationOrder(profileMd);
  const entries = (citations.entries ?? []).filter((e) => e.doc === doc);

  for (const e of entries) {
    if (!order.includes(e.clauseId)) errs.push(`profiles/citations.json: clauseId "${e.clauseId}" matches no obligation in the profile (obligations: ${order.join(", ")})`);
  }
  // citationUrl is a SHOULD, not a MUST (CONTRIBUTING.md:26 → spec/grammar.md §4):
  // an obligation with no citationUrl is CORRECT and MUST NOT be flagged. Only the
  // obligations that DO declare one are required to be registered. Today 3 of 8
  // declare one — asserting 8 would false-red the profile.
  for (const [id, url] of obligationCitations(profileMd)) {
    const e = entries.find((x) => x.clauseId === id);
    if (!e) { errs.push(`profiles/citations.json: obligation "${id}" declares citationUrl ${url} but has no registry entry`); continue; }
    if (e.url !== url) errs.push(`profiles/citations.json: clauseId "${id}" registers ${e.url} but the profile cites ${url}`);
  }
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.clauseId)) errs.push(`profiles/citations.json: duplicate entry for clauseId "${e.clauseId}"`);
    seen.add(e.clauseId);
  }
  return errs;
}

/** Internal coherence of one vector's `expected` block. Oracle-free by
 *  construction: every assertion is arithmetic over the vector's own results. */
export function checkVectorSelfConsistency(fileName, vector, order) {
  const errs = [];
  const stem = fileName.replace(/\.json$/, "");
  if (vector.name !== stem) errs.push(`${fileName}: "name" is "${vector.name}" but the filename stem is "${stem}"`);

  const results = vector.expected?.results ?? [];
  const ids = results.map((r) => r.obligationId);
  // assertions.md (last MUST): results in author order, independent of internal
  // evaluation order. Equality here also catches omissions, extras and dupes.
  if (ids.length !== order.length || ids.some((id, i) => id !== order[i])) {
    errs.push(`${fileName}: expected.results must list every obligation exactly once in profile author order — got [${ids.join(", ")}], profile order is [${order.join(", ")}]`);
  }
  // assertions.md:35-46 — honest denominator (`satisfied / applicable`,
  // not-applicable excluded) and the vacuous case (applicable === 0 ⇒ 1, "not 0
  // and not NaN"). Tolerance because 5/6 is stored as a full-precision double.
  const applicable = results.filter((r) => r.status !== "not-applicable").length;
  const satisfied = results.filter((r) => r.status === "satisfied").length;
  const derived = applicable === 0 ? 1 : satisfied / applicable;
  const stored = vector.expected?.coverageRatio;
  if (typeof stored !== "number" || Math.abs(derived - stored) > 1e-9) {
    errs.push(`${fileName}: coverageRatio ${stored} contradicts its own results — ${satisfied} satisfied / ${applicable} applicable = ${derived}`);
  }
  return errs;
}

/** GitHub's heading-anchor algorithm: lowercase, drop everything that is not a
 *  word char / space / hyphen, then replace EACH space with "-".
 *  TRAP — do NOT collapse whitespace runs with /\s+/g. Dropping the em-dash from
 *  "3. Requirement — satisfaction …" leaves TWO spaces, so the real anchor is
 *  "3-requirement--satisfaction-…" with a DOUBLE hyphen. crossmap/oscal.md links
 *  to exactly that; a collapsing slugifier reports a CORRECT link as dead
 *  (verified — it was this checker's first false positive). */
export function slugify(heading) {
  return heading.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-");
}

/** Heading slugs of a markdown doc, skipping fenced code blocks (a `#` comment
 *  inside ```sh is not a heading). Duplicate headings would need GitHub's "-1"
 *  suffix rule; the repo has none today, so it is deliberately not implemented. */
export function headingSlugs(md) {
  const out = new Set();
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) out.add(slugify(m[2]));
  }
  return out;
}

/** Relative + anchor link integrity.
 *  @param files  Map<repoRelPosixPath, content> — markdown-ish docs only.
 *  @param exists (repoRelPosixPath) => boolean — ANY repo path (dirs + LICENSE too).
 *  External http(s)/mailto targets are out of scope: the monorepo's link-audit
 *  already reaches those (and the citation sentinel owns the regulator URLs). */
export function checkLinks({ files, exists }) {
  const errs = [];
  const slugCache = new Map();
  const slugsFor = (p) => {
    if (!slugCache.has(p)) slugCache.set(p, files.has(p) ? headingSlugs(files.get(p)) : null);
    return slugCache.get(p);
  };
  for (const [file, text] of files) {
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/i.test(target)) continue;
      const hash = target.indexOf("#");
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? "" : target.slice(hash + 1);
      const resolved = rel === "" ? file : normalize(join(dirname(file), rel)).replace(/\/$/, "");
      if (rel !== "" && !exists(resolved)) { errs.push(`${file}: dead relative link → ${target}`); continue; }
      if (!frag) continue;
      const slugs = slugsFor(resolved);
      if (slugs === null) continue; // directory or non-markdown target — no anchors to check
      if (!slugs.has(frag)) errs.push(`${file}: link → ${target} points at a heading that does not exist in ${resolved}`);
    }
  }
  return errs;
}
