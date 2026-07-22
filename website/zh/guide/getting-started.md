# 快速上手

从下载到跑完第一个任务,大约五分钟。

## 1. 安装

- **macOS**:从 [Releases](https://github.com/OpenCoworkAI/open-cowork/releases) 下载 `.dmg`,把 Open Cowork 拖进「应用程序」。或使用 Homebrew:

  ```bash
  brew tap OpenCoworkAI/tap
  brew install --cask --no-quarantine open-cowork
  ```

  > 首次打开如果提示「无法验证开发者」,右键点击应用 → **打开** → **打开**,只需一次。未公证的构建出现此提示属正常现象。

- **Windows**:从 Releases 下载并运行 `.exe` 安装包。

## 2. 获取 API Key

Open Cowork 提供界面,模型 API Key 由你自备。打开 **设置 → API 设置**,展开「常见服务配置」:每个平台旁都有 **获取 API Key** 链接,直达对应控制台。常见选择:

| 平台 | 适合 | Key 控制台 |
|---|---|---|
| OpenRouter | 一个 Key 用多家模型 | [openrouter.ai/keys](https://openrouter.ai/keys) |
| DeepSeek | 低成本、中文强 | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| 智谱 GLM | 国内直连 | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/apikeys) |
| Ollama | 完全本地、无需 Key | 跑在你自己电脑上 |

粘贴 Key、选好模型后点 **测试连接**——内置诊断会按 DNS → TCP → TLS → 认证 → 模型逐级检查,准确告诉你卡在哪一步。

## 3. (推荐)启用沙盒

在 **设置 → 沙盒** 启用 VM 隔离(Windows 用 WSL2,macOS 用 Lima)。聊天页头部的徽章实时显示当前状态:绿色「沙盒隔离」表示命令在虚拟机内执行;黄色「未隔离」表示直接在本机执行。

> GUI 操作和 `sudo` 命令按设计始终在本机执行——沙盒覆盖的是 shell 命令与文件操作。

## 4. 跑第一个任务

回到首页:选择一个**工作文件夹**(AI 只会操作这个文件夹内的文件),输入你想做的事,比如「按文件类型整理这个文件夹」,点 **开始**。

右侧 trace 面板会实时展示 AI 的每一步操作;涉及修改文件的工具会先弹窗征求你的同意。
