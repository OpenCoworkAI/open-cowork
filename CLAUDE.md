# CUA Harness Development Guide

## Current Focus: Demo Task Iteration

We are iterating on **2 demo tasks** for a presentation to leadership. All harness optimization work should serve these two tasks.

### Demo Tasks

1. **Organize Desktop Files** (`demo-organize-desktop`)
   - Instruction: "My Desktop is a mess. Please organize the files into folders."
   - Type: CLI-heavy (`run_command`)
   - Setup: `messy-desktop.ps1 create` generates 16 test files
   - Validation: `messy-desktop.ps1 verify` checks actual file organization
   - Demonstrates: agent efficiency via command-line execution

2. **Paper Ablation → Excel Chart** (`demo-paper-chart`)
   - Instruction: "Find the paper 'Attention is All You Need', look at the ablation study results, and create a comparison chart in Excel based on the data."
   - Type: GUI-heavy (PDF browsing + Excel chart creation)
   - The model should search/download the paper itself (not pre-placed)
   - Demonstrates: visual understanding + cross-app workflow + CUA's irreplaceable value (charts can't be text-parsed)

### Running Demo Tasks

```bash
# Run both demo tasks
node scripts/run-cua-benchmark.mjs --demo

# Run individually
node scripts/run-cua-benchmark.mjs --task demo-organize-desktop
node scripts/run-cua-benchmark.mjs --task demo-paper-chart

# Use 9B model for comparison
CUA_MODEL=qwen3.5:9b node scripts/run-cua-benchmark.mjs --demo
```

## Iteration Principles (MUST follow)

### 1. Benchmark is the arena, not the product
- The benchmark script finds problems
- Fix the **harness** (system prompt, action handling in `run-cua-benchmark.mjs`, `cua_helper.py`), not the task descriptions
- Never "cheat" by making task instructions more specific to get a pass

### 2. Extract general patterns, no task-specific workarounds
- Good: "add `run_command` action so model can execute shell commands directly" (general capability)
- Bad: "add hint in task description to use `curl` for downloading" (task-specific cheat)
- Good: "teach model about Excel keyboard shortcuts in system prompt" (general knowledge)
- Bad: "tell model to download from arxiv.org/pdf/1706.03762" (giving the answer)

### 3. Distinguish harness guidance vs task hints
- **Harness guidance (OK in system prompt)**: "Use run_command for any command-line task", "Use Ctrl+L to focus Edge address bar"
- **Task hint (NOT OK)**: "Download the PDF using curl", "Put .txt files in a Documents folder"
- Rule of thumb: if the guidance helps ALL tasks, it's harness guidance. If it only helps one task, it's a hint.

### 4. Task instructions give goals only
- Keep instructions natural and simple, like a real user would say
- No step-by-step instructions, no method specifications
- The model decides HOW to accomplish the goal

### 5. Post-run analysis with screenshots
After every benchmark run:
1. Check the trajectory directory for screenshots
2. For each failure, classify the root cause:
   - **perception**: model misread the screen (wrong text, missed element)
   - **coordinate**: model clicked the wrong location
   - **strategy**: model chose a bad approach (e.g., GUI when CLI is better)
   - **execution**: right idea but wrong action syntax/parameters
   - **hallucination**: model claimed success without actually completing the task
3. Fix the root cause in the harness, not in the task

## Architecture

### Key Files
- `scripts/run-cua-benchmark.mjs` — Benchmark runner + task definitions + harness logic
- `scripts/cua-helpers/cua_helper.py` — Python helper (screenshot, click, type, key_press, launch_app, focus_window, minimize_all)
- `scripts/cua-helpers/messy-desktop.ps1` — Desktop file mess creator/verifier/cleaner
- `docs/cua-iteration-log.md` — Historical iteration log

### Model Actions (available to the CUA model)
- `screenshot` — capture current screen
- `click` / `double_click` / `right_click` — mouse actions at coordinates
- `type` — type text via keyboard
- `key_press` — keyboard shortcut (with modifiers)
- `scroll` — scroll at position
- `launch_app` — open a GUI application (calc, notepad, explorer, edge, settings-*)
- `focus_window` — bring existing window to front
- `run_command` — **execute shell command directly, return text output** (no GUI terminal needed)
- `done` — report task completion with summary

### Model & Infra
- Default model: `qwen3.5:4b` (vision-capable, 4.6B params)
- Ollama on remote A100 via SSH tunnel at `localhost:11434`
- Screen: 1280x800 model coords → 2400x1600 actual (150% DPI scaling)
- Screenshot with cyan grid overlay for coordinate guidance

## Demo Context

### Product Positioning
- **What**: Privacy-preserving local AI agent for desktop automation
- **For**: C-end users on their own devices
- **Goal**: Prove feasibility to leadership ("this approach works")
- **Model**: Team is training 4B and 8B models; demo must align with these sizes
- **Honesty**: If using cloud inference, say so. Don't fake local execution.

### Why These Two Tasks
1. **Organize Desktop** — shows CLI efficiency (`run_command`), practical value, everyone relates
2. **Paper → Excel Chart** — shows visual understanding that CLI/text-parsing CAN'T do (the core CUA value proposition)

### What NOT to Demo
- Microsoft Office workflows (overlaps with Copilot)
- WeChat/Chinese-only apps (needs to be international)
- Fake/contrived scenarios (use real tools and real tasks)

## Win11 Gotchas (known issues)
- Win key via ctypes/pyautogui locks screen (Windows Hello)
- Windows Search overlay can't be screenshotted by mss
- PowerShell inline DllImport blocked by AMSI/AV
- Edge UWP multi-process architecture breaks window detection
- IME can intercept pyautogui keystrokes → `_ensure_english_input()` before typing
