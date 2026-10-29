# 上游 v0.33.1 集成记录

> 本文保留 v0.33.1 候选阶段的检查记录。后续该集成已作为 `90b814ac`
> 合入并推送个人仓库 main，未发布 npm；发布工作继续到
> [v0.33.2 集成记录](upstream-v0.33.2-integration.md)，以下未提交、未推送等描述仅对应原检查时点。

## 版本与范围

- 整理日期：2026-10-29。
- 个人仓库起点：`318ecfc10869550cca6a6038b05ddfe2aeacdc4e`。
- 上游目标：`v0.33.1`，提交 `a6cf8fd0`；包含从 `v0.31.2` 起的 84 个提交。
- 源码候选版本：`0.33.1-youngfine.1`，尚未发布。
- 集成分支：`merge/upstream-v0.33.1-20261029`。
- Worktree：`/Volumes/FANXIANG/git-repository/worktrees/self-projects/hapi/merge-v0.33.1-20261029`。
- 原工作区的两个 README 未提交修改已复制到候选版中，再补充新版说明；原工作区保持原状。
- 本次交付是候选代码及检查结果，不包含提交、推送、npm 发布、全局安装或服务器部署。

## 合并与 Review

合并最初有 22 个冲突文件。Review 同时对照个人起点与上游目标，
检查手工解决的冲突和自动合并的二开交汇处；除经用户确认的 v24 测试夹具修正外，
不扩展修复上游原有问题。

| 范围 | 核对与处理 |
|------|------------|
| npm 启动器 | 保留 `@youngfine` 包名和个人 Release 地址；接入平台包精确版本检查；npm、Bun 重装提示使用个人包名和指定版本。 |
| 发布流程 | 保留个人 `release-all`、主分支限制、npm 身份与写权限检查、平台包先于主包发布和失败重试流程；移除上游新引入的独立官方包发布脚本，避免保留第二条含官方包名的发布路径。 |
| 构建与签名 | 根配置和个人工作流统一到 Bun 1.4.4；保留环境变量不内联、构建路径检查、缓存产物再次检查、Darwin 签名与验证。 |
| Codex 权限 | 新权限目录采用上游的四个原生选项；旧 `safe-yolo` 在共享会话启动和设置入口转换为 `default`，保持 `workspace-write` 和人工提权审批；补充空设置不触发原生更新的回归测试。 |
| 聊天输入框 | 保留文本上下文、失败恢复、会话引用、图片预处理状态和双 Esc 中断；Esc 关闭新版设置面板时恢复焦点，不触发任务中断。 |
| 网页设置 | 保留 Esc、文本阈值和图片压缩配置，接入上游合并、简洁、详细三种工具卡片样式与预览。 |
| 草稿与语音 | 核对新版跨会话语音草稿及直接发送逻辑和二开附件草稿的交汇处；保留附件恢复时的预处理标记，避免重复压缩。 |
| DSH / ACP | 保留 MCP 注入、流式工具、思考、用量和清理逻辑，合入上游的空闲文本快照及最终文本处理。 |
| Android 设置 | 图片压缩状态及四个更新回调显式传入新的 `SettingsGeneralContent`；vivo 设置从外层注入，纯展示预览不依赖运行时 `AppGraph`；用量和存储入口采用上游的新设置目录。 |
| 原生推送 | 核对 vivo 同意与激活逻辑、平台选择、加密目标、命名空间隔离及网页单设备测试；保留已有 iOS、FCM 和加密 relay 路径。 |
| 数据库升级 | 采用上游 v25 到 v28 的迁移；新增个人数据保留测试，验证 vivo 注册及加密密钥、会话元数据、排队文本附件消息在还原的 v25 结构升级后仍保留。 |
| 文档与版本 | CLI、共享版本、锁文件和原生默认版本使用相同候选版本；双语 README 区分已发布的 `0.31.2-youngfine.1` 与未发布候选版。 |

除已被上游等效修复替代的测试进程审计实现外，原个人分支修改过的文件
均仍保留相对上游的差异；同时逐项核对上述关键行为，避免仅凭文件差异认定功能完整。

## 已完成的检查

检查使用独立下载的 Bun 1.4.4，不切换本机全局 Bun。
单元测试使用临时数据库、临时目录或模拟传输，没有启动真实 Hub、Runner 或智能体。

