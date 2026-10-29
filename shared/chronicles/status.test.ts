import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLE_RECORDS, getChronicleRecords } from "./content";
import {
  CHRONICLE_COLLECTIONS, CHRONICLE_REGISTRY, createChronicleRegistry, getChronicleCollections,
  getChronicleEntries, getChronicleEntry, getCollectionEntries, validateChronicleProposal,
} from "./registry";
import {
  CANON_MARKERS, CANON_STATUSES, CHRONICLES_CONTENT_POLICY, SOURCE_RELIABILITIES,
  getCanonMarker, isCanonStatus, isCreatorApproved, isStatusVisible,
} from "./status";
import type { CanonStatus, ContentPolicy } from "./status";
import type { ChronicleEntry, ChronicleLabel, ChronicleRecord } from "./types";

const OFF: ContentPolicy = { showUnapproved: false };
const ON: ContentPolicy = { showUnapproved: true };
const MALFORMED_POLICIES = [{}, null, undefined, { showUnapproved: "yes" }, { showUnapproved: 1 }] as unknown as ContentPolicy[];
const APPROVED_IDS = CHRONICLE_RECORDS.map((record) => record.id);

// Development fixtures for these tests only: never content and never shipped.
const fixture = (change: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
  id: "fixture-proposal", collection: "laws", canonStatus: "working-proposal",
  title: "Fixture proposal", body: "Development fixture text.", ...change,
});

test("canon statuses split into the creator's three and the two agents may write", () => {
  assert.deepEqual(CANON_STATUSES, ["approved", "public-assertion", "disputed-testimony", "working-proposal", "placeholder"]);
  assert.deepEqual(CANON_STATUSES.filter(isCreatorApproved), ["approved", "public-assertion", "disputed-testimony"]);
  assert.deepEqual(SOURCE_RELIABILITIES, ["verified-fact", "interpretation", "rumor-or-accusation", "missing-evidence", "unresolved-claim"]);
  for (const status of CANON_STATUSES) assert.ok(isCanonStatus(status), status);
  for (const value of ["Approved", "", "recorded", undefined, null, 1]) assert.equal(isCanonStatus(value), false, String(value));
  assert.ok(Object.isFrozen(CANON_STATUSES) && Object.isFrozen(SOURCE_RELIABILITIES));
});

test("the content policy is the one switch: frozen, boolean and nothing else", () => {
  assert.deepEqual(Object.keys(CHRONICLES_CONTENT_POLICY), ["showUnapproved"]);
  assert.equal(typeof CHRONICLES_CONTENT_POLICY.showUnapproved, "boolean");
  assert.ok(Object.isFrozen(CHRONICLES_CONTENT_POLICY));
  assert.throws(() => { (CHRONICLES_CONTENT_POLICY as { showUnapproved: boolean }).showUnapproved = !CHRONICLES_CONTENT_POLICY.showUnapproved; }, TypeError);
  for (const status of CANON_STATUSES) {
    assert.equal(isStatusVisible(status, ON), true, status);
    assert.equal(isStatusVisible(status, OFF), isCreatorApproved(status), status);
    for (const policy of MALFORMED_POLICIES) assert.equal(isStatusVisible(status, policy), isCreatorApproved(status), `${status} under ${JSON.stringify(policy)}`);
  }
  assert.equal(isStatusVisible("approved-ish" as CanonStatus, ON), false, "an unknown status never shows");
});

test("with the switch off, the registry returns exactly the 11 approved records, in content order, as the same strings, and no marker", () => {
  const entries = getChronicleEntries(OFF);
  assert.equal(CHRONICLE_RECORDS.length, 11);
  assert.equal(entries.length, 11);
  assert.deepEqual(entries.map((entry) => entry.id), APPROVED_IDS);
  entries.forEach((entry, index) => {
    const record = CHRONICLE_RECORDS[index];
    assert.equal(entry.canonStatus, "approved", entry.id);
    assert.equal(entry.collection, record.exhibit, entry.id);
    assert.equal(entry.label, record.label, entry.id);
    assert.ok(Object.is(entry.title, record.title) && Object.is(entry.body, record.body), `${entry.id} keeps the record's own strings`);
    assert.equal(entry.nation, record.nation, entry.id);
    assert.deepEqual(Object.keys(entry), ["id", "collection", "canonStatus", "label", "title", "body", ...(record.nation ? ["nation"] : [])]);
    assert.equal(getCanonMarker(entry.canonStatus, OFF), null, entry.id);
    assert.equal(getChronicleEntry(entry.id, OFF), entry);
  });
  for (const status of CANON_STATUSES) assert.equal(getCanonMarker(status, OFF), null, `no ${status} marker with the switch off`);
  assert.equal(getChronicleEntry("unknown", OFF), undefined);
  assert.equal(getChronicleEntry(undefined as unknown as string, ON), undefined);
});

