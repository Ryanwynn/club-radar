# Set up your own Club Radar

Club Radar is a private page on claude.ai that lists the deadlines (ticket sales, sign-ups, forms, deposits) and events announced in your WhatsApp groups, with countdowns. Everything runs on your own Mac and your own claude.ai account. Nobody else can see your messages or your items, including whoever shared this kit with you.

Setup takes about 20 minutes and uses the Terminal.

## What you need

Club Radar has three moving parts, and each needs something installed:

1. **The WhatsApp bridge** (Go program) links your Mac to WhatsApp and stores your messages in a local database.
2. **The WhatsApp MCP server** (Python, run by `uv`) lets Claude read that database. Club Radar adds three read-only tools to it.
3. **The Club Radar page** (claude.ai) and its optional **morning job** (a scheduled task in the Claude app that runs `node`).

| Need | Why | Install | Check it works |
|---|---|---|---|
| Mac (Apple silicon or Intel) | The bridge and the MCP server run locally | — | — |
| **Claude desktop app**, signed in to claude.ai | The page can only reach WhatsApp from inside the app; the **Code** tab publishes the page and runs the morning job | [claude.ai/download](https://claude.ai/download) | App opens and shows a **Code** tab |
| Xcode Command Line Tools | C compiler for the bridge's SQLite driver (cgo); also provides `git` | `xcode-select --install` | `xcode-select -p` prints a path |
| [Homebrew](https://brew.sh) | Easiest way to install the next three | see brew.sh | `brew --version` |
| Go 1.24+ | Builds and runs the bridge | `brew install go` | `go version` |
| uv | Runs the MCP server and installs its Python packages (it fetches Python 3.11+ itself) | `brew install uv` | `uv --version` |
| Node.js 20+ | Morning job only: merges results and reads event times from CampusGroups/Partiful pages | `brew install node` | `node --version` |
| WhatsApp on your phone | To link the Mac as a device | — | — |

Not needed: FFmpeg (whatsapp-mcp only uses it to send voice notes, which Club Radar never does), an Anthropic API key (the page and the morning job use your claude.ai plan), or any hosting.

**While Club Radar is in use, two things must be running:** the bridge (step 1, keeps messages syncing; without it the page shows only what was synced before it stopped) and the Claude app (the page and the morning job only work inside it).

## 0. Get this kit

```bash
git clone https://github.com/Ryanwynn/club-radar.git ~/club-radar
```

The steps below assume it's in `~/club-radar`.

## 1. Connect WhatsApp to your Mac

Club Radar reads WhatsApp through the open-source [whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) server, which links your Mac as a WhatsApp device (like WhatsApp Web) and keeps a copy of your messages **only on your Mac**.

```bash
git clone https://github.com/lharries/whatsapp-mcp.git ~/whatsapp-mcp
```

```bash
cd ~/whatsapp-mcp/whatsapp-bridge && go run main.go
```

The first run downloads Go packages and compiles for a minute or two. Then scan the QR code with WhatsApp → Settings → Linked devices. Leave this Terminal window running (it keeps syncing); the first sync of your history can take a few minutes. Re-run the same command after every restart. WhatsApp may ask you to re-link about every 20 days: if new messages stop appearing, look at this window for a new QR code.

If it fails with `go-sqlite3 requires cgo` or a missing `clang`, install the Xcode Command Line Tools (see the table) and run it again.

### Optional: keep the bridge running in the background

A Terminal window stops the bridge when it closes. To have macOS run it instead, and let **Refresh now** restart it if it's down, first build it once and link it with the QR code as above (`go build -o whatsapp-bridge .` in `~/whatsapp-mcp/whatsapp-bridge`, then `./whatsapp-bridge`, scan, Ctrl+C). Then save this as `~/Library/LaunchAgents/local.whatsapp-bridge.plist`, replacing `YOU` with your Mac username:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.whatsapp-bridge</string>
  <key>ProgramArguments</key><array><string>/Users/YOU/whatsapp-mcp/whatsapp-bridge/whatsapp-bridge</string></array>
  <key>WorkingDirectory</key><string>/Users/YOU/whatsapp-mcp/whatsapp-bridge</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/whatsapp-bridge.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/whatsapp-bridge.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.whatsapp-bridge.plist
```

Don't also run it from Terminal: two copies fight over the same WhatsApp link. In step 3, add the `env` block shown there so Refresh knows which agent to restart.

## 2. Add Club Radar's read-only tools


```bash
cd ~/whatsapp-mcp && git apply ~/club-radar/kit/whatsapp-mcp-radar.patch
```

Check it (downloads the Python packages the first time; should end with `9 passed`):

```bash
cd ~/whatsapp-mcp/whatsapp-mcp-server && uv run --with pytest pytest -q test_radar.py
```

The patch adds three read-only tools: `list_groups`, `list_group_messages` and `download_group_media` (used by the morning run for flyers). They only read your group messages, and they never return phone numbers. It also adds `bridge_status`, which Refresh uses to check the bridge is running, and `start_bridge`, which starts the background bridge from the optional step above if it's down (it never starts a second copy).

## 3. Register the server with Claude

Add this to your Claude desktop config (Claude → Settings → Developer → Edit Config). The name **must be `whatsapp`**:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "uv",
      "args": ["--directory", "/Users/YOU/whatsapp-mcp/whatsapp-mcp-server", "run", "main.py"],
      "env": {
        "WHATSAPP_BRIDGE_LAUNCHD_LABEL": "local.whatsapp-bridge",
        "WHATSAPP_BRIDGE_PLIST": "/Users/YOU/Library/LaunchAgents/local.whatsapp-bridge.plist"
      }
    }
  }
}
```

Leave out `env` if you run the bridge from Terminal; Refresh then still warns you when the bridge is down but can't start it. Quit and reopen the Claude app. To check it: in the Code tab, ask "list my WhatsApp groups with the whatsapp list_groups tool". You should see your groups.

This is separate from Claude Code's own MCP config (`claude mcp add` / `~/.claude.json`). If WhatsApp is only registered there, Claude Code can read it but the page can't, and **Set up** shows "WhatsApp isn't reachable". If the app can't find `uv`, use its full path (`which uv`, e.g. `/opt/homebrew/bin/uv`).

## 4. Publish your page

Open the Claude app's **Code** tab with `~/club-radar` as the folder and say:

> Publish page/index.html as a new artifact with supporting files core.js (from page/core.js) and prompts.js (from page/prompts.js), icon "calendar", and capabilities
> `{"mcp":{"servers":[{"server":"host:whatsapp","tools":["list_groups","list_group_messages","bridge_status","start_bridge"]}]},"sample":{},"db":{"rules":[{"path":"","read":"owner","write":"owner"}]},"user":{}}`

The page is private to you. Its access rules let only the owner read its data, even if you share the link later.

## 5. First run

Open the page **in the Claude app** (the Refresh button only works there, because that's where WhatsApp is reachable). Click **Set up**:

1. Allow the page to use WhatsApp and Claude when asked.
2. Review the list of groups. Untick social chats and check the club names. Give all of one club's groups the same name, and leave class chats blank.
3. Click **Save and scan**. The first scan reads the last 30 days and takes a few minutes.

## 6. Morning refresh (optional, recommended)

In the Code tab, say:

> Create a scheduled task "Club Radar morning refresh" that runs daily at 7:00 AM, using the prompt in kit/morning-job.md with {{ARTIFACT_URL}} replaced by my page's URL and {{KIT_DIR}} replaced by this folder's absolute path.

It needs Node.js (see the table) and the bridge running. It runs while the Claude app is open. If the Mac was asleep or the app was closed, it runs the next time the app opens. The morning run also reads event flyers (images), which the Refresh button skips.

## Privacy

- Your messages stay on your Mac. The page stores only the extracted deadlines and events, each with a quote of up to 200 characters from the message.
- Club Radar never sends WhatsApp messages. The page can only call the two read-only tools.
- The morning job opens the links found in announcements (e.g. CampusGroups or Partiful event pages) to read the start time, the same as clicking them without being signed in.
- To remove everything, delete the page from claude.ai (this erases its data), unlink the Mac in WhatsApp → Linked devices, and delete `~/whatsapp-mcp`.

## Caveat

whatsapp-mcp uses an unofficial WhatsApp connection. WhatsApp's terms don't allow unofficial clients, and accounts using them have occasionally been restricted. Use it at your own discretion.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Page says "WhatsApp isn't reachable" | The server is registered only in Claude Code, or the app wasn't restarted. Do step 3 in the Claude **app's** config, then quit and reopen the app. If the app can't find `uv`, put its full path (`which uv`) in `command`. |
| Page says "Waiting for the WhatsApp connector" | Open the page in the Claude app, not a browser tab. |
| Recent messages or events are missing | Is the bridge (step 1) running and linked? Then click **Refresh now**. If a red note says the last check stopped partway, click Refresh again and keep the page open until it finishes. |
| `git apply` reports a conflict | Your whatsapp-mcp copy has local changes. Clone a fresh copy and apply the patch there. |
| Morning job reports `node: command not found` | Install Node.js (see the table). |

