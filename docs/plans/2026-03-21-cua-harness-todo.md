# CUA Harness — 优化清单 v2 (Final)

**日期**: 2026-03-21
**基于**: 15+ 个 sub-agent 的并行调研 + 完整 code review
**分支**: `worktree-cua-harness` (已推到 origin)

---

## 已完成 ✅

### P0 Bug Fixes
- [x] 坐标缩放 `mapToScreenCoords()`
- [x] Windows DPI 感知 `SetProcessDPIAware()`
- [x] click 边界检查
- [x] key_press 返回错误（不再静默失败）
- [x] scroll 方向验证
- [x] **PowerShell 脚本注入修复** — 用临时文件替代字符串插值 (C-2)
- [x] **macOS bash 注入修复** — 用 stdin pipe 替代 bash -c (H-4)
- [x] **macOS Retina 坐标修复** — osascript 逻辑分辨率替代 sips 物理像素 (H-2)
- [x] **Windows 水平滚动方向修复** (H-1)
- [x] **unsubscribe 泄漏修复** — 移到 finally (H-5)
- [x] **steer() 错误日志** — 不再静默吞掉 (H-6)
- [x] **Compaction 关闭** — 防止丢弃截图 (Pi SDK API)
- [x] **beforeToolCall 步数限制** — 替代 steer() (Pi SDK API)
- [x] **num_ctx 32768** — 防 OOM

### P1 Robustness
- [x] 截图指纹 hash + Hamming distance 变化检测
- [x] 循环检测（action hash, 3次阈值, soft nudge）
- [x] Trajectory JSONL 日志 + 截图文件保存
- [x] 系统 prompt — `/no_think`, 安全护栏, 自我验证
- [x] Few-shot 示例 (7 个 Windows CUA 场景)

### Benchmark
- [x] 自动化 benchmark runner
- [x] 失败自动分类
- [x] Markdown 报告生成
- [x] 预定义 Tier 1-2 任务

---

## 待做 — 按优先级排序

### Phase 1.5: Demo 前必做 (1-3 天)

| # | 优化项 | 来源 | 影响 | 文件 |
|---|-------|------|------|------|
| 1 | **Ollama 健康检查** — 在 sub-agent 创建前验证 Ollama + 模型可用 | 安全调研 | 防崩溃 | cua-sub-agent.ts |
| 2 | **剪贴板 save/restore** — type_text 前保存剪贴板,后恢复 | Code Review L-1 + 安全 | 防数据丢失 | cua-tools.ts |
| 3 | **Windows 防睡眠** — `SetThreadExecutionState` 包装 | 安全调研 | 防 demo 中断 | cua-sub-agent.ts |
| 4 | **Temperature 0.0** — 坐标输出需要确定性 | Qwen 调研 | +精度 | cua-sub-agent.ts |
| 5 | **JPEG Q=85 截图** — 替代 PNG,减 80% payload | 截图调研 | -延迟 | cua-tools.ts |
| 6 | **step 计数器修复** — trajectory 里 step 永远是 0 | Code Review M-3 | 调试 | cua-tools.ts |
| 7 | **系统 prompt 精简** — 详细指令放 tool description | Qwen 调研 | +准确率 | cua-sub-agent.ts |
| 8 | **CUA 工具条件注册** — 只在 config 启用时加载 | Code Review H-7 | 防误触发 | agent-runner.ts |

### Phase 2: 性能优化 (1 周)

| # | 优化项 | 来源 | 影响 |
|---|-------|------|------|
| 9 | **持久化 PowerShell** — 避免每次 spawn, 省 ~700ms/步 | Windows 调研 | 极高 |
| 10 | **动作类型延迟表** — click 300ms, type 120ms, scroll 80ms | 时序调研 | 中 |
| 11 | **截图 diff 轮询** — 等 UI 稳定（2 帧不变）替代固定延迟 | 时序调研 | 高 |
| 12 | **Ollama 预热** — session 开始时发空请求加载模型 | 时序调研 | -3-5s 首次延迟 |
| 13 | **keep_alive: 30m** — 防 5 分钟超时卸载 | 时序调研 | 中 |
| 14 | **`afterToolCall` 剥离旧截图** — 执行后删除 base64 节省上下文 | Pi SDK 调研 | 中 |
| 15 | **UAC 检测** — 黑屏 = UAC 弹窗,停止任务 | 安全调研 | 中 |
| 16 | **窗口焦点验证** — type_text 前检查前台窗口 | 安全调研 | 中 |

