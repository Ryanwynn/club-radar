// Run with: TZ=America/New_York node --test page/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("./core.js");

const H = 3600e3;
const NOW = new Date("2026-10-20T12:00:00-04:00");
const msgIndex = {
  m1: { id: "m1", chat_jid: "g1@g.us", chat_name: "Wharton Tech Club 26-27: General", ts: "2026-10-12 12:12:39-04:00" },
  m2: { id: "m2", chat_jid: "g2@g.us", chat_name: "Wharton '27 and '28", ts: "2026-10-15 07:15:21-04:00" },
  m3: { id: "m3", chat_jid: "g1@g.us", chat_name: "Wharton Tech Club 26-27: General", ts: "2026-10-18 09:00:00-04:00" },
};
const chats = {
  "g1@g.us": { name: "Wharton Tech Club 26-27: General", include: true, club: "Wharton Tech Club" },
  "g2@g.us": { name: "Wharton '27 and '28", include: true, club: null },
  "g3@g.us": { name: "Fantasy Football League", include: false, club: "Fantasy" },
};

function item(over = {}) {
  return {
    kind: "deadline", title: "Buy SF Trek ticket", club: "Wharton Tech Club",
    when: "2026-10-21T23:59:00-04:00", approx: false, action: "buy ticket",
    eventTitle: "SF Tech Trek", eventWhen: "2026-10-28",
    source: { chatJid: "g1@g.us", chatName: "Tech", msgId: "m1", ts: "2026-10-12 12:12:39-04:00", excerpt: "x" },
    ...over,
  };
}
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

test("itemKey stable across title case/punctuation", () => {
  const a = C.itemKey(item({ eventTitle: "SF Tech Trek!" }));
  const b = C.itemKey(item({ eventTitle: "  sf tech   trek ", club: "Wharton Tech Club 26-27" }));
  assert.equal(a, b);
  assert.match(a, /^[a-z0-9-]+$/);
  assert.ok(Buffer.byteLength(C.itemKey(item({ title: "x".repeat(500), eventTitle: null }))) <= 180);
});

test("event keys differ by date", () => {
  const e1 = C.itemKey(item({ kind: "event", title: "Coffee chat", when: "2026-10-22T10:00:00-04:00" }));
  const e2 = C.itemKey(item({ kind: "event", title: "Coffee chat", when: "2026-10-29T10:00:00-04:00" }));
  assert.notEqual(e1, e2);
});

test("normalizeExtraction rejects non-ISO when", () => {
  const raw = { kind: "deadline", title: "Pay deposit", club: "India Trek", when: "next Monday", approx: false, msgId: "m3", excerpt: "pay by next monday" };
  assert.equal(C.normalizeExtraction(raw, { msgIndex }), null);
  assert.ok(C.normalizeExtraction({ ...raw, when: "2026-10-26" }, { msgIndex }));
});

test("normalizeExtraction keeps approx items without a date", () => {
  const x = C.normalizeExtraction({ kind: "deadline", title: "India Trek deposit", club: "India Trek", when: null, approx: true, msgId: "m3" }, { msgIndex });
  assert.equal(x.approx, true);
  assert.equal(x.when, null);
});

test("normalizeExtraction attaches source and clips excerpt", () => {
  const x = C.normalizeExtraction({ kind: "event", title: "SF Tech Trek", club: "Wharton Tech Club", when: "2026-10-28", msgId: "m1", excerpt: "y".repeat(500) }, { msgIndex });
  assert.deepEqual({ ...x.source, excerpt: x.source.excerpt.length }, {
    chatJid: "g1@g.us", chatName: "Wharton Tech Club 26-27: General", msgId: "m1", ts: "2026-10-12 12:12:39-04:00", excerpt: 200,
  });
  assert.equal(C.normalizeExtraction({ kind: "event", title: "t", club: "c", when: "2026-10-28", msgId: "nope" }, { msgIndex }), null);
  assert.equal(C.normalizeExtraction({ kind: "rumor", title: "t", club: "c", when: "2026-10-28", msgId: "m1" }, { msgIndex }), null);
});

test("merge by key dedupes repost", () => {
  const first = C.mergeItems([], [item()], NOW.toISOString()).upserts;
  const again = C.mergeItems(first, [item({ title: "buy sf trek ticket!", source: { ...item().source, msgId: "m3", ts: "2026-10-18 09:00:00-04:00" } })], NOW.toISOString());
  assert.equal(again.upserts.length, 1);
  assert.equal(again.upserts[0].id, first[0].id);
});

