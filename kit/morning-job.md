Club Radar morning refresh. Update my Club Radar page with new deadlines and events from my WhatsApp groups.

Settings (filled in at setup):
- Page URL: {{ARTIFACT_URL}}
- Kit folder: {{KIT_DIR}}
- Work folder: {{KIT_DIR}}/.work  (create it; delete its contents at the start of each run)

Tools: use ONLY the `whatsapp` MCP tools `list_group_messages` and `download_group_media` (both read-only), the ArtifactData tool, and Bash for `node`. Never send WhatsApp messages and never call any other WhatsApp tool. Do not print message contents in your reply.

Steps:

1. Read state with ArtifactData on the page URL:
   - get `meta` / `status` (may not exist yet) and `config` / `chats`. If `config/chats` does not exist, stop and reply "Club Radar isn't set up yet: open the page in the Claude app and click Set up."
   - list `items` with `out_dir` = work folder (page through `next_cursor` until done). Build `existing.json` in the work folder: an array of every item document's body, adding `"__version": <that document's version>` to each.

Cost: steps 2–4 read every message and flyer, so don't do them yourself. Start ONE subagent with the Agent tool and `model: "sonnet"` (the cheapest model that resolves relative dates and reads flyers reliably), give it the work folder, `existing.json`, the included jids, clubs and `after` value, and paste it steps 2–4 verbatim plus the Tools rule above. Tell it to reply only with: the number of messages, the `ts` of the last message, and for each text batch its last message's `ts` and whether it failed, and whether step 4 ran — never message contents. Then continue at step 5 with its files. If the Agent tool is unavailable, do steps 2–4 yourself.

2. Fetch messages: `after` = `status.lastScanTs`, or if missing, 30 days ago formatted "YYYY-MM-DD HH:MM:SS" in local time. `chat_jids` = every jid in `config/chats.chats` whose `include` is true. Call `list_group_messages(after, chat_jids, limit=500)` repeatedly, passing `next_after` as the next `after`, until `next_after` is null. Save all messages, in order, to `messages.json`. If there are none, stop here (the main job skips to step 5b).

3. Text: keep messages whose `text` is at least 12 characters. In batches of 150, write `{messages, clubs, existing, tz, today}` to `prompt-input-N.json`:
   - clubs: the distinct non-null `club` values of included chats
   - existing: the contents of existing.json (the CLI derives the open items from it, hidden ones included)
   - tz: my local time zone (e.g. from `date +%Z` / system settings, as an IANA name like America/New_York)
   - today: today's date YYYY-MM-DD
   Then run `node {{KIT_DIR}}/page/cli.mjs extraction-prompt prompt-input-N.json`, follow the printed instructions yourself against those messages, and save your JSON answer as `incoming-N.json`.

4. Flyers: take up to 40 messages from step 2 whose `media_type` is "image", newest first. For each, call `download_group_media(message_id, chat_id)` with the message's `id` and `chat_jid` and look at the image with Read. If it announces an event or a deadline, add an item in the same JSON shape the extraction prompt asks for, with `msgId` = that image message's id and `excerpt` = a short description of the flyer text. Save these as `incoming-images.json` (`{"items": [...]}`).

5. Merge: combine every incoming file's `items` into `incoming.json` (`{"items": [...]}`), then run
   `node {{KIT_DIR}}/page/cli.mjs merge existing.json incoming.json messages.json > ops.json`.
   `ops.json` is a list of ArtifactData batch writes. Apply them with ArtifactData `batch` on the page URL, at most 50 per call. If a write is refused because the document changed, re-read that document, redo the merge for it, and retry once.

5b. Times from event pages: list `items` again into the work folder and rebuild `existing.json` with fresh `__version`s (as in step 1), then run
   `node {{KIT_DIR}}/page/cli.mjs enrich existing.json > enrich-ops.json`.
   It opens each item's link (CampusGroups, Partiful, …) and fills missing start times from the page itself, takes the real sign-up cutoff ("Sales End") from CampusGroups, attaches CampusGroups links and adds sign-up deadlines for events that had none — no model involved. Apply `enrich-ops.json` with ArtifactData `batch` like step 5 (it contains both `update` and `set` writes). Its stderr summary line goes into your reply.

6. Update `meta` / `status` with ArtifactData `set` (pin `if_version` if it existed): keep its other fields and set `lastScanTs` = the `ts` of the last message from step 2 (unchanged if none) — but if any text batch in step 3 failed, set it to the `ts` of the last message of the batch just before the first failed one (or leave it unchanged if the first batch failed) so the failed messages are read again next run; `lastRunAt` = now as an ISO-8601 timestamp, `lastRunBy` = "morning", `inProgress` = false, `flyersCheckedAt` = now if step 4 ran.

7. Reply in one or two lines: how many messages were checked, how many items were added or updated, and any step that failed. Delete the work folder's contents.
