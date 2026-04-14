<p align="center">
  <img src="resources/logo.png" alt="Open Cowork Logo" width="280" />
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
  <a href="https://discord.gg/pynjtQDf"><img src="https://img.shields.io/discord/1493588403260883078?logo=discord&label=Discord&color=5865F2" alt="Discord" /></a>
  <a href="#community"><img src="https://img.shields.io/badge/WeChat-微信群-07C160?logo=wechat&logoColor=white" alt="WeChat" /></a>
</p>

---

## 📖 Introduction

**Open Cowork** is an open-source implementation of **Claude Cowork**, with one-click installers for **Windows** and **macOS**—no coding required.

It provides a sandboxed workspace where AI can manage files, generate professional outputs (PPTX, DOCX, XLSX, etc.) through our built-in **Skills** system, and **connect to desktop apps via MCP** (browser, Notion, etc.) for better collaboration.

> [!WARNING]
> **Disclaimer**: Open Cowork is an AI collaboration tool. Please exercise caution with its operations, especially when authorizing file modifications or deletions. We support VM-based sandbox isolation, but some operations may still carry risks.

---

<a id="features"></a>

## ✨ Key Features

|               | MCP & Skills | Remote Control | GUI Operation |
| ------------- | ------------ | -------------- | ------------- |
| Claude Cowork | ✓            | ✗              | ✗             |
| OpenClaw      | ✓            | ✓              | ✗             |
| OpenCowork    | ✓            | ✓              | ✓             |

- **One-Click Install, Ready to Use**: Pre-built installers for Windows and macOS, no environment setup needed—just download and start using.
- **Flexible Model Support**: Supports **Claude**, **OpenAI-compatible APIs**, and Chinese models like **GLM**, **MiniMax**, **Kimi**. Use your OpenRouter, Anthropic, or other API keys with flexible configuration. More models coming soon!
- **Remote Control**: Connect to collaboration platforms like **Feishu (Lark)** and other remote services to automate workflows and cross-platform operations.
- **GUI Operation**: Control and interact with various desktop GUI applications on your computer. **Recommended model: Gemini-3-Pro** for optimal GUI understanding and control.
- **Smart File Management**: Read, write, and organize files within your workspace.
- **Skills System**: Built-in workflows for PPTX, DOCX, PDF, XLSX generation and processing. **Supports custom skill creation and deletion.**
- **MCP External Service Support**: Integrate browser, Notion, custom apps and more through **MCP Connectors** to extend AI capabilities.
- **Multimodal Input**: Drag & drop files and images directly into the chat input for seamless multimodal interaction.
- **Real-time Trace**: Watch AI reasoning and tool execution in the Trace Panel.
- **Secure Workspace**: All operations confined to your chosen workspace folder.
- **VM-Level Isolation**: WSL2 (Windows) and Lima (macOS) VM isolation—all commands execute in an isolated VM to protect your host system.
- **UI Enhancements**: Beautiful and flexible UI design, system language switching, comprehensive MCP/Skills/Tools call display.

<a id="demo"></a>

## 🎬 Demo

See Open Cowork in action:

### 1. Folder Organization & Cleanup 📂

https://github.com/user-attachments/assets/dbeb0337-2d19-4b5d-a438-5220f2a87ca7

### 2. Generate PPT from Files 📊

https://github.com/user-attachments/assets/30299ded-0260-468f-b11d-d282bb9c97f2

### 3. Generate XLSX Spreadsheets 📉

https://github.com/user-attachments/assets/f57b9106-4b2c-4747-aecd-a07f78af5dfc

### 4. GUI Operation🖥

https://github.com/user-attachments/assets/75542c76-210f-414d-8182-1da988c148f2

### 5. Remote control with Feishu(Lark) 🤖

https://github.com/user-attachments/assets/05a703de-c0f5-407b-9a43-18b6a172fd74

---

<a id="installation"></a>

## 📦 Installation

### Option 1: Homebrew (macOS, Recommended)

```bash
brew tap OpenCoworkAI/tap
brew install --cask --no-quarantine open-cowork
```

> The `--no-quarantine` flag bypasses macOS Gatekeeper, so you won't see the "Apple cannot verify this app" warning.

### Option 2: Download Installer

