# CUA Harness 技巧调研报告 — 2026-03-21

> 10 个并行调研 agent 的汇总。按优先级排序，标注 4B 模型适用性。

## Executive Summary

当前 harness（Qwen 3.5 9B + Ollama + 1024×576 JPEG Q=85 + 红色网格 + structured JSON）的 0% benchmark 成功率，**根因不是单一技巧缺失，而是多个基础层问题叠加**：

1. **分辨率太低** — 1024×576 只给模型 ~748 visual tokens，低于有效阈值
2. **JPEG 压缩损害 GUI 文字/图标边缘** — Q=85 的 DCT 8×8 ringing artifacts
3. **坐标空间不对** — 1024 是 2 的幂，模型有 bias；应用 0–999 整数
4. **缺少结构化推理** — JSON 里没有 `thought` 字段，模型不推理就输出坐标
5. **缺少失败反思** — 操作失败后没有 verbal reflection buffer
6. **纯视觉方案在非微调模型上天花板很低** — 需要 UIA/SoM 辅助 grounding

---

## 技巧全景图（按优先级排序）

### Tier S — 必须做（高影响 × 低成本）

| # | 技巧 | 影响 | 实现成本 | 4B 适用 | 来源 |
|---|------|------|---------|---------|------|
| S1 | **JSON schema 加 `thought` 必填字段** | +15-23% | 仅改 prompt | ✅ 更需要 | OS-Genesis, UI-TARS, AGUVIS |
| S2 | **分辨率提升到 1280×800** | High | 改一个常量 | ✅ | Qwen2-VL 文档, Anthropic CU |
| S3 | **JPEG → PNG** | Medium-High | 改一行 format | ✅ | SeeClick, ShowUI, Anthropic |
| S4 | **坐标空间换成 0–999 整数 + clamp** | High | 改 prompt + 后处理 | ✅ 更需要 | OS-Atlas, CogAgent, SeeClick |
| S5 | **Reflexion-style verbal memory buffer** | High | ~50 行代码 | ✅ | Reflexion (AlfWorld +22pp) |
| S6 | **post-action verification prompt 模板** | High | 仅改 prompt | ✅ | ScreenAgent, UFO, OS-Copilot |

### Tier A — 强烈推荐（高影响 × 中成本）

| # | 技巧 | 影响 | 实现成本 | 4B 适用 | 来源 |
|---|------|------|---------|---------|------|
| A1 | **UIA 可访问性树作为辅助输入** | +6-8pp | 1-2 天 | ✅ 极需要 | OSWorld (12%→19%), UFO |
| A2 | **SoM 标注（UIA bbox → 编号叠加）** | +15-40% grounding | 2-3 天 | ✅ 极需要 | OmniParser, SeeClick, SoM paper |
| A3 | **recovery action menu（非泛化 nudge）** | Medium-High | 仅改 prompt | ✅ | UFO, Mobile-Agent-v2 |
| A4 | **action space 加 double_click + right_click** | Medium | ~30 行代码 | ✅ | OSWorld, UI-TARS, Anthropic |
| A5 | **progress-aware step budget nudge** | Medium | 仅改 prompt | ✅ | CRADLE, Mobile-Agent-v2 (+7.5pp) |
| A6 | **pre-execution plan 生成（纯文本）** | High | 1 次额外 LLM 调用 | ✅ | UFO, Agent S, Agent S2 |

### Tier B — 推荐（中影响 × 中成本）

| # | 技巧 | 影响 | 实现成本 | 4B 适用 | 来源 |
|---|------|------|---------|---------|------|
| B1 | **Zoom-in crop（局部放大截图）** | High for small elements | ~100 行 | ✅ 弥补视觉弱 | Anthropic zoom action, CogAgent |
| B2 | **截图文本替换（旧截图→文字摘要）** | Medium | ~50 行 | ✅ 省 context | Anthropic loop.py, MemGPT |
| B3 | **Grid 样式优化（cyan 虚线 + 25% 透明 + A1 标签）** | Medium | 改 Python helper | ✅ | SoM paper ablation |
| B4 | **真正的 perceptual hash (dHash)** | Medium | Python helper 加命令 | ✅ | 标准做法 |
| B5 | **截图稳定性轮询（等 UI 动画结束）** | Medium | ~20 行 | ✅ | OSWorld (3s default) |
| B6 | **Workflow memory（成功 trajectory 存 SQLite）** | Medium-High | 半天 | ✅ | Agent Workflow Memory |

