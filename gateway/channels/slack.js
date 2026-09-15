// Slack over Socket Mode: the gateway dials out to Slack, so like Telegram's
// long polling there is no public webhook to expose.
import bolt from "@slack/bolt";
import { blankState } from "../core.js";
import {
  groupId,
  isChatMessage,
  parseMessageId,
  payloadFromSlack,
  slackEscape,
  slackFiles,
  slackQuestion,
  slackTrigger,
} from "./slack_format.js";

const { App, LogLevel, SocketModeReceiver, webApi } = bolt;

// Slack accepts 40,000 characters but truncates display well before that.
const LIMIT = 4000;
// A reconnect that fails for good rejects into the void and emits nothing, so
// only a clock can tell a client that gave up from one still trying.
const GIVE_UP_MS = 120_000;
// Listing is a call per channel; joins, leaves and unknown channels ask for
// one, and a busy workspace must not turn that into a rate limit that stalls
// every answer behind it.
const LIST_GAP_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
// The SDK's default retries last about half an hour: long enough to hold a
// question, or the supervisor's whole sync, hostage.
const retries = () => ({ retryConfig: { retries: 2 } });

// Bolt logs through this, so its lines are JSON like the rest of the gateway.
function boltLogger(log) {
  let level = LogLevel.WARN;
  const line = (parts) => parts.map((p) => (p instanceof Error ? p.message : String(p))).join(" ");
  return {
    debug: () => {},
    info: () => {},
    warn: (...parts) => log.warn(line(parts)),
    error: (...parts) => log.error(line(parts)),
    setLevel: (l) => {
      level = l;
    },
    getLevel: () => level,
    setName: () => {},
  };
}

