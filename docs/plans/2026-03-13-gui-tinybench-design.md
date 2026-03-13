# GUI TinyBench Design

Date: 2026-03-13
Branch: `feat/gui-tinybench` (based on `dev`)

## Goal

Build a lightweight end-to-end benchmark for GUI automation tools in open-cowork.
Uses Pi Agent SDK + MCP Tool chain — any model can drive GUI operations through
standard `tool_use`, no vendor-specific protocol required.

## Architecture

```
TinyBench Runner (tinybench-runner.ts)
  │
  ├── Pi Agent SDK (pi-coding-agent)
  │     ├── model: configurable (gpt-5.4 / claude / qwen)
  │     ├── system prompt: GUI operation instructions
  │     └── customTools: gui-operate MCP tools (bridged)
  │
  ├── gui-operate-server (MCP, existing)
  │     ├── screenshot_for_display
  │     ├── click / type_text / key_press / scroll / drag
  │     ├── move_mouse / wait / get_displays
  │     └── gui_locate_element / gui_verify_vision
  │
  └── TinyBench Evaluator
        ├── text assertion (model final text contains expected)
        ├── filesystem check (file/folder exists)
        └── manual review (screenshot artifacts)
```

## Key Design Decisions

1. **Pi SDK + MCP Tool chain** — GUI tools are standard MCP tools exposed via
   `buildMcpCustomTools()`. No OpenAI `computer_call` protocol needed.
2. **Model-agnostic** — GPT-5.4 as baseline, but any model works.
3. **Reuse existing infrastructure** — gui-operate-server already has 18 tools.
   agent-runner.ts already bridges MCP tools to Pi SDK.
4. **Standalone runner** — TinyBench runs independently, not through the chat UI.

## File Structure

```
src/main/cua/
  ├── tinybench-runner.ts      # Core: run GUI tasks via Pi SDK
  ├── tinybench-tasks.ts       # Task definitions
  ├── tinybench-evaluator.ts   # Result evaluation
  ├── tinybench-report.ts      # Report generation
  └── types.ts                 # Type definitions
scripts/
  └── run-tinybench.mjs        # CLI entry point
tests/
  └── tinybench-*.test.ts      # Unit tests
```

## Task Definitions

| Task ID | Description | Verification |
|---------|-------------|-------------|
| `calc-add-2-3` | Open Calculator, compute 2+3 | Final text contains "5" |
| `calc-chain-12-34` | Calculator: 12+34 | Final text contains "46" |
| `textedit-hello` | Type text in TextEdit | Manual review / OCR |
| `finder-new-folder` | Create folder in Finder | Filesystem check |

## Runner Flow

1. Start gui-operate MCP server (stdio transport)
2. Bridge as Pi SDK customTools via `buildMcpCustomTools()`
3. Build system prompt with GUI operation instructions
4. Call Pi SDK `AgentSession.run(taskPrompt)`
5. SDK auto-loops: model → tool_use(screenshot) → model sees image → tool_use(click) → ...
6. Collect metrics: steps, tokens, duration, final text
7. Evaluate: pass/fail + failure categorization
8. Output report (JSON + human-readable summary)

## CLI Interface

```bash
# Single task
node scripts/run-tinybench.mjs --task calc-add-2-3 --model gpt-5.4

# Suite
node scripts/run-tinybench.mjs --suite smoke --model gpt-5.4

# With repeats for statistical significance
node scripts/run-tinybench.mjs --suite smoke --model gpt-5.4 --repeats 3

# Dry-run (screenshot only, no model call)
node scripts/run-tinybench.mjs --task calc-add-2-3 --dry-run-screenshot
```

## Report Output

```json
{
  "suiteId": "smoke",
  "model": "gpt-5.4",
  "tasks": [
    {
      "taskId": "calc-add-2-3",
      "passed": true,
      "steps": 4,
      "durationMs": 12340,
      "tokens": { "input": 5200, "output": 320 }
    }
  ],
  "summary": {
    "passRate": 1.0,
    "avgSteps": 4,
    "avgDurationMs": 12340,
    "totalTokens": 5520
  }
}
```

## System Prompt Design

The system prompt instructs the model to:
1. Use `screenshot_for_display` to observe the current screen state
2. Identify UI elements and plan the next action
3. Execute actions using click/type_text/key_press tools
4. Take another screenshot to verify the action worked
5. Repeat until the task is complete
6. Report the final result

## Comparison with Previous GUI Branch

| Dimension | Old GUI branch | New TinyBench |
|-----------|---------------|---------------|
| Model call | Direct `openai` SDK | Pi Agent SDK |
| Protocol | OpenAI `computer_call` | Standard `tool_use` |
| Model support | GPT-5.4 only | Any model |
| Tool bridge | Custom `McpComputerBackend` | Reuse `buildMcpCustomTools` |
| Code volume | ~2500 lines | ~800 lines estimated |
