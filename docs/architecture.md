# Architecture

This document describes the internal architecture of Open Cowork for contributors and developers working on the codebase.

## Overview

Open Cowork is an Electron desktop application that follows the standard 3-process model:

```
┌──────────────────────────────────────────────────────────┐
│                    Electron Shell                         │
│                                                          │
│  ┌─────────────┐   IPC Bridge   ┌─────────────────────┐ │
│  │ Main Process │ ◄───────────► │  Renderer Process    │ │
│  │  (Node.js)   │  (preload.ts) │  (React + Zustand)   │ │
│  │              │               │                      │ │
│  │ • Agent SDK  │               │ • ChatView           │ │
│  │ • Sessions   │  ClientEvent  │ • SettingsPanel      │ │
│  │ • Sandbox    │ ────────────► │ • TracePanel         │ │
│  │ • MCP        │               │ • ContextPanel       │ │
│  │ • Remote     │  ServerEvent  │ • Sidebar            │ │
│  │ • SQLite     │ ◄──────────── │                      │ │
│  │ • Config     │               │                      │ │
│  └─────────────┘               └─────────────────────┘ │
│         │                                                │
│         ▼                                                │
│  ┌─────────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Sandbox Layer   │  │  MCP     │  │ Remote Control│  │
│  │ WSL2 / Lima / ── │  │ Servers  │  │ Feishu/Ngrok  │  │
│  │ Native           │  │ (stdio/  │  │               │  │
│  │                   │  │  SSE)    │  │               │  │
│  └─────────────────┘  └──────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Main process** (`src/main/`) handles all backend logic: agent execution, database, sandbox, MCP servers, remote control, and configuration. It communicates with the renderer via typed IPC events.

**Preload script** (`src/preload/index.ts`) exposes a `window.electronAPI` bridge using Electron's `contextBridge`. It provides three communication patterns: `send()` (fire-and-forget), `on()` (subscribe to server events), and `invoke()` (request-response RPC).

**Renderer process** (`src/renderer/`) is a React 18 + TypeScript SPA using Zustand for state management and TailwindCSS for styling. It renders the chat UI, settings panels, and trace visualizations.

---

## Agent Execution Engine

The agent execution system is the core of Open Cowork. Two runner implementations exist, selected based on the configured provider.

### Runner Selection

`SessionManager.createAgentRunner()` (`src/main/session/session-manager.ts:74-100`) selects the runner:

- **`ClaudeAgentRunner`** (default) — used when provider is `openrouter`, `anthropic`, or `custom` with `anthropic` protocol
- **`OpenAIResponsesRunner`** — used when provider is `openai` or `custom` with `openai` protocol

Both implement the `AgentRunner` interface:

```typescript
interface AgentRunner {
  run(session: Session, prompt: string, existingMessages: Message[]): Promise<void>;
  cancel(sessionId: string): void;
  handleQuestionResponse(questionId: string, answer: string): void;
  clearSdkSession?(sessionId: string): void;
}
```

### ClaudeAgentRunner

**File:** `src/main/claude/agent-runner.ts`

This runner uses `query()` from `@anthropic-ai/claude-agent-sdk` to spawn a `claude-code` subprocess. The execution flow:

1. **Register session paths** with `PathResolver`
2. **Initialize sandbox sync** — if WSL or Lima mode is active, files are copied to the isolated VM and skills are rsynced in
3. **Locate claude-code** — searches bundled paths, npm globals, nvm, homebrew, and user-configured path
4. **Build environment** — merges shell PATH (via `getShellEnvironment()`), config overrides (`getClaudeEnvOverrides()`), and `CLAUDE_CONFIG_DIR`
5. **Build system prompt** — appends workspace info, available skills, MCP tools, credentials, artifact instructions, and behavior guidelines
6. **Build conversation context** — converts existing message history into a Human/Assistant text format
7. **Configure MCP servers** — maps enabled MCP configs to the SDK's `mcpServers` format, substituting bundled Node.js/npx paths
8. **Load runtime plugins** — queries `PluginRuntimeService` for enabled plugin paths
9. **Call `query()`** — passes all options including model, maxTurns (1000), thinking options, abort controller, stderr handler, and a custom `spawnClaudeCodeProcess` function that prefers bundled Node.js
10. **Stream results** — iterates the async response, emitting `stream.message`, `stream.partial`, `trace.step`, and `trace.update` events to the renderer
11. **Handle permissions** — tool calls requiring approval emit `permission.request` events; the UI response resolves a pending Promise
12. **Handle questions** — `AskUserQuestion` tool calls emit `question.request` events with the same pattern
13. **Post-run sync** — if sandbox isolation was active, files are synced back from the VM

**Key helpers:**
- `getAvailableSkillsPrompt()` — scans 3 tiers of skill directories (builtin → global → project) and formats them for the system prompt
- `getMCPToolsPrompt()` — groups MCP tools by server and generates usage instructions
- `getCredentialsPrompt()` — formats saved credentials for automated login (passwords are passed directly to the agent)
- `redactSensitiveText()` (`src/main/claude/redaction.ts`) — strips API keys and tokens from log output

### OpenAIResponsesRunner

**File:** `src/main/openai/responses-runner.ts`

Alternative runner for OpenAI-compatible APIs. Supports two modes:

- **responses** — uses OpenAI's Responses API with tool definitions
- **chat** — uses standard Chat Completions API

Tool calls are parsed from OpenAI's function calling format and translated into the app's `ToolUseContent`/`ToolResultContent` types. Permissions are handled identically to the Claude runner.

---

## Session Lifecycle

**File:** `src/main/session/session-manager.ts`

```
User sends message
        │
        ▼
  startSession() or continueSession()
        │
        ▼
  createSession() ──► Save to SQLite
        │
        ▼
  enqueuePrompt()
        │
        ▼
  ensureSandboxInitialized()
        │
        ▼
  processFileAttachments() ──► Copy files to .tmp/, sync to sandbox
        │
        ▼
  agentRunner.run()
        │
        ├──► stream.message events ──► UI updates
        ├──► trace.step events ──► Trace panel
        ├──► permission.request ──► PermissionDialog
        ├──► question.request ──► Question UI
        │
        ▼
  Session status: idle
        │
        ▼
  maybeGenerateSessionTitle() ──► Auto-title after first exchange
