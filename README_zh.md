<p align="center">
  <img src="resources/logo.png" alt="Open Cowork Logo" width="180" />
</p>

<h1 align="center">🚀 Open Cowork: 你的私人 AI 智能助手桌面应用</h1>

<p align="center">
  <strong>🚀 Claude Cowork 的开源实现</strong><br/>
  <br/>
  一键安装 • 隐私优先 • 自带 API Key
</p>

<p align="center">
  <a href="./README.md">English Docs</a> •
  <a href="#特性">核心特性</a> •
  <a href="#演示">演示视频</a> •
  <a href="#下载">下载安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#技能库">技能库</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-18+-brightgreen" alt="Node.js" />
</p>

---

## 📖 简介

**Open Cowork** 是 **Claude Cowork** 的开源实现，提供 **Windows** 和 **macOS** 一键安装包，无需任何编程知识。

它为 AI 提供了一个沙盒化的工作环境，可以管理文件、读取文档，并通过内置的 Skills 系统生成专业的 **PPTX**、**DOCX**、**XLSX** 等。

---

## ✨ 核心特性

- **零门槛上手**：提供 Windows 和 macOS 预构建安装包，下载即用。
- **自带 API Key**：使用你的 OpenRouter 或 Anthropic API Key，按需付费。
- **文件管理**：AI 可以在工作区内读取、写入和整理文件。
- **Skills 系统**：内置 PPTX、DOCX、PDF、XLSX 生成和处理工作流。
- **实时追踪**：在 Trace Panel 中观察 AI 推理和工具调用过程。
- **沙盒安全**：所有操作限制在你选择的工作区文件夹内。

---

## 🎬 演示

观看 Open Cowork 实战演示：

<p align="center">
  <a href="https://www.youtube.com/watch?v=MyuiO70R0h8">
    <img src="https://img.youtube.com/vi/MyuiO70R0h8/maxresdefault.jpg" alt="Open Cowork 演示 1" width="400" />
  </a>
  <a href="https://www.youtube.com/watch?v=piEEor1ohHo">
    <img src="https://img.youtube.com/vi/piEEor1ohHo/maxresdefault.jpg" alt="Open Cowork 演示 2" width="400" />
  </a>
</p>

---

## 📦 下载与安装

### 方式一：下载安装包（推荐）

请访问我们的 [Release 页面](https://github.com/your-username/open-cowork/releases) 下载最新版本。

| 平台 | 文件类型 |
|------|----------|
| **Windows** | `.exe` |
| **macOS** (Apple Silicon) | `.dmg` |

### 方式二：源码编译

适合想要贡献代码或进行二次开发的开发者：

```bash
git clone https://github.com/your-username/open-cowork.git
cd open-cowork
npm install
npm run dev
```

构建安装包：`npm run build`

---

## 🚀 快速开始

### 1. 获取 API Key
你需要一个 API Key 来驱动 Agent。推荐使用：
- **[OpenRouter](https://openrouter.ai/)**：一个 Key 通用所有模型（推荐 Claude 3.5 Sonnet）。
- **[Anthropic Console](https://console.anthropic.com/)**：官方直连。

### 2. 配置
1. 打开应用。
2. 点击左下角的 ⚙️ **设置** 图标。
3. 粘贴你的 API Key。
   * *提示：如果使用 OpenRouter，请将 Base URL 设置为 `https://openrouter.ai/api`。*

### 3. 开始协作
1. **选择工作区**：选择一个文件夹，授权 Claude 在其中工作。
2. **输入指令**：
   > "读取当前文件夹下的 financial_report.csv，并帮我生成一份包含 5 页幻灯片的 PPT 总结报告。"

---

## 🏗️ 架构概览

```
open-cowork/
├── src/
│   ├── main/                 # Electron 主进程 (Node.js)
│   │   ├── claude/           # Agent SDK 与运行器
│   │   ├── sandbox/          # 安全与路径解析
│   │   └── skills/           # 技能加载与管理
│   └── renderer/             # 前端 UI (React + Tailwind)
├── .claude/skills/           # 默认技能定义
└── resources/                # 静态资源
```

---

## 🗺️ 路线图

- [x] **核心**：稳定的 Windows & macOS 安装包
- [x] **安全**：完整的文件系统沙盒
- [x] **技能**：支持 PPTX, DOCX, PDF, XLSX
- [ ] **记忆优化**：改进长会话的上下文管理和跨会话记忆。

---

## 🤝 贡献指南

欢迎任何形式的贡献！无论是新技能、UI 修复还是安全改进：

1. Fork 本仓库。
2. 创建分支 (`git checkout -b feature/NewSkill`)。
3. 提交 PR。

---

## 📄 许可证

MIT © Open Cowork Team

---

<p align="center">
  Made with ❤️ by the Open Cowork Team
</p>