### Tier C — 长期 / 大投入

| # | 技巧 | 影响 | 实现成本 | 4B 适用 | 来源 |
|---|------|------|---------|---------|------|
| C1 | **OmniParser v2 作为预处理层** | Very High | 3-5 天 | ✅ 极需要 | Microsoft, 24.6k stars |
| C2 | **换模型：Qwen2.5-VL 7B** | Very High | 配置改 | ❌ 只有7B+ | ScreenSpot 84.7% |
| C3 | **UFO 式 dual-agent 架构** | High | 1-2 周 | ⚠️ 视复杂度 | Microsoft UFO |
| C4 | **MCTS / tree search** | High | Very High | ❌ | Agent-Q |

---

## 详细技巧说明

### S1. JSON schema 加 `thought` 必填字段

**当前**：`{"action": "click", "x": 300, "y": 200}`
**建议**：
```json
{
  "thought": "I see the Calculator app is open. The + button is in the middle-right area.",
  "action": "click",
  "x": 650,
  "y": 400
}
```

**为什么有效**：强制模型先描述所见、再推理、再输出坐标。OS-Genesis 在 3-7B 模型上测得 +15-23% 准确率提升。UI-TARS 的 System-2 reasoning 本质上就是这个。

**4B 模型影响**：更大。小模型不推理就 action 的错误率远高于大模型。

### S2. 分辨率提升到 1280×800

**当前**：1024×576（~748 visual tokens @ Qwen2-VL 14px patches）
**建议**：1280×800（~933 tokens，接近 Qwen2-VL 的 1024 token 上限）

Qwen2-VL 的 Naive Dynamic Resolution 机制：`min_pixels=256*28*28` 到 `max_pixels=1024*28*28`。1024×576 低于推荐范围下限。

**代码改动**：改 `SCREENSHOT_W = 1280; SCREENSHOT_H = 800`

### S3. JPEG → PNG

GUI 截图有硬边缘（按钮边框、文字轮廓），JPEG 的 8×8 DCT 压缩在这些边缘产生 ringing artifacts。10pt 字体在 96 DPI 下只有 13-14px 高——正好是 1-2 个 DCT block，inter-block artifacts 占比极大。

Anthropic CU、SeeClick、ShowUI、UI-TARS 训练/评估全用 PNG。

**本地推理不走网络**，PNG 只增加内存不增加延迟。

### S4. 坐标空间换成 0–999 整数

**当前问题**：
- `1024` 是训练数据高频数字（2 的幂、图像尺寸、context window），模型有 bias 去输出它
- Qwen2-VL 原生训练格式是 `<|box_start|>(x,y)<|box_end|>` 0–1000 整数
- 用 999 作上界避免 1024 的 bias

**Prompt 改为**：
```
Coordinates are integers from 0 to 999.
(0,0) = top-left, (999,999) = bottom-right.
Example: {"thought": "...", "action": "click", "x": 512, "y": 347}
```

**后处理**：
```javascript
const clampedX = Math.max(0, Math.min(999, action.x));
const realX = Math.round(clampedX / 999 * screenWidth);
```

### S5. Reflexion-style verbal memory buffer

**原理**：操作失败后，生成结构化反思句，保留最近 3 条 prepend 到后续 prompt。

```
[REFLECTION 1] Clicked (342,156) expecting File menu to open, but screenshot unchanged.
The element is likely not at that coordinate — need to re-examine with fresh screenshot.

[REFLECTION 2] Tried typing "123+456" but calculator was not focused.
Must click the calculator input area before typing.
```

**Reflexion 在 AlfWorld 上从 75% 提升到 97%**（+22pp），虽然是文本环境，但 verbal memory 的原理通用。

### S6. Post-action verification prompt

**当前**：截图变化检测只用 fingerprint hash，结果注入 `⚠️ WARNING`
**建议**：改为结构化 verification template：

```
Action taken: click at (342, 156), expecting File menu to open
Expected outcome: A dropdown menu should appear below the File button
Actual state: [screenshot]
Question: Did the action succeed? Answer yes/partial/no, then decide next action.
```

`expected outcome` 字段是关键——没有它模型无法做有意义的对比。

### A1. UIA 可访问性树

OSWorld 的硬数据：

| 观测方式 | 任务成功率 |
|---------|-----------|
| 纯截图 | 11.97% |
| 纯 A11y 树 | 14.93% |
| SoM | 14.44% |
| **截图 + A11y 树** | **18.94%** |