test("M1 ships no proposal, so the draft build shows the same 11 approved entries", () => {
  assert.equal(CHRONICLE_REGISTRY.all.length, CHRONICLE_RECORDS.length);
  assert.ok(CHRONICLE_REGISTRY.all.every((entry) => entry.canonStatus === "approved"));
  for (const policy of [ON, CHRONICLES_CONTENT_POLICY]) {
    assert.deepEqual(getChronicleEntries(policy), getChronicleEntries(OFF));
    assert.ok(getChronicleEntries(policy).every((entry) => getCanonMarker(entry.canonStatus, policy) === null));
  }
});

test("with the switch on, a fixture proposal appears with its marker, and the switch off removes both", () => {
  const proposal = fixture();
  const placeholder = fixture({ id: "fixture-placeholder", collection: "atlas", canonStatus: "placeholder", nation: "korvenia" });
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [proposal, placeholder]);

  assert.deepEqual(registry.entries(ON).map((entry) => entry.id), [...APPROVED_IDS, "fixture-proposal", "fixture-placeholder"]);
  const shown = registry.entry("fixture-proposal", ON);
  assert.ok(shown);
  assert.equal(shown.canonStatus, "working-proposal");
  assert.ok(Object.is(shown.title, proposal.title) && Object.is(shown.body, proposal.body));
  assert.equal(getCanonMarker(shown.canonStatus, ON), "Working proposal");
  assert.equal(getCanonMarker(registry.entry("fixture-placeholder", ON)!.canonStatus, ON), "Placeholder");
  for (const entry of registry.entries(ON)) {
    if (isCreatorApproved(entry.canonStatus)) assert.equal(getCanonMarker(entry.canonStatus, ON), null, `${entry.id} carries no marker`);
  }
  assert.deepEqual(registry.collectionEntries("laws", ON).map((entry) => entry.id), [...getChronicleRecords("laws").map((record) => record.id), "fixture-proposal"]);

  assert.deepEqual(registry.entries(OFF).map((entry) => entry.id), APPROVED_IDS);
  assert.equal(registry.entry("fixture-proposal", OFF), undefined);
  assert.equal(registry.entry("fixture-placeholder", OFF), undefined);
  assert.deepEqual(registry.collectionEntries("laws", OFF).map((entry) => entry.id), getChronicleRecords("laws").map((record) => record.id));
  assert.equal(getCanonMarker(proposal.canonStatus, OFF), null);
  for (const policy of MALFORMED_POLICIES) {
    assert.deepEqual(registry.entries(policy).map((entry) => entry.id), APPROVED_IDS, "a malformed policy shows only approved words");
    assert.equal(getCanonMarker("working-proposal", policy), null);
  }
  assert.ok(registry.all.some((entry) => entry.id === "fixture-proposal"), "audits still see every entry");
});

test("a duplicate or shadowing id throws", () => {
  for (const record of CHRONICLE_RECORDS) {
    assert.throws(() => createChronicleRegistry(CHRONICLE_RECORDS, [fixture({ id: record.id, collection: record.exhibit })]), /would shadow an approved entry/, record.id);
  }
  assert.throws(() => createChronicleRegistry(CHRONICLE_RECORDS, [fixture(), fixture()]), /proposal id "fixture-proposal" appears twice/);
  assert.throws(() => createChronicleRegistry([...CHRONICLE_RECORDS, CHRONICLE_RECORDS[3]], []), /approved id "kwind-09" appears twice/);
  assert.throws(() => createChronicleRegistry([{ ...CHRONICLE_RECORDS[0], id: "Not Kebab" }], []), /not kebab-case/);
  assert.doesNotThrow(() => createChronicleRegistry(CHRONICLE_RECORDS, [fixture(), fixture({ id: "fixture-second" })]));
});