```

Sessions are persisted in SQLite. Each session stores:
- `id`, `title`, `status` (idle/running/completed/error)
- `cwd` — working directory on the host
- `mountedPaths` — virtual-to-real path mappings
- `allowedTools` — whitelist of tools the session can use
- `memoryEnabled` — whether memory is active

The default allowed tools are: `askuserquestion`, `todowrite`, `todoread`, `webfetch`, `websearch`, `read`, `write`, `edit`, `list_directory`, `glob`, `grep`.

---

## IPC Communication

### Event Flow

All IPC goes through two channels:
- **`client-event`** — renderer → main (via `ipcRenderer.send`)
- **`client-invoke`** — renderer → main (via `ipcRenderer.invoke`, returns a value)
- **`server-event`** — main → renderer (via `webContents.send`)

### Event Taxonomy

| Namespace | Direction | Examples |
|-----------|-----------|---------|
| `session.*` | Client → Main | `session.start`, `session.continue`, `session.stop`, `session.delete`, `session.list` |
| `stream.*` | Main → Client | `stream.message`, `stream.partial` |
| `trace.*` | Main → Client | `trace.step`, `trace.update` |
| `permission.*` | Bidirectional | `permission.request` (→ client), `permission.response` (→ main) |
| `question.*` | Bidirectional | `question.request` (→ client), `question.response` (→ main) |
| `config.*` | Both | `config.status`, `config.save` |
| `sandbox.*` | Main → Client | `sandbox.sync`, `sandbox.progress` |
| `remote.*` | Both | `remote.getStatus`, `remote.setEnabled`, `remote.getPairedUsers` |
| `error` | Main → Client | General error messages |

### Preload Bridge

`src/preload/index.ts` exposes `window.electronAPI` with namespaced methods:

- `config.get()`, `config.save()`, `config.test()`, `config.isConfigured()`
- `window.minimize()`, `window.maximize()`, `window.close()`
- `mcp.*` — MCP server management
- `credentials.*` — credential CRUD
- `skills.*` — skill management
- `plugins.*` — plugin system (V2)
- `sandbox.*` — sandbox status and setup
- `logs.*` — log retrieval
- `remote.*` — remote control

### Client-Side State

**File:** `src/renderer/store/index.ts`

Zustand store (~426 lines) holds all client-side state:
- Sessions list and active session ID
- Messages per session (with partial message streaming)
- Trace steps with pending turn management
- Permission and question dialog state
- UI toggles (sidebar collapse, context panel)
- Configuration and sandbox setup progress

---

## Sandbox System

**File:** `src/main/sandbox/sandbox-adapter.ts`

The sandbox provides execution isolation. Three modes exist:

| Mode | Platform | Technology | Isolation Level |
|------|----------|-----------|----------------|
| `wsl` | Windows | WSL2 | VM-level (Linux guest) |
| `lima` | macOS | Lima VM | VM-level (Ubuntu guest) |
| `native` | All | Path restrictions | Process-level only |

### Mode Selection

`SandboxAdapter.initialize()` selects the mode:

1. If `configStore.get('sandboxEnabled') === false` → native mode (this is the current default)
2. On Windows → tries WSL2, falls back to native
3. On macOS → tries Lima, falls back to native
4. On Linux → native mode

### WSL2 Bridge

**File:** `src/main/sandbox/wsl-bridge.ts`

- Detects WSL2 availability and distro
- Installs Node.js in WSL if missing
- Converts Windows paths ↔ WSL paths via `pathConverter`
- Executes commands via `wsl -d <distro> -e`
- `SandboxSync` (`src/main/sandbox/sandbox-sync.ts`) handles bidirectional file sync between host and WSL

### Lima Bridge

**File:** `src/main/sandbox/lima-bridge.ts`

- Detects Lima installation and `claude-sandbox` instance
- Creates/starts the VM if needed
- Executes commands via `limactl shell claude-sandbox --`
- `LimaSync` (`src/main/sandbox/lima-sync.ts`) handles file sync

### Path Resolution

**File:** `src/main/sandbox/path-resolver.ts`

Maps virtual paths (`/mnt/workspace`) to real host paths. Each session registers its own mount mappings. The agent runner also maintains a path whitelist allowing read access to skill directories outside the workspace.

---

## Plugin & Skill System

### Three-Tier Skill Resolution

`ClaudeAgentRunner.getAvailableSkillsPrompt()` scans skills from three locations, with later tiers overriding earlier ones:

1. **Built-in skills** — shipped with the app in `.claude/skills/` (highest read priority)
2. **Global skills** — in `app.getPath('userData')/claude/skills/` (user-installed)
3. **Project skills** — in `<workingDir>/.claude/skills/`, `<workingDir>/.skills/`, or `<workingDir>/skills/`

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: pptx
description: "PowerPoint generation skill..."
---
# Skill content (instructions for the agent)
```

