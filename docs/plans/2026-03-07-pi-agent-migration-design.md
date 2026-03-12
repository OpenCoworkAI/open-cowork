# Design: Migrate to pi-coding-agent (Replace Claude Agent SDK + Python Proxy)

**Date**: 2026-03-07
**Status**: Approved

## Goal

Replace the current Claude Agent SDK + Python proxy architecture with `@mariozechner/pi-coding-agent`, enabling native multi-model support (20+ providers) through a single TypeScript runtime without any Python dependency.

## Current Architecture

```
User Message (Renderer)
    ↓ IPC
agent-runner.ts
    ↓
Claude Agent SDK query()
    ├─ Anthropic → Direct API call
    └─ OpenAI/Gemini/Other → Python Proxy (FastAPI + LiteLLM) → upstream API
```

**Problems:**
- Python proxy adds ~500ms cold-start latency + IPC overhead
- Two separate code paths (direct vs proxy) increase complexity
- Python runtime dependency complicates packaging and distribution
- Format conversion (Anthropic ↔ OpenAI) maintained manually in `server.py`

## New Architecture

```
User Message (Renderer)
    ↓ IPC
agent-runner.ts
    ↓
pi-coding-agent SDK
    createAgentSession() → session.prompt() → session.subscribe()
    ↓
pi-ai (Unified LLM Layer)
    ├─ anthropic → @anthropic-ai/sdk
    ├─ openai → openai SDK (+ Ollama/vLLM/LM Studio/Moonshot)
    ├─ google → @google/genai
    ├─ mistral → @mistralai/mistralai
    ├─ bedrock → @aws-sdk/client-bedrock-runtime
    ├─ groq, cerebras, xai, openrouter, etc.
    └─ Any OpenAI-compatible endpoint
```

**All models go through the same code path. No proxy. No Python.**

## What Gets Removed

| File/Module | Purpose | Replacement |
|-------------|---------|-------------|
| `@anthropic-ai/claude-agent-sdk` | Agent runtime (tool calls, multi-turn, streaming) | `@mariozechner/pi-coding-agent` |
| `vendor/claude-code-proxy/` | Python FastAPI server for format conversion | pi-ai native SDK routing |
| `src/main/proxy/claude-proxy-manager.ts` | Proxy process lifecycle management | Deleted entirely |
| `src/main/claude/unified-gateway-resolver.ts` | Provider routing decision | pi-ai auto-routes by provider field |
| `src/main/session/claude-unified-mode.ts` | SDK vs proxy decision logic | Deleted (single path now) |
| `src/main/claude/claude-env.ts` | Environment variable setup for providers | `AuthStorage.setRuntimeApiKey()` |

## What Gets Modified

### `src/main/claude/agent-runner.ts` (Major Rewrite)

**Before:**
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query(queryInput)) {
  // Parse SDK message format
  // Stream to renderer
}
```

**After:**
```typescript
import { createAgentSession, AuthStorage, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

const authStorage = AuthStorage.create(authJsonPath);
authStorage.setRuntimeApiKey(provider, apiKey); // From user's config

const model = getModel(provider, modelId); // e.g., getModel('openai', 'gpt-4.1-mini')

const { session } = await createAgentSession({
  model,
  thinkingLevel,
  authStorage,
  modelRegistry: new ModelRegistry(authStorage),
  tools: createCodingTools(sandboxPath),
  customTools: mcpTools,
  sessionManager: SessionManager.inMemory(),
  cwd: sandboxPath,
});

session.subscribe((event) => {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        // Stream text to renderer
      }
      break;
    case 'tool_execution_start':
      // Notify renderer: tool started
      break;
    case 'tool_execution_end':
      // Notify renderer: tool finished
      break;
    case 'agent_end':
      // Query complete
      break;
  }
});

await session.prompt(userMessage);
```

### Settings UI (Simplification)

- Remove `customProtocol` field (no longer needed)
- Remove "proxy required" indicators
- Provider dropdown maps directly to pi-ai provider names
- Model list can use `ModelRegistry.getAvailable()` for auto-discovery

### Config Store

- Provider/model config stays in our configStore
- At runtime, inject API keys into `AuthStorage.setRuntimeApiKey()`
- Model resolved via `getModel(provider, modelId)` or `modelRegistry.find(provider, modelId)`

## Key API Mapping

| Current (Agent SDK) | New (pi-coding-agent) |
|---------------------|----------------------|
| `query(input)` iterator | `session.prompt(text)` + `session.subscribe()` |
| SDK message types | `AgentSessionEvent` types |
| `canUseTool` callback | `tools` + `customTools` params |
| `env` vars for auth | `AuthStorage.setRuntimeApiKey()` |
| `model` string | `getModel(provider, modelId)` → `Model` object |
| `systemPrompt` option | `DefaultResourceLoader({ systemPromptOverride })` |
| `mcpServers` config | `customTools` (convert MCP to ToolDefinition) |
| `maxTurns` | Agent config (built-in) |

## Event Mapping

| Agent SDK Event | pi-coding-agent Event |
|----------------|----------------------|
| System init message | `agent_start` |
| Text streaming | `message_update` + `text_delta` |
| Tool use request | `tool_execution_start` |
| Tool result | `tool_execution_end` |
| Thinking output | `message_update` + `thinking_delta` |
| Final response | `agent_end` |
| Error | `message_update` + `error` event type |

## Migration Strategy

### Phase 1: Core Integration
1. Install `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`
2. Rewrite `agent-runner.ts` to use pi-coding-agent SDK
3. Map existing event types to renderer IPC protocol
4. Wire up AuthStorage with existing configStore API keys

### Phase 2: Cleanup
5. Remove Python proxy files and proxy manager
6. Remove unified-gateway-resolver and claude-unified-mode
7. Remove claude-env.ts
8. Uninstall `@anthropic-ai/claude-agent-sdk`

### Phase 3: UI Simplification
9. Simplify provider settings (remove proxy-related options)
10. Add model auto-discovery via ModelRegistry
11. Clean up i18n strings for removed concepts

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| pi-coding-agent update breaks us | Pin version, test before upgrading |
| Missing feature in pi-ai for niche provider | Fall back to custom OpenAI-compatible endpoint config |
| MCP tools don't map cleanly to ToolDefinition | Write adapter: MCP server → pi-coding-agent `customTools` |
| Session format incompatibility | Use `SessionManager.inMemory()`, manage our own persistence |

## Dependencies

```json
{
  "@mariozechner/pi-coding-agent": "^0.55.3",
  "@mariozechner/pi-ai": "^0.56.3"
}
```

These bring in as transitive deps: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai`, `@aws-sdk/client-bedrock-runtime`.
