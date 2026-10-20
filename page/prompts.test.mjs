// Run with: TZ=America/New_York node --test page/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const P = require("./prompts.js");
const C = require("./core.js");
const here = dirname(fileURLToPath(import.meta.url));

const messages = [
  { id: "m1", chat_jid: "g1@g.us", chat_name: "Tech", ts: "2026-10-12 12:12:39-04:00", text: "Tickets on sale until Friday" },
];

test("extraction prompt carries message ids, timestamps, clubs and open items", () => {
  const s = P.extraction({ messages, clubs: ["Wharton Tech Club"], openItems: [{ id: "d--tech--sf-trek--buy", title: "Buy SF ticket", when: "2026-10-13" }], tz: "America/New_York", today: "2026-10-20" });
  for (const needle of ["m1", "2026-10-12 12:12:39-04:00", "Wharton Tech Club", "d--tech--sf-trek--buy", "America/New_York", "matchId"]) {
    assert.ok(s.includes(needle), needle);
  }
});

test("triage prompt lists every message id and asks for ids", () => {
  const s = P.triage({ messages: [...messages, { id: "m7", text: "anyone at the bar?" }] });
  for (const needle of ["m1", "m7", "Tickets on sale until Friday", '"ids"']) assert.ok(s.includes(needle), needle);
});

test("suggestChats prompt lists every group jid", () => {
  const s = P.suggestChats({ groups: [{ jid: "g1@g.us", name: "Tech" }, { jid: "g9@g.us", name: "Fantasy Football League" }] });
  assert.ok(s.includes("g1@g.us") && s.includes("g9@g.us"));
});

test("cli merge emits set ops only for changed items", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-"));
  const base = { kind: "deadline", title: "Buy SF ticket", club: "Wharton Tech Club", when: "2026-10-16", approx: false, action: "buy ticket", msgId: "m1", excerpt: "x" };
  const [kept] = C.mergeItems([], [C.normalizeExtraction(base, { msgIndex: { m1: messages[0] } })], "2026-10-12T00:00:00Z").upserts;
  writeFileSync(join(dir, "existing.json"), JSON.stringify([{ ...kept, __version: 7 }]));
  writeFileSync(join(dir, "messages.json"), JSON.stringify(messages));
  const later = { ...base, when: "2026-10-18", msgId: "m2" };
  const msgs = [...messages, { id: "m2", chat_jid: "g1@g.us", chat_name: "Tech", ts: "2026-10-14 09:00:00-04:00", text: "Extended to Sunday" }];
  writeFileSync(join(dir, "messages.json"), JSON.stringify(msgs));
  writeFileSync(join(dir, "incoming.json"), JSON.stringify({ items: [base, later, { ...base, kind: "event", title: "SF Tech Trek", when: "2026-10-28", action: null }] }));
  const out = JSON.parse(execFileSync("node", [join(here, "cli.mjs"), "merge", join(dir, "existing.json"), join(dir, "incoming.json"), join(dir, "messages.json")], { encoding: "utf8" }));
  assert.equal(out.length, 2);
  const upd = out.find((o) => o.doc_id === kept.id);
  const add = out.find((o) => o.doc_id !== kept.id);
  assert.deepEqual(Object.keys(upd).sort(), ["collection", "data", "doc_id", "if_version", "op"]);
  assert.equal(upd.op, "set");
  assert.equal(upd.if_version, 7);
  assert.equal(upd.data.when, "2026-10-18");
  assert.equal(upd.data.__version, undefined);
  assert.deepEqual(Object.keys(add).sort(), ["collection", "data", "doc_id", "op"]);
  assert.equal(add.collection, "items");
  assert.equal(add.data.title, "SF Tech Trek");
});

test("cli extraction-prompt builds openItems from existing, hidden ones flagged", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-"));
  const existing = [
    { id: "keep-me", kind: "deadline", title: "Deposit", when: "2099-01-01", approx: false, dismissed: true },
  ];
  writeFileSync(join(dir, "in.json"), JSON.stringify({ messages, clubs: [], existing, tz: "America/New_York", today: "2026-10-20" }));
  const out = execFileSync("node", [join(here, "cli.mjs"), "extraction-prompt", join(dir, "in.json")], { encoding: "utf8" });
  assert.ok(out.includes("keep-me") && out.includes("hidden by the student"));
});

test("categorize prompt lists every item id and the three categories", () => {
  const s = P.categorize({ items: [{ id: "e--a", kind: "event", title: "Gala", club: "Vets" }, { id: "d--b", kind: "deadline", title: "Pay deposit", club: "Ski", eventTitle: "Ski Trip" }] });
  for (const needle of ["e--a", "d--b", "for Ski Trip", "social", "professional", "trip"]) assert.ok(s.includes(needle), needle);
});
