// Pure functions over Slack's event shapes and text. No socket, no Bolt, so
// they can be tested without a workspace.
import { hasPrefix, stripPrefix } from "../lib.js";

export const groupId = (channel) => `sl:${channel}`;
export const messageId = (channel, ts) => `sl:${channel}:${ts}`;
export const parseMessageId = (id) => {
  const [, channel, ts] = id.split(":");
  return { channel, ts };
};
// Edits, deletions, joins and topic changes arrive as messages too; none of
// them is something a person said.
const SAID = new Set([undefined, "file_share", "thread_broadcast"]);
const FILE_HOSTS = new Set(["files.slack.com", "files.slack-gov.com"]);

export const isChatMessage = (event) => SAID.has(event.subtype) && !event.bot_id;

// Slack sends markup: &amp; entities, <@U1|name>, <#C1|general>,
// <https://x|label>. It is stored and embedded the way people read it.
export function slackPlain(text) {
  return text
    .replace(/<([^<>]+)>/g, (_, inner) => {
      const bar = inner.indexOf("|");
      const target = bar === -1 ? inner : inner.slice(0, bar);
      const label = bar === -1 ? "" : inner.slice(bar + 1);
      if (target.startsWith("@")) return label ? `@${label}` : target;
      if (target.startsWith("#")) return label ? `#${label}` : target;
      if (target.startsWith("!")) return label || `@${target.slice(1)}`;
      return label && label !== target ? `${label} (${target})` : target;
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function payloadFromSlack(event, botUserId, senderName = null) {
  // A thread's root carries thread_ts equal to its own ts; only replies point elsewhere.
  const reply = event.thread_ts && event.thread_ts !== event.ts;
  return {
    wa_msg_id: messageId(event.channel, event.ts),
    group_id: groupId(event.channel),
    sender_jid: `sl:${event.user}`,
    sender_name: senderName,
    body: event.text ? slackPlain(event.text) : null,
    quoted_msg_id: reply ? messageId(event.channel, event.thread_ts) : null,
    is_bot: event.user === botUserId,
    ts: new Date(Number(event.ts) * 1000).toISOString(),
  };
}

// The bot token travels with a download, so it only goes to Slack's own hosts.
export function isSlackFileUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && FILE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function slackFiles(event) {
  return (
    (event.files ?? [])
      // Tombstones are deleted files; hidden_by_limit is past a free plan's
      // history; external files are links to somewhere else entirely.
      .filter(
        (f) =>
          f.mode !== "tombstone" && f.mode !== "hidden_by_limit" && !f.is_external && isSlackFileUrl(f.url_private_download),
      )
      .map((f) => ({
        url: f.url_private_download,
        filename: f.name ?? `file-${f.id}`,
        mime: f.mimetype ?? null,
        size: f.size ?? null,
      }))
  );
}

// Slack writes a mention as <@U123>, or <@U123|name> from older clients.
const mention = (botUserId) => new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, "g");

export function slackTrigger(text, botUserId, triggers) {
  return mention(botUserId).test(text) || hasPrefix(slackPlain(text), triggers);
}

export function slackQuestion(text, botUserId, triggers) {
  return stripPrefix(slackPlain(text.replace(mention(botUserId), " ")).replace(/\s+/g, " ").trim(), triggers);
}

// Slack acts on <!channel>, <@U…> and <#C…> in anything a bot posts. Answers
// quote chat history, so escaping is what stops one from pinging a channel.
export const slackEscape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
