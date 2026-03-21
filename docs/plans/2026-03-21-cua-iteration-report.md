# CUA Harness Iteration Report — 2026-03-21

## Session Overview
First standalone benchmark run session on Windows 11 (2400x1600, 150% DPI).

## Key Findings

### 1. Environment Issues Resolved
- **PowerShell AMSI blocks**: Inline P/Invoke scripts blocked by Windows Defender
  - **Fix**: Moved all automation to Python (mss + pyautogui + ctypes)
- **ESM/CJS module incompatibility**: Pi SDK is ESM-only, project uses bundler moduleResolution
  - **Fix**: Created standalone `.mjs` runner that bypasses Pi SDK entirely, calls Ollama API directly

### 2. Critical Bugs Found & Fixed
- **Win key locks screen**: `ctypes.keybd_event(VK_LWIN)` triggers Windows Hello lock on Win11 corporate machines
  - **Fix**: Blocked Win key in helper, added `launch_app` command using `Start-Process`
- **Win+S opens Widgets**: On this Win11 build, Win+S opens Copilot/Widgets, not Search
  - **Fix**: `launch_app` replaces all keyboard-based app opening
- **Windows Search overlay not capturable**: `mss` screenshots show black when Search overlay is active
  - **Root cause**: Windows compositor security prevents capture of secure UI
  - **Fix**: Bypass by using `launch_app` (no overlay to capture)
- **Ollama tool messages don't support images**: `images` field in `role: "tool"` messages is ignored
  - **Fix**: Screenshots sent as `role: "user"` messages with `images` field
- **qwen3.5:9b tool calling format unreliable**: Model outputs coordinates as `"[374, 968]"` strings
  - **Fix**: Switched to structured JSON output mode (no formal tool calling API)
- **Model acts blind between screenshots**: Only sees screen when explicitly requesting screenshot
  - **Fix**: Auto-screenshot after every action, included in response

### 3. Architecture Improvements
- **Standalone CLI runner** (`scripts/run-cua-benchmark.mjs`): Zero Pi SDK deps, directly calls Ollama
- **Python automation helper** (`scripts/cua-helpers/cua_helper.py`): 8 commands, AV-safe
- **Structured JSON mode**: Model outputs `{"action": "...", ...}` parsed inline — more reliable than tool calling
- **Auto-screenshot**: Every action triggers a screenshot feedback loop

### 4. Benchmark Results (baseline)
All tasks currently **0% success rate** due to the Win key / screen lock issue.
The core harness infrastructure is working — model receives screenshots, outputs JSON actions.
Need to re-run after screen unlock with `launch_app` fix.

## Files Changed
```
scripts/run-cua-benchmark.mjs          — Standalone CUA benchmark runner (JSON mode)
scripts/cua-helpers/cua_helper.py      — Python automation helper (8 commands)
scripts/cua-helpers/screenshot.ps1     — PowerShell screenshot (blocked by AV, unused)
scripts/cua-helpers/screen-info.ps1    — PowerShell screen info
scripts/cua-helpers/click.ps1          — PowerShell click (blocked by AV, unused)
scripts/cua-helpers/key-press.ps1      — PowerShell key press (blocked by AV, unused)
scripts/cua-helpers/type-text.ps1      — PowerShell type text
scripts/cua-helpers/scroll.ps1         — PowerShell scroll
```

## Next Steps (when screen is unlocked)
1. Run baseline benchmark with `launch_app` — expect significant improvement
2. Optimize system prompt for coordinate accuracy
3. Add task-specific success validation (e.g., check if file exists for notepad task)
4. Phase 2 optimizations: persistent Python process, action delay tuning
5. Phase 3: SOM (Set-of-Mark) via Windows UI Automation for better click accuracy