Skills are injected into the system prompt as a formatted list. The agent reads the SKILL.md file at runtime using the Read tool before executing the workflow.

### V2 Plugin System

**Files:**
- `src/main/skills/plugin-runtime-service.ts` — main plugin runtime
- `src/main/skills/plugin-catalog-service.ts` — catalog browsing and download
- `src/main/skills/plugin-registry-store.ts` — persistence

Plugins are a superset of skills, supporting multiple component types:

| Component | Description |
|-----------|-------------|
| `skills` | Workflow definitions (SKILL.md files) |
| `commands` | CLI-like commands |
| `agents` | Standalone agent definitions |
| `hooks` | Event hooks |
| `mcp` | MCP server definitions |

**Plugin manifest** (`package.json` in plugin root):

```typescript
interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  mcpServers?: string | Record<string, unknown>;
}
```

**Plugin lifecycle:**
1. `listCatalog()` — fetches available plugins from Anthropic's registry
2. `install(pluginName)` — downloads to temp dir, validates manifest, copies to app data, registers in store
3. `toggleComponent(pluginName, kind, enabled)` — enables/disables individual component types
4. `getEnabledRuntimePlugins()` — returns plugins with enabled components for SDK injection

### Legacy Skills Manager

**File:** `src/main/skills/skills-manager.ts`

