# Telegram remote control

1. Create a dedicated bot with [BotFather](https://t.me/BotFather) and copy its token.
2. Open **Settings → Remote Control → Telegram**.
3. Enter the token and the numeric Telegram user IDs that may control this desktop, separated by commas. Usernames are not user IDs.
4. Save, start the remote gateway, then send the bot a private message.

The connector uses Telegram Bot API long polling; it does not require a public server, tunnel, or webhook URL. Connecting removes any existing webhook for this bot, so use a dedicated bot. The token is saved in the existing encrypted remote configuration store. Clearing the token and saving disconnects Telegram and removes its gateway allowlist entries.

Only allowlisted users in private chats can send tasks. This check runs before attachments are downloaded and remains enforced when another connector has configured the gateway for open access. Existing gateway authentication is preserved: if it uses pairing, pair the user through the existing approval panel as well; token-only gateway authentication does not accept messaging connectors.

Text messages share the existing per-chat session routing and working-directory commands, including `!cd <path>`. Photos and documents up to 10 MB are downloaded into agent content; document bytes use the existing session attachment staging. Captions accompany attachments. Unsupported or oversized downloads produce a notice instead of silently running an empty task. The bot replies with text and formatted code; long replies are split.

Permission prompts have inline **Allow once / Deny / Always allow** buttons. Each button is bound to one pending request, its owner, and its private chat. The buttons and text replies pass through the shared gateway authorization checks, expire after 60 seconds, and can be consumed once. **Always allow** remembers the tool approval for the current conversation.

Telegram's command menu exposes these controls:

- `/new` selects a fresh conversation for the next task and keeps earlier conversations available.
- `/sessions` lists your conversations created during the current app run and marks the selected one.
- `/switch <id>` selects one of your conversation IDs; an unambiguous ID prefix also works. Each conversation keeps its working directory.
- `/stop` stops the selected task and denies its pending permission requests.

Each allowed user has a separate conversation list. In settings, choose notifications for task completion, task failure, and tool progress separately. Completion and failure notifications default to enabled; tool progress defaults to disabled. Responses and permission prompts remain available independently of these notification preferences.

The connector supports private chats and polling. Group routing and public webhooks remain follow-up work. Conversation records stay in the desktop app; the Telegram selection list is rebuilt as conversations are used during each app run. Telegram bot chats are cloud chats, not end-to-end encrypted Secret Chats. The Bot API token must be kept private.

Validation uses mocked Bot API responses; a live bot account is required to confirm delivery in a released desktop build. API reference: [Telegram Bot API](https://core.telegram.org/bots/api).
