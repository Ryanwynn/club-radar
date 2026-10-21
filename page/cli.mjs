#!/usr/bin/env node
// Usage:
//   node cli.mjs merge <existing.json> <incoming.json> <messages.json>
//     existing.json: Item[] (the db "items" docs; each may carry "__version", its db version)
//     incoming.json: {"items": [...]} as returned by the extraction prompt
//     messages.json: messages from list_group_messages (used to resolve msgId)
//   Prints ArtifactData batch operations for changed items.
//   node cli.mjs extraction-prompt <input.json>
//     input.json: {messages, clubs, existing, tz, today} -> prints the prompt text
//       (existing: Item[] from the db; open items, hidden ones included, are derived from it)
//   node cli.mjs enrich <existing.json>
//     Opens each item's link and fills missing start times from the event page (CampusGroups,
//     Partiful, anything with schema.org startDate). From CampusGroups it also takes the real
//     sign-up cutoff ("Sales End"), attaches the CampusGroups link to deadlines, and adds a
//     sign-up deadline for events that had none. Prints ArtifactData batch ops; a summary goes
//     to stderr. Private CampusGroups events need a sign-in and are skipped.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("./core.js");
const P = require("./prompts.js");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "merge") {
  const [existingPath, incomingPath, messagesPath] = args;
  const versions = {};
  const existing = read(existingPath).map(({ __version, ...item }) => {
    if (__version != null) versions[item.id] = __version;
    return item;
  });
  const incoming = read(incomingPath);
  const msgIndex = Object.fromEntries(read(messagesPath).map((m) => [m.id, m]));
  const items = (incoming.items || incoming)
    .map((raw) => C.normalizeExtraction(raw, { msgIndex }))
    .filter(Boolean);
  const { upserts } = C.mergeItems(existing, items, new Date().toISOString());
  const ops = upserts.map((data) => {
    const op = { op: "set", collection: "items", doc_id: data.id, data };
    if (versions[data.id] != null) op.if_version = versions[data.id];
    return op;
  });
  process.stdout.write(JSON.stringify(ops, null, 2) + "\n");
} else if (cmd === "extraction-prompt") {
  const input = read(args[0]);
  const openItems = input.openItems || C.openItems((input.existing || []).map(({ __version, ...x }) => x), new Date());
  process.stdout.write(P.extraction({ ...input, openItems }) + "\n");
} else if (cmd === "enrich") {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const all = read(args[0]);
  const versions = Object.fromEntries(all.map((x) => [x.id, x.__version]));
  const items = all.map(({ __version, ...x }) => x).filter((x) => !x.dismissed && (C.dueTime(x) == null || C.dueTime(x) >= now - 864e5));
  const pages = new Map();
  const stats = { links: 0, filled: 0, signupsAdded: 0, signIn: 0, failed: 0 };
  async function load(url) {
    if (pages.has(url)) return pages.get(url);
    let page = null;
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (Macintosh) ClubRadar" } });
      if (/otp_signup|login|signin/i.test(res.url)) stats.signIn++;
      else if (res.ok) {
        const html = await res.text();
        page = { start: C.parseEventPage(html), cg: C.isCgLink(res.url) ? C.parseCampusGroups(html) : null, name: C.pageTitle(html) };
      }
    } catch (_) { stats.failed++; }
    pages.set(url, page);
    return page;
  }
  const patches = new Map();
  const view = (x) => ({ ...x, ...(patches.get(x.id) || {}) });
  const patch = (x, p) => { if (p) patches.set(x.id, { ...(patches.get(x.id) || {}), ...p }); };
  const cgLinkOf = (x) => x.cgLink || (C.isCgLink(x.link) ? x.link : null) || C.findCgLink(x.source && x.source.excerpt);
  const creates = [];

  // Events first, so their deadlines can borrow the event's CampusGroups link and sales-end time.
  const ordered = [...items.filter((x) => x.kind === "event"), ...items.filter((x) => x.kind === "deadline")];
  for (const item of ordered) {
    patch(item, C.fillFromEvent(item));
    let cgLink = cgLinkOf(item);
    if (!cgLink && item.kind === "deadline") {
      const ev = items.find((e) => e.kind === "event" && C.sameEvent(item, e) && cgLinkOf(view(e)));
      if (ev) cgLink = cgLinkOf(view(ev));
    }
    const cur = view(item);
    const needsTime = item.kind === "event" ? !C.hasTime(cur.when) || cur.approx : !C.hasTime(cur.eventWhen) || !cur.when;
    const urls = [...new Set([needsTime && cur.link, cgLink].filter(Boolean))];
    for (const url of urls) {
      stats.links++;
      const page = await load(url);
      if (!page || !C.titleMatches(page.name, item)) continue;
      if (url === cgLink && item.cgLink !== cgLink) patch(item, { cgLink });
      patch(item, C.enrichFromPage(view(item), page.start));
      if (!page.cg) continue;
      patch(item, C.costFromCampusGroups(view(item), page.cg));
      if (item.kind === "deadline") { patch(item, C.deadlineFromCampusGroups(view(item), page.cg)); continue; }
      const ev = view(item);
      if (!C.cutsOffEarly(page.cg, ev.when) || Date.parse(page.cg.salesEnd) < now - 864e5) continue;
      const own = items.filter((d) => d.kind === "deadline" && C.sameEvent(d, ev));
      if (own.length) for (const d of own) patch(d, C.deadlineFromCampusGroups({ ...view(d), eventWhen: view(d).eventWhen || ev.when }, page.cg));
      else {
        const dl = C.signupDeadline(ev, page.cg, cgLink, nowIso);
        if (!all.some((x) => x.id === dl.id) && !creates.some((x) => x.id === dl.id)) creates.push(dl);
      }
    }
  }

  const ops = [];
  for (const [id, p] of patches) {
    const before = items.find((x) => x.id === id);
    const changed = Object.fromEntries(Object.entries(p).filter(([k, v]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)));
    if (!Object.keys(changed).length) continue;
    stats.filled++;
    const op = { op: "update", collection: "items", doc_id: id, data: { ...changed, updatedAt: nowIso } };
    if (versions[id] != null) op.if_version = versions[id];
    ops.push(op);
  }
  for (const dl of creates) { stats.signupsAdded++; ops.push({ op: "set", collection: "items", doc_id: dl.id, data: dl }); }
  process.stdout.write(JSON.stringify(ops, null, 2) + "\n");
  process.stderr.write(`links checked ${stats.links}, items updated ${stats.filled}, sign-up deadlines added ${stats.signupsAdded}, need sign-in ${stats.signIn}, failed ${stats.failed}\n`);
} else {
  process.stderr.write("usage: cli.mjs merge <existing.json> <incoming.json> <messages.json> | extraction-prompt <input.json> | enrich <existing.json>\n");
  process.exit(2);
}