### Phase 3: 精度提升 (2 周)

| # | 优化项 | 来源 | 影响 |
|---|-------|------|------|
| 17 | **SOM via Windows UIA** — 枚举交互元素,画编号框 | 截图+Windows 调研 | +20-35% 精度 |
| 18 | **0-1000 归一化坐标** — Qwen 原生格式 | Qwen 调研 | +精度(需测试) |
| 19 | **窗口裁剪** — 截图只截活动窗口 | 截图调研 | 高(聚焦任务) |
| 20 | **历史图片降采样** — 旧截图 640×360 Q=70 | 截图调研 | -40% token |
| 21 | **SendInput 替代 mouse_event** — 更可靠的点击 | Windows 调研 | 中 |
| 22 | **Win 键别名** — key_press 支持 Win+R, Win+S 等 | Windows 调研 | 低 |

### Phase 4: 生产化

| # | 优化项 |
|---|-------|
| 23 | C# helper exe 替代 PowerShell (30ms vs 300ms) |
| 24 | macOS Swift CLI binary (<10ms) |
| 25 | OmniParser sidecar (YOLO UI 检测) |
| 26 | Reflection Agent (每步额外验证) |
| 27 | 多显示器支持 |
| 28 | 安全确认 UI (Send/Delete 前暂停) |
| 29 | Claude/GPT backend 实现 |
| 30 | 评测框架 — 复用 WindowsAgentArena 任务 JSON |
| 31 | UI overlay — step counter + 推理文本 + 点击高亮 |
| 32 | Demo 录制备份工具 |

---

## Demo 准备清单

### T-72h: 环境搭建
- [ ] Windows 机器安装 Ollama + `ollama pull qwen3.5:9b`
- [ ] 100% DPI 缩放,1920×1080 分辨率
- [ ] 高性能电源计划,禁用睡眠
- [ ] 关闭 Windows Update 自动安装

### T-48h: 排练开始
- [ ] 跑 20 次 baseline (Tier 1: 记事本+设置+计算器)
- [ ] 记录成功率,选最高的作为主 demo
- [ ] 跑 10 次 Tier 2 (Excel 数据整理)
- [ ] 拍摄预录备份视频

### T-24h: 最终准备
- [ ] 环境快照保存
- [ ] Slides 完成 (架构图+竞品表+路线图)
- [ ] 5 次完整排练,记录日志
- [ ] 准备 recovery 话术

### Demo 当天
- [ ] 到场后先连投影仪验证分辨率
- [ ] 跑 1 次完整 demo 热身
- [ ] 重置 demo 数据
- [ ] 关闭所有非 demo 应用 + 通知

---

## 文件清单 (当前分支)

```
src/main/cua/
├── cua-tools.ts            (540 LoC) — 5 GUI tools + 坐标映射 + DPI + 变化检测
├── cua-sub-agent.ts        (230 LoC) — sub-agent + beforeToolCall + computer_use tool
├── cua-screenshot-hash.ts   (50 LoC) — 截图指纹 hash
├── cua-loop-detector.ts     (60 LoC) — 循环检测
├── cua-trajectory.ts        (80 LoC) — JSONL 轨迹日志
├── cua-benchmark.ts        (290 LoC) — 自动化 benchmark runner
└── cua-few-shot-examples.ts (260 LoC) — 7 个 Windows few-shot 示例

src/main/claude/
└── agent-runner.ts          (+8 LoC) — 注册 computer_use tool

docs/plans/
└── 2026-03-21-cua-harness-todo.md — 本文件
```

**总计: ~1,520 LoC, 6 commits, 分支 `worktree-cua-harness`**
