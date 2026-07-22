# 故障排查

按新用户最常遇到的顺序排列。

## macOS 打不开应用

*「无法打开 Open Cowork,因为无法验证开发者」*

在「应用程序」中右键点击应用 → **打开** → **打开**,只需一次。用 Homebrew 安装时带上 `--no-quarantine` 参数(见[下载页](https://github.com/OpenCoworkAI/open-cowork/releases))即可跳过。

## 「认证失败」/ 401

API Key 错误、已过期,或无权访问所选模型。

1. 从平台控制台重新复制 Key(设置里每个平台旁的**获取 API Key**链接直达)。
2. 点 **测试连接**——诊断会定位问题出在网络、认证还是模型名。
3. 用 OpenRouter 时确认账户有余额。

## 「请求被限流」/ 429

平台在限流。等一分钟重试;若持续出现,可能是 Key 等级不够跑该模型——查看平台控制台,或换个更便宜的模型。

## 网络错误 / 超时

- 用浏览器或 `curl` 测试同一个接口地址是否可达。
- 用了代理/VPN 的话试着切换开关——不稳定的网关是任务中途断连最常见的原因,Agent 会自动重试。
- 公司防火墙环境下,确认模型平台的 API 域名在放行名单里。

## 沙盒安装失败

- **macOS**:VM 隔离依赖 Lima,执行 `brew install lima` 后在 设置 → 沙盒 重试;确保磁盘剩余空间 ≥ 5 GB。
- **Windows**:需启用 WSL2:管理员 PowerShell 执行 `wsl --install`,重启后重试。
- 也可以点 **继续** 跳过 VM 直接使用——聊天页头部黄色「未隔离」徽章会提醒你防护等级降低。

## 会话一直显示「运行中」

如果任务运行期间应用崩溃或被强退,重启应用即可——中断的会话会被自动复位,重发上一条消息即可继续。如果是正在运行的会话卡住,点停止按钮后重新发送。

## 文档生成(PPTX/DOCX/XLSX)失败

升级到最新版——v3.4 起所需 Python 库已随应用打包。若错误提到 `soffice`,安装 [LibreOffice](https://www.libreoffice.org/) 可启用幻灯片缩略图(不装也不影响生成本身)。

## 还是解决不了?

**设置 → 日志 → 导出** 会生成日志包,附到 [GitHub issue](https://github.com/OpenCoworkAI/open-cowork/issues)(日志不含 API Key),或到 [Discord](https://discord.gg/pynjtQDf) 提问。
