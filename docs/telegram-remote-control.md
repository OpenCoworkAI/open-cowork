# Telegram remote control

1. Create a dedicated bot with [BotFather](https://t.me/BotFather) and copy its token.
2. Open **Settings → Remote Control → Telegram**.
3. Enter the token and the numeric Telegram user IDs that may control this desktop, separated by commas. Usernames are not user IDs.
4. Save, start the remote gateway, then send the bot a private message.

The connector uses Telegram Bot API long polling; it does not require a public server, tunnel, or webhook URL. Connecting removes any existing webhook for this bot, so use a dedicated bot. The token is saved in the existing encrypted remote configuration store. Clearing the token and saving disconnects Telegram and removes its gateway allowlist entries.

Only allowlisted users in private chats can send tasks. This check runs before attachments are downloaded and remains enforced when another connector has configured the gateway for open access. Existing gateway authentication is preserved: if it uses pairing, pair the user through the existing approval panel as well; token-only gateway authentication does not accept messaging connectors.

Text messages share the existing per-chat session routing and working-directory commands, including `!cd <path>`. Photos and documents up to 10 MB are downloaded into agent content; document bytes use the existing session attachment staging. Captions accompany attachments. Unsupported or oversized downloads produce a notice instead of silently running an empty task. The bot replies with text and formatted code; long replies are split. Permission prompts include `y`, `n`, and `always` reply buttons for allow once, deny, and remember approval. These replies still pass through sender authorization and the pending interaction's owner check.

This first connector supports private chats and polling. Group routing, public webhooks, per-event notification preferences, and an additional Telegram-specific session command UI are follow-up work. Telegram bot chats are cloud chats, not end-to-end encrypted Secret Chats. The Bot API token must be kept private.

Validation uses mocked Bot API responses; a live bot account is required to confirm delivery in a released desktop build. API reference: [Telegram Bot API](https://core.telegram.org/bots/api).