Get the latest version from our [Releases Page](https://github.com/OpenCoworkAI/open-cowork/releases).

| Platform                  | File Type |
| ------------------------- | --------- |
| **Windows**               | `.exe`    |
| **macOS** (Apple Silicon) | `.dmg`    |

### Option 3: Build from Source

For developers who want to contribute or modify the codebase:

```bash
git clone https://github.com/OpenCoworkAI/open-cowork.git
cd open-cowork
npm install
npm run rebuild
npm run dev
```

To build the installer locally: `npm run build`

### Security Configuration: 🔒 Sandbox Support

Open Cowork provides **multi-level sandbox protection** to keep your system safe:

| Level        | Platform | Technology | Description                                    |
| ------------ | -------- | ---------- | ---------------------------------------------- |
| **Basic**    | All      | Path Guard | File operations restricted to workspace folder |
| **Enhanced** | Windows  | WSL2       | Commands execute in isolated Linux VM          |
| **Enhanced** | macOS    | Lima       | Commands execute in isolated Linux VM          |

- **Windows (WSL2)**: When WSL2 is detected, all Bash commands are automatically routed to a Linux VM. The workspace is synced bidirectionally.
- **macOS (Lima)**: When [Lima](https://lima-vm.io/) is installed (`brew install lima`), commands run in an Ubuntu VM with `/Users` mounted.
- **Fallback**: If no VM is available, commands run natively with path-based restrictions.

**Setup (Optional, Recommended)**

- **Windows**: WSL2 is auto-detected if installed. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install)

- **macOS**:
  Lima is auto-detected if installed. Install command:

```bash
brew install lima
# Open Cowork will automatically create and manage a 'claude-sandbox' VM
```

---

<a id="quick-start"></a>

## 🚀 Quick Start Guide

### 1. Get an API Key

You need an API key to power the agent. We support **OpenRouter**, **Anthropic**, and various cost-effective **Chinese Models**.

| Provider           | Get Key / Coding Plan                                                      | Base URL (Required)                      | Recommended Model    |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------- | -------------------- |
| **OpenRouter**     | [OpenRouter](https://openrouter.ai/)                                       | `https://openrouter.ai/api`              | `claude-4-5-sonnet`  |
| **Anthropic**      | [Anthropic Console](https://console.anthropic.com/)                        | (Default)                                | `claude-4-5-sonnet`  |
| **Zhipu AI (GLM)** | [GLM Coding Plan](https://bigmodel.cn/glm-coding) (⚡️Chinese Deal)         | `https://open.bigmodel.cn/api/anthropic` | `glm-4.7`, `glm-4.6` |
| **MiniMax**        | [MiniMax Coding Plan](https://platform.minimaxi.com/subscribe/coding-plan) | `https://api.minimaxi.com/anthropic`     | `minimax-m2`         |
| **Kimi**           | [Kimi Coding Plan](https://www.kimi.com/membership/pricing)                | `https://api.kimi.com/coding/`           | `kimi-k2`            |

### 2. Configure

1. Open the app and click the ⚙️ **Settings** icon in the bottom left.
2. Paste your **API Key**.
3. **Crucial**: Set the **Base URL** according to the table above (especially for Zhipu/MiniMax, etc.).
4. Enter the **Model** name you want to use.

### 3. Start Coworking

1. **Select a Workspace**: Choose a folder where Claude is allowed to work.
2. **Enter a Prompt**:
   > "Read the financial_report.csv in this folder and create a PowerPoint summary with 5 slides."

### 📝 Important Notes

1.  **macOS Installation**: If you downloaded the DMG directly (not via Homebrew) and see a security warning, go to **System Settings > Privacy & Security** and click **Open Anyway**. Or install via Homebrew to avoid this entirely:
    ```bash
    brew tap OpenCoworkAI/tap && brew install --cask --no-quarantine open-cowork
    ```
2.  **Network Access**: For tools like `WebSearch`, you may need to enable "Virtual Network Interface" (TUN Mode) in your proxy settings to ensure connectivity.
3.  **Notion Connector**: Besides setting the integration token, you also need to add connections in a root page. See https://www.notion.com/help/add-and-manage-connections-with-the-api for more details.

---

<a id="skills"></a>

## 🧰 Skills Library

Open Cowork ships with built-in skills under `.claude/skills/`, and supports user-added or custom skills, including:

- `pptx` for PowerPoint generation
- `docx` for Word document processing
- `pdf` for PDF handling and forms
- `xlsx` for Excel spreadsheet support
- `skill-creator` for creating custom skills

---

## 🏗️ Architecture

```
open-cowork/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # Main entry point
│   │   ├── claude/              # Agent SDK & Runner
│   │   │   └── agent-runner.ts  # AI agent execution logic
│   │   ├── config/              # Configuration management
│   │   │   └── config-store.ts  # Persistent settings storage
│   │   ├── db/                  # Database layer
│   │   │   └── database.ts      # SQLite/data persistence
│   │   ├── ipc/                 # IPC handlers
│   │   ├── memory/              # Memory management
│   │   │   └── memory-manager.ts
│   │   ├── sandbox/             # Security & Path Resolution
│   │   │   └── path-resolver.ts # Sandboxed file access
│   │   ├── session/             # Session management
│   │   │   └── session-manager.ts
│   │   ├── skills/              # Skill Loader & Manager
│   │   │   └── skills-manager.ts
│   │   └── tools/               # Tool execution
│   │       └── tool-executor.ts # Tool call handling
│   ├── preload/                 # Electron preload scripts
│   │   └── index.ts             # Context bridge setup
│   └── renderer/                # Frontend UI (React + Tailwind)
│       ├── App.tsx              # Root component
│       ├── main.tsx             # React entry point
│       ├── components/          # UI Components
│       │   ├── ChatView.tsx     # Main chat interface
│       │   ├── ConfigModal.tsx  # Settings dialog
│       │   ├── ContextPanel.tsx # File context display
│       │   ├── MessageCard.tsx  # Chat message component
│       │   ├── PermissionDialog.tsx
│       │   ├── Sidebar.tsx      # Navigation sidebar
│       │   ├── Titlebar.tsx     # Custom window titlebar
│       │   ├── TracePanel.tsx   # AI reasoning trace
│       │   └── WelcomeView.tsx  # Onboarding screen
│       ├── hooks/               # Custom React hooks
│       │   └── useIPC.ts        # IPC communication hook
│       ├── store/               # State management
│       │   └── index.ts
│       ├── styles/              # CSS styles
│       │   └── globals.css
│       ├── types/               # TypeScript types
│       │   └── index.ts
│       └── utils/               # Utility functions
├── .claude/
│   └── skills/                  # Default Skill Definitions
│       ├── pptx/                # PowerPoint generation
│       ├── docx/                # Word document processing
│       ├── pdf/                 # PDF handling & forms
│       ├── xlsx/                # Excel spreadsheet support
│       └── skill-creator/       # Skill development toolkit
├── resources/                   # Static Assets (icons, images)
├── electron-builder.yml         # Build configuration
├── vite.config.ts               # Vite bundler config
└── package.json                 # Dependencies & scripts
```

---

## 🗺️ Roadmap

- [x] **Core**: Stable Windows & macOS Installers
- [x] **Security**: Full Filesystem Sandboxing
- [x] **Skills**: PPTX, DOCX, PDF, XLSX Support + Custom Skill Management
- [x] **VM Sandbox**: WSL2 (Windows) and Lima (macOS) isolation support
- [x] **MCP Connectors**: Custom connector support for external service integration
- [x] **Rich Input**: File upload and image input in chat
- [x] **Multi-Model**: OpenAI-compatible API support (iterating)
- [x] **UI/UX**: Enhanced interface with English/Chinese localization
- [ ] **Memory Optimization**: Improved context management for longer sessions and cross-session memory.
- [ ] **New Features**: Stay tuned!

---

## 🛠️ Contributing

We welcome contributions! Whether it's a new Skill, a UI fix, or a security improvement:

1. Fork the repo.
2. Create a branch (`git checkout -b feature/NewSkill`).
3. Submit a PR.

---

## 💬 Community

Join our community for support and discussion:

- **Discord**: [Join our Discord server](https://discord.gg/pynjtQDf) — for real-time chat, support, and development discussion.
- **WeChat**: Scan the QR code below to join our WeChat group (Chinese community).

<p align="center">
  <img src="resources/WeChat.jpg" alt="WeChat Group" width="200" />
</p>

---

## 📄 License

MIT © Open Cowork Team

---

<p align="center">
  Made with ❤️ by the Open Cowork Team with the help of opus4.5
</p>
