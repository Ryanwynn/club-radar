// Club Radar prompts: shared by the page (sample.json) and the morning job.
(function (root) {
  "use strict";

  const ITEM_SHAPE = `{"items": [{
  "kind": "deadline" | "event",
  "title": string,            // short, e.g. "Buy SF Tech Trek ticket" or "SF Tech Trek"
  "club": string,             // the club/organizer HOSTING it (not the chat it was posted in)
  "when": string | null,      // ISO 8601: "YYYY-MM-DD" if no time, else "YYYY-MM-DDTHH:MM" with offset
  "approx": boolean,          // true when the date is vague/TBD; then "when" may be null
  "action": string | null,    // deadlines only: "buy ticket" | "register" | "fill form" | "pay deposit" | "apply" | other short verb phrase
  "link": string | null,      // URL from the message for taking the action / details; prefer the CampusGroups link (groups.wharton.upenn.edu or cglink.me) when there is one
  "eventTitle": string | null,// deadlines only: the event this deadline is for
  "eventWhen": string | null, // deadlines only: that event's ISO date, if known
  "msgId": string,            // id of the message that states this (the most recent one, if several)
  "excerpt": string,          // <= 200 chars quoted from that message
  "matchId": string | null,   // id of an OPEN ITEM below if this is the same deadline/event (update/reminder/extension)
  "category": "social" | "professional" | "trip", // see CATEGORIES; a deadline takes its event's category
  "cost": string | null       // what it costs the student, short, as stated: "Free", "$45", "$300 deposit, $2,000 total", "Members $10 / non-members $15"; null if not mentioned
}]}`;

  const CATEGORIES = `- trip: treks, trips and travel, anything out of town for a day or more (incl. their deposits, payments and sign-ups)
- professional: career and learning — speakers, panels, fireside chats, info sessions, conferences, workshops, case competitions, recruiting, coffee chats, applications, surveys about programming
- social: parties, mixers, socials, sports, games, dinners, cultural and religious celebrations, charity events`;

  function extraction({ messages, clubs, openItems, tz, today }) {
    const lines = messages.map((m) => {
      const text = String(m.text || "").replace(/\s+/g, " ").slice(0, 1200);
      const media = m.media_type ? ` [${m.media_type}]` : "";
      return `<msg id="${m.id}" ts="${m.ts}" chat="${String(m.chat_name || "").replace(/"/g, "'")}">${media} ${text}</msg>`;
    });
    const open = (openItems || []).map((x) => `- ${x.id} | ${x.kind || ""} | ${x.title} | ${x.when || "TBD"}${x.hidden ? " | (hidden by the student)" : ""}`);
    return `You extract ACTION DEADLINES and EVENTS from a student's WhatsApp group messages (business-school clubs, treks/trips, class chats).

Today is ${today}. The student's time zone is ${tz}.

What counts:
- deadline: something the student must DO by a time: buy/sell tickets cutoff, register/RSVP, sign-up or interest form, survey due, pay a deposit/booking, apply. Also announced-but-undated ones ("deposit date TBD") with approx=true.
- event: a dated happening: talk, trek/trip, social, info session, case competition, networking dinner.

Ignore: individuals buying/selling/ISO tickets ("selling my ticket", "ISO", "sold!"), job postings, recruiting questions, chit-chat, memes, and anything already over before ${today} unless it is an event later than today.

Rules:
- Resolve relative dates ("tomorrow", "Friday", "next Monday", "EOD") against THAT message's ts, not today.
- A date with no time for a deadline means end of that day; leave it as "YYYY-MM-DD".
- A deadline's "when" is when sign-up / payment / the form CLOSES, and only if the message says so ("RSVP by Thursday", "sales end 10/28"). Don't copy the event's date into it: if no cutoff is given, set "when": null, "approx": false and fill "eventWhen" — the student is warned to sign up early.
- If a later message changes an earlier deadline/event, output it once with the newest info and that message's msgId.
- If it is the same thing as an OPEN ITEM (hidden ones included), set matchId to that item's id.
- "club" is who hosts it. Prefer an exact name from KNOWN CLUBS when it matches.
- A trip/trek with a sign-up deadline gives TWO items: the event (trip dates) and the deadline (with eventTitle/eventWhen).
- When unsure whether something is real, leave it out.
- "category" is one of:
${CATEGORIES}

KNOWN CLUBS: ${(clubs || []).join("; ") || "(none yet)"}

OPEN ITEMS:
${open.join("\n") || "(none)"}

MESSAGES:
${lines.join("\n")}

Reply with JSON only, exactly this shape (empty list if nothing):
${ITEM_SHAPE}`;
  }

  // Cheap first pass (quick tier): keep only messages worth the full extraction.
  function triage({ messages }) {
    const lines = messages.map((m) => {
      const text = String(m.text || "").replace(/\s+/g, " ").slice(0, 400);
      return `<msg id="${m.id}" chat="${String(m.chat_name || "").replace(/"/g, "'")}">${text}</msg>`;
    });
    return `Below are WhatsApp group messages from a student's club and class chats. List the id of every message that might announce, change, extend, cancel or remind about a DEADLINE (tickets, registration, RSVP, forms, deposits, applications) or an EVENT (talk, trip/trek, social, info session, competition, dinner). The chat name counts as context (a bare "Oct 28–30 · San Francisco" in a trek group announces the trek). Include a message if in doubt — missing one is far worse than including an extra. Leave out obvious chit-chat, thanks, memes, and individuals buying/selling their own ticket.

MESSAGES:
${lines.join("\n")}

Reply with JSON only: {"ids": [string]} (empty list if none).`;
  }

  // Quick-tier pass for items saved before categories existed.
  function categorize({ items }) {
    const lines = items.map((x) => `- ${x.id} | ${x.kind} | ${String(x.title || "").replace(/\|/g, "/")} | ${String(x.club || "").replace(/\|/g, "/")}${x.eventTitle ? " | for " + String(x.eventTitle).replace(/\|/g, "/") : ""}`);
    return `Sort a student's club deadlines and events into one category each:
${CATEGORIES}

ITEMS (id | kind | title | club | event it belongs to):
${lines.join("\n")}

Reply with JSON only: {"items": [{"id": string, "category": "social" | "professional" | "trip"}]} covering every item above.`;
  }

  function suggestChats({ groups }) {
    const lines = groups.map((g) => `- ${g.jid} | ${String(g.name || "(no name)").replace(/\|/g, "/")}`);
    return `These are a student's WhatsApp groups. For each, decide:
- include: true if events or deadlines could be announced there (clubs, treks/trips, class/cohort/section chats, school orgs, conferences). false for purely social or personal chats (friends, family, fantasy sports, pets, buy/sell marketplaces, housing).
- club: the club or trip the group belongs to, as a short canonical name with no year (e.g. "Wharton Tech Club 26-27: General" -> "Wharton Tech Club", "[Interest Group] India Trek 2027" -> "India Trek"). null for class/cohort chats and anything that isn't one club or trip.

Several groups of the same club must get the identical club name.

GROUPS:
${lines.join("\n")}

Reply with JSON only: {"chats": [{"jid": string, "include": boolean, "club": string | null}]} covering every group above.`;
  }

  const api = { extraction, triage, categorize, suggestChats, ITEM_SHAPE, CATEGORIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RadarPrompts = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
