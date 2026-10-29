import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import type { Direction } from "../menu/types";
import * as content from "./content";
import {
  CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLE_RECORDS, CHRONICLES_MAP, CHRONICLES_TITLE,
  getChronicleRecord, getChronicleRecords, getChronicleShortTitle, getHotspotRecords, getNationAccounts,
  getNextArticle, getNextHotspot, getNextTimelineStop, hotspotAt,
} from "./content";
import type { ChronicleNationId } from "./types";

const NATIONS: readonly ChronicleNationId[] = ["korvenia", "solforiz", "aethelgard", "kwind-09"];

// A creator-maintained set of spoiler-guard phrases, stored hashed.
const GUARDED_PHRASES = [
  { length: 11, sha256: "94da9c8bb8d871f84657fb8936d0962cba359fc7f0da8c962a21127303ebd6e2" },
  { length: 6, sha256: "641f3495279b93bc8a54d7887e221454aec9ace44c8b4c93622f8c81858556cd" },
  { length: 6, sha256: "cdb59355f3ba293977fc0945fb85f11822d412c45c7520c7121bd2234f6c1f48" },
  { length: 10, sha256: "32e4bc02a7ccf34d72692db7f08aa945102e290beb4832d5673b987015d8cb4f" },
  { length: 9, sha256: "ea0287f6a123b9fec277e4e1b3bf33e07fb965c4073168a1d3cb15516c905a86" },
  { length: 4, sha256: "4000f2014d95492e58f30c07881c44db7538ae01033febe6043b5f0814b5e811" },
] as const;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Returns the index of the first phrase found in the normalised text, or -1. */
function findGuardedPhrase(text: string, phrases: readonly { length: number; sha256: string }[]): number {
  const normalized = normalize(text);
  for (const [entry, phrase] of phrases.entries()) {
    for (let index = 0; index + phrase.length <= normalized.length; index++) {
      if (sha256(normalized.slice(index, index + phrase.length)) === phrase.sha256) return entry;
    }
  }
  return -1;
}

/** Every string a module exports, object keys included; functions and typed arrays hold no copy. */
function exportedStrings(module: Record<string, unknown>): string[] {
  const strings: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !seen.has(value)) {
      seen.add(value);
      for (const [key, item] of Object.entries(value)) { strings.push(key); walk(item); }
    }
  };
  for (const value of Object.values(module)) if (typeof value !== "function") walk(value);
  return strings;
}

/** Every module under shared/chronicles, nested folders included, except tests. */
async function chronicleModules(directory = new URL("./", import.meta.url)): Promise<URL[]> {
  const modules: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) modules.push(...await chronicleModules(new URL(`${entry.name}/`, directory)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) modules.push(new URL(entry.name, directory));
  }
  return modules.sort((a, b) => a.href.localeCompare(b.href));
}

test("every record has a known exhibit and label, text and a unique id", () => {
  const exhibits = CHRONICLE_EXHIBITS.map((exhibit) => exhibit.id);
  for (const record of CHRONICLE_RECORDS) {
    assert.ok(exhibits.includes(record.exhibit), record.id);
    assert.ok(Object.keys(CHRONICLE_LABELS).includes(record.label), record.id);
    assert.ok(record.title.trim() && record.body.trim(), record.id);
    assert.match(record.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    if (record.nation) assert.ok(NATIONS.includes(record.nation), record.id);
    if (record.hotspot) assert.equal(record.exhibit, "atlas", `${record.id} places a hotspot outside the Atlas`);
  }
  assert.equal(new Set(CHRONICLE_RECORDS.map((record) => record.id)).size, CHRONICLE_RECORDS.length);
});

test("each nation has exactly one Atlas map record, clear of the centre", () => {
  for (const nation of NATIONS) {
    const records = getHotspotRecords().filter((record) => record.nation === nation);
    assert.equal(records.length, 1, nation);
    const { hotspot } = records[0];
    for (const value of [hotspot.x, hotspot.y]) assert.ok(value > 0 && value < 1, nation);
    assert.ok(Math.hypot(hotspot.x - 0.5, hotspot.y - 0.5) >= 0.2, nation);
  }
  assert.equal(getHotspotRecords().length, NATIONS.length);
  assert.ok(getHotspotRecords().every((record) => record.exhibit === "atlas"));
});

test("hotspotAt opens each nation and empty ground does nothing", () => {
  assert.equal(hotspotAt(0.5, 0.5), null);
  for (const record of getHotspotRecords()) {
    assert.equal(hotspotAt(record.hotspot.x, record.hotspot.y), record);
    assert.equal(hotspotAt(record.hotspot.x + 0.029, record.hotspot.y), record);
    assert.equal(hotspotAt(record.hotspot.x + 0.031, record.hotspot.y), null);
    assert.equal(hotspotAt(record.hotspot.x, record.hotspot.y, -1), null);
  }
  for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.2], [0.5, 0.8], [NaN, 0.5], [0.5, Infinity]]) assert.equal(hotspotAt(x, y), null, `${x}, ${y}`);
});