test("merge by matchId updates when", () => {
  const [old] = C.mergeItems([], [item()], NOW.toISOString()).upserts;
  const ext = item({ title: "Ticket sales extended", when: "2026-10-24T23:59:00-04:00", matchId: old.id, source: { ...item().source, ts: "2026-10-18 09:00:00-04:00" } });
  const { upserts } = C.mergeItems([old], [ext], NOW.toISOString());
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].id, old.id);
  assert.equal(upserts[0].when, "2026-10-24T23:59:00-04:00");
});

test("newer source wins; older source ignored", () => {
  const [cur] = C.mergeItems([], [item({ source: { ...item().source, ts: "2026-10-18 09:00:00-04:00" } })], NOW.toISOString()).upserts;
  const stale = item({ when: "2026-10-30T23:59:00-04:00", source: { ...item().source, ts: "2026-10-10 09:00:00-04:00" } });
  const r = C.mergeItems([cur], [stale], NOW.toISOString());
  assert.equal(r.upserts.length, 0);
  assert.equal(r.unchanged, 1);
});

test("merge preserves dismissed and firstSeen", () => {
  const [a] = C.mergeItems([], [item()], "2026-10-01T00:00:00Z").upserts;
  const dismissed = { ...a, dismissed: true };
  const { upserts } = C.mergeItems([dismissed], [item({ when: "2026-10-22T23:59:00-04:00", source: { ...item().source, ts: "2026-10-19 09:00:00-04:00" } })], NOW.toISOString());
  assert.equal(upserts[0].dismissed, true);
  assert.equal(upserts[0].firstSeen, "2026-10-01T00:00:00Z");
});

test("isMine via other chat label", () => {
  assert.equal(C.isMine(item({ club: "Wharton Tech Club", source: { ...item().source, chatJid: "g2@g.us" } }), chats), true);
  assert.equal(C.isMine(item({ club: "Tech Club" }), chats), true);
  assert.equal(C.isMine(item({ club: "Wharton Retail & Consumer Club" }), chats), false);
  assert.equal(C.isMine(item({ club: "Fantasy" }), chats), false, "excluded chats don't count");
});

test("urgency boundaries", () => {
  const u = (ms, over = {}) => C.urgency(item({ when: at(ms), ...over }), NOW);
  assert.equal(u(47 * H), "red");
  assert.equal(u(49 * H), "amber");
  assert.equal(u(6 * 24 * H), "amber");
  assert.equal(u(8 * 24 * H), "grey");
  assert.equal(u(-23 * H), "missed");
  assert.equal(u(-25 * H), "hidden");
  assert.equal(C.urgency(item({ when: null, approx: true }), NOW), "grey");
});

test("date-only deadline = 23:59 local", () => {
  const due = C.dueTime(item({ when: "2026-10-21" }));
  assert.equal(new Date(due).toString().slice(16, 21), "23:59");
  assert.equal(C.dueTime(item({ kind: "event", when: "2026-10-21" })), new Date(2026, 9, 21, 0, 0).getTime());
});

test("buildView: far event in later, its deadline in actNow", () => {
  const trip = item({ kind: "event", title: "India Trek", club: "India Trek", when: "2027-01-05", eventTitle: null, action: null });
  const dep = item({ title: "India Trek deposit", club: "India Trek", when: "2026-11-01T23:59:00-04:00", eventTitle: "India Trek", eventWhen: "2027-01-05" });
  const soon = item({ kind: "event", title: "SF Tech Trek", when: "2026-10-28", action: null });
  const v = C.buildView([trip, dep, soon].map((x, i) => ({ ...x, id: "i" + i })), chats, NOW);
  assert.deepEqual(v.actNow.map((r) => r.item.title), ["India Trek deposit"]);
  assert.deepEqual(v.days.map((d) => d.date), ["2026-10-28"]);
  assert.deepEqual(v.later.map((m) => [m.month, m.items.map((r) => r.item.title)]), [["2027-01", ["India Trek"]]]);
});

