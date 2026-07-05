## Vision

Open Cowork currently wraps the Claude Agent SDK as a single-session, single-turn desktop chat app. To evolve into a **true agent platform**, we need five foundational capabilities that the app currently lacks or only partially implements.

This issue is the master roadmap. Each section includes: current state (what exists today), gap (what's missing), technical approach, and dependencies.

---

## Dependency Graph

```
   0. Headless / CLI ─────────────────────────────────────────┐
        │  (enables automated testing of everything below)    │
        ├──────────────────┐                                  │
        ▼                  ▼                                  │
   1. Config 文件化    (all features become testable           │
        │              without manual GUI interaction)        │
        ├──────────────────┐                                  │
        ▼                  ▼                                  │
   2. Subagent        4. Reactive Polling                     │
   (needs config       (condition config                      │
    access for          needs file-based                      │
    model routing)      persistence)                          │
        │                                                     │
        ▼                                                     │
   3. Compact 增强                                            │
   (subagent multiplies context pressure;                     │
    also standalone value)                                    │
```

**Suggested order**: `0 → 1 → 2 → 3 → 4` (0 is foundational infrastructure; 1 is prerequisite for 2+4; 3 benefits from 2 but can start independently)

---

## 0. Headless / CLI Mode — Run Without GUI

### Current State

The codebase is **already highly decoupled from Electron GUI**, with three independent proofs:

1. **Test suite** (`vitest`): `tests/mocks/electron.ts` shims `app.getPath`, `BrowserWindow`, `dialog`, `ipcMain`. The entire core (`SessionManager`, `ConfigStore`, `MCPManager`, `MemoryService`) runs under plain Node in CI — every commit validates "core works without Electron."

2. **Remote system** (Feishu/Slack): `RemoteGateway` (`remote/gateway.ts`) is a pure-Node `http.Server` + `ws.WebSocketServer` (zero Electron imports). It already handles the full session lifecycle without GUI, including permission flow (5-minute timeout → default deny).

3. **`ClaudeAgentRunner`** has zero GUI dependency. It's constructed with 4 plain callbacks (`sendToRenderer`, `saveMessage`, `requestPermission`, `requestSudoPassword`). Swap them for stdio equivalents and the entire engine runs unmodified.

Additionally, `handleClientEvent()` in `index.ts:2662-2807` is already a pure, GUI-agnostic dispatcher — it takes `ClientEvent` unions and calls straight into `SessionManager`. Only 3 of ~15 cases touch `dialog`/`mainWindow`.

### Gap

- No CLI entry point (`package.json` has no `bin` field)
- No way to send a prompt without the Electron GUI
- No programmatic/scriptable interface for testing or automation
- No JSONL/streaming output mode for tool integration

### Why This is Foundational

- **Enables Claude Code (or any external agent) to drive Open Cowork programmatically** — for testing, validation, and agent-to-agent workflows
- **Unblocks CI-level integration testing** of agent behavior, not just unit tests
- **Makes every other roadmap item testable** without manual GUI interaction

### Technical Approach

**Phase 1: `--headless` flag (Option A — fastest, ~3-4 days)**

Still uses the real Electron binary, so `app.getPath()`, `better-sqlite3` native module, and sandbox adapters all work unchanged.

```
electron . --headless -p "prompt" --cwd /path
electron . --headless --mode json    # JSONL event stream (like pi --mode json)
electron . --headless --mode rpc     # stdin/stdout bidirectional (like pi --mode rpc)
```

Changes needed:

- `src/main/index.ts`: detect `--headless` flag, skip `createWindow()`/`buildMacMenu()`/`setupTray()`/`autoUpdater`/`startNavServer()`
- New `src/main/cli/headless-io.ts`: replace `sendToRenderer` with JSONL stdout writer; read `ClientEvent`s from stdin
- Permission policy: `--auto-approve` flag → all tools allowed; `--permission-policy <file>` → load rules from JSON; default → deny with log
- Process lifecycle: exit after prompt completes (single-shot mode) or keep running (RPC mode)

**Phase 2: `StdioChannel` for Remote (Option B — ~2 days)**

A new `IChannel` implementation (~150-250 lines, like `slack-channel.ts`) that plugs into `RemoteManager`/`MessageRouter`. Gets session mapping, permission handling, and response buffering for free. Best for "another agent drives it like a chatbot."

**Phase 3: Standalone Node package (Option C — longer term)**

Extract core into a package that works without the Electron binary at all (for Docker/CI without X11):

- Production-harden `tests/mocks/electron.ts` shim → real OS-appropriate paths
- Rebuild `better-sqlite3` for target Node ABI (currently rebuilt for Electron's ABI)
- Patch ~5 ungated `app.getPath()` calls to use try/fallback pattern (already used by `logger.ts` and `store-encryption.ts`)

### `electron-store` in headless

- **With Electron binary (Phase 1)**: works unchanged, zero risk
- **Without Electron (Phase 3)**: needs explicit `cwd` option or `electron` shim. Test suite already validates this path continuously.

### Usage Examples

```bash
# Single-shot: send prompt, get result, exit
open-cowork --headless -p "list all files in src/" --cwd ~/project

# JSONL streaming: pipe events for processing
open-cowork --headless --mode json -p "refactor this function" | jq '.type'

# RPC mode: bidirectional, for agent-to-agent
open-cowork --headless --mode rpc

# Auto-approve all tool calls (for trusted automation)
open-cowork --headless --auto-approve -p "fix the failing tests"

# Claude Code integration test
echo '{"type":"session.start","prompt":"what model are you?"}' | open-cowork --headless --mode rpc
```

### Estimated Scope

- Phase 1 (`--headless`): ~3-4 days
- Phase 2 (`StdioChannel`): ~2 days
- Phase 3 (standalone Node): ~1-2 weeks

---

## 1. Config 文件化 — Agent-Accessible Configuration

### Current State

- **Main config** (`config-store.ts`): 21 fields in `AppConfig`, encrypted via AES-256-CBC (`store-encryption.ts`). Key derived from `hostname + hardcoded seed` — obfuscation, not real security.
- **Unencrypted stores**: `mcp-config.json` (MCP server definitions), `plugin-registry.json` (installed plugins). These are already plaintext JSON on disk.
- **Encrypted stores**: `remote-config.json` (Feishu/Telegram/Slack secrets — correctly encrypted).
- **Agent awareness**: The agent knows **nothing** about its own config. No `model`, `contextWindow`, `provider`, or `memoryEnabled` in the system prompt. No config read/write tools exposed.

### Gap

1. Agent cannot read its own configuration (model, context window, available capabilities)
2. Agent cannot modify configuration (switch model, add MCP server, adjust settings)
3. No human-readable config file for version control or manual editing
4. Config is only editable through GUI

### Technical Approach

**Phase 1: Agent config awareness (read-only)**

- Inject key non-sensitive config into system prompt: `model`, `contextWindow`, `maxTokens`, `provider`, `sandboxEnabled`, `memoryEnabled`, `enableThinking`
- Expose a `config_read` custom tool via a new `ConfigExtension` (same pattern as `MemoryExtension`)

**Phase 2: Config file export/import**

- Split `AppConfig` by sensitivity:
  - **Safe to file-ize**: `defaultWorkdir`, `globalSkillsPath`, `theme`, `enableDevLogs`, `sandboxEnabled`, `enableThinking`, `memoryEnabled`, non-secret parts of `memoryRuntime`
  - **Must stay encrypted**: all `apiKey` fields (top-level, `profiles[*]`, `configSets[*].profiles[*]`, `memoryRuntime.llm/embedding.apiKey`), MCP `env`/`headers` with tokens, all remote channel secrets
- Add `ConfigStore.exportSafe()` / `ConfigStore.importSafe()` using existing `normalizeConfig()` validation
- File format: JSON or YAML in userData directory
- GUI ↔ file bidirectional sync with file watcher

**Phase 3: Agent config write**

- Expose `config_write` tool for non-sensitive fields only
- Permission-gated (always-ask) for safety
- Enables agent self-configuration: switch model mid-task, toggle thinking, add MCP servers

### Security Considerations

- API keys must NEVER appear in plaintext config files
- Note: `mcp-config.json` already stores tokens in `env`/`headers` unencrypted — this is a pre-existing latent risk to address separately
- `config_write` tool must have an explicit blocklist of sensitive fields

### Estimated Scope

- Phase 1: ~1 day (system prompt injection + read tool)
- Phase 2: ~2-3 days (export/import + file sync + migration)
- Phase 3: ~1-2 days (write tool + permission integration)

---

## 2. Subagent — Parallel Child Agent Execution

### Current State

- `createAgentSession()` is called from exactly **one place** (`agent-runner.ts:2244`). No multi-session orchestration.
- The SDK has a complete subagent extension example (`examples/extensions/subagent/`) supporting single, parallel (max 8, 4 concurrent), and chain modes — but this is a CLI extension, not wired into Open Cowork.
- The project's `AgentRuntimeExtension` interface supports injecting custom tools via `beforeSessionRun() → { customTools }` — this is the clean integration point.
- `AgentSession` API supports full programmatic control: `.prompt()`, `.subscribe()`, `.abort()`, `.dispose()`, `.getContextUsage()`.

### Gap

- No ability to spawn child agents from within a conversation
- No parallel task execution
- No context isolation (one long conversation = one ballooning context)

### Technical Approach

**Architecture: in-process sessions (not subprocess)**

The SDK's example spawns a `pi` CLI process, but Open Cowork should use in-process `createAgentSession()` because:

- No dependency on `pi` binary being on PATH
- Reuses existing `authStorage` / `modelRegistry` already constructed in `agent-runner.ts`
- Tighter integration with MCP, sandbox, and permission systems
- Lower overhead than process spawning

**Implementation:**

```
src/main/subagent/
├── subagent-extension.ts     # AgentRuntimeExtension, injects `subagent` tool
├── subagent-executor.ts      # Creates/manages child AgentSessions
├── subagent-tool.ts          # ToolDefinition: params, execute(), streaming
└── agent-definitions.ts      # Agent discovery from .md frontmatter files
```

1. **`SubagentExtension`** implements `AgentRuntimeExtension`:
   - `beforeSessionRun()` returns `{ customTools: [subagentToolDefinition] }`
   - Register alongside `MemoryExtension` in `src/main/index.ts:839`

2. **`subagent` tool** accepts:

   ```
   { agent?: string, task: string, mode: "single" | "parallel" | "chain" }
   ```

   - `single`: one child session, returns result text
   - `parallel`: array of tasks, concurrent execution (configurable limit)
   - `chain`: sequential, each step receives previous result

3. **Child session lifecycle**:
   - `createAgentSession({ sessionManager: inMemory(), model, tools: <subset>, cwd })`
   - Subscribe to events for progress streaming to parent
   - `AbortSignal` propagation from parent → child
   - `.dispose()` on completion
   - Token usage aggregation (child usage reported back to parent's UI)

4. **Agent definitions** (Phase 2):
   - Discover from `~/.opencowork/agents/*.md` (user) and `.opencowork/agents/*.md` (project)
   - Frontmatter: `name`, `description`, `model`, `tools`, body = system prompt
   - Security: project-local agents require confirmation (untrusted prompts)

### Key Decisions Needed

- [ ] Should child agents share parent's MCP connections or get their own?
- [ ] Should child agents have access to the `subagent` tool themselves (recursive)?
- [ ] How to display child agent progress in the UI? (inline trace? separate panel?)
- [ ] Concurrency limit (SDK example uses 4 concurrent, 8 max)

### Estimated Scope

- MVP (single mode only): ~3-4 days
- Full (parallel + chain + agent discovery): ~1-2 weeks

---

## 3. Compact 增强 — Beyond SDK Auto-Compaction

### Current State

- **SDK auto-compaction exists and works**: triggers at `contextTokens > contextWindow - reserveTokens`, uses LLM to summarize discarded messages, keeps recent messages verbatim.
- **App tuning**: Ollama-specific overrides (disabled <16k ctx, scaled 16-64k, SDK defaults otherwise).
- **UI surface**: `auto_compaction_start/end` events → trace step showing "Compacting context..." status.
- **What the app DOESN'T use** (but the SDK already provides):
  - `AgentSession.compact(customInstructions?)` — manual trigger, never called
  - `auto_compaction_end.result` — contains full `CompactionResult` (summary, kept/discarded boundary, file lists), but the app **discards it** (only reads pass/fail status)
  - `session_before_compact` extension hook — can cancel compaction or supply a completely custom summary, never registered
  - `session_compact` extension hook — post-compaction notification, never registered
  - `AgentSession.getContextUsage()` — returns `{ tokens, contextWindow, percent }`, never called
- **Dead code**: `MemoryManager.manageContext()` / `compressContext()` / `generateSummary()` in `memory-manager.ts` — fully implemented placeholder never wired in.

### Gap

1. No manual `/compact` trigger for users
2. No custom summarization strategy (can't say "preserve decisions, discard tool output")
3. No compact result visibility (user can't see what was discarded or read the summary)
4. No selective retention (all-or-nothing based on token count)
5. SDK extension hooks (`session_before_compact`) unused
6. `MemoryManager` context compression code is dead/abandoned

### Technical Approach

**Phase 1: Surface what the SDK already provides** (~2 days)

- Wire `AgentSession.compact()` to a UI button and/or `/compact` command
- Read `auto_compaction_end.result` and display the summary + file lists in a collapsible trace step
- Call `AgentSession.getContextUsage()` periodically and surface in ContextPanel (more accurate than current message-level aggregation)
- Show pre/post token counts after compaction

**Phase 2: Custom compaction strategy via extension hooks** (~3-4 days)

- Register an extension (via `DefaultResourceLoader`'s `extensionFactories`) to hook `session_before_compact`
- Implement a custom summarizer that:
  - Preserves key decisions and architectural context
  - Aggressively truncates/drops verbose tool outputs (file contents, command output)
  - Keeps the most recent N tool results verbatim (configurable)
  - Merges with previous summary incrementally (the SDK already supports this pattern)
- Allow `customInstructions` to be set per-session or globally (e.g., "focus on code changes, ignore test output")

**Phase 3: Compact UI/UX** (~3-4 days)

- "Context Usage" panel showing real-time token budget with projected turns remaining
- Compaction history: list of past compactions with summaries, expandable
- Pre-compaction preview: show what WILL be discarded before confirming manual compaction
- Settings: compaction threshold, retention strategy, custom instructions

### SDK Hook Integration Detail

```typescript
// Via DefaultResourceLoader's extensionFactories
resourceLoader = new DefaultResourceLoader({
  extensionFactories: [
    (api) => {
      api.on('session_before_compact', async (event) => {
        // Option A: Let SDK compact but with custom instructions
        // return {};

        // Option B: Provide entirely custom summary
        const customSummary = await ourCustomSummarizer(event.preparation);
        return {
          compaction: {
            summary: customSummary,
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
          },
        };

        // Option C: Cancel compaction (e.g., if user hasn't approved)
        // return { cancel: true };
      });
      api.on('session_compact', (event) => {
        // Post-compaction: store summary, notify UI, update history
      });
    },
  ],
});
```

### SDK Compaction Algorithm (for reference)

The SDK's `compact()` in `core/compaction/compaction.js`:

1. `shouldCompact()` — triggers when `contextTokens > contextWindow - reserveTokens`
2. `prepareCompaction()` — finds cut point (walks backward keeping `keepRecentTokens`), never splits a tool_call/tool_result pair
3. `generateSummary()` — LLM call with structured template (Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context), with an UPDATE variant for incremental merges
4. Returns `CompactionResult { summary, firstKeptEntryId, tokensBefore, details: { readFiles, modifiedFiles } }`

Default settings: `reserveTokens: 16384`, `keepRecentTokens: 20000`

### Estimated Scope

- Phase 1 (surface existing): ~2 days
- Phase 2 (custom strategy): ~3-4 days
- Phase 3 (UI/UX): ~3-4 days

---

## 4. Reactive Polling — Condition-Based Agent Triggering

### Current State

- **ScheduledTaskManager** exists: full cron-like system with one-shot, interval, daily, weekly schedules.
- Uses `setTimeout` per task (not a polling loop). Triggers `sessionManager.startSession(prompt, cwd)` — always a brand new agent session.
- **Schema**: `ScheduledTask` = `{ id, title, prompt, cwd, runAt, nextRunAt, scheduleConfig, repeatEvery, repeatUnit, enabled, lastRunAt, lastRunSessionId, lastError }`.
- **UI**: `SettingsSchedule.tsx` — form + list in Settings tab.

### Gap

The current scheduler is **fire-and-forget at time T**. It has:

- No condition evaluation before firing
- No state persistence for diffing (last seen state, hash, ETag)
- No "check vs act" separation (every trigger = unconditional new agent session)
- No lightweight non-LLM checks (HTTP status, file hash, command exit code)

### Technical Approach

**Extend the existing scheduler, don't build a parallel system.**

The timer engine, SQLite persistence, IPC CRUD, and Settings UI shell are all reusable. The delta is a new execution model layered on top.

**New concept: `WatchTask` (extends `ScheduledTask`)**

```typescript
interface WatchTask extends ScheduledTask {
  watchConfig: {
    checkType: 'http' | 'command' | 'file' | 'agent';
    // 'http': GET a URL, compare response hash/status/body-selector
    // 'command': run a shell command, compare exit code + stdout hash
    // 'file': watch file mtime/hash
    // 'agent': ask an agent to check (expensive, but most flexible)
    checkConfig: HttpCheckConfig | CommandCheckConfig | FileCheckConfig | AgentCheckConfig;
    compareMode: 'hash' | 'status' | 'jsonpath' | 'regex';
    lastState?: string; // serialized last-observed state for diffing
    lastCheckedAt?: number;
    consecutiveUnchanged?: number;
  };
}
```

**Execution flow change:**

```
Current:  timer fires → executeTask() → always startSession()
New:      timer fires → checkCondition() → changed? → yes: startSession()
                                                    → no:  update lastState, reschedule
```

**Phase 1: Infrastructure** (~3-4 days)

- Extend `scheduled_tasks` SQLite schema with `watch_config` JSON column, `last_state`, `last_checked_at`
- Add `checkCondition()` to `ScheduledTaskManager` with `http` and `command` check types
- Split `handleTrigger()` into check → act pipeline

**Phase 2: Agent-driven checks** (~2 days)

- `checkType: 'agent'` spawns a lightweight agent session with a check-only prompt
- Agent returns structured `{ changed: boolean, summary: string }`
- More expensive but handles complex conditions ("has the PR been merged?", "are there new errors in the log?")

**Phase 3: UI** (~2 days)

- New task "kind" toggle in `SettingsSchedule.tsx`: Schedule vs. Watch
- Watch-specific fields: what to check, how to compare, check interval
- Status display: "Last checked: 5m ago (unchanged)" vs. "Last triggered: 2h ago (change detected)"

### Estimated Scope

- Phase 1 (http + command checks): ~3-4 days
- Phase 2 (agent-driven checks): ~2 days (leverages subagent infrastructure from #2)
- Phase 3 (UI): ~2 days

---

## Summary Table

| #   | Capability       | Phases | Total Estimate | Dependencies                             |
| --- | ---------------- | ------ | -------------- | ---------------------------------------- |
| 0   | Headless / CLI   | 3      | ~1-2 weeks     | None (foundational)                      |
| 1   | Config 文件化    | 3      | ~4-6 days      | Headless enables testing                 |
| 2   | Subagent         | 2      | ~1-2 weeks     | Config (#1 P1 for model routing)         |
| 3   | Compact 增强     | 3      | ~1-1.5 weeks   | Independent, benefits from Subagent      |
| 4   | Reactive Polling | 3      | ~1-1.5 weeks   | Config (#1), benefits from Subagent (#2) |

---

## Open Questions

- [ ] Config file format preference: JSON (consistent with existing stores) vs. YAML (more human-friendly)?
- [ ] Subagent UI: inline expansion in chat vs. separate panel vs. both?
- [ ] Should compact custom instructions be per-session, per-workspace, or global?
- [ ] Polling check interval minimum (to prevent abuse / runaway costs)?
- [ ] Headless mode: should `--headless` be the Electron binary or a separate `open-cowork-cli` package?
- [ ] Should these be separate issues or tracked as sub-tasks of this roadmap?

---

## References

- SDK subagent example: `node_modules/@mariozechner/pi-coding-agent/examples/extensions/subagent/`
- SDK compaction internals: `node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/`
- hermes-agent 4-phase compaction (external reference): `NousResearch/hermes-agent` `agent/context_compressor.py`
- Current extension pattern: `src/main/memory/memory-extension.ts` + `src/main/extensions/agent-runtime-extension-manager.ts`
- Electron shim (headless proof): `tests/mocks/electron.ts` + `vitest.config.mts:10-12`
- Remote gateway (headless session handling): `src/main/remote/gateway.ts` + `remote-manager.ts`
- pi CLI headless modes: `node_modules/@mariozechner/pi-coding-agent/docs/{json,rpc,sdk}.md`
