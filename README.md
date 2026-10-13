# HAPI Personal Fork

Run official Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness sessions and control them remotely through native iOS / Android apps, Web / PWA, or Telegram Mini App.

本项目 fork 自 [tiann/hapi](https://github.com/tiann/hapi)。

## 版本与上游基线

- 当前个人发布版本：`@youngfine/hapi@0.30.7-youngfine.4`。
- 基于上游 `v0.30.7`，对应提交 `0239edf3`；保留该版本的 Web、CLI、Hub、Android 和 iOS 能力，并叠加下述个人改动。
- 截至 `2026-10-13` 拉取核对，上游最新版本标签为 `v0.30.7`，但 `main` 已有后续开发提交；本发布不包含这些尚未合入的提交，不等同于同步上游最新 `main`。

## 我的改动

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

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Shared Codex Sessions** - Use Codex from your terminal and phone at the same time. Requires Codex 0.154.0+. [Usage and limits](docs/guide/codex-shared-sessions.md).
- **Native First** - HAPI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Grok Build, OpenCode, Kimi, Copilot, Antigravity, Pi, DeepSeek Harness—different agents, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone's browser or desktop web app, directly connected to the working machine.
- **Voice Control** - Use dictation in native apps, or talk to your AI agent hands-free with the web voice assistant.
- **Workspace Browser** - Opt-in via one or more `hapi runner start --workspace-root <path>` flags: browse scoped file trees from the web and start sessions in allowed subdirectories.

## 使用

```bash
npm install -g @youngfine/hapi --registry=https://registry.npmjs.org
hapi hub --relay
hapi runner start --workspace-root ~/git-repository
```

`hapi server` remains supported as an alias.

Use `hapi <agent> [options]` to start an agent directly, for example `hapi claude`
or `hapi codex`. Scripts must specify the agent explicitly. `hapi --help` shows
HAPI's commands and supported agents.

The hub displays a URL and two QR codes. Open the web URL in a browser, or pair a native app using the companion QR. See [Native apps](docs/guide/native-apps.md) for build and pairing instructions.

> The relay uses WireGuard + TLS for end-to-end encryption. Your data is encrypted from your device to your machine.

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md)

## Docs

- [Native apps (iOS / Android)](docs/guide/native-apps.md)
- [Web / PWA](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Supported Agents](docs/guide/agents.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAPI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Native apps (iOS / Android)

The repository includes SwiftUI/UIKit and Kotlin Compose clients with chat, approvals, session creation, files, dictation, and push notifications. See the [native app guide](docs/guide/native-apps.md) for capabilities, platform differences and pairing. Build instructions: [iOS](ios/README.md) and [Android](android/README.md). Developer protocol: [client contract](docs/api/client-contract/index.md).

## Build from source

Requires Bun 1.4.0.

```bash
bun install
bun run build:single-exe
```

## Credits

HAPI means "哈皮" a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
