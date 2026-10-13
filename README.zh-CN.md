# HAPI Personal Fork

[English](README.md) | **简体中文**

运行官方 Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness 会话，通过原生 iOS / Android 应用、Web / PWA 或 Telegram Mini App 远程控制。

本项目 fork 自 [tiann/hapi](https://github.com/tiann/hapi)。

## 版本与上游基线

- 当前个人发布版本：`@youngfine/hapi@0.30.7-youngfine.5`。
- 基于上游 `v0.30.7`，对应提交 `0239edf3`；保留该版本的 Web、CLI、Hub、Android 和 iOS 能力，并叠加下述个人改动。
- 截至 `2026-10-13` 拉取核对，上游最新版本标签为 `v0.30.7`，但 `main` 已有后续开发提交；本发布不包含这些尚未合入的提交，不等同于同步上游最新 `main`。

## 我的改动

### 0.30.7-youngfine.5：构建隐私与双语文档

- 编译后的程序通过 Bun 虚拟文件系统解析模块路径，不再嵌入构建机器的工作区和用户主目录。
- 禁用构建时环境变量内联，并继续禁止运行时自动加载 `.env`；运行配置仍从明确设置的环境变量和配置文件读取。
- 编译后及 npm 打包前检查构建路径，使用 `--skip-build` 复用的二进制也必须通过检查；这不是全面密钥审计，也不会改变已经发布的旧包。
- 默认 README 改为英文，新增完整中文版，npm 主包同时包含两种语言文档。
- GitHub Release 使用与 npm 打包相同的已检查二进制，macOS 产物经过临时签名及验证；本次不提供 APK。

### 聊天与操作体验

- 增加独立的“临时上下文”入口，长文本可以作为 `.txt` 附件与输入框中的问题一起发送。
- 粘贴文本达到默认 `3000` 字符或超过 `60` 行时自动转换为附件，两个阈值可以在“设置 → 聊天 → 输入”中自定义。
- 支持直接粘贴普通文件，不再只处理图片。
- User 消息超过 `15` 行时默认折叠，展开后立即显示完整内容。
- 运行中默认需要在 `2` 秒内按两次 `Esc` 才中断任务，首次按下会提示；可在“设置 → 聊天 → 输入”改为按一次。

### 0.30.7-youngfine.4：原生推送扩展

- **vivo / iQOO 推送**：Android 新增独立于 FCM 的 vivo 测试推送渠道，支持会话完成、权限审批和任务通知；需在 App 设置中明确同意并启用，开启系统通知权限本身不会完成渠道注册。
- **可扩展渠道架构**：Hub 统一原生推送渠道注册与通知分发，Android 统一渠道选择、设备注册、令牌更新和重试；保留 FCM、Android 加密中继及 iOS APNs/中继，后续渠道可通过适配器和注册表扩展，无需在会话业务中增加厂商分支。
- **网页测试入口**：在“设置 → 通用 → 伴侣应用 → 推送设备”查看当前命名空间下已注册的设备、刷新列表并发送单设备测试推送；测试有 `10` 秒冷却，当前不支持 iOS 测试发送，平台受理不等于手机确认送达。
- **隐私保护**：vivo 通知仅展示通用提示，不明文发送聊天内容、会话名称或审批详情；点击目标使用设备密钥加密，`AppSecret` 仅保存在 Hub，不能打入 APK 或提交到仓库。
- **真机验证**：`2026-10-13` 已在一台 vivo 手机上验证前台、后台、清掉后台进程三种场景的测试通知，以及真实会话完成通知；此结果不代表所有机型或系统“强行停止”后的送达保证。

#### vivo 配置与限制

Android 构建需配置匹配的 `hapiVivoAppId` 和 `hapiVivoAppKey`，应用名称为 `HAPI`，包名为 `run.hapi.companion`；详见 [Android vivo 接入](android/README.md#vivo-test-push)。

Hub 可在实际使用的 `HAPI_HOME/settings.json`（默认 `~/.hapi/settings.json`）中配置 `vivoPushMode: "test"`、`vivoAppId`、`vivoAppKey`、`vivoAppSecret`，或使用环境变量 `HAPI_VIVO_PUSH=test`、`VIVO_APP_ID`、`VIVO_APP_KEY`、`VIVO_APP_SECRET`；环境变量优先于文件，npm 安装的程序不会自动加载 `.env`。

当前仅接入 vivo **API 单设备测试消息**，不是正式生产推送：每个应用每天最多 `1000` 条，仅向当前联网设备投递，不支持离线缓存，业务通知也受同样限制；未上架或个人开发者账户的可用权限以 vivo 控制台为准。

仅启用本次 vivo 功能，需要升级 Hub 到 `.4` 并安装对应 Android APK，Runner 无需为此升级到 `.4`；配置和测试步骤见 [通知指南](docs/guide/notifications.md)。

## 功能

- **无缝切换**：在本地工作，需要时切换到远程，随时切回，无需丢失上下文或重启会话。
- **共享 Codex 会话**：同时在终端和手机上使用 Codex，需要 Codex 0.154.0 或更新版本，详见[使用方式与限制](docs/guide/codex-shared-sessions.md)。
- **原生优先**：HAPI 包装现有 AI 智能体，而不是替代它，保留熟悉的终端和操作体验。
- **离开电脑也能继续**：在手机上一键审批 AI 请求。
- **自由选择智能体**：Claude Code、Codex、Cursor Agent、Grok Build、OpenCode、Kimi、Copilot、Antigravity、Pi、DeepSeek Harness 使用统一工作流。
- **随处访问终端**：通过手机浏览器或桌面网页直接连接工作机器并执行命令。
- **语音操作**：在原生应用中使用语音输入，或通过网页语音助手与 AI 智能体交流。
- **工作区浏览器**：通过一个或多个 `hapi runner start --workspace-root <path>` 参数主动启用，在网页端浏览授权范围内的文件树，并在允许的子目录中创建会话。

## 使用

```bash
npm install -g @youngfine/hapi --registry=https://registry.npmjs.org
hapi hub --relay
hapi runner start --workspace-root ~/git-repository
```

仍支持 `hapi server` 作为别名。

使用 `hapi <agent> [options]` 直接启动智能体，例如 `hapi claude` 或 `hapi codex`；脚本必须明确指定智能体，`hapi --help` 可查看命令和支持的智能体。

Hub 会显示一个网址和两个二维码，可以在浏览器中打开网页地址，或使用伴侣应用二维码配对原生应用；构建和配对说明见[原生应用指南](docs/guide/native-apps.md)。

> 中继使用 WireGuard + TLS 实现端到端加密，数据从设备到工作机器全程加密传输。

Cloudflare Tunnel、Tailscale 等自托管方式见[安装指南](docs/guide/installation.md)。

## 文档

- [原生应用（iOS / Android）](docs/guide/native-apps.md)
- [Web / PWA](docs/guide/pwa.md)
- [工作原理](docs/guide/how-it-works.md)
- [支持的智能体](docs/guide/agents.md)
- [语音助手](docs/guide/voice-assistant.md)
- [为什么选择 HAPI](docs/guide/why-hapi.md)
- [常见问题](docs/guide/faq.md)

## 原生应用（iOS / Android）

仓库包含 SwiftUI/UIKit 和 Kotlin Compose 客户端，支持聊天、审批、创建会话、文件、语音输入和推送通知；能力、平台差异与配对方式见[原生应用指南](docs/guide/native-apps.md)，构建说明见 [iOS](ios/README.md) 和 [Android](android/README.md)，开发协议见[客户端契约](docs/api/client-contract/index.md)。

## 源码构建

需要 Bun 1.4.0。

```bash
bun install
bun run build:single-exe
```

## 致谢

HAPI 意为“哈皮”，是 [Happy](https://github.com/slopus/happy) 的中文音译，感谢原项目的贡献。
