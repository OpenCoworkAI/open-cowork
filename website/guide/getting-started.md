# Getting Started

Get from download to your first completed task in about five minutes.

## 1. Install

- **macOS**: download the `.dmg` from [Releases](https://github.com/OpenCoworkAI/open-cowork/releases), drag Open Cowork into Applications. Or use Homebrew:

  ```bash
  brew tap OpenCoworkAI/tap
  brew install --cask --no-quarantine open-cowork
  ```

  > If macOS blocks the app on first open ("cannot verify the developer"), right-click the app → **Open** → **Open** once. This is expected for unnotarized builds.

- **Windows**: download and run the `.exe` installer from Releases.

## 2. Get an API key

Open Cowork brings its own interface — you bring a model API key. In **Settings → API Settings**, expand *Common provider setups*: each provider row has a **Get API key** link that opens the provider's console. Popular choices:

| Provider | Good for | Key console |
|---|---|---|
| OpenRouter | One key, many models | [openrouter.ai/keys](https://openrouter.ai/keys) |
| DeepSeek | Low cost, strong Chinese | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| Gemini | Free tier, GUI operation | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Ollama | Fully local, no key | runs on your machine |

Paste the key, pick a model, then click **Test connection** — the built-in diagnostics check DNS → TCP → TLS → auth → model in order and tell you exactly which step failed.

## 3. (Recommended) Enable the sandbox

In **Settings → Sandbox**, enable VM isolation (WSL2 on Windows, Lima on macOS). The badge in the chat header always shows your current state: green **Sandboxed** means commands run inside a VM; amber **Not isolated** means they run directly on your machine.

> GUI operation and `sudo` commands always run on the host by design — the sandbox covers shell commands and file operations.

## 4. Run your first task

Back on the home screen: pick a **working folder** (the AI only touches files inside it), type what you want — for example *"organize this folder by file type"* — and press **Let's go**.

Watch the trace panel on the right to see every step the AI takes. Tools that modify files ask for your approval before running.
