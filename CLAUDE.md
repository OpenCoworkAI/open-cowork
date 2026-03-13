# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup
npm install                     # Install dependencies
npm run rebuild                 # Rebuild better-sqlite3 for Electron

# Development
npm run dev                     # Start dev server (downloads Node, builds agents/MCP, then Vite)
npm run dev:with-python         # Dev with Python proxy support (for OpenAI/Gemini/OpenRouter)

# Build
npm run build                   # Full production build → electron-builder output

# Test
npm run test                    # Vitest (watch mode)
npm run test -- --run           # Single run, no watch
npm run test -- tests/foo.test.ts  # Run a specific test file
npm run bench                   # Benchmarks

# Code quality
npm run lint                    # ESLint (src/**/*.{ts,tsx})
npm run format                  # Prettier (src/**/*.{ts,tsx,css})

# Native rebuild (after Electron or better-sqlite3 version changes)
npm run rebuild                 # Rebuild better-sqlite3 for current Electron
```

## Architecture

Electron desktop app (v31) with React 18 renderer. Three process boundaries:

```
┌─────────────────────────────────────────────────┐
│  Renderer (React/Zustand/Tailwind)              │
│  src/renderer/                                  │
├─────────────────────────────────────────────────┤
│  Preload (contextBridge → window.electronAPI)   │
│  src/preload/index.ts                           │
├─────────────────────────────────────────────────┤
│  Main Process (Node.js/Electron)                │
│  src/main/                                      │
│    ├── index.ts          IPC hub, app lifecycle (2181 lines)
│    ├── nav-server.ts     CLI-driven UI navigation (HTTP on :19888)
│    ├── claude/            Agent SDK integration, model routing
│    ├── config/            electron-store, API key management
│    ├── credentials/       Secure credential storage
│    ├── db/                SQLite (better-sqlite3)
│    ├── mcp/               MCP client (stdio + SSE transports)
│    ├── memory/            Conversation memory persistence
│    ├── remote/            Feishu/Lark bot integration
│    ├── sandbox/           WSL2 (Win) / Lima (Mac) isolation
│    ├── schedule/          Cron-like task scheduler
│    ├── session/           Session manager, chat history
│    ├── skills/            Skill loader, plugin runtime
│    ├── tools/             Tool execution (sandboxed & native)
│    └── utils/             Logger, artifact parser, helpers
└─────────────────────────────────────────────────┘
```

### Module map

| Module | Entry file | Description | Lines |
|--------|-----------|-------------|-------|
| index | `index.ts` | IPC hub (~60 handlers), app lifecycle, window management | 2181 |
| claude | `claude/agent-runner.ts` | AI execution via pi-coding-agent SDK, provider routing | 1514 |
| config | `config/config-store.ts` | electron-store config, API keys, model presets | 1373 |
| mcp | `mcp/mcp-manager.ts` | MCP server lifecycle, stdio + SSE transports | 1321 |
| remote | `remote/remote-manager.ts` | Feishu/Lark bot, tunnel, message routing | 1067 |
| skills | `skills/skills-manager.ts` | Skill discovery, hot-reload, plugin install | 999 |
| session | `session/session-manager.ts` | Session CRUD, chat history, workspace scoping | 957 |
| tools | `tools/tool-executor.ts` | Tool execution with sandbox/native dispatch | 832 |
| db | `db/database.ts` | SQLite schema, migrations, query helpers | 673 |
| sandbox | `sandbox/sandbox-adapter.ts` | Platform-aware sandbox (WSL2/Lima/native) | 590 |
| schedule | `schedule/scheduled-task-manager.ts` | Cron-like scheduled tasks | 488 |
| memory | `memory/memory-manager.ts` | Conversation memory persistence | 298 |
| credentials | `credentials/credentials-store.ts` | Secure credential storage | 275 |
| nav-server | `nav-server.ts` | HTTP server for CLI-driven UI navigation | 155 |

### Request flow (AI query)

1. Renderer dispatches `session.continue` via IPC
2. `src/main/index.ts` routes to `SessionManager.continueSession()`
3. `SessionManager` delegates to `AgentRunner.run()` (`@mariozechner/pi-coding-agent` SDK)
4. AgentRunner resolves provider (Anthropic direct, or via Python proxy for OpenAI/Gemini/OpenRouter)
5. MCP tools are bridged into SDK ToolDefinition format
6. Streaming responses flow back as server events: `stream.message`, `stream.partial`, `trace.step`
7. Renderer's `useIPC` hook dispatches events into Zustand store → React re-renders

### Provider routing

- **Anthropic**: Claude Agent SDK → Anthropic API directly (fast, no proxy)
- **OpenAI / Gemini / OpenRouter / custom**: Claude Agent SDK → local Python FastAPI proxy (LiteLLM) → upstream API

### State management

Zustand store (`src/renderer/store/index.ts`) holds all app state. The `useIPC` hook (`src/renderer/hooks/useIPC.ts`) is the single listener for all main→renderer events.

### IPC pattern

- `ipcMain.on(channel, handler)` — fire-and-forget (renderer → main)
- `ipcMain.handle(channel, handler)` — request/response (renderer → main)
- `mainWindow.webContents.send(channel, data)` — push events (main → renderer)
- Preload exposes typed API via `contextBridge` as `window.electronAPI`

### IPC channel index

Key channels in `src/main/index.ts` (all `ipcMain.handle` unless noted):

| Channel | Line | Purpose |
|---------|------|---------|
| `client-event` | :771 | Session dispatch hub (fire-and-forget via `ipcMain.on`) |
| `client-invoke` | :783 | Session dispatch hub (request/response) |
| `config.get` | :971 | Read current app config |
| `config.save` | :1030 | Persist config changes |
| `config.test` | :1077 | Test API key connectivity |
| `mcp.getServers` | :1109 | List MCP server configs |
| `mcp.saveServer` | :1127 | Add/update MCP server |
| `mcp.getTools` | :1157 | List all MCP tools across servers |
| `sandbox.*` | :1487+ | Sandbox setup/status (WSL/Lima) |
| `logs.*` | :1632+ | Log retrieval, export, clear |
| `remote.*` | :1795+ | Remote bot config, pairing, sessions |
| `schedule.*` | :1935+ | Scheduled task CRUD and execution |

### Sandbox model

Platform-aware execution via `src/main/sandbox/sandbox-adapter.ts`:
- **Windows**: WSL2 bridge with bidirectional file sync
- **macOS**: Lima VM with SSH bridge
- **Native fallback**: Direct execution with path guards

Path virtualization maps host paths to `/workspace` inside sandbox.

### Skills system

Built-in skills live in `.claude/skills/` (pptx, docx, pdf, xlsx, skill-creator). Each has a `SKILL.md` and implementation files. Skills are loaded by `src/main/skills/skills-manager.ts`.

## Code conventions

- **Always write unit tests** — Every new feature, bug fix, or non-trivial code change MUST include corresponding unit tests. Place tests in `tests/` matching the source file name (e.g., `src/main/cua/tinybench-tasks.ts` → `tests/tinybench-tasks.test.ts`). Run `npm run test -- --run` to verify before committing.

- **TypeScript strict mode** with `noUnusedLocals` and `noUnusedParameters`
- **Path aliases**: `@/*` → `src/*`, `@main/*` → `src/main/*`, `@renderer/*` → `src/renderer/*`
- **Formatting**: Prettier — single quotes, 2-space indent, 100 char width, trailing commas (es5)
- **Unused vars**: Prefix with `_` to suppress lint warnings
- **i18n**: English and Chinese via i18next (`src/renderer/i18n/`)
- **Dark mode**: Class-based via Tailwind (`dark:` prefix)
- **CSS variables**: Theme colors defined in `src/renderer/styles/globals.css`

## Key files by task

| Task | Key files |
|------|-----------|
| Add IPC handler | `src/main/index.ts`, `src/preload/index.ts` |
| AI query execution | `src/main/claude/agent-runner.ts` |
| Session lifecycle | `src/main/session/session-manager.ts` |
| MCP integration | `src/main/mcp/mcp-manager.ts` |
| Database schema | `src/main/db/database.ts` |
| Config persistence | `src/main/config/config-store.ts` |
| UI state | `src/renderer/store/index.ts` |
| Server events | `src/renderer/hooks/useIPC.ts` |
| Chat UI | `src/renderer/components/ChatView.tsx` |
| Sandbox execution | `src/main/sandbox/sandbox-adapter.ts` |

## Common modification scenarios

| Scenario | Files to touch |
|----------|---------------|
| Add a new AI provider | `config/config-store.ts` (presets), `claude/agent-runner.ts` (routing), `config/auth-utils.ts` (credentials) |
| Add a new MCP tool | `mcp/mcp-manager.ts` (server config), `tools/tool-executor.ts` (execution) |
| Add a new IPC handler | `src/main/index.ts` (handler), `src/preload/index.ts` (bridge), `renderer/types.ts` (types) |
| Add a new settings tab | `renderer/components/Settings*.tsx`, `src/main/index.ts` (IPC), `renderer/i18n/` (translations) |
| Modify sandbox behavior | `sandbox/sandbox-adapter.ts`, `sandbox/wsl-bridge.ts` or `sandbox/lima-bridge.ts` |
| Add a scheduled task feature | `schedule/scheduled-task-manager.ts`, `src/main/index.ts` (schedule.* IPC) |

## Testing

- **Framework**: Vitest with globals enabled, node environment
- **Test locations**: `src/**/*.test.ts` and `tests/**/*.test.ts`
- **Coverage**: v8 provider, excludes renderer (no jsdom)
- **Mocking**: `mockReset` and `restoreMocks` enabled by default
- **No renderer tests in Vitest** — renderer is excluded from coverage; UI is tested manually

## Build outputs

- `dist/` — Vite-bundled renderer
- `dist-electron/main/` — Compiled main process
- `dist-electron/preload/` — Compiled preload
- `dist-mcp/` — esbuild-bundled MCP servers
- `dist-wsl-agent/`, `dist-lima-agent/` — Sandbox agents
- `release/` — electron-builder installers (DMG, NSIS, AppImage)
