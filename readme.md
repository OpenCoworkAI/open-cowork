<p align="center">
  <img src="resources/logo.png" alt="Open Cowork Logo" width="180" />
</p>

<h1 align="center">🚀 Open Cowork: Your Personal AI Agent Desktop App</h1>

<p align="center">
  • Open Source Claude Cowork • One-Click Install 
</p>

<p align="center">
  <a href="./README_zh.md">中文文档</a> •
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#installation">Downloads</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#skills">Skills Library</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-18+-brightgreen" alt="Node.js" />
</p>

---

## 📖 Introduction

**Open Cowork** is an open-source implementation of **Claude Cowork**, with one-click installers for **Windows** and **macOS**—no coding required.

It provides a sandboxed workspace where AI can manage files, read documents, and generate professional outputs like **PPTX**, **DOCX**, **XLSX**, and more through our built-in Skills system.

---

## ✨ Key Features

- **Zero Coding Required**: Pre-built installers for Windows and macOS, just download and run.
- **Bring Your Own Key**: Use your OpenRouter or Anthropic API key, pay only for what you use.
- **File Management**: AI can read, write, and organize files within your workspace.
- **Skills System**: Built-in workflows for PPTX, DOCX, PDF, XLSX generation and processing.
- **Real-time Trace**: Watch AI reasoning and tool execution in the trace panel.
- **Sandboxed Security**: All operations confined to your chosen workspace folder.

---

## 🎬 Demo

See Open Cowork in action:

<p align="center">
  <a href="https://www.youtube.com/watch?v=MyuiO70R0h8">
    <img src="https://img.youtube.com/vi/MyuiO70R0h8/maxresdefault.jpg" alt="Open Cowork Demo 1" width="400" />
  </a>
  <a href="https://www.youtube.com/watch?v=piEEor1ohHo">
    <img src="https://img.youtube.com/vi/piEEor1ohHo/maxresdefault.jpg" alt="Open Cowork Demo 2" width="400" />
  </a>
</p>

---

## 📦 Installation

### Option 1: Download Installer (Recommended)

Get the latest version from our [Releases Page](https://github.com/your-username/open-cowork/releases).

| Platform | File Type |
|----------|-----------|
| **Windows** | `.exe` |
| **macOS** (Apple Silicon) | `.dmg` |

### Option 2: Build from Source

For developers who want to contribute or modify the codebase:

```bash
git clone https://github.com/your-username/open-cowork.git
cd open-cowork
npm install
npm run dev
```

To build the installer locally: `npm run build`

---

## 🚀 Quick Start Guide

### 1. Get an API Key
You need an API key to power the agent. We recommend:
- **[OpenRouter](https://openrouter.ai/)**: One key for all models (Claude 3.5 Sonnet, etc.).
- **[Anthropic Console](https://console.anthropic.com/)**: Direct access to Claude.

### 2. Configure
1. Open the app.
2. Click the ⚙️ **Settings** icon.
3. Paste your API Key.
   * *Tip: If using OpenRouter, make sure to set the Base URL to `https://openrouter.ai/api`.*

### 3. Start Coworking
1. **Select a Workspace**: Choose a folder where Claude is allowed to work.
2. **Enter a Prompt**:
   > "Read the financial_report.csv in this folder and create a PowerPoint summary with 5 slides."

---

## 🏗️ Architecture

```
open-cowork/
├── src/
│   ├── main/                 # Electron Main Process (Node.js)
│   │   ├── claude/           # Agent SDK & Runner
│   │   ├── sandbox/          # Security & Path Resolution
│   │   └── skills/           # Skill Loader & Manager
│   └── renderer/             # Frontend UI (React + Tailwind)
├── .claude/skills/           # Default Skill Definitions
└── resources/                # Static Assets
```

---

## 🗺️ Roadmap

- [x] **Core**: Stable Windows & macOS Installers
- [x] **Security**: Full Filesystem Sandboxing
- [x] **Skills**: PPTX, DOCX, PDF, XLSX Support
- [ ] **Better Memory Handling**: Improved context management for longer sessions and cross-session memory.

---

## 🤝 Contributing

We welcome contributions! Whether it's a new Skill, a UI fix, or a security improvement:

1. Fork the repo.
2. Create a branch (`git checkout -b feature/NewSkill`).
3. Submit a PR.

---

## 📄 License

MIT © Open Cowork Team

---

<p align="center">
  Made with ❤️ by the Open Cowork Team
</p>
