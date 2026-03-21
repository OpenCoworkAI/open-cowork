# CUA Harness Handoff — 2026-03-21

> Mac 端 Claude Code → Windows 端 Claude Code 的交接文档。
> 两端 CC 都可以读这个文件来了解当前状态。

## Current State

**Branch**: `worktree-cua-harness`
**Latest commit**: `c8322a4` — feat(cua): add reflection buffer, verification prompts, context management
**Remote**: pushed to `origin/worktree-cua-harness` ✅

### What Was Done (Mac Session, 2026-03-21)

1. **调研**: 10 个并行 agent 调研了 CUA/GUI Agent 领域的最新技巧
   - 调研报告: `docs/plans/2026-03-21-cua-technique-research.md`
   - 覆盖: SoM、OSWorld、Action Space、截图预处理、Self-reflection、小模型调优、Prompt 工程、UI 元素检测、坐标表示、多轮规划

2. **代码改进** (2 个 commit):
   - `70eeaad` — Trajectory 数据丰富 + 分辨率 1280×800 + PNG + Grid cyan + double_click/right_click + thought 字段
   - `c8322a4` — Reflection buffer + verification prompts + recovery menu + 截图稳定性轮询 + context 裁剪

3. **文档**:
   - `docs/plans/cua-self-evolving-workflow.md` — Self-Evolving 完整流程文档
   - `docs/plans/cua-handoff-2026-03-21.md` — 本交接文档

### Key Changes Summary

| 维度 | 改前 | 改后 |
|------|------|------|
| 分辨率 | 1024×576 JPEG Q=85 | 1280×800 PNG |
| Grid | 红色实线 | Cyan 25% 透明 |
| Trajectory | 只存 action+result | thought + before/after 截图 + coords + timing |
| 推理 | 无 thought 字段 | thought 必填 |
| 失败处理 | 泛化 nudge | Reflection buffer (3条) + recovery menu + verification |
| Context | 无限堆积截图 | 稳定性轮询 + 保留最近 2 张 + 文本替换 |
| Actions | 5 个 | 7 个 (+double_click, right_click) |

---

## For Windows Claude Code Session

### Quick Start

```bash
# 1. Pull latest
cd <open-cowork-repo>
git checkout worktree-cua-harness
git pull origin worktree-cua-harness

# 2. Ensure Ollama is running with the model
ollama run qwen3.5:9b   # or qwen3.5:4b

# 3. Ensure Python deps
pip install mss pyautogui pyperclip Pillow

# 4. Run a single task to test
node scripts/run-cua-benchmark.mjs --task calculator-add --variant self-evolving-v1
```

### Self-Evolving Workflow

Read `docs/plans/cua-self-evolving-workflow.md` for the full step-by-step process.

TL;DR:
1. Run benchmark → produces trajectory in `%APPDATA%/open-cowork/cua-trajectories/cua-<timestamp>/`
2. Read trajectory screenshots (Claude Code VLM can see .png files)
3. Compare model's `model_thought` (in trajectory.jsonl) vs actual screenshot content
4. Classify gaps: perception_error, coordinate_drift, wrong_strategy, execution_failure, hallucination
5. Modify harness code based on top failure mode
6. Re-run and compare

### What to Look For in Trajectory Data

Each step in `trajectory.jsonl` now contains:
```json
{
  "step": 3,
  "timestamp": "2026-03-21T...",
  "action": {"thought": "I see the + button", "action": "click", "x": 650, "y": 400},
  "result": "Clicked model(650,400) -> screen(1200,740) [left]",
  "model_raw_output": "<full model response>",
  "model_thought": "I see the + button in the center area",
  "screenshot_before": "step_005_before.png",
  "screenshot_after": "step_006_after.png",
  "screen_changed": true,
  "duration_ms": 2340,
  "model_coords": [650, 400],
  "screen_coords": [1200, 740]
}
```

### Priority Actions

1. **First**: Run `calculator-add` once, see if the new improvements help
2. **If still 0%**: Read the trajectory, do gap analysis, identify top failure mode
3. **If coordinate_drift**: Consider switching model to `qwen2.5vl:7b` (84.7% ScreenSpot)
4. **If perception_error**: Model might not be processing images correctly via Ollama
5. **If model too slow**: Try `qwen3.5:4b` but use Q8_0 quantization, not Q4

### Model Options (Ollama)

| Model | Size | GUI Grounding | Speed |
|-------|------|--------------|-------|
| `qwen3.5:9b` | 6.6GB | Unknown (no benchmarks) | Medium |
| `qwen3.5:4b` | ~3GB | Unknown | Fast |
| `qwen2.5vl:7b` | ~5GB | 84.7% ScreenSpot | Medium |

---

## For Mac Claude Code Session

### What Mac Session Does

- Code review and architecture discussion
- Adjust harness code based on Windows gap analysis results
- Run research agents for new techniques
- Merge CUA branch into dev/main when ready

### Sync Pattern

```bash
# Pull Windows changes
cd /Users/haoqing/Desktop/open-cowork/.claude/worktrees/cua-harness
git pull origin worktree-cua-harness

# After making changes, push back
git push origin worktree-cua-harness
```

---

## Open Questions (需要进一步讨论)

1. **MCP vs Pi SDK**: CUA 在产品里走哪条路？GUI 部分学长负责，需要和他对齐
2. **模型选择**: Qwen 3.5 9B/4B vs Qwen2.5-VL 7B — 等 benchmark 数据再决定
3. **复杂任务拆分**: Sub-agent 隔离 context 的方案已讨论，但实现是后续的事
4. **A11y / UIA**: 昊卿暂时不想用，但如果 coordinate_drift 是主要问题可以重新考虑

## Files Modified in This Session

```
scripts/run-cua-benchmark.mjs       (+235 lines)  — 核心改动
scripts/cua-helpers/cua_helper.py   (+47 lines)   — 分辨率/格式/新 actions
docs/plans/cua-self-evolving-workflow.md  (新建)   — Self-Evolving 流程
docs/plans/2026-03-21-cua-technique-research.md (新建) — 调研报告
docs/plans/cua-handoff-2026-03-21.md (新建)       — 本交接文档
```
