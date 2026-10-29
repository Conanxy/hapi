# HAPI Personal Fork

[English](README.md) | **简体中文**

运行官方 Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness 会话，通过原生 iOS / Android 应用、Web / PWA 或 Telegram Mini App 远程控制。

本项目 fork 自 [tiann/hapi](https://github.com/tiann/hapi)。

## 版本与上游基线

- 当前个人发布版本：`@youngfine/hapi@0.31.2-youngfine.1`，发布于 `2026-10-27`。
- 已于 `2026-10-27` 合入上游标签 `v0.31.2`，对应提交 `7bf0e5bc`，并保留个人二开改动；本次发布以上述标签为上游基线。
- 已发布 npm 主包及五个平台包：macOS ARM64/x64、Linux ARM64/x64、Windows x64，包含 CLI、Hub 和内嵌网页；原生 iOS、Android 更新已包含在源码中，本次不提供 APK 或 iOS 应用构建。

## 0.33.2 集成候选版（尚未发布）

源码候选版本 `0.33.2-youngfine.1` 合入上游 `v0.33.2`（`730dfcb2`），包含此前已集成的 `v0.33.1`；
正式发布前，当前已发布版本和下方安装命令仍为 `0.31.2-youngfine.1`。

- 会话按持久化的最后一条用户消息时间排序，智能体输出不再持续改变顺序；保留手动置顶，移除原来的“固定会话顺序”开关。
- 会话间消息支持默认 `queue` 排队与 `steer` 插入运行中回合；后者要求目标为运行中的 Pi、Codex 或 Cursor ACP，DSH 继续支持排队投递。
- 输入框只有一个附件时隐藏排序拖柄；Android 主题、语言及个人图片压缩选项使用新的选择弹窗。
- 支持在独立窗口打开会话，并锁定手动设置的会话标题。
- Codex 后续回合运行时可从历史回合分叉；OpenCode 可导入本机会话历史。
- 语音草稿在切换会话后保留，工具卡片支持合并、简洁和详细三种样式。
- `hapi usage` 与 `/api/activity` 提供持久化的智能体工作及等待时长，和 token 用量统计分开；Hub 数据库升级至 v29，并从已有消息回填排序时间，升级前应备份 `HAPI_HOME`。
- 构建要求 Bun 1.4.4；npm 启动器会拒绝版本不一致的平台包，并提供指定版本的重装命令。
- 保留个人二开的文本上下文恢复、图片压缩配置与草稿预处理状态、双 Esc 中断、DSH 扩展和 vivo 推送；Android 图片压缩设置仍位于“通用”子页。

集成范围和验证结果见 [v0.33.2 集成记录](docs/upstream-v0.33.2-integration.md)。

## 0.31.2-youngfine.1 更新内容

### 网页功能与体验入口

| 更新 | 如何体验 |
|------|----------|
| 终端内容转给 Agent | 打开会话的“终端”，点击“发送给 Agent”，将滚动缓冲追加到聊天草稿；先选中文字则使用“选区发送给 Agent”，回到输入框后可检查内容、补充问题再发送。 |
| 固定会话顺序（0.31.2） | 在 0.31.2 中开启“设置 → 显示 → 固定会话顺序”；0.33.2 候选版以最后一条用户消息时间排序取代此开关。 |
| 130% 字号 | 在“设置 → 显示 → 字体大小”选择 `130%`。 |
| 外部链接在新标签页打开 | 开启“设置 → 显示 → 链接 → 在新标签页中打开外部链接”。 |
| 语音输入快捷键 | 语音功能可用时，按 `Ctrl/Cmd+Shift+D` 启停语音输入；收起状态下输入框的主语音/发送按钮也扩大了点击区域。 |
| 粘贴普通文件 | 将剪贴板中的文件直接粘贴到输入框作为附件，也支持非图片文件。 |
| 输入框撤销与重做 | 输入、粘贴或插入会话引用后使用编辑器的撤销/重做快捷键，输入框现在维护独立的编辑历史。 |

### 智能体与稳定性

- **Codex**：权限选项新增 **Auto**（`autoReview`），保留工作区写入沙箱，将提权请求交给 Codex 原生自动审核；已完成回合的耗时在刷新后保留，自动压缩上下文时显示状态，共享 WebSocket 支持更大的历史记录；详见[共享 Codex 会话](docs/guide/codex-shared-sessions.md)。
- **DeepSeek Harness**：通过 ACP 配置选项支持新建会话和运行中会话的模型选择，默认入口改为官方 `dsh --profile acp`。
- **Kimi 与 OpenCode**：Kimi 动态发现实际配置的模型，OpenCode 同时支持 v1 和 v2 会话；详见[支持的智能体](docs/guide/agents.md)。
- **聊天与 Hub**：改善图片预览稳定性、附件即时移除、页面转入后台时保存草稿、侧边栏渲染，以及会话枚举和配置读取的缓存。
- **Android 源码**：新增会话日期范围筛选、按机器和智能体记住新建会话配置，以及草稿夹移动、复制和删除确认；需单独构建并安装新版客户端才能体验这些原生功能，详见 [Android](android/README.md)。

## 我的改动

### 0.31.2-youngfine.1：附件恢复与 DSH 集成

- 文本上下文上传失败后保留弹窗中可编辑的内容；粘贴文本自动转附件失败时，在当前选区恢复原文并保留会话引用，同时移除失败附件，避免重试时重复添加。
- 图片草稿在刷新、会话恢复和草稿夹迁移后保留上传预处理结果，包括无需转换而保留原图的情况，避免恢复同一草稿时反复压缩图片。
- 合入上游时保留个人二开的 DSH MCP 注入、工具/思考/用量流式更新，以及 ACP 会话清理改动。

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
npm install -g @youngfine/hapi@0.31.2-youngfine.1 --registry=https://registry.npmjs.org
hapi hub --relay
hapi runner start --workspace-root ~/git-repository
```

仍支持 `hapi server` 作为别名。

已有部署应在 Hub 和各 Runner 所在机器安装该版本，保留原有 `HAPI_HOME` 与 `CLI_API_TOKEN`，并通过原有服务管理方式重启 Hub；除非设置了 `HAPI_DISABLE_VERSION_HANDOFF=1`，Runner 通常会在 CLI 二进制更新后自动替换进程，详见[后台服务部署](docs/guide/deployment.md#background-service-deployment)和[安装指南](docs/guide/installation.md)。

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

需要 Bun 1.4.4。

```bash
bun install
bun run build:single-exe
```

## 致谢

HAPI 意为“哈皮”，是 [Happy](https://github.com/slopus/happy) 的中文音译，感谢原项目的贡献。
