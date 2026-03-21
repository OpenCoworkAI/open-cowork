# CUA Harness Iteration Report — 2026-03-21

## Session Overview
First standalone benchmark run session on Windows 11 (2400x1600, 150% DPI).
Total: 7 commits on `worktree-cua-harness` branch.

## Key Findings

### 1. Environment Issues Resolved
- **PowerShell AMSI blocks**: Inline P/Invoke scripts blocked by Windows Defender
  - **Fix**: Moved all automation to Python (mss + pyautogui)
- **ESM/CJS module incompatibility**: Pi SDK is ESM-only, project uses bundler moduleResolution
  - **Fix**: Created standalone `.mjs` runner that calls Ollama API directly (no Pi SDK)

### 2. Critical Bugs Found & Fixed
- **Win key locks screen**: `ctypes.keybd_event(VK_LWIN)` triggers Windows Hello lock on Win11 corporate
  - **Fix**: Blocked Win key entirely, added `launch_app` via `Start-Process`
- **Win+S opens Widgets**: On this Win11 build, Win+S opens Copilot/Widgets, not Search
  - **Fix**: `launch_app` replaces all keyboard-based app opening
- **Windows Search overlay not capturable**: `mss` shows black for secure compositor overlays
  - **Fix**: Bypass via `launch_app` (no overlay to capture)
- **Ollama tool messages don't support images**: `images` field in `role: "tool"` ignored
  - **Fix**: Screenshots sent as `role: "user"` messages with `images` field
- **qwen3.5:9b tool calling format unreliable**: Outputs coordinates as `"[374, 968]"` strings
  - **Fix**: Structured JSON output mode (model outputs `{"action": "..."}`, no formal tool calling)
- **Model acts blind between screenshots**: Only sees screen when explicitly requesting
  - **Fix**: Auto-screenshot after every action
- **Model outputs out-of-bounds coordinates** (y=979 > 720)
  - **Fix**: Explicit coordinate bounds documentation in system prompt

### 3. Clarification: qwen3.5:9b DOES support vision
- Confirmed via `/api/show` → `capabilities: ['completion', 'vision', 'tools', 'thinking']`
- Initial research incorrectly stated it was text-only
- Model is receiving and processing screenshots correctly
- The actions it took (clicking near taskbar, pressing calculator buttons) were based on visual analysis

### 4. Architecture
- **Standalone CLI runner** (`scripts/run-cua-benchmark.mjs`): Zero Pi SDK deps
- **Python helper** (`scripts/cua-helpers/cua_helper.py`): 8 commands, AV-safe
- **Leaderboard** (`scripts/cua-leaderboard.mjs`): Aggregates benchmark reports
- **Structured JSON mode**: More reliable than tool calling for small models
- **Auto-screenshot**: Every action → screenshot → model feedback loop

### 5. Benchmark Results
5 runs, all 0% success. Root causes:
| Run | Variant | Failure Reason |
|-----|---------|---------------|
| 1-3 | baseline (tool calling) | Win key didn't work (pyautogui), model blind to images |
| 4 | baseline-v2 (JSON mode) | Win key didn't work, coordinates from few-shot examples |
| 5 | auto-screenshot-v1 | Model saw screenshots but Win+S failed, clicked OOB coords |

## Commits (this session)
```
68f439e feat(cua): add standalone CLI benchmark runner with Python automation
4594509 feat(cua): improve task definitions, add validation, block Win key
f9441c0 feat(cua): add benchmark leaderboard aggregator
0928278 fix(cua): block Win key and add launch_app tool to Pi SDK harness
bb583c9 fix(cua): update few-shot examples to use launch_app instead of Win key
13225c8 fix(cua): strengthen coordinate guidance in system prompt
```

## When User Returns — Quick Start
```bash
# Machine will be on lock screen. User enters PIN to unlock.
# Then run:
node scripts/run-cua-benchmark.mjs --task calculator-add
# Or full Tier 1 suite:
node scripts/run-cua-benchmark.mjs --runs 3 --variant launch-app-v1
# Check leaderboard:
node scripts/cua-leaderboard.mjs
```

## Next Steps
1. **Immediate**: Run benchmark with `launch_app` after unlock
2. **Short-term**: Tune coordinate accuracy, adjust action delays
3. **Medium-term**: Persistent Python process (avoid spawn overhead), SOM via UIA
4. **Long-term**: C# native helper, multi-display, Claude/GPT backends
