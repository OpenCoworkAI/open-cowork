# 🗺️ Open Cowork Roadmap

> This document outlines the development direction for Open Cowork. For feature requests and discussion, see [GitHub Issues](https://github.com/OpenCoworkAI/open-cowork/issues).

## ✅ Completed

- **Core**: Stable Windows & macOS installers with build verification
- **Security**: Full filesystem sandboxing + path traversal / zip-slip hardening
- **VM Sandbox**: WSL2 (Windows) and Lima (macOS) VM-level isolation
- **Skills**: PPTX, DOCX, PDF, XLSX support + custom skill management + hot-reload
- **MCP Connectors**: Custom connector support (stdio / SSE / Streamable HTTP)
- **Rich Input**: File upload and image input in chat
- **Multi-Model**: Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi, Grok, MiniMax, Ollama
- **UI/UX**: Enhanced interface with English/Chinese localization
- **Remote Control**: Feishu (Lark) bot integration with pairing mode + approval panel
- **CI/CD**: Automated builds, smoke tests, Codex-powered PR review bot
- **Model Presets**: Up-to-date model catalogs for all major providers
- **Dependency Policy**: Tiered management strategy with Dependabot grouping

## 🚧 In Progress

- **v3.3.0 Stable Release**: Graduate from beta — all blocking issues resolved
- **Memory System**: Unified storage with core/experience memory (PR #138 under review)

## 📋 Planned

### Near-term (v3.4.0)

- **Sandbox Hardening**: Deep research and improvement of VM sandbox reliability, startup performance, and cross-platform consistency (Lima on macOS, WSL2 on Windows)
- **App Slimming**: Reduce installer from ~156 MB to ~80 MB — on-demand Python/Node.js download, lazy-load Feishu SDK, strip unused files ([details](docs/SLIM-PLAN.md))
- **Code Cleanup**: Split god files (index.ts 2672 lines, gui-operate-server.ts 6884 lines), lazy imports, dead code removal
- **Tool Completeness**: Implement native TodoWrite, AskUserQuestion, Glob, Grep, WebFetch, WebSearch tool schemas + handlers for API key users
- **Memory System**: Unified storage, prompt injection, cross-session retrieval, and source-aware reranking
- **Scheduled Tasks**: Cron-like task scheduling with UI management and persistent execution
- **Log Management**: Structured logging with rotation, size limits, and user-accessible log viewer improvements
- **Installation Experience**: Smoother first-run — auto-detect system dependencies, clearer error messages, one-click setup
- **Linux Support**: First-class Linux builds (currently build-from-source only)

### Mid-term (v3.5.0+)

- **Plugin System**: Extensible architecture for community-built integrations
- **Multi-Agent**: Orchestrate multiple agents for complex workflows
- **Workspace Templates**: Pre-configured environments for common use cases (coding, writing, research)

### Long-term

- **Computer Use (CUA)**: GUI automation via screen capture and mouse/keyboard control
- **Collaborative Mode**: Multiple users sharing a workspace
- **Mobile Companion**: Lightweight mobile app for monitoring and quick interactions

---

_Last updated: 2026-04-18_
_Want to contribute? Check our [Contributing Guide](CONTRIBUTING.md) and pick an issue labeled `good first issue`._