The older skills management system. Handles custom skill installation (copy to `~/.claude/skills/`), enable/disable toggling, and skill folder validation. Coexists with the V2 plugin system.

---

## MCP Integration

**File:** `src/main/mcp/mcp-manager.ts`

MCP (Model Context Protocol) allows the app to connect to external tool servers.

### Server Types

| Type | Transport | Example |
|------|-----------|---------|
| `stdio` | Child process (stdin/stdout) | Chrome browser control, GUI operations |
| `sse` | HTTP Server-Sent Events | Remote API endpoints |

### Server Lifecycle

1. **Configuration** stored in `MCPConfigStore` (`src/main/mcp/mcp-config-store.ts`) as YAML
2. **Initialization** — `MCPManager.initializeServers()` connects to all enabled servers
3. **Connection** — creates MCP `Client` with appropriate transport (StdioClientTransport or SSEClientTransport)
4. **Tool discovery** — `refreshTools()` queries each server for available tools
5. **Tool injection** — tools are formatted into the system prompt and passed to the SDK's `mcpServers` option
6. **Tool execution** — the SDK routes `mcp__<ServerName>__<toolName>` calls directly to the MCP server

### Bundled Node.js

For `stdio` servers that need `npx` or `node`, the app uses bundled Node.js from `resources/node/<platform>-<arch>/` rather than the system Node.js. This ensures MCP servers work reliably in packaged builds where the system PATH may be limited.

### Built-in MCP Servers

- `gui-operate-server.ts` — GUI automation via screen capture and interaction
- `software-dev-server-example.ts` — software development helpers

---

## Remote Control

**File:** `src/main/remote/remote-manager.ts`

The remote control system allows external channels (like chat bots) to interact with Open Cowork sessions.

### Architecture

```
External Channel (Feishu Bot)
        │
        ▼
  RemoteGateway ◄──── Ngrok Tunnel (public URL)
        │
        ▼
  MessageRouter
        │
        ▼
  AgentExecutor (SessionManager)
        │
        ▼
  Response Buffer ──► External Channel
```

### Components

- **RemoteGateway** (`src/main/remote/gateway.ts`) — HTTP server receiving webhook requests
- **TunnelManager** (`src/main/remote/tunnel-manager.ts`) — manages ngrok tunnel for public URL exposure
- **MessageRouter** (`src/main/remote/message-router.ts`) — routes incoming messages to agent sessions
- **FeishuChannel** (`src/main/remote/channels/feishu.ts`) — Lark/Feishu bot integration with token authentication
- **RemoteConfigStore** (`src/main/remote/remote-config-store.ts`) — persists remote control settings

### Session Mapping

Remote sessions use a dual-ID system:
- **Remote session ID** — identifier used by the external channel
- **Actual session ID** — internal UUID matching a local session

`sessionIdMapping` and `reverseSessionIdMapping` maintain bidirectional lookups. `sessionChannelMapping` tracks which channel originated each session for response routing.

### Response Buffering

To avoid spamming external channels, responses are collected in `responseBuffers` with debounced sending. Message deduplication uses `sentMessageHashes`.

### User Pairing

External users must be approved before they can use the agent:
1. User sends a message via the channel
2. A `PairingRequest` is created and shown in the UI
3. The local user approves or rejects
4. Approved users become `PairedUser` entries

---

## Database

**File:** `src/main/db/database.ts`

SQLite via `better-sqlite3` (synchronous, no async overhead). Database location: `app.getPath('userData')/database.db`.

### Schema

