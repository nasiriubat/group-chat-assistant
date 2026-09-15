# Setup guide

From an empty machine to a bot answering in your group. Roughly fifteen
minutes, most of it waiting for models to download.

Contents: [1 Install](#1-install) · [2 Sign in](#2-sign-in) ·
[3 Add a model provider](#3-add-a-model-provider) ·
[4 Connect a channel](#4-connect-a-channel) · [5 Choose groups](#5-choose-groups) ·
[6 Ask the first question](#6-ask-the-first-question) ·
[7 Import older history](#7-import-older-history) ·
[8 Add files as knowledge](#8-add-files-as-knowledge) ·
[9 Tune a group](#9-tune-a-group) ·
[10 Change or remove a connection](#10-change-or-remove-a-connection) ·
[11 Erase data](#11-erase-data) ·
[12 Troubleshooting](#12-troubleshooting)

---

## Before you start

| You need | Why |
|---|---|
| Docker Desktop or Docker Engine with Compose v2 | Runs all three services |
| 4 GB of RAM and 3 GB of disk | The embedding and reranking models run locally; the app settles around 3 GB |
| One API key from a model provider | Writes the answers. Step 3 lists where to get one |
| A phone with WhatsApp, or a Telegram or Discord bot | The channel it listens on |

The WhatsApp channel uses an unofficial client. It may violate WhatsApp's
terms and the number can be banned. A dedicated number is safest. Your own
number works too, and your own messages are answered normally, but the risk
is then on your main account.

---

## 1 Install

```
git clone https://github.com/nasiriubat/wtsapp-rag.git
cd wtsapp-rag
cp .env.example .env
```

Fill in the four secrets in `.env`. These commands print values you can paste:

```
openssl rand -hex 16   # POSTGRES_PASSWORD
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 32   # GATEWAY_TOKEN
```

`ADMIN_PASSWORD` is the password you will type to sign in. Pick something you
can remember, or generate one and store it in a password manager.

Then start everything:

```
docker compose up -d --build
```

The first start downloads about 1 GB of models, which takes a minute or two.
Watch it finish with `docker compose logs -f app`, or just wait until
`http://localhost:8000/admin` answers.

Make the two files that hold secrets readable by you alone. `.env` has the
master key; `gateway/auth_state/` becomes a live WhatsApp session once you
pair:

```
chmod 600 .env
chmod -R go-rwx gateway/auth_state
```

**Back up `.env` somewhere separate from the database.** `SECRET_KEY` is the
only thing that can decrypt the provider keys and channel tokens inside a
database dump.

---

## 2 Sign in

Open **http://localhost:8000/setup**. There is no user name; type
`ADMIN_PASSWORD` from `.env`. Five wrong attempts pause sign-in for a minute,
and you land on the page you asked for once you are in.

Everything is bound to localhost. To reach the panel from another machine,
put a reverse proxy with TLS in front of it rather than publishing the port;
[DEPLOY.md](DEPLOY.md) does this on a cloud VM, or skips it with an SSH tunnel.
Two things to know when you do. The login lockout counts against the address
your proxy reports in `X-Forwarded-For`, and only the addresses in
`TRUSTED_PROXY` in `.env` may set that header; the default covers a proxy on
the same machine or on a Docker network. And `/metrics` and the detailed
`/health` need the gateway token, so a proxy in front of the panel exposes
nothing about how busy your groups are.

The wizard at **http://localhost:8000/setup** walks the same five steps this
guide does, remembers where you are, and once a model, a channel and a group
are in place it says so instead of starting over. The panel proper is at
**http://localhost:8000/admin**.

---

## 3 Add a model provider

The provider writes the answers. Retrieval and reranking stay on your machine,
so the only thing that leaves it is the question plus the excerpts that answer
it.

Go to **Providers** and press **Add provider**, or use the wizard's Model step.

| Provider | Where the key comes from | Kind | Base URL | A good starting model |
|---|---|---|---|---|
| Anthropic | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | `anthropic` | leave empty | `claude-sonnet-5` |
| Google Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini` | leave empty | `gemini-3.8-flash` |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `openai` | leave empty | `gpt-5.4-mini` |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | `openai` | `https://openrouter.ai/api/v1` | `openai/gpt-5.4-mini` |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | `openai` | `https://api.groq.com/openai/v1` | one of their hosted models |
| Mistral | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) | `openai` | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Together | [api.together.xyz/settings/api-keys](https://api.together.xyz/settings/api-keys) | `openai` | `https://api.together.xyz/v1` | any chat model they list |
| Ollama, on your own machine | no key; type any text | `openai` | `http://host.docker.internal:11434/v1` | whatever you have pulled |
| LiteLLM proxy | your proxy's key | `openai` | `https://your-proxy/v1` | whatever it routes |

Then:

1. **Name** is yours to choose. It appears on the Cost page.
2. **Prices** are euros per million tokens, input and output, from that
   provider's pricing page. They start at 0, which makes every answer look
   free and makes budget caps useless, so fill them in. A new install has a
   €10 monthly cap across all groups; change it on the Cost page.
3. Press **List the models**. It asks the provider what your key can actually
   use, and the **Model** field opens a list of them: type a few letters to
   narrow it down and pick one, so you never have to know a model id by heart.
   Typing one by hand still works.
4. Press **Test before adding** (or **Test these settings** when editing). It
   makes one real call with what is in the form, before anything is saved, and
   shows the reply or the error. On a saved provider's card, **Test** checks
   what is stored.
5. The first provider you add becomes the default, marked **default** on its
   card: that is the one that answers everywhere. Press **Make default** on
   another to switch. A group can override it under **Answer with** on its own
   page. If no provider is the default, every question is refused, and the
   Providers page says so in red.

The eval in [EVAL.md](EVAL.md) found a small model answered a bilingual set as
accurately as a much larger one, for a twentieth of the cost. Start small.

---

## 4 Connect a channel

Go to **Channels**. Each one is independent; you can run all five.

### WhatsApp, by pairing a phone

1. On the Channels page, check the WhatsApp card is not disabled; if it is,
   press **Enable** on it.
2. Open **Setup → Connect WhatsApp**. A QR code appears within a few seconds.
3. On the phone: **WhatsApp → Settings → Linked devices → Link a device**, and
   scan it.
4. The page turns green and tells you how many groups that number is in.

The pairing survives restarts. It lives in `gateway/auth_state/`.

### Telegram

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
   Choose a name and a username ending in `bot`. He replies with a token that
   looks like `123456:AAF...`.
2. Send `/setprivacy`, choose your bot, and select **Disable**. Without this a
   bot only sees messages that mention it, so it cannot build any memory.
3. Add the bot to the group like any other member.
4. On the Channels page press **Connect** on the Telegram card, paste the
   token and press **Save**.
5. Have somebody write in the group. Telegram bots cannot list their groups,
   so a group only appears once it has spoken.

### Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
   and press **New Application**.
2. Open **Bot** in the sidebar, press **Reset Token**, and copy it.
3. On the same page, under **Privileged Gateway Intents**, turn on
   **MESSAGE CONTENT INTENT**. Without it every message arrives empty.
4. Open **OAuth2 → URL Generator**. Tick the **bot** scope, then the
   permissions **Read Messages/View Channels**, **Send Messages** and
   **Read Message History**. Copy the generated URL, open it, and invite the
   bot to your server.
5. On the Channels page press **Connect** on the Discord card, paste the token
   and press **Save**. Text channels appear as soon as it connects.

### Slack

Slack connects over **Socket Mode**: the gateway opens the connection to
Slack, so nothing needs to be reachable from the internet and no port has to
be opened. You need to be allowed to install apps in the workspace; on some
workspaces an admin has to approve the install.

**Create the Slack app**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and press
   **Create New App → From a manifest**. Pick your workspace.
2. Choose **YAML**, replace everything in the box with the manifest below,
   press **Next**, then **Create**. Change `name` and `display_name` if you
   like: the display name is what people type after `@`.

   ```yaml
   display_information:
     name: Group Assistant
   features:
     bot_user:
       display_name: assistant
       always_online: true
     app_home:
       messages_tab_enabled: true
       messages_tab_read_only_enabled: false
   oauth_config:
     scopes:
       bot:
         - channels:history
         - channels:read
         - groups:history
         - groups:read
         - im:history
         - chat:write
         - users:read
         - files:read
   settings:
     event_subscriptions:
       bot_events:
         - message.channels
         - message.groups
         - message.im
         - member_joined_channel
         - member_left_channel
     socket_mode_enabled: true
     org_deploy_enabled: false
     token_rotation_enabled: false
   ```

   What the scopes are for: `*:history` lets it read public channels, private
   channels and its own direct messages; `*:read` lets it list the channels it
   was invited to; `chat:write` lets it answer; `users:read` puts names next to
   messages instead of ids; `files:read` lets it download files shared in a
   channel, which it only does for groups with **Index files shared in the
   chat** turned on.
3. Open **Basic Information → App-Level Tokens → Generate Token and Scopes**.
   Name it `socket`, press **Add Scope**, choose `connections:write`, press
   **Generate**, and copy the token. It starts with `xapp-`.
4. Open **Install App → Install to Workspace → Allow**. Copy the
   **Bot User OAuth Token**. It starts with `xoxb-`.

**Connect it in the panel**

5. Open **Channels** and press **Connect** on the **Slack** card. Paste the
   `xoxb-` token into **Bot User OAuth Token** and the `xapp-` token into
   **App-level token**. Leave **Enabled** ticked and press **Save**. If the two
   are swapped, the dialog stays open and says so.
6. Within 30 seconds the card turns green: *connected as @assistant in
   Your Workspace*. If it says *enabled, not connected*, see the
   troubleshooting table at the end of this guide.

**Choose the channels it listens to**

7. In Slack, open each channel it should remember and send
   `/invite @assistant`. Private channels work the same way. It hears nothing
   in a channel it has not been invited to.
8. In the panel open **Setup**, step **Groups**. The channel is listed as
   *Your Workspace / #channel* a few seconds after the invite. Tick it and press
   **Enable selected**. Logging starts from that moment; messages written
   before are not fetched.

**Ask it**

9. In an enabled channel write `@assistant what did we decide about the
   venue?`, or start the message with the group's trigger word (`@agent` by
   default). The answer arrives in a thread under the question, with a
   **Source message** link to the message it came from. Slack has no
   quote-reply, so the link is the citation. A follow-up in that thread needs
   the mention or the trigger word again.
10. For a private question, open the app under **Apps** in Slack's sidebar and
    write in its **Messages** tab. It answers from the channels you are a
    member of whose group has **Allow private questions** turned on. Leave a
    channel and it stops answering about it within a minute.

Group DMs (a direct message with several people) are ignored, and so are
edits and deletions: an edited message keeps the text it was sent with.

To stop it, press **Disable** on the Slack card, or **Edit → Remove** to delete
both tokens. To revoke it on Slack's side as well, open the app at
[api.slack.com/apps](https://api.slack.com/apps) and delete it or reinstall it,
which issues a new bot token.

### WhatsApp Cloud API, Meta's official one

This one answers **private messages** on a business number: someone who is in
one of your groups can message the business number and get an answer with a
citation. It cannot watch group chats, because Meta caps Cloud API groups at 8
participants and requires an Official Business Account.

It needs a public HTTPS address, so put a reverse proxy or a tunnel in front
of the gateway's port 8080 first.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
   and create an app of type **Business**.
2. Add the **WhatsApp** product. Meta creates a test business account and a
   test number for you.
3. Open **WhatsApp → API Setup**. Copy the **Phone number ID** and press
   **Generate access token**. That token expires in 24 hours; for a permanent
   one create a System User in
   [business.facebook.com/settings](https://business.facebook.com/settings),
   give it the `whatsapp_business_messaging` permission on the app, and
   generate a token that does not expire.
4. Open **App settings → Basic** and copy the **App secret**. The assistant
   uses it to verify that a webhook really came from Meta.
5. Invent a **verify token**. It is any string you choose; Meta echoes it back
   once to prove you own the endpoint.
6. On the Channels page press **Connect** on the WhatsApp Cloud API card, paste
   all four values and press **Save**. The gateway starts listening on port 8080.
7. Back in Meta: **WhatsApp → Configuration → Webhook → Edit**. Callback URL
   is `https://your-domain/webhook/whatsapp_cloud`, the verify token is the
   one you invented. Save, then **Manage** and subscribe to the `messages`
   field.

Meta only allows a reply inside 24 hours of the person's last message, so the
assistant answers questions and does not start conversations.

---

## 5 Choose groups

Go to **Setup → Groups**, or **Groups** in the sidebar. Everything your
channels can see is listed. Tick the ones the assistant should listen to.

Only messages sent **after** you enable a group are stored. Step 7 covers
older history.

---

## 6 Ask the first question

You can ask from the browser before anyone in the group does. The last wizard
step, and the top of the **Questions** page, have an **Ask it from here** box:
pick the group, type a question, and you get the answer, the citation and
the chunks it retrieved with their scores. It is one real model call, logged
like any other question with the panel as the asker, and never throttled.
That is also how you test a tuning change without a phone.

From the group itself, send:

```
@agent hello
```

Expect **"I don't have anything on that."** That is the correct answer: the
group has no history yet and hello is not a question. It proves the whole path
works. The Questions page will show the attempt with what it retrieved.

Three ways to get the bot's attention, all equivalent:

- start a message with a trigger word, `@agent` by default,
- mention the bot's number or username,
- reply to one of its messages.

---

## 7 Import older history

To answer about anything said before it joined:

1. On the phone, open the group, then **⋮ → More → Export chat → Without
   media**. Send the `.txt` to yourself.
2. In the panel go to **Data → Import chat history**, pick the group, upload
   the file.
3. Give the indexer a minute. The Health page shows chunks being built.

Re-uploading the same export is safe; duplicates are skipped. Answers drawn
from imported messages carry a text citation rather than a quote-reply,
because WhatsApp cannot quote a message it never saw.

---

## 8 Add files as knowledge

The assistant answers from the conversation. It can also answer from files you
give it: a price list, a booking policy, minutes, a photographed rota.

Go to **Knowledge → Upload**.

| It reads | How |
|---|---|
| `.txt`, `.md`, `.csv`, `.json`, `.html` | straight through |
| `.pdf` | page by page, so an answer can cite a page number |
| `.docx`, `.xlsx`, `.xls`, `.pptx` | converted to text, tables included |
| `.png`, `.jpg`, and other pictures | read by the model you configured in step 3 |
| a scanned PDF with no text layer | each page rendered and read by the model, up to 20 pages |

Choose **Every group** or one group. A shared file is searched by every group;
a group's own file is searched only there. Files up to 25 MB, several at once.

A file is read within seconds of the upload, and the row turns from
**reading…** to **searchable**. An answer drawn from a file cites the file name
and page rather than quoting a message, because there is no message to quote.

Two things worth knowing. The model has to see a picture to read it, so each
image and each scanned page costs one call to your provider; a text PDF costs
nothing. And the file itself is not kept once its text has been extracted, so
backups stay small and re-indexing is free.

### Files people share in the chat

Off by default. Turn it on per group under **Groups → the group → Memory →
Index files shared in the chat**, and documents and pictures posted in that
group land in Knowledge automatically, up to 10 MB each.

It is off by default for three reasons: the gateway has to download media,
which is the behaviour most likely to get a WhatsApp number flagged; every
picture costs a model call; and people who share a photo in a group are not
necessarily expecting it to be indexed. Members on the group's opt-out list are
skipped either way.

---

## 9 Tune a group

Each group's page has four sections.

**Basics.** Display name, which provider answers, and whether the group is
active at all.

**Pause a group** without deleting it: **Pause** on its row in the groups list,
or untick **Active** on its page. From that moment:

- New messages are not stored and questions in the group get no answer. The
  gateway stops passing its messages on within 30 seconds; the app already
  refuses them before that. What is said while paused is gone for good.
- Its history, decisions and uploaded files stay. So does its retention
  window, which keeps deleting old messages on schedule: a pause is not a way
  to keep data longer than you promised.
- Private questions are not answered from it.
- You can still ask it from the **Ask it from here** box on the Questions page,
  where it is marked *(paused)*.

**Resume** starts logging again from that moment. The audit log records each
pause and resume.

**Answering.** Trigger words. The confidence threshold, which defaults to 0 so
every question reaches the model and the model decides whether it can answer;
raising it saves provider calls but the eval found it refuses real questions.
The refusal text, and the answer language, where `auto` follows the question.

**Memory.** Decision tracking mines each new chunk for decisions so answers can
say what changed and when; it costs one small model call per chunk. Private
questions let members of this group message the bot directly. The correction
acknowledgement is what it replies when somebody corrects it.

**Decisions on record** lists what the assistant currently treats as settled,
with what each decision replaced. A bad extraction or a mischievous
correction can be removed there, which makes whatever it replaced current
again. **Members** lists everyone who has written in the group with a
one-click **Opt out and erase**.

**Answers with**, on the groups list, shows which model answers in each group
and whether that is the global default or the group's own choice.

**Limits and privacy.** A monthly euro cap for this group, a retention window
in days, opted-out members whose history is erased when you save, and quiet
hours during which it stays silent.

---

## 10 Change or remove a connection

**Change the WhatsApp number.** Channels → WhatsApp card → **Settings** →
**Link a different number**. The gateway logs out, clears the old pairing and shows a fresh QR at
Setup → Connect WhatsApp. Nothing in the database is touched, so old messages
and answers stay. Groups stay enabled, but their ids belong to the old
account's view of them: if the new number is not in the same groups, enable
the right ones again on the Groups page.

**The number was banned.** Same flow, plus a new phone and number. If the
gateway cannot start at all, stop it, delete the contents of
`gateway/auth_state/`, start it, and scan again.

**Remove Telegram, Discord, Slack or the Cloud API.** Channels → the card's
**Edit** → **Remove**. The
token is deleted and the gateway stops that channel within 30 seconds. Their
groups stay in the database; delete them from the Groups page if you want
them gone. WhatsApp cannot be removed, only disabled, because it is the
channel the panel's linking flow belongs to.

**Rotate a token without downtime.** Press **Edit** on the channel's card and
paste the new one. Blank fields keep what is stored, so you only retype what
changed.

**Delete a group's data.** Groups → the group → **Remove group** stops it
being used. To erase what was said, use Data → **Erase a member** for one
person, or set a retention window so everything ages out.

---

## 11 Erase data

Everything the assistant keeps can be deleted from **Data**, and each button
says exactly what it takes with it.

| To remove | Where | What goes |
|---|---|---|
| One member's history | Data → **Erase a member** | Their messages, and the chunks built from episodes they were in. Add them to the group's opt-out list to keep them erased as they keep writing. |
| A group's whole chat | Data → **Delete chats** on that row | Every message, chunk and recorded decision for the group. Uploaded files survive; they were not said in the chat. |
| The question log | Data → **Clear the question log** | Questions, answers, what was retrieved, and the **cost history**, which is computed from the same table. Optionally only rows older than N days, or only one group. |
| One question | Questions → open it → **Delete this question** | That row alone. |
| A decision on record | Groups → the group → **Decisions on record** → Remove | That fact; anything it had replaced becomes current again. |
| A file | Knowledge → **Delete** | The document and everything indexed from it. |
| Old data, automatically | Groups → the group → **Retention (days)** | Messages and chunks age out on their own. Documents are not aged out. |

Deleting the question log costs you the record of how the assistant is
performing, which is what the eval and the feedback buttons are built on.
Clear it when you want the record gone, not as housekeeping.

---

## 12 Troubleshooting

Every change made in the panel is on **Audit log**, with what changed and
secrets masked. A red banner at the top of every page means an enabled
channel is not connected. The panel refreshes Health every 30 seconds.

| What you see | What to check |
|---|---|
| No reply at all | Channels page: is the channel connected? Then Questions: did the question arrive? If not, the trigger did not fire. Check the group is enabled and the trigger word matches. |
| "I don't have anything on that" for everything | The group has no history yet. Import the chat export, or wait for the conversation to be chunked, which happens after a 30-minute gap. |
| "No LLM provider is configured" | Providers page: one of them needs the **default** badge. Press **Make default** on it. A group can also point at a provider you have since disabled. |
| A file stays on "could not read" | The row says why. A scanned PDF over 20 pages has to be split; an image needs a provider that accepts images. |
| "The monthly answer budget is used up" | Cost page, or the group's own cap. |
| The QR never appears | `docker compose logs gateway`. The gateway needs the app to be up first; it retries every five seconds. |
| Telegram bot sees nothing | `/setprivacy` → Disable in BotFather, then remove and re-add the bot to the group. |
| Discord messages arrive empty | MESSAGE CONTENT INTENT is off in the developer portal. |
| Slack card says "enabled, not connected" | `docker compose logs gateway \| grep -i slack`: a "slack connection failed" or "channel failed to start" line carries Slack's error. The gateway tries again every 30 seconds. `invalid_auth` means a token was revoked or mistyped; `not_allowed_token_type` means the app-level token lacks `connections:write`. Check **Socket Mode** is switched on in the app's settings too. |
| Slack channel never appears in the groups list | The bot has not been invited: `/invite @assistant` in that channel. |
| Slack bot connected but never answers | Is the channel enabled on the Groups page? Did the message mention the bot or start with the trigger word? A reply in a thread without either is not a question. |
| Slack shared files show "a web page" in the gateway log | The `files:read` scope is missing. Add it under **OAuth & Permissions** and reinstall the app. |
| Meta rejects the webhook | It must be HTTPS and publicly reachable, and the verify token must match exactly. |
| Answers are slow | Health page shows the median. The local reranker is the bottleneck when several questions arrive at once; see [EVAL.md](EVAL.md). |
| Something else | [OPERATIONS.md](OPERATIONS.md) has the runbook: logs, backups, restore, rotating secrets. |