test("buildView sorts actNow by due, Mine first on ties, TBD last, hides dismissed", () => {
  const same = "2026-10-22T23:59:00-04:00";
  const rows = [
    item({ id: "a", title: "Shared thing", club: "Retail Club", when: same }),
    item({ id: "b", title: "Mine thing", club: "Wharton Tech Club", when: same }),
    item({ id: "c", title: "TBD thing", when: null, approx: true }),
    item({ id: "d", title: "Sooner", club: "Retail Club", when: "2026-10-21T10:00:00-04:00" }),
    item({ id: "e", title: "Dismissed", when: same, dismissed: true }),
  ];
  const v = C.buildView(rows, chats, NOW);
  assert.deepEqual(v.actNow.map((r) => r.item.title), ["Sooner", "Mine thing", "Shared thing", "TBD thing"]);
  assert.equal(v.actNow[1].mine, true);
});

test("buildView drops past events", () => {
  const v = C.buildView([item({ id: "p", kind: "event", title: "Past", when: "2026-10-17" })], chats, NOW);
  assert.equal(v.days.length + v.later.length, 0);
});

test("staleness thresholds", () => {
  assert.equal(C.staleness(null, NOW), "never");
  assert.equal(C.staleness(at(-23 * H), NOW), "fresh");
  assert.equal(C.staleness(at(-25 * H), NOW), "amber");
  assert.equal(C.staleness(at(-49 * H), NOW), "red");
});

test("isMine matches whole words only", () => {
  assert.equal(C.isMine(item({ club: "Wharton Fintech Club" }), chats), false);
  const ai = { "a@g.us": { name: "AI", include: true, club: "AI Club" } };
  assert.equal(C.isMine(item({ club: "Retail Club" }), ai), false);
  assert.equal(C.isMine(item({ club: "Sailing Club" }), ai), false);
  assert.equal(C.isMine(item({ club: "Wharton AI & Analytics Club" }), ai), true);
});

test("openItems includes dismissed items flagged hidden, drops expired", () => {
  const rows = [
    item({ id: "live", when: at(48 * H) }),
    item({ id: "gone", when: at(-48 * H) }),
    item({ id: "hid", when: at(72 * H), dismissed: true }),
    item({ id: "ev", kind: "event", title: "Mixer", when: at(5 * 24 * H) }),
  ];
  const open = C.openItems(rows, NOW);
  assert.deepEqual(open.map((x) => x.id).sort(), ["ev", "hid", "live"]);
  assert.equal(open.find((x) => x.id === "hid").hidden, true);
  assert.equal(open.find((x) => x.id === "live").hidden, undefined);
});

test("re-extracted dismissed item via matchId stays dismissed", () => {
  const [a] = C.mergeItems([], [item()], NOW.toISOString()).upserts;
  const hidden = { ...a, dismissed: true };
  const ext = item({ action: "buy tickets", matchId: a.id, source: { ...item().source, ts: "2026-10-19 09:00:00-04:00" } });
  const { upserts } = C.mergeItems([hidden], [ext], NOW.toISOString());
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].id, a.id);
  assert.equal(upserts[0].dismissed, true);
});

test("update keeps known club when newer extraction says Unknown or another name", () => {
  const [a] = C.mergeItems([], [item()], NOW.toISOString()).upserts;
  const unk = item({ club: "Unknown", when: "2026-10-23", matchId: a.id, source: { ...item().source, chatJid: "g2@g.us", ts: "2026-10-19 09:00:00-04:00" } });
  const r1 = C.mergeItems([a], [unk], NOW.toISOString()).upserts[0];
  assert.equal(r1.club, "Wharton Tech Club");
  assert.equal(r1.when, "2026-10-23");
  const other = item({ club: "MBA Class of 2028", when: "2026-10-24", matchId: a.id, source: { ...item().source, ts: "2026-10-19 10:00:00-04:00" } });
  assert.equal(C.mergeItems([r1], [other], NOW.toISOString()).upserts[0].club, "Wharton Tech Club");
});

test("safeResumeTs never splits a second", () => {
  const b = [{ ts: "2026-10-19 09:00:00-04:00" }, { ts: "2026-10-19 09:00:05-04:00" }, { ts: "2026-10-19 09:00:05-04:00" }];
  assert.equal(C.safeResumeTs(b, "2026-10-18 00:00:00-04:00"), "2026-10-19 09:00:00-04:00");
  assert.equal(C.safeResumeTs([{ ts: "x" }, { ts: "x" }], "prev"), "prev");
  assert.equal(C.safeResumeTs(b, "p", true), "2026-10-19 09:00:05-04:00", "the final batch may advance to its last ts");
});

