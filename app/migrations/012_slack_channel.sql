-- Slack is a fifth channel kind, over Socket Mode.
ALTER TABLE channels DROP CONSTRAINT channels_kind_check;
ALTER TABLE channels ADD CONSTRAINT channels_kind_check
  CHECK (kind IN ('whatsapp', 'telegram', 'discord', 'whatsapp_cloud', 'slack'));
