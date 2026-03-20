# CUA Harness — TODO & Optimization Roadmap

**Branch**: `worktree-cua-harness` (experimental, do NOT merge until validated)
**Status**: Skeleton implemented, needs testing and optimization
**Goal**: Beat existing gui-operate-server MCP approach in demo scenarios

---

## Phase 0: Validation (must pass before any merge)

- [ ] **Windows 实机测试**: 在 Windows 上安装 Ollama + qwen3.5:9b，验证基本 screenshot → click 流程
- [ ] **macOS 实机测试**: 在 macOS 上验证同样的流程
- [ ] **Tool calling 可靠性**: 验证 Ollama tool calling 是否能正常工作，如果不行则切换到 structured output
- [ ] **对比测试**: 用相同的简单任务（如"打开记事本"）对比新 CUA harness vs 旧 gui-operate MCP 的成功率
- [ ] **延迟测试**: 测量端到端延迟（截图 + 推理 + 执行），目标 < 10s/步

---

## Phase 1: P0 Bug Fixes (已完成 ✅)

- [x] 坐标缩放 `mapToScreenCoords()` — 模型坐标 → 真实屏幕坐标
- [x] Windows DPI 感知 — `SetProcessDPIAware()`
- [x] click 边界检查 — 越界返回错误文本
- [x] key_press 错误返回 — 未知键名返回有效键名列表
- [x] scroll 方向验证
- [x] macOS scroll 修复 — 用 cliclick 替代坏掉的 AppleScript
- [x] 动作后延迟 — click 500ms, type 200ms, key 300ms
- [x] 屏幕尺寸缓存
- [x] 系统 prompt 改进 — `/no_think`, 安全护栏, 自我验证
- [x] num_ctx 限制 32768（防 OOM）

---

## Phase 2: P1 Robustness (Demo 前必须完成)

### 截图变化检测
- [ ] 实现 `averageHash(buf)` — 将截图缩为 8×8 灰度 → 64-bit hash
- [ ] 每次 action 后对比 before/after hash（Hamming distance）
- [ ] distance < 6 → 注入提示"Your action had no visible effect"
- [ ] 复杂度: 低 | 影响: +8-12% 成功率

### 循环检测
- [ ] 记录最近 10 个 action 的 hash（action_type + params normalized）
- [ ] 连续 3 个相同 action → 注入"You are repeating the same action. Try a different approach."
- [ ] 使用 soft nudge，不硬阻止
- [ ] 复杂度: 低 | 影响: +5-10%

### 步数预算管理
- [ ] 50% maxSteps → 注入"You are halfway through. Focus on key actions."
- [ ] 75% maxSteps → 注入"Running low on steps. Wrap up or summarize progress."
- [ ] 90% maxSteps → 注入"Last chance. Complete or report what was accomplished."
- [ ] 复杂度: 极低 | 影响: +3-5%

### Trajectory 日志
- [ ] 创建 `cua-trajectory.ts` — JSONL writer
- [ ] 每步记录: step, timestamp, action, screenshot_before (file path), screenshot_after, model_response, action_result
- [ ] 截图保存到 `~/.open-cowork/cua-trajectories/session-{id}/`
- [ ] 复杂度: 低 | 影响: 调试必需

### 重试策略
- [ ] action 返回 error → 自动注入错误上下文给模型（已部分实现）
- [ ] 同一 action 失败 2 次 → 注入"Try a different approach"
- [ ] 连续 3 次失败 → 触发 graceful failure
- [ ] 复杂度: 低 | 影响: +5-8%

### Dialog 检测
- [ ] 在系统 prompt 中加入: "If you see a popup dialog, error message, or notification, handle it before continuing"
- [ ] 已在 prompt 中部分实现
- [ ] 复杂度: 极低（纯 prompt）

---

## Phase 3: P2 进阶优化 (Demo 后)

### SOM via Windows UIA
- [ ] 实现 `enumerateUiaElements()` — PowerShell 调用 Windows UI Automation API
- [ ] 过滤可交互元素 (Button, CheckBox, ComboBox, Edit, MenuItem)
- [ ] 在截图上画编号 bounding box
- [ ] 修改 prompt: "Click element 7" 替代坐标
- [ ] 回退: UIA 不可用时降级为原始截图
- [ ] 预估: +20-35% 点击精度（对 9B 模型效果最大）
- [ ] 复杂度: 中 | 影响: 极高

### 0-1000 归一化坐标
- [ ] 如果切换到 UI-TARS 或 MAI-UI 等 GUI 微调模型，改用 0-1000 坐标
- [ ] 对 Qwen 3.5（通用模型）影响不大，暂跳过
- [ ] 复杂度: 低

### 窗口裁剪
- [ ] 实现 `getForegroundWindowBounds()` — Win32 GetForegroundWindow + GetWindowRect
- [ ] 根据 `app_hint` 参数裁剪到目标窗口
- [ ] 目标窗口占满 1280×720 → 更高分辨率看到更多细节
- [ ] 复杂度: 中 | 影响: 高（聚焦任务）

### 历史图片降采样
- [ ] 旧截图降到 640×360 JPEG Q=70
- [ ] 只保留最近 2 张全分辨率 + 1 张半分辨率
- [ ] 减少 ~40% 视觉 token
- [ ] 复杂度: 低

### Before/After 截图标注
- [ ] 在 prompt 中明确标注 [PREVIOUS screenshot] / [CURRENT screenshot]
- [ ] 帮助模型理解哪些变化是由上一步 action 引起的
- [ ] 复杂度: 极低

### Tool calling → Structured output 切换
- [ ] 如果 Ollama tool calling bug (#14745) 影响使用
- [ ] 切换到 `format: json_schema` 模式
- [ ] 自己驱动 obs→action 循环（~50 行代码改动）
- [ ] 准备好但不急着换

---

## Phase 4: 生产化 (长期)

- [ ] Windows C# helper exe 替代 PowerShell（延迟 300ms → 30ms）
- [ ] macOS Swift CLI binary 替代 cliclick+osascript（延迟 50ms → <10ms）
- [ ] OmniParser sidecar（YOLO UI 元素检测 + Florence 标注）
- [ ] Reflection Agent（每步额外一次 LLM 调用验证）
- [ ] 多显示器支持（显示器偏移 + 指定显示器截图）
- [ ] 安全确认 UI（Send/Delete 前暂停等用户确认）
- [ ] Claude/GPT backend 实现
- [ ] 单元测试 + 集成测试

---

## Metrics to Track

| 指标 | 目标 | 如何测量 |
|------|------|---------|
| 简单任务成功率 | >80% | Tier 1 场景（设置切换等）跑 10 次 |
| 中等任务成功率 | >50% | Tier 2 场景（Excel 操作等）跑 10 次 |
| 单步延迟 | <8s | screenshot→推理→执行 端到端 |
| 上下文隔离 | 100% | 主 agent 上下文不含任何截图 |
| 坐标精度 | >85% 点中目标 | 手动标注 20 次点击的目标元素 |

---

## Files

| File | Lines | Status |
|------|-------|--------|
| `src/main/cua/cua-tools.ts` | ~340 | ✅ P0 修复完成 |
| `src/main/cua/cua-sub-agent.ts` | ~190 | ✅ Prompt 改进完成 |
| `src/main/claude/agent-runner.ts` | +8 | ✅ 注册 computer_use tool |
| `src/main/cua/cua-trajectory.ts` | ~80 | ❌ 待实现 |
