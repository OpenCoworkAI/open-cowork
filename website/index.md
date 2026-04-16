---
layout: home

hero:
  name: Open Cowork
  text: Open-Source AI Agent Desktop App
  tagline: One-click install for Windows & macOS. Multi-model support, VM sandbox isolation, built-in Skills, and MCP integration — no coding required.
  image:
    src: /logo.png
    alt: Open Cowork Logo
  actions:
    - theme: brand
      text: Download
      link: https://github.com/OpenCoworkAI/open-cowork/releases
    - theme: alt
      text: View on GitHub
      link: https://github.com/OpenCoworkAI/open-cowork

features:
  - icon: 🚀
    title: One-Click Install
    details: Pre-built installers for Windows (.exe) and macOS (.dmg). Also available via Homebrew. No terminal or coding knowledge required.
  - icon: 🤖
    title: Multi-Model Support
    details: Works with Claude, GPT, Gemini, DeepSeek, GLM, MiniMax, Kimi, and any OpenAI-compatible API. Bring your own API key.
  - icon: 🔒
    title: VM Sandbox Isolation
    details: WSL2 (Windows) and Lima (macOS) powered VM isolation. All commands execute in a secure Linux environment, protecting your host system.
  - icon: 🧰
    title: Built-in Skills
    details: Generate PPTX, DOCX, XLSX, and PDF documents with built-in workflows. Create custom skills with the skill-creator toolkit.
  - icon: 🔌
    title: MCP Tool Integration
    details: Connect to browsers, Notion, and desktop apps via Model Context Protocol. Extend AI capabilities beyond file management.
  - icon: 🖥️
    title: GUI Automation
    details: Control and automate desktop GUI applications via computer use. Recommended model — Gemini-3-Pro for best results.
  - icon: 📡
    title: Remote Control
    details: Send commands and receive results via Feishu (Lark) and Slack integration. Automate workflows across collaboration platforms.
  - icon: 🛡️
    title: Free & Open Source
    details: MIT licensed. Fully transparent codebase. Your data stays local — no telemetry, no data sent to Open Cowork servers.
---

<style>
.faq-section {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px;
}
.faq-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 32px;
}
.faq-item {
  margin-bottom: 24px;
}
.faq-item h3 {
  font-size: 1.1em;
  margin-bottom: 8px;
}
.faq-item p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.comparison-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.comparison-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
.comparison-section table {
  width: 100%;
  border-collapse: collapse;
}
.comparison-section th, .comparison-section td {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  text-align: center;
}
.comparison-section th {
  background: var(--vp-c-bg-soft);
}

.install-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px;
}
.install-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
</style>

<div class="comparison-section">

## How It Compares

|                 | MCP & Skills | Remote Control | GUI Automation |
| --------------- | :----------: | :------------: | :------------: |
| Claude Cowork   |      ✓       |       ✗        |       ✗        |
| **Open Cowork** |    **✓**     |     **✓**      |     **✓**      |

</div>

<div class="install-section">

## Quick Install

**macOS (Homebrew)**

```bash
brew tap OpenCoworkAI/tap
brew install --cask --no-quarantine open-cowork
```

**Windows / macOS** — [Download from Releases →](https://github.com/OpenCoworkAI/open-cowork/releases)

</div>

<div class="faq-section">

## Frequently Asked Questions

<div class="faq-item">

### What is Open Cowork?

Open Cowork is a free, open-source AI agent desktop application for Windows and macOS. It wraps AI models (Claude, GPT, Gemini, DeepSeek, etc.) into a user-friendly GUI with one-click installation — no terminal or coding knowledge required.

</div>

<div class="faq-item">

### What AI models are supported?

Claude (via Anthropic or OpenRouter), OpenAI-compatible APIs, and Chinese models including GLM (Zhipu AI), MiniMax, and Kimi. Any provider offering an OpenAI-compatible API endpoint can be configured.

</div>

<div class="faq-item">

### Is it free?

Yes. Open Cowork is completely free and open-source under the MIT license. You only pay for AI model API usage from your chosen provider.

</div>

<div class="faq-item">

### How does sandbox isolation work?

Open Cowork uses WSL2 (Windows) or Lima (macOS) to run all AI-executed commands inside an isolated Linux VM. Even if the AI makes a mistake, your host system files remain protected.

</div>

<div class="faq-item">

### Is my data safe?

Open Cowork runs entirely on your local machine. The only external communication is with the AI model API you configure. No data is sent to Open Cowork servers.

</div>

<div class="faq-item">

### Does it work on Linux?

Pre-built installers are available for Windows and macOS. Linux users can build from source — see the [GitHub repository](https://github.com/OpenCoworkAI/open-cowork) for instructions.

</div>

</div>
