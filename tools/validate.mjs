#!/usr/bin/env node
// RaC structural validation — the whole CI gate. Zero deps, zero network.
//   node tools/validate.mjs
// Exits 0 when clean, 1 on failures (all failures printed).
//
// What this does NOT do: decide whether a vector's per-obligation `status` is
// CORRECT. That needs the private reconciliation engine (the normative oracle —
// conformance/assertions.md § Running the suite). See tools/lib/checks.mjs for
// the full boundary.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { assertSupported, validate } from "./lib/schema-mini.mjs";
import { obligationOrder, checkCitationParity, checkVectorSelfConsistency, checkLinks } from "./lib/checks.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => join(ROOT, ...s);
const rel = (abs) => relative(ROOT, abs).split(/[\\/]/).join("/");
const readJson = async (abs) => JSON.parse(await readFile(abs, "utf8"));

async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".worktrees" || e.name === "node_modules") continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

const failures = [];
const record = (family, errs) => { for (const e of errs) failures.push(`[${family}] ${e}`); };

// ── 1. Vectors: schema conformance + self-consistency ────────────────────────
const schema = await readJson(p("conformance/vectors.schema.json"));
assertSupported(schema); // throws loudly if the schema grew an unimplemented keyword
const profileMd = await readFile(p("profiles/gdpr/v1.md"), "utf8");
const order = obligationOrder(profileMd);
if (order.length === 0) failures.push("[profile] could not extract any obligation id from profiles/gdpr/v1.md — the §2.2 manifest shape changed; fix obligationOrder() in tools/lib/checks.mjs");

const vectorDir = p("conformance/vectors");
const vectorFiles = (await readdir(vectorDir)).filter((f) => f.endsWith(".json")).sort();
if (vectorFiles.length === 0) failures.push("[vectors] conformance/vectors/ contains no .json vectors");
for (const f of vectorFiles) {
  const vector = await readJson(join(vectorDir, f));
  record("schema", validate(schema, vector).map((e) => `${f}: ${e}`));
  record("vector", checkVectorSelfConsistency(f, vector, order));
}

// ── 2. Citations ↔ profile obligations ───────────────────────────────────────
record("citations", checkCitationParity(profileMd, await readJson(p("profiles/citations.json")), { doc: "gdpr-v1" }));

// ── 3. Relative + anchor links ───────────────────────────────────────────────
const all = await walk(ROOT);
const docs = all.filter((f) => f.endsWith(".md") || f.endsWith("llms.txt"));
const files = new Map();
for (const f of docs) files.set(rel(f), await readFile(f, "utf8"));

// Every repo path (files AND their ancestor dirs) — README.md links to
// `conformance/` and assertions.md links to `vectors/`, so directory targets
// MUST resolve. Verified: both are live links today.
const knownPaths = new Set();
for (const f of all) {
  let cur = rel(f);
  knownPaths.add(cur);
  for (let d = dirname(cur); d && d !== "." && d !== "/"; d = dirname(d)) knownPaths.add(d.split(/[\\/]/).join("/"));
}
record("links", checkLinks({ files, exists: (relPath) => knownPaths.has(relPath) }));

console.log(`[rac-validate] ${vectorFiles.length} vectors · ${order.length} obligations · ${files.size} docs · ${failures.length} failures`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length) { console.error(`\nFAIL (${failures.length})`); process.exit(1); }
console.log("PASS");
