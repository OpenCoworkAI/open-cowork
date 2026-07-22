# Troubleshooting

The most common issues, in the order new users usually hit them.

## macOS won't open the app

*"Open Cowork cannot be opened because the developer cannot be verified."*

Right-click the app in Applications → **Open** → **Open**. You only need to do this once. With Homebrew, install with the `--no-quarantine` flag shown on the [download page](https://github.com/OpenCoworkAI/open-cowork/releases).

## "Authentication failed" / 401

Your API key is wrong, expired, or lacks access to the selected model.

1. Re-copy the key from your provider's console (the **Get API key** link next to each provider in Settings opens it).
2. Click **Test connection** — the diagnostics pinpoint whether the problem is network, auth, or the model name.
3. On OpenRouter, confirm your account has credit.

## "Rate limited" / 429

The provider is throttling you. Wait a minute and retry. If it persists, your key's tier may be too low for the model — check the provider's dashboard or switch to a cheaper model.

## Network errors / timeouts

- Test the same endpoint in your browser or with `curl`.
- If you use a proxy or VPN, try toggling it — unstable gateways are the most common cause of mid-task disconnects. The agent retries automatically.
- Behind a corporate firewall, ensure the provider's API domain is allowed.

## Sandbox setup fails

- **macOS**: Lima is required for VM isolation. Install with `brew install lima`, then retry in Settings → Sandbox. Ensure you have ~5 GB free disk space.
- **Windows**: WSL2 must be enabled: run `wsl --install` in an elevated PowerShell, reboot, retry.
- You can always click **Continue** to run without the VM — the amber **Not isolated** badge in the chat header reminds you of the reduced protection.

## A session shows "running" forever

If the app crashed or was force-quit during a task, restart the app — interrupted sessions are automatically reset and you can retry the last message. If a live session hangs, press the stop button and send the prompt again.

## Document generation (PPTX/DOCX/XLSX) fails

Update to the latest release — required Python libraries ship with the app as of v3.4. If the error mentions `soffice`, install [LibreOffice](https://www.libreoffice.org/) to enable slide thumbnails (generation itself works without it).

## Still stuck?

**Settings → Logs → Export** produces a log bundle. Attach it to a [GitHub issue](https://github.com/OpenCoworkAI/open-cowork/issues) — API keys are not written to logs — or ask in [Discord](https://discord.gg/pynjtQDf).
