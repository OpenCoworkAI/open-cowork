# Self-Evolving CUA Benchmark Workflow

**Date**: 2026-03-21
**Status**: Active
**Branch**: `worktree-cua-harness`

---

## 1. Overview

This document describes the **Self-Evolving CUA Benchmark** workflow. A single Claude Code session on Windows drives the entire loop end-to-end, with no human intervention required between iterations.

**Actors**:
- **Ollama** (Qwen 3.5 9B or 4B) runs as the CUA actor, receiving screenshots and outputting structured JSON actions.
- **Claude Code** acts as the meta-orchestrator. It runs the benchmark, reads trajectory data including screenshots (using its VLM capability), performs gap analysis, modifies harness code, and re-runs.

**The Loop**:

```
 Run Benchmark
      |
      v
 Collect Trajectory (JSONL + screenshots)
      |
      v
 Analyze Gaps (Claude reads screenshots + model thoughts)
      |
      v
 Classify Failures (perception, coordinate, strategy, etc.)
      |
      v
 Generate Gap Report
      |
      v
 Apply Fixes to Harness Code
      |
      v
 Commit Changes
      |
      v
 Re-run Benchmark  -----> compare with previous iteration
      |
      +---> loop until target success rate reached
```

---

## 2. Prerequisites

Before starting the loop, verify the following on the Windows machine.

### Ollama

```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags

# Verify the CUA model is loaded
ollama list | findstr qwen3.5
```

If the model is not pulled yet:
```bash
ollama pull qwen3.5:9b
# or for lower VRAM:
ollama pull qwen3.5:4b
```

### Python Dependencies

```bash
python -c "import mss, pyautogui, pyperclip; print('OK')"
```

If any are missing:
```bash
pip install mss pyautogui pyperclip
```

### Node.js

```bash
node --version   # v18+ required
```

### Working Directory

All commands assume the repo root of `open-cowork`:
```bash
cd %USERPROFILE%\path\to\open-cowork
```

### Display Settings

- Resolution: 1920x1080
- DPI scaling: 100% (critical for coordinate accuracy)
- Power plan: High Performance (disable sleep/screen off)

---

## 3. Step-by-Step Workflow

### Step 1: Run Benchmark

Run a single task to produce a trajectory:

```bash
node scripts/run-cua-benchmark.mjs --task calculator-add --variant self-evolving-v1
```

Or run the full Tier 1 suite:

```bash
node scripts/run-cua-benchmark.mjs --tier 1 --runs 1 --variant self-evolving-v1
```

**Output**: A trajectory directory is created at:
```
%APPDATA%/open-cowork/cua-trajectories/cua-<timestamp>/
```

The directory contains:
```
cua-<timestamp>/
  trajectory.jsonl          # One JSON object per line, one line per step
  step_001_observe.jpg      # Screenshot before first action
  step_002_after-action.jpg # Screenshot after first action
  step_003_after-action.jpg # ...
  summary.json              # Overall result: {success, summary, totalSteps}
```

### Step 2: Read Trajectory Data

Read all three data sources from the trajectory directory.

**2a. Read `summary.json`** for the overall result:

```json
{
  "success": false,
  "summary": "No summary (step budget exhausted)",
  "totalSteps": 15,
  "timestamp": "2026-03-21T10:30:00.000Z"
}
```