Python 实现用 `uiautomation` 库（yinkaisheng，3.4k stars），比 pywinauto 快：
```python
import uiautomation as auto
control = auto.GetRootControl()
for child in control.GetChildren():
    print(child.ControlTypeName, child.Name, child.BoundingRectangle)
```

**只取 Control View、交互元素、depth ≤ 4**，序列化为 compact JSON 注入 prompt。

**Demo 场景（Excel、Word、Settings）都是 UIA 覆盖好的原生 Win32/UWP 应用。**

### A2. SoM 标注（Set-of-Mark）

用 UIA bounding rectangles 在截图上叠加编号标签，模型输出 `CLICK [7]` 而不是预测坐标。

**效果**：将"找坐标"的回归问题转化为"选编号"的分类问题。SoM 在 ScreenSpot 上给 GPT-4V 提升了 +67%（16.3% → 27.2%）。对小模型提升更大。

**实现方式**：
1. UIA 获取 interactive elements 的 bounding boxes
2. 在截图上叠加编号 markers（semi-transparent, 2-4px padding）
3. 生成 element table：`[1] Button "Submit" at (450,320), [2] TextBox "Search" at (200,80)`
4. Prompt 说："Click element by number. Example: {"action": "click_element", "id": 3}"

### A6. Pre-execution plan 生成

在主循环前做一次纯文本 LLM 调用，生成 3-5 subgoal plan：

```json
{"plan": [
  "Open Calculator app",
  "Enter 123 + 456",
  "Read the result",
  "Report the answer"
]}
```

注入 system prompt context。每步模型知道自己在 plan 的哪一步。

**UFO 和 Agent S 都用这个模式**。对长任务（8-15 步）减少 goal drift。成本：1 次无截图 LLM 调用，非常快。

---

## 模型选择建议

### 当前 Qwen 3.5 9B 的问题

Qwen 3.5 是 2025.3 刚发布的模型，**没有任何 GUI grounding benchmark 数据**。397B 版本 ScreenSpot-Pro 65.6%，但 9B 版本未知。

### 替代方案对比

| 模型 | 大小 | ScreenSpot | GUI Fine-tuned | Ollama 可用 |
|------|------|-----------|---------------|------------|
| **Qwen2.5-VL 7B** | 7B | **84.7%** | ✅ 专门训练 | `qwen2.5vl:7b` |
| Qwen 3.5 9B | 9B | 未知 | ❌ 通用模型 | `qwen3.5:9b` |
| ShowUI 2B | 2B | 75.1% | ✅ | 需自行转换 |
| SeeClick 9.6B | 9.6B | 53.4% | ✅ | 需自行转换 |

### 量化影响（关键！尤其 4B）

| 量化级别 | GUI Grounding 衰减 | VRAM (9B) | VRAM (4B) |
|---------|-------------------|-----------|-----------|
| FP16 | 基准 | ~18GB | ~8GB |
| Q8_0 | **-1%** | ~9GB | ~4.5GB |
| Q4_K_M | **-9%** | ~5GB | ~2.5GB |
| Q4_0 | **-13%** | ~4.5GB | ~2.2GB |

**GUI 任务比一般 VQA 衰减更大**：密集小字体、小图标、精确空间定位都需要更高的权重精度。

**建议**：4B 用 Q8_0（~4.5GB VRAM），避免 Q4。

---

## 与 Self-Evolving Benchmark 的整合

上述技巧分为两类：

### 可自动观测 & 自动优化的
- 坐标精度 → 每步记录 `{predicted, actual, distance}` → 自动发现 grounding drift
- 截图变化检测 → 记录 `{fingerprint_before, fingerprint_after, distance}` → 自动识别 no-op actions
- Action 成功率 → 按 action type 统计成功/失败 → 自动识别最弱的 action
- 思考质量 → Verifier 对比 model's `thought` vs 截图实际内容 → 发现 perception gap

### 需要人工判断的
- 模型选择（Qwen 3.5 vs Qwen2.5-VL）
- SoM vs Grid vs 纯视觉的权衡
- Action space 增减

Self-Evolving 的 Verifier 环节可以用同一个 Ollama 模型做独立验证：
```
[Verifier Prompt]
Action taken: click at (512, 347)
Model thought: "I clicked the + button on the calculator"
Screenshot after action: [image]
Question: Does the screenshot show that the + button was actually clicked?
Answer yes/no and explain what the screenshot actually shows.
```

