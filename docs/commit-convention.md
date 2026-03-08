# 提交信息规范

- 日期：2026-03-08
- 执行者：Codex

## 为什么现在统一

最近检查仓库的 200 条提交后，可以看到当前风格已经有明显主流：

- 约 129 条已经符合 `type(scope): subject` 这一类 Conventional Commits 结构。
- 少数提交仍是普通英文句子、`temp`、`Release v...` 或 `merge` 之类的自由格式。

这说明仓库并不是没有规范，而是“已经在趋同，但没有被工具正式约束”。因此本次统一选择顺着现有主流，正式采用 Conventional Commits 作为未来提交规范，而不是重新发明一套格式。

## 统一后的格式

```text
type(scope): subject
```

- `type`：必填，表示改动类型。
- `scope`：选填，表示影响范围，例如 `ui`、`session`、`proxy`。
- `subject`：必填，简短描述这次改动做了什么。

推荐写法：

- 使用英文短句。
- 保持一句话说清楚改动。
- 优先使用小写开头，但允许技术缩写如 `MCP`、`API`、`RAF`。
- 不要使用 `temp`、`wip`、`misc update` 这类无法表达意图的标题。

## 推荐类型

| type | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat(ui): add grouped session sidebar` |
| `fix` | 缺陷修复 | `fix(proxy): harden empty response handling` |
| `perf` | 性能优化 | `perf: reduce runtime config and session overhead` |
| `refactor` | 重构，不改变外部行为 | `refactor(prompt): remove dead AskUserQuestion guidance` |
| `docs` | 文档改动 | `docs: add commit message convention` |
| `test` | 测试相关 | `test(proxy): add regression coverage for warm path` |
| `build` | 构建、打包、依赖构建链 | `build: align electron rebuild workflow` |
| `ci` | 持续集成或自动化流程 | `ci: refine release workflow` |
| `chore` | 杂项维护 | `chore: ignore local workspace artifacts` |
| `style` | 纯样式、格式调整 | `style(ui): normalize sidebar spacing` |
| `merge` | 手工撰写的合并说明 | `merge(main): integrate main into dev` |
| `release` | 版本发布 | `release: cut v3.3.0-beta.2` |
| `revert` | 回滚提交 | `revert: revert proxy warmup toast experiment` |

## scope 建议

`scope` 不是强制项，但建议在以下场景使用：

- 只影响单一模块时：`ui`、`proxy`、`session`、`config`、`schedule`
- 需要帮助后续检索时
- 变更跨多个功能但有明确中心模块时

如果这次改动是横跨多个模块的小范围调整，也可以直接省略 `scope`。

## 合格示例

```text
feat(ui): redesign right sidebar session info
fix(codex): filter transcript-only agent messages
perf: reduce runtime config and session overhead
docs: add commit message convention
chore: ignore local workspace artifacts
merge(main): integrate main into dev
release: cut v3.3.0-beta.2
```

## 不合格示例

```text
temp
update
fix bug
UI polish
some changes
```

不合格的主要原因通常是：

- 没有 `type`
- 没有明确动作
- 范围与目的都不清楚
- 无法从标题判断这次提交的价值

## 本地校验

仓库已接入 `commitlint + husky`，提交时会自动校验 commit message。

首次拉取新依赖后，执行：

```bash
npm install
npm run prepare
```

手动校验最近一次提交：

```bash
npm run commitlint -- --last --verbose
```

说明：该命令会直接检查当前 `HEAD` 的提交标题。如果 `HEAD` 还是历史遗留的旧格式，失败属于预期现象。

手动校验一条示例消息：

```bash
echo "feat(ui): redesign right sidebar session info" | npx commitlint --config commitlint.config.cjs
```

## 例外说明

- Git 自动生成的 merge / revert 消息会由 commitlint 默认忽略，不需要改写。
- 本次规范化不改写既有历史提交，只约束后续新增提交。
- 历史里已有的自由格式提交可以保留；如果后续需要整理历史，请单独评估是否进行交互式 rebase。
