# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x (latest) | Yes |
| < 3.0 | No |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by emailing **security@opencowork.ai** (or the maintainer contact listed in the repository). Include:

- A clear description of the vulnerability
- Steps to reproduce or a proof-of-concept
- Affected version(s)
- Potential impact assessment

### What to expect

- **Acknowledgement**: within 48 hours
- **Status update**: within 7 days
- **Fix timeline**: critical issues targeted within 14 days; others evaluated case-by-case

We will coordinate disclosure timing with you and credit reporters in the release notes unless you prefer to remain anonymous.

## Scope

In scope:
- Electron main process privilege escalation
- Arbitrary code execution via crafted input
- Credential / API key leakage
- Sandbox escape (Lima / WSL2 isolation)

Out of scope:
- Issues requiring physical access to a running machine
- Self-XSS or issues requiring the attacker to already have local code execution
- Vulnerabilities in third-party dependencies (report those upstream)

## Threat Model (honest summary)

What each layer does and does not protect:

| Layer | Protects | Does NOT protect |
|---|---|---|
| **VM sandbox** (opt-in; Lima/WSL) | Shell commands and file operations run inside the VM against a synced copy of the workspace | GUI operation and `sudo` (host by design — `sudo` is refused while sandboxed); anything outside the workspace copy |
| **Permission prompts** (write/edit/bash default to ask) | Explicit user consent per risky call; GUI control requires a session-scoped grant with an explicit warning | Read-class tools run silently for **local** sessions (remote sessions escalate them to ask) |
| **Dangerous-command patterns** (`tool-executor.ts`) | A UX guardrail against obvious accidents (`rm -rf /`, `dd`) | It is a blacklist and **not a security boundary** — trivially bypassed via interpreters (`python -c`, `node -e`). Do not rely on it; rely on the sandbox + prompts |
| **Remote control** (Feishu/Slack) | Deny-by-default allowlist, webhook signatures, channel-scoped `open` mode, stricter remote permission tier, GUI denied | Approvals still render on the local desktop (in-channel approval is tracked in #311) |
| **Credential storage** | Keys encrypted with an OS-keychain-bound key (Keychain/DPAPI) where available | Systems without safeStorage fall back to obfuscation; anyone with your unlocked OS session can use the app |

The isolation status badge in the app always shows whether the current session
is sandboxed. When it reads "Not isolated", commands execute directly on your
machine with only the permission prompts between the model and your system.

## Security Best Practices for Users

- Keep the app updated to the latest release.
- Enable the VM sandbox (Settings → Sandbox) unless you have a reason not to.
- Store API keys only in the built-in credential store — never in plain text files.
- Review MCP server configurations before adding untrusted servers.
- For remote control, keep the allowlist minimal and avoid the `open` DM policy.