test("deadline with no cutoff falls back to its event's start", () => {
  const raw = { kind: "deadline", title: "Register for talk", club: "EClub", when: null, approx: true, action: "register", eventTitle: "Talk", eventWhen: "2026-10-29T12:00-04:00", msgId: "m1" };
  const x = C.normalizeExtraction(raw, { msgIndex });
  assert.equal(x.when, "2026-10-29T12:00-04:00");
  assert.equal(x.approx, false);
  assert.equal(x.beforeEvent, true);
  assert.deepEqual(C.fillFromEvent({ kind: "deadline", when: null, eventWhen: "2027-01-05" }), { when: "2027-01-05", approx: false, beforeEvent: true });
  assert.equal(new Date(C.dueTime({ kind: "deadline", when: "2027-01-05", beforeEvent: true })).getHours(), 0);
});

test("parseEventPage reads JSON-LD and Partiful start times", () => {
  assert.deepEqual(C.parseEventPage('<script>{"@type":"Event","startDate": "2026-10-29T12:00:00-04:00",\n "endDate": "2026-10-29T13:00:00-04:00"}</script>'), { start: "2026-10-29T12:00:00-04:00", end: "2026-10-29T13:00:00-04:00" });
  assert.equal(C.parseEventPage('{"startDate":"2026-10-22T21:30:00.000Z","timezone":"America/New_York"}').start, "2026-10-22T21:30:00.000Z");
  assert.equal(C.parseEventPage("<title>Sign In or Register</title>"), null);
});

test("enrichFromPage fills a missing time but never moves the day", () => {
  const ev = { kind: "event", when: "2026-10-22", approx: false };
  assert.deepEqual(C.enrichFromPage(ev, { start: "2026-10-22T21:30:00.000Z" }), { when: "2026-10-22T21:30:00.000Z", approx: false });
  assert.equal(C.enrichFromPage(ev, { start: "2026-11-05T12:00:00-05:00" }), null);
  assert.equal(C.enrichFromPage({ kind: "event", when: "2026-10-22T19:00-04:00" }, { start: "2026-10-22T21:30:00.000Z" }), null);
  const dl = { kind: "deadline", when: null, approx: true, eventWhen: null };
  assert.deepEqual(C.enrichFromPage(dl, { start: "2026-10-29T12:00:00-04:00" }), { eventWhen: "2026-10-29T12:00:00-04:00", when: "2026-10-29T12:00:00-04:00", approx: false, beforeEvent: true });
});

test("a date-only repost keeps the time already known", () => {
  const base = { kind: "event", title: "Pub", club: "Pub", when: "2026-10-22", approx: false, msgId: "m1" };
  const [first] = C.mergeItems([], [C.normalizeExtraction(base, { msgIndex })], "t0").upserts;
  const timed = { ...first, when: "2026-10-22T17:30-04:00" };
  const repost = C.normalizeExtraction({ ...base, msgId: "m3", excerpt: "reminder" }, { msgIndex });
  const { upserts } = C.mergeItems([timed], [repost], "t1");
  assert.equal(upserts[0].when, "2026-10-22T17:30-04:00");
});

test("club priority orders within a band and within a day; hidden clubs drop out", () => {
  const items = [
    item({ id: "a", club: "Wharton Tech Club", title: "A", when: "2026-10-21T09:00:00-04:00" }),
    item({ id: "b", club: "Tennis Club", title: "B", when: "2026-10-21T20:00:00-04:00" }),
    item({ id: "c", club: "Pub", title: "C", when: "2026-10-20T13:00:00-04:00" }),
    item({ id: "d", club: "Tennis Club", title: "D", when: "2026-10-25T09:00:00-04:00" }),
  ];
  const prefs = { order: ["tennis", "tech"], hidden: ["pub"] };
  const v = C.buildView(items, chats, NOW, prefs);
  assert.deepEqual(v.actNow.map((r) => r.item.id), ["b", "a", "d"]);
  const ev = [item({ id: "e1", kind: "event", club: "Tech", title: "E1", when: "2026-10-22T09:00:00-04:00" }), item({ id: "e2", kind: "event", club: "Tennis", title: "E2", when: "2026-10-22T18:00:00-04:00" })];
  assert.deepEqual(C.buildView(ev, chats, NOW, prefs).days[0].items.map((r) => r.item.id), ["e2", "e1"]);
});

