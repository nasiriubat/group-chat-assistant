import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isChatMessage,
  isSlackFileUrl,
  messageId,
  parseMessageId,
  payloadFromSlack,
  slackEscape,
  slackFiles,
  slackPlain,
  slackQuestion,
  slackTrigger,
} from "../channels/slack_format.js";

const bot = "U0BOT";
const triggers = ["@agent"];

function sl(text, extra = {}) {
  return { type: "message", channel: "C123", channel_type: "channel", user: "U5", text, ts: "1756800000.000100", ...extra };
}

test("slack payload is namespaced and a thread reply points at its parent", () => {
  const p = payloadFromSlack(sl("hello", { thread_ts: "1756799000.000200" }), bot, "Anna K");
  assert.deepEqual(p, {
    wa_msg_id: "sl:C123:1756800000.000100",
    group_id: "sl:C123",
    sender_jid: "sl:U5",
    sender_name: "Anna K",
    body: "hello",
    quoted_msg_id: "sl:C123:1756799000.000200",
    is_bot: false,
    ts: "2025-09-02T08:00:00.000Z",
  });
  // The root of a thread carries its own ts as thread_ts; that is not a reply.
  assert.equal(payloadFromSlack(sl("root", { thread_ts: "1756800000.000100" }), bot).quoted_msg_id, null);
  assert.equal(payloadFromSlack(sl("x", { user: bot }), bot).is_bot, true);
  assert.equal(payloadFromSlack(sl(""), bot).body, null);
  assert.deepEqual(parseMessageId(messageId("C123", "1756800000.000100")), { channel: "C123", ts: "1756800000.000100" });
});

test("slack triggers on a mention of the bot or a prefix, and strips both", () => {
  assert.equal(slackTrigger(`<@${bot}> who books?`, bot, triggers), true);
  assert.equal(slackTrigger(`<@${bot}|assistant> who?`, bot, triggers), true);
  assert.equal(slackTrigger("@Agent who?", bot, triggers), true);
  assert.equal(slackTrigger("<@U999> who?", bot, triggers), false);
  assert.equal(slackTrigger("who?", bot, triggers), false);
  assert.equal(slackQuestion(`<@${bot}>   who books?`, bot, triggers), "who books?");
  assert.equal(slackQuestion("@agent who books?", bot, triggers), "who books?");
});

test("only what people said counts: edits, joins and other bots do not", () => {
  assert.equal(isChatMessage(sl("hi")), true);
  assert.equal(isChatMessage(sl("", { subtype: "file_share" })), true);
  assert.equal(isChatMessage(sl("hi", { subtype: "thread_broadcast" })), true);
  assert.equal(isChatMessage(sl("", { subtype: "message_changed" })), false);
  assert.equal(isChatMessage(sl("joined", { subtype: "channel_join" })), false);
  assert.equal(isChatMessage(sl("beep", { bot_id: "B1" })), false);
});

test("shared files keep their declared size and deleted ones are skipped", () => {
  const event = sl("", {
    subtype: "file_share",
    files: [
      { id: "F1", name: "plan.pdf", mimetype: "application/pdf", size: 2048, url_private_download: "https://files.slack.com/F1" },
      { id: "F2", mode: "tombstone" },
    ],
  });
  assert.deepEqual(slackFiles(event), [
    { url: "https://files.slack.com/F1", filename: "plan.pdf", mime: "application/pdf", size: 2048 },
  ]);
  assert.deepEqual(slackFiles(sl("hi")), []);
});

test("slack markup is stored the way people read it", () => {
  const raw = "<@U999|anna> see <#C1|general>, R&amp;D &lt;3 <https://x.com/a|the doc> <https://x.com/b> <!here>";
  assert.equal(slackPlain(raw), "@anna see #general, R&D <3 the doc (https://x.com/a) https://x.com/b @here");
  assert.equal(payloadFromSlack(sl("R&amp;D"), bot).body, "R&D");
  // Decoded entities are not read as markup a second time.
  assert.equal(slackPlain("&lt;@U1&gt;"), "<@U1>");
  assert.equal(slackQuestion(`<@${bot}> what about <#C1|general> &amp; R&amp;D?`, bot, triggers), "what about #general & R&D?");
});

test("the bot token is only ever sent to Slack's own file hosts", () => {
  assert.equal(isSlackFileUrl("https://files.slack.com/files-pri/T1-F1/download/a.pdf"), true);
  assert.equal(isSlackFileUrl("https://files.slack-gov.com/x"), true);
  assert.equal(isSlackFileUrl("http://files.slack.com/x"), false);
  assert.equal(isSlackFileUrl("https://slack.com/x"), false);
  assert.equal(isSlackFileUrl("https://files.slack.com.evil.example/x"), false);
  assert.equal(isSlackFileUrl("https://notslack.com/x"), false);
  assert.equal(isSlackFileUrl(undefined), false);
  const event = sl("", {
    files: [
      { id: "F3", name: "x", url_private_download: "https://evil.example/x" },
      { id: "F4", name: "doc", is_external: true, url_private_download: "https://files.slack.com/F4" },
    ],
  });
  assert.deepEqual(slackFiles(event), []);
});

test("an answer quoting the chat cannot ping a channel", () => {
  assert.equal(slackEscape("<!channel> R&D <@U1>"), "&lt;!channel&gt; R&amp;D &lt;@U1&gt;");
});