test("a proposal carrying a creator-approved status fails validation", () => {
  for (const status of CANON_STATUSES.filter(isCreatorApproved)) {
    const proposal = fixture({ canonStatus: status });
    assert.match(validateChronicleProposal(proposal).join("; "), /granted only by the creator/, status);
    assert.throws(() => createChronicleRegistry(CHRONICLE_RECORDS, [proposal]), /is refused/, status);
  }
  for (const status of ["working-proposal", "placeholder"] as const) assert.deepEqual(validateChronicleProposal(fixture({ canonStatus: status })), [], status);
  const malformed: [string, Partial<ChronicleEntry>][] = [
    ["canon status", { canonStatus: "approved-ish" as CanonStatus }],
    ["id", { id: "Not Kebab" }],
    ["collection", { collection: "annals" as ChronicleEntry["collection"] }],
    ["label", { label: "certain" as ChronicleLabel }],
    ["title", { title: "  " }],
    ["body", { body: "" }],
    ["nation", { nation: "elsewhere" as ChronicleEntry["nation"] }],
    ["event id", { eventId: "Year 19" }],
    ["source ids", { sourceIds: ["fixture-source", "Not kebab"] }],
  ];
  for (const [what, change] of malformed) {
    assert.equal(validateChronicleProposal(fixture(change)).length, 1, what);
    assert.throws(() => createChronicleRegistry(CHRONICLE_RECORDS, [fixture(change)]), /is refused/, what);
  }
  assert.deepEqual(validateChronicleProposal(null as unknown as ChronicleEntry), ["a proposal must be an entry object"]);
  assert.deepEqual(validateChronicleProposal(fixture({ eventId: "year-19", sourceIds: ["fixture-source"], label: "testimony" })), []);
});

test("canon status and label vary independently", () => {
  const approvedRumor: ChronicleRecord = { id: "fixture-approved-rumor", exhibit: "laws", label: "rumor", title: "Fixture rumor", body: "Development fixture text." };
  const recordedProposal = fixture({ id: "fixture-recorded-proposal", label: "recorded" });
  const registry = createChronicleRegistry([approvedRumor], [recordedProposal]);

  const rumor = registry.entry(approvedRumor.id, OFF);
  assert.ok(rumor, "an approved Rumor is accepted and shows with the switch off");
  assert.equal(rumor.canonStatus, "approved");
  assert.equal(rumor.label, "rumor");
  assert.equal(getCanonMarker(rumor.canonStatus, ON), null);

  assert.equal(registry.entry(recordedProposal.id, OFF), undefined, "Recorded does not make a proposal approved");
  const recorded = registry.entry(recordedProposal.id, ON);
  assert.ok(recorded);
  assert.equal(recorded.canonStatus, "working-proposal");
  assert.equal(recorded.label, "recorded");
  assert.equal(getCanonMarker(recorded.canonStatus, ON), "Working proposal");

  for (const label of Object.keys(CHRONICLE_LABELS) as ChronicleLabel[]) {
    for (const canonStatus of ["working-proposal", "placeholder"] as const) assert.deepEqual(validateChronicleProposal(fixture({ label, canonStatus })), [], `${canonStatus} ${label}`);
    const record: ChronicleRecord = { ...approvedRumor, label };
    assert.equal(createChronicleRegistry([record], []).entry(record.id, OFF)?.canonStatus, "approved", `an approved ${label} record`);
  }
});

test("registry lists are frozen and shared, and building one leaves its inputs untouched", () => {
  assert.equal(getChronicleEntries(ON), getChronicleEntries({ showUnapproved: true }));
  assert.equal(getChronicleEntries(OFF), getChronicleEntries({ showUnapproved: false }));
  assert.equal(getCollectionEntries("atlas", OFF), getCollectionEntries("atlas", OFF));
  assert.equal(getChronicleCollections(ON), getChronicleCollections(ON));
  for (const list of [CHRONICLE_REGISTRY.all, getChronicleEntries(ON), getChronicleEntries(OFF), getCollectionEntries("laws", ON), getChronicleCollections(OFF)]) {
    assert.ok(Object.isFrozen(list));
  }
  for (const entry of CHRONICLE_REGISTRY.all) assert.ok(Object.isFrozen(entry), entry.id);
  assert.throws(() => { (getChronicleEntries(ON) as ChronicleEntry[]).push(fixture()); }, TypeError);
  assert.throws(() => { (CHRONICLE_REGISTRY.all[0] as { title: string }).title = "Changed"; }, TypeError);
  assert.ok(Object.isFrozen(CHRONICLE_REGISTRY));

  const proposal = fixture({ sourceIds: ["fixture-source"] });
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [proposal]);
  assert.ok(!Object.isFrozen(proposal), "the factory copies proposals rather than freezing the caller's objects");
  const copy = registry.entry(proposal.id, ON)!;
  assert.notEqual(copy.sourceIds, proposal.sourceIds);
  assert.deepEqual(copy.sourceIds, proposal.sourceIds);
  assert.ok(Object.isFrozen(copy.sourceIds));
});

