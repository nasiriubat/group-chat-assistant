# What has not been verified against the real thing

Updated per phase. Everything else in the repo has a test, a CI job, or a
recorded manual check behind it; the panel's pages were walked in a real
browser on desktop and at phone width on 5 Sept 2026, with no automated
accessibility check.

## The v1.3 panel (walked in Chromium, 15 Sept 2026)

Checked: flash and htmx error toasts, success toasts fading while errors
stay, an expired session sending the tab to sign in, the Channels and
Providers cards and dialogs, the model list filling a searchable Model field
and a keyboard pick from it, and the searchable time zone list.

Not checked: the network-failure toast (the panel was never unreachable during
the walk), dark mode, Safari and Firefox, and a screen reader on the dialogs
and searchable lists, which follow the ARIA combobox pattern but were not
tried with one.

## Verified on a real phone (5 Sept 2026)

- Pairing by QR, staying connected across a gateway restart without a new
  scan, listing the groups the number is in, and ingesting real group
  messages with their ids, sender and timestamp.
- That a paired **own** number reports the operator's own messages as
  `fromMe`, which the first version mistook for the bot's own replies and
  ignored. The gateway now tracks the ids it sent instead.

## Needs a phone (WhatsApp)

- Trigger detection on a live group: mention, prefix, reply-to-bot. Unit
  tests cover the logic against synthetic Baileys objects; the shape of real
  Baileys 7 messages with LID participants is assumed from its docs.
- Quote-reply delivery: whether WhatsApp resolves the quote stub built from
  `{wa_msg_id, sender_jid, is_bot, body}`.
- Recording our own sent message with `is_bot = true`.
- Reconnect after a dropped socket; the logged-out path.
- The gateway staying silent when the app returns `answer: null`.
- The round-trip detector on the wizard's last step seeing a question
  arrive from the phone (the panel's own Ask box was verified against the
  live install on 5 Sept 2026; the QR scan and the group list are in the
  verified section above).
- Files shared in a WhatsApp group being downloaded and indexed; the unit
  tests cover the message shapes and the size check, not a real download.
- Relink: the gateway logging out in process, clearing its auth files and
  pairing again with a fresh QR when the admin asks.

- Private messages on WhatsApp: the DM branch in the gateway (LID and phone
  JIDs), the member lists from `groupFetchAllParticipating`, and the
  correction reply flow (quoting a bot message then replying "wrong, …").
  The app side of all three is covered by tests through `/ask`.

## Needs a WhatsApp business number

- The Cloud API webhook end to end: Meta's signature over a real payload, the
  verification handshake as Meta performs it, the Graph API version this was
  written against (`v21.0`, which was current at the time and must be checked
  before use), and sending inside the 24-hour window. The signature check, the
  handshake and the payload mapping have unit tests against the documented
  shapes.

## Needs a Telegram or Discord bot token

- Telegram and Discord channels end to end: connecting, seeing groups,
  trigger detection, quote-replies. The payload mapping and trigger logic
  are unit-tested against the documented update shapes; grammY and
  discord.js were never run against the real APIs here. No tokens in `.env`.

## Slack, against a real workspace (16 Sept 2026)

Verified: the manifest creates a working app, Socket Mode connects with the
two tokens as the app's bot user, the workspace's channels are listed in the
panel after `/invite`, and the connection stays up (it did not, until undici 7
was installed: see v1.3.2 in the changelog).

Still unverified: a real mention being answered, the threaded answer with its
**Source message** permalink, private questions in the app's Messages tab
(off by default since v1.3.1), a shared file downloading with `files:read`
and whether Slack ever redirects that download, member lists arriving from
`conversations.members`, and the two-minute watchdog restarting a client that
gave up. The payload mapping, markup decoding, triggers, subtype filter, file
host check and escaping are unit-tested against Slack's documented event
shapes.

## Verified live (3 Sept 2026)

- Anthropic `claude-opus-5`, Gemini `gemini-3.8-flash`, OpenAI `gpt-5.4-mini`
  and OpenRouter `openai/gpt-5.4-mini` each answered the provider test endpoint with "OK"
  and a real question about seeded chat with a correct answer and a quote
  payload pointing at the source message. Switching a group's provider
  through the admin API changed which one answered; `query_log` recorded the
  provider id, tokens and cost.
- Cold `docker compose up`: db healthy, then app healthy, then gateway
  started and printed a QR.