Gap = `model_thought` vs `verifier_assessment` → 这就是你说的"思考差距"。

---

## 实施路线图

### Phase 1 — Prompt-Only 改进（0 代码，当天可完成）
1. ✅ JSON schema 加 `thought` 字段
2. ✅ 坐标空间 → 0–999 + 明确 bounds 描述
3. ✅ Recovery action menu 替代泛化 nudge
4. ✅ Progress-aware step budget nudge
5. ✅ Post-action verification template
6. ✅ Positive framing 替代 "do NOT"

### Phase 2 — 小代码改动（1-3 天）
1. 分辨率 1280×800
2. PNG 替代 JPEG
3. Reflection buffer (3 条)
4. double_click + right_click actions
5. Post-processing coordinate clamp
6. 截图稳定性轮询（3s settle）
7. 旧截图→文本摘要替换

### Phase 3 — 架构增强（1-2 周）
1. UIA 可访问性树集成
2. SoM 编号标注叠加
3. Zoom-in crop 工具
4. Pre-execution plan 生成
5. Workflow memory (SQLite)
6. dHash perceptual hash

### Phase 4 — 长期方向
1. OmniParser v2 集成
2. 模型评估：Qwen2.5-VL 7B vs Qwen 3.5 4B
3. UFO 式 dual-agent
4. Self-evolving 闭环系统

---

## 核心论文参考

| 简称 | 论文 | 关键贡献 |
|------|------|---------|
| SoM | [arXiv:2310.11441](https://arxiv.org/abs/2310.11441) | 视觉标注 prompting |
| SeeClick | [arXiv:2401.10935](https://arxiv.org/abs/2401.10935) | GUI grounding pre-training, ScreenSpot benchmark |
| OmniParser | [arXiv:2408.00203](https://arxiv.org/abs/2408.00203) | YOLO 元素检测 + SoM 标注 |
| UI-TARS | [arXiv:2501.12326](https://arxiv.org/abs/2501.12326) | SOTA 42.5% OSWorld, self-evolving |
| AGUVIS | [arXiv:2412.04454](https://arxiv.org/abs/2412.04454) | 两阶段训练, inner monologue |
| ShowUI | [arXiv:2411.17465](https://arxiv.org/abs/2411.17465) | 2B 模型 75.1% ScreenSpot |
| OS-Atlas | [arXiv:2410.23218](https://arxiv.org/abs/2410.23218) | 13M GUI 元素语料 |
| UFO | [arXiv:2402.07939](https://arxiv.org/abs/2402.07939) | Windows UIA + dual-agent |
| Agent S2 | [arXiv:2504.00906](https://arxiv.org/abs/2504.00906) | Mixture of Grounding |
| Reflexion | [arXiv:2303.11366](https://arxiv.org/abs/2303.11366) | Verbal reinforcement learning |
| OSWorld | [arXiv:2404.07972](https://arxiv.org/abs/2404.07972) | 桌面 GUI benchmark |
| CogAgent | [arXiv:2312.08914](https://arxiv.org/abs/2312.08914) | 双分辨率架构 |
| ScreenAgent | [arXiv:2402.07945](https://arxiv.org/abs/2402.07945) | Plan-Act-Reflect 流水线 |
| Qwen2-VL | [arXiv:2409.12191](https://arxiv.org/abs/2409.12191) | Dynamic Resolution, 14px patches |
| ScreenSpot-Pro | [arXiv:2504.07981](https://arxiv.org/abs/2504.07981) | 专业高分辨率 grounding benchmark |

## 核心开源仓库

| 仓库 | Stars | 用途 |
|------|-------|------|
| [microsoft/OmniParser](https://github.com/microsoft/OmniParser) | 24.6k | 视觉元素检测 + SoM |
| [microsoft/UFO](https://github.com/microsoft/UFO) | 8.2k | Windows CUA 参考实现 |
| [bytedance/UI-TARS](https://github.com/bytedance/UI-TARS) | — | SOTA GUI agent |
| [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | — | 分层规划 + MoG |
| [microsoft/SoM](https://github.com/microsoft/SoM) | 1.5k | SoM prompting 实现 |
| [yinkaisheng/Python-UIAutomation](https://github.com/yinkaisheng/Python-UIAutomation-for-Windows) | 3.4k | 最快 Python UIA |
