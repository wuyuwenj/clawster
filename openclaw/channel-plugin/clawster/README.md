# Clawster OpenClaw Channel Plugin

This extension lets OpenClaw deliver outbound messages directly into the Clawster desktop app.

Default target endpoint:

`http://127.0.0.1:18790/api/channel/message`

Expected auth:

- `Authorization: Bearer <token>`
- Token should match the token Clawster uses for gateway auth (`clawbot.token`), unless overridden with `CLAWSTER_CHANNEL_TOKEN`.

Use `npm run setup:openclaw-channel` from this repo to copy this extension into `~/.openclaw/extensions/clawster`.

Target behavior:

- OpenClaw may require a `target` field for send actions.
- Clawster accepts any non-empty target (for example `default`) and ignores it for routing.
- Media sends are supported by appending the media URL to message text for compatibility with OpenClaw outbound checks.
