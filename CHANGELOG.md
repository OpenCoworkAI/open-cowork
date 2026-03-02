# Changelog

All notable changes to Open Cowork are documented in this file.

## [Unreleased]

### Changed
- Updated app icons for packaging
- Widened chat content area layout

### Fixed
- Drag-drop file attachments and bubble layout improvements

---

## [3.1.0] - 2026-02-13

### Added
- Full V2 plugin runtime and management system
- Plugin catalog service for browsing and installing plugins
- Plugin component toggling (skills, commands, agents, hooks, mcp)
- Demo videos in documentation

### Fixed
- Agent runner `sdkPlugins` ReferenceError at runtime
- Custom Anthropic API timeout handling
- Removed hardcoded Chinese text from config modal and titlebar
- Aligned packaged app version number
- Surface Claude stderr on exit code 1 with sensitive log redaction

---

## [3.0.0] - 2026-02-08

### Added
- GUI operation support on Windows
- GUI desktop control via WebDriverIO and screen capture
- Feishu (Lark) remote control channel
- Remote control gateway with ngrok tunneling
- User pairing and approval workflow for remote sessions
- Auto-generated concise session titles
- Artifact file links and expanded artifact icons
- Screenshot display in conversations
- Chinese text input support for GUI operations
- Quartz fallback when cliclick missing (macOS)

### Fixed
- GUI dock click targeting and verification gating
- Remote control settings blank screen
- Remote user messages missing in UI
- MCP stdio server bundled node path detection
- Build errors and MCP bundling
- Thinking options and MCP tool parsing
- Artifact label alignment and display

---

## [2.0.0] - 2026-01-22

### Added
- WSL2 sandbox isolation (Windows)
- Lima VM sandbox isolation (macOS)
- Sandbox configuration and sync logging UI
- Skills management with enable/disable and custom skills
- Notion MCP connector with default queries
- Multi-language support (English and Chinese)
- Default working directory configuration
- Developer log toggle
- File attachment support in sandbox mode

### Fixed
- Sandbox execution in dev mode
- Lima bootstrap stability
- Prevented stuck processing states
- Node.js path resolution on Windows
- x64 build issues

---

## [1.0.0] - 2026-01-16

### Added
- Initial implementation of Open Cowork desktop agent app
- Claude Agent SDK integration with `query()` API
- SQLite persistent storage for chat history
- API configuration modal with provider selection
- Support for OpenRouter, Anthropic, and Chinese models (GLM, MiniMax, Kimi)
- Built-in skills system (PPTX, DOCX, PDF, XLSX)
- Custom window titlebar with platform-specific styling
- Workspace folder selection and path sandboxing
- UI/UX improvements and progress tracking
- Windows and macOS packaging (NSIS, DMG)
- macOS code signing and quarantine handling
- Security: default path restrictions for file operations