**sessions**
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `title` | TEXT | Session title |
| `claude_session_id` | TEXT | SDK session ID for resume |
| `status` | TEXT | idle/running/completed/error |
| `cwd` | TEXT | Working directory |
| `mounted_paths` | TEXT | JSON array of {virtual, real} |
| `allowed_tools` | TEXT | JSON array of tool names |
| `memory_enabled` | INTEGER | 0 or 1 |
| `created_at` | INTEGER | Unix timestamp |
| `updated_at` | INTEGER | Unix timestamp |

**messages**
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | Session reference |
| `role` | TEXT | user/assistant/system |
| `content` | TEXT | JSON array of ContentBlock |
| `timestamp` | INTEGER | Unix timestamp |
| `token_usage` | TEXT | JSON {input, output} |

**trace_steps**
| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK | Session reference |
| `type` | TEXT | thinking/text/tool_call/tool_result |
| `status` | TEXT | pending/running/completed/error |
| `title` | TEXT | Display title |
| `content` | TEXT | Content body |
| `tool_name` | TEXT | Tool name (for tool_call) |
| `tool_input` | TEXT | JSON input (for tool_call) |
| `tool_output` | TEXT | Output text (for tool_result) |
| `is_error` | INTEGER | Error flag |
| `timestamp` | INTEGER | Unix timestamp |

---

## Memory Management

**File:** `src/main/memory/memory-manager.ts`

Handles message history retrieval and context window management.

### Context Strategies

| Strategy | Behavior |
|----------|----------|
| `full` | All messages included (if under token limit) |
| `compressed` | Older messages summarized, recent messages kept in full |
| `rolling` | Only the last N messages included |

Token estimation uses the approximation of 4 characters per token. Default max context: 180,000 tokens.

Message search uses simple text matching against content blocks (FTS5 is noted as a future optimization).

---

## Configuration

**File:** `src/main/config/config-store.ts`

Uses `electron-store` for persistent JSON config at `app.getPath('userData')/config.json`.

### Key Configuration Fields

```typescript
interface AppConfig {
  provider: 'openrouter' | 'anthropic' | 'custom' | 'openai';
  apiKey: string;
  baseUrl?: string;
  customProtocol?: 'anthropic' | 'openai';
  model: string;
  openaiMode: 'responses' | 'chat';
  claudeCodePath?: string;
  enableThinking: boolean;
  enableDevLogs: boolean;
  sandboxEnabled: boolean;
}
```

### Environment Variable Mapping

`getClaudeEnvOverrides()` (`src/main/claude/claude-env.ts`) maps config fields to environment variables:

| Config Field | Environment Variable |
|---|---|
| `apiKey` | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| `baseUrl` | `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` |
| `model` | `ANTHROPIC_DEFAULT_SONNET_MODEL` / `CLAUDE_MODEL` / `OPENAI_MODEL` |

### API Testing

`ApiTester` (`src/main/config/api-tester.ts`) validates connectivity by making a minimal API call with the configured credentials, testing both Anthropic and OpenAI protocols.

---

## Key Type Definitions

**File:** `src/renderer/types/index.ts`

Core types shared across the application:

- **`Session`** — id, title, status, cwd, mountedPaths, allowedTools, memoryEnabled
- **`Message`** — id, sessionId, role (user/assistant/system), content (ContentBlock[]), timestamp, tokenUsage
- **`ContentBlock`** — union of TextContent, ImageContent, FileAttachmentContent, ToolUseContent, ToolResultContent, ThinkingContent
- **`TraceStep`** — id, type (thinking/text/tool_call/tool_result), status, title, content, toolName, toolInput, toolOutput
- **`SessionStatus`** — `'idle' | 'running' | 'completed' | 'error'`

---

## Credentials

**File:** `src/main/credentials/credentials-store.ts`

Stores user credentials (email, website, API, other) for automated login via the agent. Credentials are organized by type and service, with full passwords stored (passed directly to the agent in the system prompt). The UI never displays passwords directly.

---

## Logging

**File:** `src/main/utils/logger.ts`

Three-level logging (info, warn, error) with:
- Console output
- File-based persistent logs
- Dev logs toggleable via `enableDevLogs` config
- Log export as ZIP archive with system info