test("a collection is offered only while the policy leaves it something to show", () => {
  assert.deepEqual(CHRONICLE_COLLECTIONS, ["atlas", "interregnum", "laws", "contested"]);
  assert.deepEqual(CHRONICLE_COLLECTIONS.slice(0, 3), CHRONICLE_EXHIBITS.map((exhibit) => exhibit.id));
  for (const policy of [ON, OFF, CHRONICLES_CONTENT_POLICY]) {
    assert.deepEqual(getChronicleCollections(policy), ["atlas", "interregnum", "laws"]);
    assert.deepEqual(getCollectionEntries("contested", policy), []);
    for (const exhibit of CHRONICLE_EXHIBITS) {
      assert.deepEqual(getCollectionEntries(exhibit.id, policy).map((entry) => entry.id), getChronicleRecords(exhibit.id).map((record) => record.id));
    }
  }
  const registry = createChronicleRegistry(CHRONICLE_RECORDS, [fixture({ id: "fixture-contested", collection: "contested" })]);
  assert.deepEqual(registry.collections(ON), ["atlas", "interregnum", "laws", "contested"]);
  assert.deepEqual(registry.collections(OFF), ["atlas", "interregnum", "laws"]);
  assert.deepEqual(registry.collectionEntries("contested", OFF), []);
  assert.deepEqual(registry.collectionEntries("unknown" as "contested", ON), []);
});

test("the markers are placeholder data, shown only beside unapproved words while the switch is on", () => {
  assert.deepEqual(Object.keys(CANON_MARKERS), ["working-proposal", "placeholder"]);
  assert.deepEqual(Object.values(CANON_MARKERS).map((marker) => marker.canonStatus), ["placeholder", "placeholder"]);
  assert.equal(CANON_MARKERS["working-proposal"].text, "Working proposal");
  assert.equal(CANON_MARKERS.placeholder.text, "Placeholder");
  assert.ok(Object.isFrozen(CANON_MARKERS) && Object.values(CANON_MARKERS).every(Object.isFrozen));
  assert.equal(getCanonMarker("working-proposal", ON), "Working proposal");
  assert.equal(getCanonMarker("placeholder", ON), "Placeholder");
  for (const status of CANON_STATUSES) {
    assert.equal(getCanonMarker(status, OFF), null, status);
    if (isCreatorApproved(status)) assert.equal(getCanonMarker(status, ON), null, status);
  }
  assert.equal(getCanonMarker("unknown" as CanonStatus, ON), null);
});

// The content layer is shared by a React app and an IWSDK app, and the Quest typecheck targets ES2020.
test("the content layer stays platform-free, deterministic and ES2020-safe", async () => {
  const directory = new URL("./", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
  for (const required of ["content.ts", "registry.ts", "scene-state.fixture.ts", "scene-state.ts", "status.ts", "types.ts"]) assert.ok(names.includes(required), required);
  const banned: [RegExp, string][] = [
    [/\bfrom\s+["'](?:react(?:-dom)?|three|@iwsdk\/[^"']*|@pmndrs\/[^"']*)["']/, "a renderer or framework import"],
    [/\b(?:window|document|localStorage|sessionStorage|indexedDB|navigator)\s*\./, "a browser global"],
    [/\b(?:requestAnimationFrame|setTimeout|setInterval|fetch|structuredClone)\s*\(/, "a timer or browser call"],
    [/Math\.random|\bDate\b|performance\.now/, "time or randomness"],
    [/\.at\(|\bfindLast(?:Index)?\b|Object\.hasOwn\b|\.replaceAll\(/, "an API newer than ES2020"],
  ];
  for (const name of names) {
    const source = await readFile(new URL(name, directory), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const [pattern, what] of banned) assert.doesNotMatch(code, pattern, `${name} uses ${what}`);
    for (const [, specifier] of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.match(specifier, /^\.\.?\//, `${name} imports ${specifier}`);
      assert.doesNotMatch(specifier, /main game|main-game-vr|web\//, `${name} reaches into an app: ${specifier}`);
    }
  }
});