| 检查 | 结果 |
|------|------|
| Bun 1.4.4 `install --frozen-lockfile --ignore-scripts` | 通过，锁文件无需额外依赖升级。 |
| 根目录 `bun typecheck` | CLI、Web、Hub、Relay 全部通过。 |
| Web 全量 Vitest | 339 个文件、3,828 项通过。 |
| Shared 全量 Bun test | 25 个文件、342 项通过。 |
| CLI 定向 Vitest | 13 个文件、275 项通过。 |
| Hub 定向 Bun test | 17 个文件、183 项通过，覆盖推送、设备接口、SSE、会话标题、历史分叉及相关存储。 |
| Hub 扩展存储与推送检查 | v24 测试夹具修正后复测，30 个文件、247 项全部通过，包含个人 v25 到 v28 数据保留回归。 |
| 个人 v25 到 v28 数据保留回归 | 1 项通过；测试使用还原的旧结构，不是服务器数据库副本。 |
| `bun run gen:fixtures` | 已执行；相对上游生成结果没有额外漂移。 |
| Android | `:core:protocol:test`、`:core:data:testDebugUnitTest`、`:app:testDebugUnitTest` 和 Kotlin 编译通过；最后一次设置页调整后再次编译并运行 App 单元测试，通过。 |
| iOS Swift Package | 使用本机已有 Xcode 27.0，HapiUI 139 项、HapiProtocol 149 项、HapiClient 473 项，共 761 项通过，包含协议夹具检查和图片压缩配置测试。 |
| `bun run build:single-exe:all` | Web 生产构建及五个平台的 CLI、Hub、内嵌网页完整构建通过，五个产物的构建路径隐私检查通过。 |
| npm 包准备 | 主包与五个平台包生成成功；两个 macOS 产物的 ad-hoc 签名和严格验证通过，复用产物的隐私检查通过。 |
| 包元数据与打包预览 | 六个包均为 `@youngfine`、版本均为 `0.33.1-youngfine.1`；主包精确依赖五个平台包；双语 README 与 NOTICE 齐全；主包 `npm pack --dry-run --json` 通过。 |
| 文档本地链接 | 检查 50 个本地链接，目标文件均存在。 |
| `git diff --check` | 通过。 |

CLI 定向检查临时移除了默认 Vitest 配置的 `globalSetup` 和 `setupFiles`，
只运行以下文件；临时配置已删除，正式测试入口保持原样。

- `scripts/build-executable.test.ts`
- `scripts/prepare-npm-packages.test.ts`
- `scripts/signDarwinNpmBinary.test.ts`
- `scripts/release-version.test.ts`
- `src/bin/hapiBin.test.ts`
- `src/codex/shared/launch.test.ts`
- `src/codex/shared/root.test.ts`
- `src/codex/utils/permissionModeConfig.test.ts`
- `src/agent/backends/acp/AcpSdkBackend.test.ts`
- `src/agent/backends/acp/AcpMessageHandler.test.ts`
- `src/dsh/dshRemoteLauncher.test.ts`
- `src/kimi/utils/config.test.ts`
- `src/test/auditTestProcesses.test.ts`

## 上游问题与验证边界

1. `hub/src/store/migration-v24.test.ts` 中的
   `adds messages.delivery_state to an already-upgraded V24 database` 原先失败。
   测试先创建当前数据库，再直接删除被当前索引引用的 `delivery_state` 列，
   SQLite 在构造旧数据库时即报错，尚未进入实际迁移。
   经用户确认，仅在测试夹具删除列之前，先删除引用该列的
   `idx_messages_immediate_queued` 和 `idx_messages_future_scheduled_queued` 两个索引；
   生产迁移逻辑 `hub/src/store/index.ts` 仍与上游 `v0.33.1` 一致。
   相关迁移检查 5 个文件、6 项通过；扩展存储及推送检查 30 个文件、247 项全部通过。
   该项本地测试阻塞已解除，完整发布 CI 尚未执行。

2. CLI 默认测试入口会启动临时 Hub；根目录完整 `bun run test`、
   Runner 集成测试、依赖服务的 Playwright 检查均未执行，遵守禁止自动运行项目的规则。
   通过的定向测试不能替代真实 Hub、Runner 和智能体之间的联调。

3. 未启动模拟器、未安装 APK、未执行设备推送验证，也未验证服务器运行负载。
   iOS 完整 App 按仓库文档要求 Xcode 27.1；本机已有工具链最高为 27.0，
   因此本次只完成 Swift Package 编译和测试。

4. 首次 CLI 隐私测试中 Linux x64、Windows x64 的编译运行时下载超时；
   完成下载后重跑，五个平台全部通过。
   首次 Swift Package 检查使用默认 Xcode 26.6，遇到上游测试类型推导错误；
   显式选择已有 Xcode 27.0 后全部通过，未修改上游 Swift 测试。

5. Hub 数据库会升级到 v28；服务器升级前应保留当前 `HAPI_HOME` 的可恢复备份。
   本次未接触服务器数据库，也未验证新版数据库直接降级到旧程序。