test("labels, exhibits, title and map are complete", async () => {
  assert.deepEqual(Object.keys(CHRONICLE_LABELS), ["recorded", "disputed", "testimony", "rumor"]);
  for (const info of Object.values(CHRONICLE_LABELS)) assert.ok(info.name.trim() && info.meaning.trim());
  assert.deepEqual(CHRONICLE_EXHIBITS.map((exhibit) => exhibit.id), ["atlas", "interregnum", "laws"]);
  for (const exhibit of CHRONICLE_EXHIBITS) {
    assert.ok(exhibit.title.trim());
    assert.ok(getChronicleRecords(exhibit.id).length > 0, exhibit.id);
  }
  assert.ok(CHRONICLES_TITLE.trim() && CHRONICLES_MAP.alt.trim());
  assert.match(CHRONICLES_MAP.src, /^\/assets\/chronicles\/[a-z0-9-]+\.webp$/);
  const bytes = await readFile(new URL(`../../main game/public${CHRONICLES_MAP.src}`, import.meta.url));
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const format = bytes.toString("ascii", 12, 16);
  const size = format === "VP8X" ? [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1]
    : format === "VP8L" ? [(bytes.readUInt32LE(21) & 0x3fff) + 1, ((bytes.readUInt32LE(21) >>> 14) & 0x3fff) + 1]
      : [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  assert.deepEqual(size, [CHRONICLES_MAP.width, CHRONICLES_MAP.height], "map dimensions match the delivered artwork");
});

test("lookups return content records in order", () => {
  for (const exhibit of CHRONICLE_EXHIBITS) {
    assert.deepEqual(getChronicleRecords(exhibit.id), CHRONICLE_RECORDS.filter((record) => record.exhibit === exhibit.id));
    assert.equal(getChronicleRecords(exhibit.id), getChronicleRecords(exhibit.id), "exhibit lists are shared, not rebuilt");
  }
  for (const record of CHRONICLE_RECORDS) assert.equal(getChronicleRecord(record.id), record);
  assert.equal(getChronicleRecord("unknown"), undefined);
  assert.deepEqual(getHotspotRecords().map(getChronicleShortTitle), ["Korvenia", "Solforiz", "Aethelgard", "Kwind-09"]);
  assert.deepEqual(getChronicleRecords("interregnum").map(getChronicleShortTitle), ["Year 0", "Years 1–12", "Year 19", "Year 33"]);
  for (const record of CHRONICLE_RECORDS) {
    const short = getChronicleShortTitle(record);
    assert.ok(short.trim() && record.title.startsWith(short), `${record.id} short title is part of its title`);
  }
  assert.deepEqual(getChronicleRecords("laws").map(getChronicleShortTitle), getChronicleRecords("laws").map((record) => record.title));
  for (const nation of NATIONS) {
    for (const account of getNationAccounts(nation)) {
      assert.equal(account.nation, nation);
      assert.equal(account.hotspot, undefined, "the map record is not repeated as an account");
    }
  }
});

test("hotspot navigation moves to the nearest nation in each direction and clamps", () => {
  const hotspots = getHotspotRecords();
  const index = (nation: ChronicleNationId) => hotspots.findIndex((record) => record.nation === nation);
  const expected: Record<ChronicleNationId, Record<Direction, ChronicleNationId>> = {
    korvenia: { left: "korvenia", right: "aethelgard", up: "korvenia", down: "kwind-09" },
    aethelgard: { left: "korvenia", right: "aethelgard", up: "aethelgard", down: "solforiz" },
    "kwind-09": { left: "kwind-09", right: "solforiz", up: "korvenia", down: "kwind-09" },
    solforiz: { left: "kwind-09", right: "solforiz", up: "aethelgard", down: "solforiz" },
  };
  for (const nation of NATIONS) {
    for (const [direction, target] of Object.entries(expected[nation]) as [Direction, ChronicleNationId][]) {
      assert.equal(hotspots[getNextHotspot(index(nation), direction)].nation, target, `${nation} ${direction}`);
    }
  }
  assert.equal(hotspots[0].nation, "korvenia");
  assert.equal(getNextHotspot(-1, "right"), index("aethelgard"), "indexes below the list clamp to the first hotspot");
  assert.equal(getNextHotspot(NaN, "down"), index("kwind-09"));
  assert.equal(getNextHotspot(hotspots.length + 3, "up"), getNextHotspot(hotspots.length - 1, "up"), "indexes past the list clamp to the last hotspot");
});

test("timeline stops and articles step like Showcase lists and clamp at both ends", () => {
  for (const [exhibit, next] of [["interregnum", getNextTimelineStop], ["laws", getNextArticle]] as const) {
    const last = getChronicleRecords(exhibit).length - 1;
    assert.ok(last > 0, exhibit);
    for (const direction of ["right", "down"] as const) {
      assert.equal(next(0, direction), 1);
      assert.equal(next(last, direction), last);
    }
    for (const direction of ["left", "up"] as const) {
      assert.equal(next(1, direction), 0);
      assert.equal(next(0, direction), 0);
    }
    assert.equal(next(-5, "right"), 1);
    assert.equal(next(last + 5, "left"), last - 1);
    assert.equal(next(NaN, "right"), 1);
  }
});

test("no string exported by any shared/chronicles module contains a guarded phrase", async () => {
  assert.ok(exportedStrings(content).length > CHRONICLE_RECORDS.length * 2);
  const modules = await chronicleModules();
  const names = modules.map((url) => url.pathname.slice(url.pathname.lastIndexOf("/shared/chronicles/") + "/shared/chronicles/".length));
  for (const required of ["content.ts", "types.ts", "archive/relief.ts"]) assert.ok(names.includes(required), `the scan reaches ${required}`);
  for (const [index, url] of modules.entries()) {
    for (const text of exportedStrings(await import(url.href))) {
      const entry = findGuardedPhrase(text, GUARDED_PHRASES);
      assert.equal(entry, -1, `guarded phrase #${entry} found in ${names[index]}: ${JSON.stringify(text.slice(0, 60))}`);
    }
  }
});

test("the guarded-phrase scanner detects a known phrase however it is written", () => {
  const known = [{ length: 5, sha256: sha256("board") }];
  for (const text of ["The board", "THE BOARD.", "the—board", "Ｂｏａｒｄ", "on-board"]) assert.equal(findGuardedPhrase(text, known), 0, text);
  for (const text of ["boar", "b o a r d", "a quiet square"]) assert.equal(findGuardedPhrase(text, known), -1, text);
  assert.equal(GUARDED_PHRASES.length, 6);
  for (const phrase of GUARDED_PHRASES) assert.match(phrase.sha256, /^[0-9a-f]{64}$/);
});
