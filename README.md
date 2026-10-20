# Club Radar

Never miss a ticket sale, sign-up form or deposit buried in a busy WhatsApp group again.

Club Radar is a private page on claude.ai that reads your WhatsApp groups on your own Mac and lists:

- **Act now** — deadlines (ticket sales, RSVPs, sign-up forms, deposits, applications) with a live countdown, most urgent first. Where an event is on CampusGroups, it shows the real sign-up cutoff ("Sales End") and spots left, and links straight to the CampusGroups page.
- **Upcoming events** — the next 60 days, by day, with start times.
- **Social / Professional / Trips & treks** — filter chips split everything by type; deadlines follow their event.
- **Clubs** — rank the clubs you care about so their items come first, or hide the ones you don't.

It runs entirely on your Mac and your own claude.ai account. Nobody else (including whoever shared this kit with you) can see your messages or your page.

Built for Wharton: it understands Wharton's CampusGroups (`groups.wharton.upenn.edu`, `cglink.me`). Everything else works for any school.

## Get started

You need a Mac, the Claude desktop app, and about 20 minutes. **[SETUP.md](SETUP.md)** walks through everything, starting with what to install:

| Need | For |
|---|---|
| Claude desktop app (signed in) | The page and the optional daily refresh |
| Xcode Command Line Tools, Go, uv | The WhatsApp bridge and server ([whatsapp-mcp](https://github.com/lharries/whatsapp-mcp)) |
| Node.js 20+ | The optional daily refresh |
| WhatsApp on your phone | Linking your Mac |

```bash
git clone https://github.com/Ryanwynn/club-radar.git ~/club-radar
```

Then follow [SETUP.md](SETUP.md).

## How it works

1. **[whatsapp-mcp](https://github.com/lharries/whatsapp-mcp)** links your Mac as a WhatsApp device and keeps your messages in a local database. This kit adds three read-only tools to it (`kit/whatsapp-mcp-radar.patch`).
2. **The page** (`page/`) runs inside the Claude app. When you click **Refresh now**, it reads new group messages, has a fast Claude model pick out the ones that might matter, then has a stronger model extract deadlines and events. Results are stored in the page's own private database.
3. **The morning refresh** (optional, `kit/morning-job.md`) is a scheduled task in the Claude app that does the same at 7 AM, also reads event flyers (images), and opens event links to fill in exact start times and CampusGroups sign-up cutoffs.

## What's in here

- `SETUP.md` — install and run your own copy
- `page/` — the page (`index.html`), its logic (`core.js`), the Claude prompts (`prompts.js`) and the CLI the morning job uses (`cli.mjs`)
- `kit/` — the whatsapp-mcp patch and the morning-job prompt template

Tests: `TZ=America/New_York node --test page/`, and in whatsapp-mcp, `uv run --with pytest pytest test_radar.py`.

## Privacy and caveats

- Your messages never leave your Mac except as text sent to Claude under your own claude.ai account to extract deadlines. The page stores only the extracted items, each with a quote of up to 200 characters.
- Club Radar never sends WhatsApp messages; it can only call read-only tools.
- whatsapp-mcp uses an unofficial WhatsApp connection. WhatsApp's terms don't allow unofficial clients, and accounts using them have occasionally been restricted. Use it at your own discretion.

## License

MIT — see [LICENSE](LICENSE).
