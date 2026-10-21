// Club Radar core logic: pure functions shared by the page, cli.mjs and tests.
(function (root) {
  "use strict";

  const H = 3600e3;
  const DAY = 24 * H;
  const KINDS = ["deadline", "event"];
  const CATEGORIES = ["social", "professional", "trip"];
  const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const CLUB_STOP = new Set(["wharton", "club", "the", "mba", "general", "official", "group"]);

  function clean(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normTitle(s) {
    return clean(s).replace(/^the /, "");
  }

  function normClub(s) {
    const noYears = String(s || "").replace(/\b\d{2,4}\s*[-/]\s*\d{2,4}\b/g, " ");
    return clean(noYears)
      .split(" ")
      .filter((w) => w && !CLUB_STOP.has(w))
      .join(" ");
  }

  function localDate(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function dueTime(item) {
    if (!item || !item.when) return null;
    const m = DATE_ONLY.exec(item.when);
    if (m) {
      const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
      return item.kind === "deadline" && !item.beforeEvent ? new Date(y, mo, d, 23, 59).getTime() : new Date(y, mo, d, 0, 0).getTime();
    }
    const t = Date.parse(String(item.when).replace(" ", "T"));
    return Number.isNaN(t) ? null : t;
  }

  function itemKey(x) {
    const club = normClub(x.club) || "unknown";
    let parts;
    if (x.kind === "deadline") {
      parts = ["d", club, normTitle(x.eventTitle || x.title), clean(x.action) || "act"];
    } else {
      const due = dueTime(x);
      parts = ["e", club, normTitle(x.title), due == null ? "tbd" : localDate(due)];
    }
    const id = parts.map((p) => p.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).join("--");
    return id.slice(0, 180);
  }

  // CampusGroups (groups.wharton.upenn.edu, or its cglink.me short links).
  const CG_URL = /https?:\/\/(?:www\.)?(?:cglink\.me|groups\.wharton\.upenn\.edu)\/[^\s<>"')\]]+/i;
  const isCgLink = (u) => CG_URL.test(String(u || "")) && CG_URL.exec(String(u)).index === 0;
  function findCgLink(...texts) {
    for (const t of texts) {
      const m = CG_URL.exec(String(t || ""));
      if (m) return m[0].replace(/[.,;:!?*_]+$/, "");
    }
    return null;
  }

  function normalizeExtraction(raw, ctx) {
    if (!raw || !KINDS.includes(raw.kind)) return null;
    const title = String(raw.title || "").trim();
    if (!title) return null;
    const msg = ctx && ctx.msgIndex && ctx.msgIndex[raw.msgId];
    if (!msg) return null;
    const approx = !!raw.approx;
    let when = raw.when == null || raw.when === "" ? null : String(raw.when).trim();
    if (when && !ISO.test(when)) return null;
    const opt = (v) => (v == null || v === "" ? null : String(v).trim());
    const eventWhen = opt(raw.eventWhen) && ISO.test(opt(raw.eventWhen)) ? opt(raw.eventWhen) : null;
    if (!when && !approx && !(raw.kind === "deadline" && eventWhen)) return null;
    // No cutoff of its own: none given, or an "approximate" one that is just the event's day.
    const beforeEvent = raw.kind === "deadline" && !!eventWhen && (!when || (approx && sameDay(when, eventWhen)));
    return {
      kind: raw.kind,
      title: title.slice(0, 160),
      club: opt(raw.club) || "Unknown",
      when: beforeEvent ? eventWhen : when,
      approx: beforeEvent ? false : approx,
      beforeEvent,
      action: raw.kind === "deadline" ? opt(raw.action) : null,
      link: /^https?:\/\//.test(raw.link || "") ? String(raw.link) : null,
      cgLink: findCgLink(isCgLink(raw.link) ? raw.link : null, msg.text),
      category: CATEGORIES.includes(raw.category) ? raw.category : null,
      cost: opt(raw.cost) ? opt(raw.cost).slice(0, 90) : null,
      eventTitle: opt(raw.eventTitle),
      eventWhen,
      matchId: opt(raw.matchId),
      source: {
        chatJid: msg.chat_jid,
        chatName: msg.chat_name,
        msgId: msg.id,
        ts: msg.ts,
        excerpt: String(raw.excerpt || msg.text || "").slice(0, 200),
      },
    };
  }

  const FIELDS = ["kind", "title", "club", "when", "approx", "beforeEvent", "action", "link", "cgLink", "category", "cost", "eventTitle", "eventWhen", "source"];
  // Filled in from CampusGroups by the morning job; a newer message never clears them.
  const STICKY = ["cgLink", "category", "cost", "deadlineFrom", "cgCost", "spotsLeft"];
  const hasTime = (w) => !!w && !DATE_ONLY.test(w);
  const sameDay = (a, b) => !!a && !!b && localDate(dueTime({ kind: "event", when: a })) === localDate(dueTime({ kind: "event", when: b }));

  function srcTime(x) {
    const t = Date.parse(String((x.source && x.source.ts) || "").replace(" ", "T"));
    return Number.isNaN(t) ? 0 : t;
  }

  function mergeItems(existing, incoming, nowIso) {
    const byId = new Map(existing.map((x) => [x.id, x]));
    const changed = new Map();
    let unchanged = 0;
    for (const inc of incoming) {
      const target = (inc.matchId && byId.get(inc.matchId)) || byId.get(itemKey(inc));
      if (!target) {
        const fresh = { id: itemKey(inc), firstSeen: nowIso, updatedAt: nowIso };
        for (const f of FIELDS) fresh[f] = inc[f] === undefined ? null : inc[f];
        byId.set(fresh.id, fresh);
        changed.set(fresh.id, fresh);
        continue;
      }
      if (srcTime(inc) < srcTime(target)) {
        unchanged++;
        continue;
      }
      const next = { ...target };
      for (const f of FIELDS) next[f] = inc[f] === undefined ? null : inc[f];
      // The hosting club is settled once known; reposts in class chats often name it differently.
      if (!["", "unknown"].includes(normClub(target.club))) next.club = target.club;
      // A repost that only gives the date keeps a time already known (from an earlier message or the event's page).
      if (!hasTime(next.when) && hasTime(target.when) && sameDay(next.when, target.when)) { next.when = target.when; next.approx = target.approx; next.beforeEvent = target.beforeEvent; }
      if (!hasTime(next.eventWhen) && hasTime(target.eventWhen) && sameDay(next.eventWhen, target.eventWhen)) next.eventWhen = target.eventWhen;
      for (const f of STICKY) if (next[f] == null && target[f] != null) next[f] = target[f];
      // A CampusGroups sales-end time is the real cutoff; a message only replaces it with an earlier one.
      if (target.deadlineFrom === "campusgroups" && (dueTime(next) == null || dueTime(next) > dueTime(target))) {
        Object.assign(next, { when: target.when, approx: false, beforeEvent: false });
      }
      const same = FIELDS.every((f) => JSON.stringify(next[f]) === JSON.stringify(target[f]));
      if (same) {
        unchanged++;
        continue;
      }
      next.updatedAt = nowIso;
      byId.set(next.id, next);
      changed.set(next.id, next);
    }
    return { upserts: [...changed.values()], unchanged };
  }

  function myClubs(chats) {
    const set = new Set();
    for (const c of Object.values(chats || {})) if (c && c.include && c.club) set.add(normClub(c.club));
    set.delete("");
    return set;
  }

  function isMine(item, chats) {
    const club = normClub(item.club);
    if (!club) return false;
    const words = new Set(club.split(" "));
    for (const mine of myClubs(chats)) {
      const mineWords = mine.split(" ");
      if (mineWords.every((w) => words.has(w)) || [...words].every((w) => mineWords.includes(w))) return true;
    }
    return false;
  }

  // Items Claude may match new messages against (dismissed ones included so a repost stays hidden).
  function openItems(items, now) {
    const t = now.getTime();
    return items
      .filter((x) => (x.kind === "deadline" ? urgency(x, now) !== "hidden" : dueTime(x) == null || dueTime(x) >= t - DAY))
      .sort((a, b) => (dueTime(a) ?? Infinity) - (dueTime(b) ?? Infinity))
      .slice(0, 200)
      .map((x) => {
        const o = { id: x.id, kind: x.kind, title: x.title, when: x.when };
        if (x.dismissed) o.hidden = true;
        return o;
      });
  }

  // Where to resume after a batch: never inside a second that may continue in the next batch.
  function safeResumeTs(batch, prevTs, isFinal) {
    const last = batch[batch.length - 1].ts;
    if (isFinal) return last;
    for (let i = batch.length - 1; i >= 0; i--) if (batch[i].ts !== last) return batch[i].ts;
    return prevTs;
  }

  function urgency(item, now) {
    const due = dueTime(item);
    if (due == null) return "grey";
    const diff = due - now.getTime();
    if (diff < -DAY) return "hidden";
    if (diff < 0) return "missed";
    // No sign-up cutoff was posted, so it may close days before the event: flag it early.
    const pad = item.beforeEvent ? 2 * DAY : 0;
    if (diff < 48 * H + pad) return "red";
    if (diff < 7 * DAY + pad) return "amber";
    return "grey";
  }

  function byDueMineTitle(a, b) {
    const da = a.due == null ? Infinity : a.due;
    const db = b.due == null ? Infinity : b.due;
    if (da !== db) return da - db;
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    return a.item.title.localeCompare(b.item.title);
  }
  const byRank = (a, b) => a.rank - b.rank;

  // Club priorities, saved as {order: [clubKey], hidden: [clubKey]}; a club key is normClub(name).
  function clubKey(name) {
    return normClub(name) || "unknown";
  }
  function clubRank(item, prefs) {
    const i = ((prefs && prefs.order) || []).indexOf(clubKey(item.club));
    return i < 0 ? Infinity : i;
  }
  function clubHidden(item, prefs) {
    return ((prefs && prefs.hidden) || []).includes(clubKey(item.club));
  }

  // Every club with something on the radar or named in Chats, in priority order (unranked ones A–Z after).
  function clubList(items, chats, prefs, now) {
    const t = now.getTime();
    const byKey = new Map();
    const add = (name, upcoming) => {
      const key = clubKey(name);
      if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), upcoming: 0 });
      const c = byKey.get(key);
      c.names.set(name, (c.names.get(name) || 0) + 1);
      if (upcoming) c.upcoming++;
    };
    for (const x of items) if (!x.dismissed && x.club) add(x.club, dueTime(x) == null || dueTime(x) >= t - DAY);
    for (const c of Object.values(chats || {})) if (c && c.include && c.club) add(c.club, false);
    const order = (prefs && prefs.order) || [];
    const hidden = new Set((prefs && prefs.hidden) || []);
    return [...byKey.values()]
      .map((c) => ({ key: c.key, name: [...c.names].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0], upcoming: c.upcoming, rank: order.indexOf(c.key), hidden: hidden.has(c.key) }))
      .sort((a, b) => (a.rank < 0) - (b.rank < 0) || (a.rank >= 0 ? a.rank - b.rank : a.name.localeCompare(b.name)));
  }

  const BAND = { missed: 0, red: 1, amber: 2, grey: 3 };

  // An item's category; a deadline without one takes its event's.
  function categoryOf(item, items) {
    if (CATEGORIES.includes(item.category)) return item.category;
    if (item.kind === "deadline") {
      const ev = items.find((e) => e.kind === "event" && CATEGORIES.includes(e.category) && sameEvent(item, e));
      if (ev) return ev.category;
    }
    return null;
  }

  // What it costs, from the announcement and/or CampusGroups' ticket table; a deadline falls back to its event's.
  function costOf(item, items) {
    const ev = item.kind === "deadline" ? items.find((e) => e.kind === "event" && (e.cost || e.cgCost) && sameEvent(item, e)) : null;
    const quoted = item.cost || (ev && ev.cost) || null;
    const tickets = item.cgCost || (ev && ev.cgCost) || null;
    if (!tickets || tickets === quoted) return quoted;
    return quoted ? `${quoted} · CampusGroups: ${tickets}` : tickets;
  }

  // category: "all" (default) or one of CATEGORIES; uncategorized items show only under "all".
  function buildView(items, chats, now, prefs, category) {
    const t = now.getTime();
    const rows = items
      .filter((x) => !x.dismissed && !clubHidden(x, prefs))
      .map((item) => ({ item, mine: isMine(item, chats), due: dueTime(item), rank: clubRank(item, prefs), category: categoryOf(item, items), cost: costOf(item, items) }))
      .filter((r) => !category || category === "all" || r.category === category);

    const actNow = rows
      .filter((r) => r.item.kind === "deadline")
      .map((r) => ({ ...r, urgency: urgency(r.item, now) }))
      .filter((r) => r.urgency !== "hidden")
      .sort((a, b) => {
        const ta = a.due == null;
        const tb = b.due == null;
        if (ta !== tb) return ta ? 1 : -1;
        // Within an urgency band, higher-priority clubs first.
        return BAND[a.urgency] - BAND[b.urgency] || byRank(a, b) || byDueMineTitle(a, b);
      });

    const events = rows.filter((r) => r.item.kind === "event" && (r.due == null || r.due >= t - DAY));
    const horizon = t + 60 * DAY;
    const dayMap = new Map();
    const monthMap = new Map();
    for (const r of events.sort(byDueMineTitle)) {
      if (r.due != null && r.due <= horizon && !r.item.approx) {
        const k = localDate(r.due);
        if (!dayMap.has(k)) dayMap.set(k, []);
        dayMap.get(k).push(r);
      } else {
        const k = r.due == null ? "TBD" : localDate(r.due).slice(0, 7);
        if (!monthMap.has(k)) monthMap.set(k, []);
        monthMap.get(k).push(r);
      }
    }
    const sortKeys = (m) => [...m.keys()].sort((a, b) => (a === "TBD") - (b === "TBD") || a.localeCompare(b));
    return {
      actNow,
      days: sortKeys(dayMap).map((date) => ({ date, items: dayMap.get(date).sort((a, b) => byRank(a, b) || byDueMineTitle(a, b)) })),
      later: sortKeys(monthMap).map((month) => ({ month, items: monthMap.get(month).sort((a, b) => byRank(a, b) || byDueMineTitle(a, b)) })),
    };
  }

  function staleness(lastRunAt, now) {
    if (!lastRunAt) return "never";
    const age = now.getTime() - Date.parse(lastRunAt);
    if (age < 24 * H) return "fresh";
    if (age < 48 * H) return "amber";
    return "red";
  }

  // Start/end from an event page's HTML (schema.org JSON-LD as on CampusGroups, or Partiful's data). No model needed.
  function parseEventPage(html) {
    const s = String(html || "");
    const pick = (key) => {
      const m = new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"').exec(s);
      return m && ISO.test(m[1]) ? m[1] : null;
    };
    const start = pick("startDate");
    return start ? { start, end: pick("endDate") } : null;
  }

  // "Oct 28, 2026 at 11:55 PM" on a CampusGroups page, in Philadelphia time -> ISO with offset.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function easternIso(y, mo, d, h, mi) {
    const p = (n) => String(n).padStart(2, "0");
    const guess = Date.UTC(y, mo, d, h + 5, mi);
    const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
      .formatToParts(guess).find((x) => x.type === "timeZoneName").value; // "GMT-4"
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name) || ["", "-", "5"];
    return `${y}-${p(mo + 1)}-${p(d)}T${p(h)}:${p(mi)}${m[1]}${p(m[2])}:${m[3] || "00"}`;
  }
  function parseCampusGroups(html) {
    const s = String(html || "");
    const at = s.indexOf('aria-label="Registration Options"');
    if (at < 0) return null;
    const text = s.slice(at, at + 40000).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const body = text.split(/ Details /)[0];
    const ends = [];
    const re = /Sales End ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) at (\d{1,2})(?::(\d{2}))? ?(AM|PM)/g;
    let m;
    while ((m = re.exec(body))) {
      const mo = MONTHS.indexOf(m[1].toLowerCase());
      if (mo < 0) continue;
      let h = +m[4] % 12;
      if (m[6] === "PM") h += 12;
      ends.push(easternIso(+m[3], mo, +m[2], h, m[5] ? +m[5] : 0));
    }
    const spots = [...body.matchAll(/(\d+) Spots? Left/g)].map((x) => +x[1]);
    const cost = campusGroupsCost(s.slice(at, at + 40000));
    if (!ends.length) return { salesEnd: null, spotsLeft: null, cost, closed: /Registration is (now )?closed/i.test(body) };
    // Several options (member / non-member …): registration is open until the last one closes.
    const salesEnd = ends.sort((a, b) => Date.parse(a) - Date.parse(b))[ends.length - 1];
    return { salesEnd, spotsLeft: spots.length ? Math.max(...spots) : null, cost, closed: false };
  }

  // "Member Deposit $300 · Non-Member Deposit $350" from the ticket table; one price when they all match.
  function campusGroupsCost(html) {
    const unescape = (t) => t.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#039;/g, "'").replace(/\s+/g, " ").trim();
    const rows = [...String(html).matchAll(/<tr id="ticket_[\s\S]*?<\/tr>/g)].map((m) => {
      const name = unescape((/<b>([\s\S]*?)<\/b>/.exec(m[0]) || ["", ""])[1]);
      const price = unescape((/Price<\/span>([\s\S]*?)<\/td>/.exec(m[0]) || ["", ""])[1]);
      return { name, price: /^free$/i.test(price) ? "Free" : price };
    }).filter((r) => r.price);
    // Long sentences are add-ons ("if you want a single room…"), not ticket types.
    const tickets = rows.filter((r) => r.name.length <= 40);
    const list = tickets.length ? tickets : rows;
    if (!list.length) return null;
    const more = /more registration options available/i.test(html) ? " · more options after sign-in" : "";
    if (new Set(list.map((r) => r.price)).size === 1) return (list.length === 1 && more ? `${list[0].name} ${list[0].price}` : list[0].price) + more;
    return list.slice(0, 3).map((r) => `${r.name} ${r.price}`).join(" · ") + (list.length > 3 ? " · …" : "") + more;
  }

  // Sales that run until the event starts (or later) aren't an earlier cutoff.
  const cutsOffEarly = (cg, eventWhen) => !!cg && !!cg.salesEnd && (!eventWhen || Date.parse(cg.salesEnd) < dueTime({ kind: "event", when: eventWhen }));
  // The event name on a page: its <title> up to the " - Club name" suffix CampusGroups adds.
  function pageTitle(html) {
    const m = /<title>([\s\S]*?)<\/title>/i.exec(String(html || ""));
    return m ? m[1].replace(/&amp;/g, "&").replace(/&#39;|&#039;/g, "'").replace(/\s+/g, " ").trim().split(" - ")[0] : null;
  }
  // One message can carry several events and one link; only trust a page that names this item's event.
  const TITLE_STOP = new Set(["the", "and", "for", "with", "club", "wharton", "event", "session", "register", "night", "annual", "2026", "2027"]);
  function titleMatches(name, item) {
    if (!name) return true;
    const words = (t) => new Set(clean(t).split(" ").filter((w) => w.length > 2 && !TITLE_STOP.has(w)));
    const page = words(name);
    return [item.title, item.eventTitle].some((t) => t && [...words(t)].some((w) => page.has(w)));
  }
  const sameEvent = (dl, ev) => clubKey(dl.club) === clubKey(ev.club) && !!dl.eventTitle && normTitle(dl.eventTitle) === normTitle(ev.title);

  // Fields to set on a deadline from its CampusGroups page. Only replaces a deadline that wasn't really a
  // sign-up cutoff (none given, or just the event's own day) or one later than CampusGroups says.
  function deadlineFromCampusGroups(dl, cg) {
    if (!cutsOffEarly(cg, dl.eventWhen) || dl.deadlineFrom === "campusgroups" && dl.when === cg.salesEnd && dl.spotsLeft === cg.spotsLeft) return null;
    const vague = !dl.when || dl.beforeEvent || dl.approx || (dl.eventWhen && sameDay(dl.when, dl.eventWhen));
    if (!vague && dl.deadlineFrom !== "campusgroups" && dueTime(dl) <= Date.parse(cg.salesEnd)) return null;
    return { when: cg.salesEnd, approx: false, beforeEvent: false, deadlineFrom: "campusgroups", spotsLeft: cg.spotsLeft };
  }

  // A sign-up deadline for an event that only had its date announced.
  function signupDeadline(ev, cg, cgLink, nowIso) {
    const dl = {
      kind: "deadline", title: `Register for ${ev.title}`, club: ev.club, when: cg.salesEnd, approx: false, beforeEvent: false,
      action: "register", link: cgLink, cgLink, category: ev.category || null, cost: ev.cost || null, cgCost: cg.cost || ev.cgCost || null, eventTitle: ev.title, eventWhen: ev.when, source: ev.source || null,
      deadlineFrom: "campusgroups", spotsLeft: cg.spotsLeft,
    };
    return { id: itemKey(dl), firstSeen: nowIso, updatedAt: nowIso, ...dl };
  }

  // Given an item and its event page's start time, the fields to change (or null).
  // Only fills in what's missing and never moves an item to another day.
  function enrichFromPage(item, page) {
    if (!page || !page.start || item.dismissed) return null;
    if (item.kind === "event") {
      if (hasTime(item.when) && !item.approx) return null;
      if (item.when && !sameDay(item.when, page.start)) return null;
      return { when: page.start, approx: false };
    }
    const patch = {};
    if (!hasTime(item.eventWhen) && (!item.eventWhen || sameDay(item.eventWhen, page.start))) patch.eventWhen = page.start;
    if (!item.when || (item.beforeEvent && !hasTime(item.when) && sameDay(item.when, page.start))) Object.assign(patch, { when: page.start, approx: false, beforeEvent: true });
    return Object.keys(patch).length ? patch : null;
  }

  // Deadlines saved before beforeEvent existed: no cutoff, but the event date is known.
  function fillFromEvent(item) {
    if (item.kind !== "deadline" || item.beforeEvent || !item.eventWhen || !ISO.test(item.eventWhen)) return null;
    if (item.when && !(item.approx && sameDay(item.when, item.eventWhen))) return null;
    return { when: item.eventWhen, approx: false, beforeEvent: true };
  }

  // Ticket prices from an item's CampusGroups page, kept apart from the price quoted in messages.
  function costFromCampusGroups(item, cg) {
    if (!cg || !cg.cost || item.cgCost === cg.cost) return null;
    return { cgCost: cg.cost };
  }

  const api = { costOf, campusGroupsCost, costFromCampusGroups, CATEGORIES, categoryOf, pageTitle, titleMatches, cutsOffEarly, isCgLink, findCgLink, parseCampusGroups, sameEvent, deadlineFromCampusGroups, signupDeadline, clubKey, clubList, parseEventPage, enrichFromPage, fillFromEvent, hasTime, openItems, safeResumeTs, normClub, normTitle, itemKey, dueTime, normalizeExtraction, mergeItems, isMine, urgency, buildView, staleness, localDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RadarCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