Key fields: `success` (boolean), `summary` (model's final statement), `totalSteps`.

**2b. Read `trajectory.jsonl`** for the action log. Each line is a JSON object:

```json
{
  "step": 3,
  "timestamp": "2026-03-21T10:30:05.123Z",
  "action": {
    "action": "click",
    "x": 512,
    "y": 288
  },
  "result": "Clicked model(512,288) -> screen(960,540) [left]"
}
```

Key fields per step: `step` (number), `action` (the JSON the model output), `result` (execution feedback).

**2c. Read screenshot files** using the Read tool. Claude can view `.jpg` and `.png` files directly as images. Read each `step_NNN_*.jpg` file to see the actual screen state.

### Step 3: Gap Analysis (Per Step)

For each step in the trajectory, perform this five-part analysis:

1. **Read the before screenshot** (the screenshot provided to the model at that step). Claude sees the image via its VLM capability.

2. **Read the model's action and any `thought` field** from the JSONL. If using the `thought`-enabled JSON schema (S1 from technique research), the model's reasoning is in `action.thought`. Otherwise, infer intent from the action itself.

3. **Compare**: Does the model's stated reasoning match what the screenshot actually shows? For example, if the model says "I see the File menu open" but the screenshot shows a blank desktop, that is a perception error.

4. **Read the after screenshot** (the screenshot taken after the action executed).

5. **Compare**: Did the action have the intended effect? If the model clicked where it thought the "+" button was, did the "+" actually get activated? Look for visual changes between before and after.

6. **Classify the gap** using the schema in Step 4.

### Step 4: Gap Classification Schema

Every identified gap must be classified into one of these types:

| Gap Type | Description | Example | Detection Method |
|----------|-------------|---------|-----------------|
| `perception_error` | Model describes something not present or misidentifies an element in the screenshot | "I see the File menu" but screenshot shows the desktop with no open windows | Compare model's `thought` text against what Claude sees in the before-screenshot |
| `coordinate_drift` | Model identifies the correct target but clicks the wrong coordinates | Model aims for the "+" button at (650,400) but the button is actually at (680,350); the after-screenshot shows "6" was pressed instead | Check if the intended element matches the element at the actual click coordinates |
| `wrong_strategy` | The plan or approach is incorrect for the task | Model tries to type "123+456" directly into calculator display instead of using the input field, or tries to open Start Menu instead of using `launch_app` | Evaluate whether the action sequence could plausibly achieve the goal |
| `execution_failure` | Action did not execute at the OS level despite correct reasoning | Click was sent but the target window was not focused; before and after screenshots are identical despite a non-screenshot action | After-screenshot is unchanged (perceptual hash distance near zero) despite an action being sent |
| `context_stale` | Model acts on an outdated view of the screen | "Based on what I see, the dialog is still open" but the dialog was dismissed two steps ago | Model references elements that were only visible in earlier screenshots |
| `hallucination` | Model claims the task is done but the result is wrong or not visible | Model reports "Done. Result: 579" but the calculator display shows "123" | Compare model's `done` summary against the final screenshot |
| `format_error` | Model output could not be parsed as valid JSON | Raw text like "I'll click the button" instead of `{"action": "click", ...}`, or JSON with missing required fields | Parse failure in the benchmark runner (logged as "Failed to parse action JSON") |

### Step 5: Generate Gap Report

After analyzing all steps, produce a structured gap report. Use this template:

```markdown
# Gap Analysis Report

**Task**: calculator-add
**Variant**: self-evolving-v1
**Iteration**: 1
**Date**: 2026-03-21
**Result**: FAIL (15/15 steps exhausted)
**Trajectory**: %APPDATA%/open-cowork/cua-trajectories/cua-1711012345678/

## Summary

- Total steps: 15
- Successful actions: 8
- Failed actions: 5
- Format errors: 2
- Primary failure mode: coordinate_drift (5 occurrences)
- Secondary failure mode: format_error (2 occurrences)

## Step-by-Step Analysis

### Step 1 — screenshot (OK)
- Action: `{"action": "screenshot"}`
- Observation: Model correctly requested initial screenshot.
- Gap: None

### Step 3 — click (FAIL: coordinate_drift)
- Action: `{"action": "click", "x": 650, "y": 400}`
- Model intent: Click the "+" button on calculator
- Actual result: Clicked the "6" button (adjacent to "+")
- Before screenshot: Calculator is open, "+" is at approximately (680, 350)
- After screenshot: "6" appeared in the display
- Coordinate error: dx=30, dy=50
- **Root cause**: Model estimated coordinates from grid but was off by ~40px

### Step 7 — type (FAIL: execution_failure)
- Action: `{"action": "type", "text": "123+456="}`
- Model intent: Type the expression into calculator
- Actual result: Calculator was not focused; text went to background window
- Before screenshot: Calculator visible but taskbar shows another app is active
- After screenshot: Calculator unchanged
- **Root cause**: Window focus was lost after previous click on taskbar

[...continue for all steps with gaps...]

## Gap Distribution

| Gap Type | Count | Percentage |
|----------|-------|-----------|
| coordinate_drift | 5 | 45% |
| format_error | 2 | 18% |
| execution_failure | 2 | 18% |
| perception_error | 1 | 9% |
| wrong_strategy | 1 | 9% |

## Recommended Fixes (Priority Order)

1. **coordinate_drift (5x)**: Improve coordinate guidance in system prompt; consider switching to 0-999 normalized coordinates with clamping
2. **format_error (2x)**: Add retry logic with clearer JSON instruction on parse failure
3. **execution_failure (2x)**: Add window focus verification before type actions
```

Save the gap report to:
```
docs/plans/gap-reports/gap-report-<task>-<variant>-iter<N>.md
```

### Step 6: Apply Fixes

Based on the gap report, identify the **single most impactful failure mode** and apply a targeted fix.

Rules for applying fixes:
- Fix **one failure mode at a time**. Do not bundle multiple unrelated fixes.
- Prefer prompt-only changes over code changes (lower risk, faster iteration).
- After modifying code, run `npm run lint` to verify no regressions.
- Commit with a conventional commit message referencing the gap type.

Example commit flow:
```bash
# After modifying the system prompt to fix coordinate_drift
git add scripts/run-cua-benchmark.mjs
git commit -m "fix(cua): improve coordinate guidance to reduce coordinate_drift

Gap report iteration 1 showed 45% coordinate_drift errors.
Switched to 0-999 normalized coordinate space with explicit bounds."
```

Files most likely to be modified:

| Fix Target | File | What to Change |
|-----------|------|---------------|
| System prompt | `scripts/run-cua-benchmark.mjs` (SYSTEM_PROMPT) | Coordinate instructions, action guidance, few-shot examples |
| JSON parsing | `scripts/run-cua-benchmark.mjs` (parseAction) | More robust extraction, fallback patterns |
| Action execution | `scripts/run-cua-benchmark.mjs` (executeAction) | Validation, focus checks, retry logic |
| Screenshot config | `scripts/run-cua-benchmark.mjs` (SCREENSHOT_W/H) | Resolution, format |
| Python helper | `scripts/cua-helpers/cua_helper.py` | Screenshot capture, click execution, new commands |
| Harness core (TS) | `src/main/cua/cua-sub-agent.ts` | Agent loop, tool registration |
| Tools (TS) | `src/main/cua/cua-tools.ts` | Action implementation, coordinate mapping |

### Step 7: Re-run and Compare

After committing the fix, re-run the same task with an incremented variant name:

```bash
node scripts/run-cua-benchmark.mjs --task calculator-add --variant self-evolving-v2
```

Then repeat Steps 2-5 to produce a new gap report. Compare the two reports:

- Did the targeted failure mode decrease in frequency?
- Did any new failure modes appear (regression)?
- Did overall step count change?

Record the comparison in a running changelog (see Section 4).

---

## 4. Iteration Strategy

### Starting Point

Begin with the simplest task: `calculator-add`. This task has clear success criteria (output must contain "579") and a well-defined action sequence.

### Progression Rules

1. **Get to >80% success rate on one task** before moving to the next.
2. Fix **one failure mode per iteration**. Do not attempt multiple fixes simultaneously.
3. If a fix causes regressions on previously passing scenarios, revert it.
4. After reaching >80% on `calculator-add`, proceed to `notepad-write`, then `settings-themes`.
5. Tier 2 tasks (`excel-sort`, `browser-search`) come only after Tier 1 is stable.

### Iteration Changelog

Maintain a running log at `docs/plans/gap-reports/iteration-changelog.md`:

```markdown
# Self-Evolving Iteration Changelog

| Iter | Variant | Task | Fix Applied | Gap Targeted | Before | After | Commit |
|------|---------|------|-------------|-------------|--------|-------|--------|
| 1 | self-evolving-v1 | calculator-add | (baseline) | - | 0% | 0% | - |
| 2 | self-evolving-v2 | calculator-add | 0-999 coords | coordinate_drift | 0% | 20% | abc1234 |
| 3 | self-evolving-v3 | calculator-add | thought field | perception_error | 20% | 40% | def5678 |
```

### When to Stop

- Target success rate reached (>80% for Tier 1, >60% for Tier 2)
- Three consecutive iterations with no improvement (plateau)
- The remaining failures require architectural changes beyond prompt/harness tuning (escalate to Phase 3 from the todo list)

---

## 5. Failure Mode to Fix Mapping

Quick-reference table for translating gap types into concrete harness changes.

| Gap Type | Recommended Fixes | Files to Modify | Priority |
|----------|------------------|----------------|----------|
| `perception_error` | Add `thought` field to JSON schema (S1); add post-action verification prompt (S6); increase screenshot resolution (S2) | `run-cua-benchmark.mjs` SYSTEM_PROMPT | High |
| `coordinate_drift` | Switch to 0-999 normalized coordinates (S4); add coordinate clamping in post-processing; increase screenshot resolution to 1280x800 (S2); switch to PNG (S3) | `run-cua-benchmark.mjs` SYSTEM_PROMPT + `mapCoords()` | High |
| `wrong_strategy` | Add pre-execution plan generation (A6); improve task instruction specificity; add recovery action menu (A3) | `run-cua-benchmark.mjs` SYSTEM_PROMPT; possibly add plan step before main loop | Medium |
| `execution_failure` | Add window focus verification before `type_text`; add screenshot-diff polling to confirm action took effect (B5); increase `ACTION_SETTLE_MS` | `cua_helper.py` (add `check_focus` command); `run-cua-benchmark.mjs` | Medium |
| `context_stale` | Strip old screenshots from message history; replace with text summaries (B2); use `afterToolCall` to remove base64 data from older turns | `run-cua-benchmark.mjs` message management | Medium |
| `hallucination` | Add explicit verification step before `done` action; require the model to describe what it sees in the final screenshot; cross-check against `successKeywords` | `run-cua-benchmark.mjs` SYSTEM_PROMPT + done-handling logic | High |
| `format_error` | Improve JSON extraction regex; add retry with explicit format reminder; consider Ollama's `format: "json"` parameter | `run-cua-benchmark.mjs` `parseAction()` + `chatRaw()` | Low |

### Fix Priority Order (general guidance)

When multiple gap types appear in a single report, fix them in this order:

1. `format_error` -- if the model cannot output valid JSON, nothing else works
2. `perception_error` -- if the model cannot see correctly, coordinates will be wrong
3. `coordinate_drift` -- most common failure mode for small VLMs
4. `execution_failure` -- OS-level issues that waste steps
5. `hallucination` -- false completion claims waste the entire run
6. `wrong_strategy` -- requires deeper prompt engineering
7. `context_stale` -- only matters in longer trajectories (>8 steps)

---

## 6. Commands Reference

### Benchmark Runner

```bash
# Run a single predefined task (1 run)
node scripts/run-cua-benchmark.mjs --task calculator-add

# Run a single predefined task with a variant label
node scripts/run-cua-benchmark.mjs --task calculator-add --variant self-evolving-v3

# Run a single ad-hoc instruction (not from predefined tasks)
node scripts/run-cua-benchmark.mjs --single "Open Notepad and type Hello World"

# Run all Tier 1 tasks (3 runs each)
node scripts/run-cua-benchmark.mjs --tier 1 --runs 3 --variant self-evolving-v3

# Run all Tier 2 tasks
node scripts/run-cua-benchmark.mjs --tier 2 --runs 1

# Run all tasks (Tier 1 + Tier 2)
node scripts/run-cua-benchmark.mjs --tier all --runs 1

# Set max steps per task
node scripts/run-cua-benchmark.mjs --task calculator-add --max-steps 20

# Use a different model
CUA_MODEL=qwen3.5:4b node scripts/run-cua-benchmark.mjs --task calculator-add

# Use a different Ollama endpoint
OLLAMA_BASE=http://192.168.1.100:11434 node scripts/run-cua-benchmark.mjs --task calculator-add
```

### Leaderboard

```bash
# View aggregated results across all benchmark runs
node scripts/cua-leaderboard.mjs
```

### Ollama Management

```bash
# Check running models
curl http://localhost:11434/api/tags

# Warm up the model (load into VRAM without a real task)
curl -X POST http://localhost:11434/api/generate -d "{\"model\": \"qwen3.5:9b\", \"prompt\": \"hi\", \"stream\": false}"

# Check model capabilities (confirm vision support)
curl -s http://localhost:11434/api/show -d "{\"name\": \"qwen3.5:9b\"}" | python -m json.tool | findstr capabilities

# Set keep-alive to 30 minutes (prevent model unload during iteration)
curl -X POST http://localhost:11434/api/generate -d "{\"model\": \"qwen3.5:9b\", \"prompt\": \"\", \"keep_alive\": \"30m\", \"stream\": false}"
```

### Trajectory Inspection

```bash
# List all trajectory directories
dir %APPDATA%\open-cowork\cua-trajectories\

# View summary of a specific run
type %APPDATA%\open-cowork\cua-trajectories\cua-<timestamp>\summary.json

# View step-by-step actions
type %APPDATA%\open-cowork\cua-trajectories\cua-<timestamp>\trajectory.jsonl

# Count steps in a trajectory
find /c /v "" %APPDATA%\open-cowork\cua-trajectories\cua-<timestamp>\trajectory.jsonl

# List screenshots for a run
dir %APPDATA%\open-cowork\cua-trajectories\cua-<timestamp>\*.jpg
```

### Benchmark Reports

```bash
# List all saved benchmark reports
dir %APPDATA%\open-cowork\cua-benchmarks\

# View a specific report
type %APPDATA%\open-cowork\cua-benchmarks\benchmark-self-evolving-v1-*.md
```

### Git (During Iteration)

```bash
# Check current state
git status
git log --oneline -5

# Commit a fix after modifying harness code
git add scripts/run-cua-benchmark.mjs
git commit -m "fix(cua): <description of the fix targeting a specific gap type>"

# If a fix causes regressions, revert
git revert HEAD
```