export async function start(core, config, log) {
  const logger = boltLogger(log);
  // Asked here and handed to Bolt, because Bolt's own check runs in its
  // constructor unawaited: a bad token became an unhandled rejection instead
  // of a start() the supervisor sees fail.
  const auth = await new webApi.WebClient(config.bot_token, retries()).auth.test();
  const botUserId = auth.user_id;
  const receiver = new SocketModeReceiver({
    appToken: config.app_token,
    logger,
    logLevel: LogLevel.WARN,
    installerOptions: { clientOptions: retries() },
  });
  const app = new App({
    token: config.bot_token,
    botId: auth.bot_id,
    botUserId,
    receiver,
    logger,
    logLevel: LogLevel.WARN,
    clientOptions: retries(),
  });
  const state = { ...blankState(), jid: `@${auth.user} in ${auth.team}` };
  let seen = new Map();
  // Channels the bot hears but a listing did not return (another workspace's
  // shared channel, say): not worth a listing per message.
  const unlisted = new Set();
  const names = new Map();
  let failed = false;
  let stopping = false;
  // Null while connected. Counting from now covers a first connection that never comes up.
  let downSince = Date.now();
  // After stop() the supervisor has reported this channel blank; a late report must not undo that.
  const report = () => (stopping ? undefined : core.report("slack", { ...state, groups: [...seen.values()] }));

  async function listChannels() {
    // users.conversations returns only the bot's own channels; conversations.list pages the whole workspace.
    const fresh = new Map();
    const pages = app.client.paginate("users.conversations", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
    });
    for await (const page of pages) {
      for (const c of page.channels ?? []) {
        // Members decide who may ask about a channel privately; without them
        // someone removed from it could keep asking.
        const members = [];
        for await (const m of app.client.paginate("conversations.members", { channel: c.id, limit: 1000 })) {
          members.push(...(m.members ?? []).map((u) => `sl:${u}`));
        }
        fresh.set(groupId(c.id), { id: groupId(c.id), subject: `${auth.team} / #${c.name}`, members });
      }
    }
    seen = fresh;
    // Display names change; a listing is a natural moment to forget them.
    names.clear();
    report();
  }

  // One listing at a time, a minute apart; requests in between fold into the next one.
  let running = null;
  let queued = null;
  let lastListed = 0;
  function relist() {
    queued ??= (async () => {
      await running;
      const wait = lastListed + LIST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      queued = null;
      if (stopping) return;
      lastListed = Date.now();
      running = listChannels().catch((err) => log.warn({ err: err.message }, "could not list slack channels"));
      await running;
    })();
    return queued;
  }

  async function nameOf(user) {
    if (names.has(user)) return names.get(user);
    try {
      const res = await app.client.users.info({ user });
      const profile = res.user?.profile ?? {};
      names.set(user, profile.display_name || profile.real_name || res.user?.name || null);
      return names.get(user);
    } catch (err) {
      // Slack refusing (no users:read, say) is remembered, or every message
      // would repeat a doomed call. A network failure is worth another try.
      if (err.code === webApi.ErrorCode.PlatformError) names.set(user, null);
      return null;
    }
  }

  async function shareFile(payload, file) {
    // No redirects: the token must not follow the file anywhere Slack did not put it.
    const res = await fetch(file.url, {
      headers: { authorization: `Bearer ${config.bot_token}` },
      redirect: "error",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`file download ${res.status}`);
    // The declared size was checked before; the response gets a say too before its body is read.
    if (!core.fileAllowed(res.headers.get("content-length"), file.filename)) return;
    // Without files:read Slack answers 200 with its sign-in page instead of the file.
    if (res.headers.get("content-type")?.startsWith("text/html") && !file.mime?.includes("html")) {
      throw new Error("file download returned a web page; is the files:read scope granted?");
    }
    await core.shareFile({
      groupId: payload.group_id,
      senderJid: payload.sender_jid,
      filename: file.filename,
      mime: file.mime,
      bytes: Buffer.from(await res.arrayBuffer()),
    });
  }

  async function post(channel, answer, threadTs, source) {
    const link = source ? `\n<${source}|Source message>` : "";
    return app.client.chat.postMessage({
      channel,
      text: slackEscape(answer.slice(0, LIMIT)) + link,
      thread_ts: threadTs,
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  async function permalink(channel, ts) {
    const res = await app.client.chat.getPermalink({ channel, message_ts: ts }).catch(() => null);
    return res?.permalink ?? null;
  }

  app.event("message", async ({ event }) => {
    if (!isChatMessage(event)) return;
    if (event.channel_type === "im") {
      const payload = payloadFromSlack(event, botUserId, await nameOf(event.user));
      if (payload.body === null) return;
      core
        .handleDirect(payload, (answer) => post(event.channel, answer))
        .catch((err) => log.error({ err: err.message }, "slack direct failed"));
      return;
    }
    // Group DMs are left out: they cannot be listed without another scope.
    if (!["channel", "group"].includes(event.channel_type)) return;
    const id = groupId(event.channel);
    if (!seen.has(id) && !unlisted.has(id)) {
      relist().then(() => !seen.has(id) && unlisted.add(id));
    }
    const group = core.groupFor(id);
    if (!group) return;
    const payload = payloadFromSlack(event, botUserId, await nameOf(event.user));
    if (group.files && !payload.is_bot) {
      for (const file of slackFiles(event)) {
        if (!core.fileAllowed(file.size, file.filename)) continue;
        shareFile(payload, file).catch((err) =>
          log.warn({ err: err.message, filename: file.filename }, "could not fetch shared file"),
        );
      }
    }
    if (payload.body === null) return;
    // Not awaited, as on Telegram: an answer takes seconds.
    core
      .handle(payload, {
        trigger: () =>
          !payload.is_bot && slackTrigger(event.text, botUserId, group.triggers)
            ? slackQuestion(event.text, botUserId, group.triggers)
            : null,
        // Slack has no quote-reply. The answer goes into the question's thread
        // and links the message it came from instead.
        send: async (answer, quote) => {
          const thread = event.thread_ts ?? event.ts;
          const source = quote ? await permalink(event.channel, parseMessageId(quote.wa_msg_id).ts) : null;
          const sent = await post(event.channel, answer, thread, source);
          const own = { channel: sent.channel, ts: sent.ts, thread_ts: thread, user: botUserId };
          return { ...payloadFromSlack(own, botUserId, auth.user), body: answer };
        },
      })
      .catch((err) => log.error({ err: err.message }, "slack handle failed"));
  });
  // Anyone joining or leaving changes who may ask privately; the bot doing it
  // changes which channels exist at all. Bolt's ignoreSelf lets the bot's own through.
  const membership = async ({ event }) => {
    unlisted.delete(groupId(event.channel));
    relist();
  };
  app.event("member_joined_channel", membership);
  app.event("member_left_channel", membership);
  app.error(async (err) => log.error({ err: err.message }, "slack handler failed"));

  receiver.client.on("connected", () => {
    if (stopping) return;
    state.connected = true;
    downSince = null;
    log.info({ user: auth.user, team: auth.team }, "slack connected");
    report();
  });
  receiver.client.on("reconnecting", () => {
    if (stopping) return;
    state.connected = false;
    downSince ??= Date.now();
    report();
  });

  // Not awaited, as on Telegram: a connection Slack keeps refusing must not
  // hold up the supervisor, and every other channel with it.
  app.start().catch((err) => {
    failed = true;
    log.error({ err: err.message }, "slack connection failed");
    report();
  });
  relist();
  return {
    report,
    dead: () => failed || (downSince !== null && Date.now() - downSince > GIVE_UP_MS),
    stop: () => {
      stopping = true;
      return app.stop();
    },
  };
}