test("clubList merges name variants, ranked first then A–Z", () => {
  const items = [item({ club: "Wharton EClub" }), item({ id: "x2", club: "EClub", title: "Other" }), item({ id: "x3", club: "Tennis Club", title: "T" })];
  const list = C.clubList(items, chats, { order: ["tennis"] }, NOW);
  assert.deepEqual(list.map((c) => c.key), ["tennis", "eclub", "tech"]);
  assert.equal(list[1].upcoming, 2);
  assert.equal(list[1].name, "EClub");
});

test("CampusGroups: sales end parsed in Eastern time, latest option wins, max spots", () => {
  const html = '<div aria-label="Registration Options"> Option Member Sales End Oct 14, 2026 at 12 PM Availability 4 Spots Left Option Guest Sales End Oct 28, 2026 at 11:55 PM Availability 2 Spots Left </div> Details more';
  assert.deepEqual(C.parseCampusGroups(html), { salesEnd: "2026-10-28T23:55-04:00", spotsLeft: 4, closed: false });
  assert.equal(C.parseCampusGroups('<div aria-label="Registration Options">Sales End Dec 2, 2026 at 9 AM</div>').salesEnd, "2026-12-02T09:00-05:00");
  assert.equal(C.parseCampusGroups("<p>no options</p>"), null);
});

test("CampusGroups cutoff replaces a vague or event-day deadline, never a sooner one", () => {
  const cg = { salesEnd: "2026-10-24T21:00-04:00", spotsLeft: 16 };
  const vague = { kind: "deadline", when: "2026-10-25T16:00-04:00", beforeEvent: true, eventWhen: "2026-10-25T16:00-04:00" };
  assert.equal(C.deadlineFromCampusGroups(vague, cg).when, "2026-10-24T21:00-04:00");
  const eventDay = { kind: "deadline", when: "2026-10-25", eventWhen: "2026-10-25T16:00-04:00" };
  assert.equal(C.deadlineFromCampusGroups(eventDay, cg).deadlineFrom, "campusgroups");
  const sooner = { kind: "deadline", when: "2026-10-22T12:00-04:00", eventWhen: "2026-10-25T16:00-04:00" };
  assert.equal(C.deadlineFromCampusGroups(sooner, cg), null);
  // Sales running past the event's start aren't an early cutoff.
  assert.equal(C.deadlineFromCampusGroups({ ...vague, eventWhen: "2026-10-24T12:00-04:00" }, cg), null);
});

test("deadline without a stated cutoff is kept and flagged; CG link found in message text", () => {
  const x = C.normalizeExtraction({ kind: "deadline", title: "RSVP karting", club: "Motor", when: null, approx: false, eventWhen: "2026-10-25T16:00-04:00", msgId: "m1", link: "https://forms.gle/x" }, { msgIndex: { m1: { ...msgIndex.m1, text: "RSVP here https://cglink.me/2cz/r125666." } } });
  assert.equal(x.beforeEvent, true);
  assert.equal(x.cgLink, "https://cglink.me/2cz/r125666");
  assert.equal(C.urgency(x, new Date("2026-10-22T12:00:00-04:00")), "red");
});

test("titleMatches rejects another event's page", () => {
  assert.equal(C.titleMatches("WAAAM Escape 2026", { title: "Othership Williamsburg social flow session" }), false);
  assert.equal(C.titleMatches("WAAAM Escape 2026", { title: "WAAAM Escape Inter-MBA Social" }), true);
});

test("an 'approximate' deadline on the event's own day counts down to the event, not TBD", () => {
  const raw = { kind: "deadline", title: "Register for chat", club: "EClub", when: "2026-10-27T12:00-04:00", approx: true, eventTitle: "Chat", eventWhen: "2026-10-27T12:00-04:00", msgId: "m1" };
  const x = C.normalizeExtraction(raw, { msgIndex });
  assert.equal(x.beforeEvent, true);
  assert.equal(x.approx, false);
  assert.deepEqual(C.fillFromEvent({ kind: "deadline", when: "2026-10-27T12:00-04:00", approx: true, eventWhen: "2026-10-27T12:00-04:00" }), { when: "2026-10-27T12:00-04:00", approx: false, beforeEvent: true });
  assert.equal(C.urgency({ kind: "deadline", when: "2026-11-30", approx: true }, NOW), "grey");
  assert.equal(C.urgency({ kind: "deadline", when: "2026-10-21", approx: true }, NOW), "red");
});
