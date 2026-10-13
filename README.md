# HAPI Personal Fork

**English** | [简体中文](README.zh-CN.md)

Run official Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness sessions and control them remotely through native iOS / Android apps, Web / PWA, or Telegram Mini App.

This project is a personal fork of [tiann/hapi](https://github.com/tiann/hapi).

## Version and Upstream Baseline

- Current personal release: `@youngfine/hapi@0.30.7-youngfine.5`.
- Based on upstream `v0.30.7`, commit `0239edf3`, retaining its Web, CLI, Hub, Android, and iOS capabilities alongside the custom changes below.
- The upstream refs fetched and checked on `2026-10-13` showed `v0.30.7` as the latest version tag. Upstream `main` has additional development commits that are not included in this release; this fork is not synchronized with the latest upstream `main`.

## Custom Changes

### 0.30.7-youngfine.5: Build Privacy and Bilingual Documentation

- Removed build-machine workspace and home directories from compiled executables by resolving module paths through Bun's virtual filesystem.
- Disabled build-time environment-variable inlining and retained the restriction on automatic runtime `.env` loading. Runtime configuration still comes from explicit environment variables and settings.
- Added build-path checks after compilation and before npm packaging, including cached binaries used with `--skip-build`. These checks are not a comprehensive secrets audit and do not modify previously published packages.
- Made English the default README and added a complete Chinese version, with both included in the npm wrapper package.
- GitHub Releases use the same checked binaries as npm packaging, including ad-hoc signing and verification for macOS. This release does not include an APK.

### Chat and Interaction

- Added a dedicated temporary-context input so long text can be sent as a `.txt` attachment alongside a question.
- Pasted text automatically becomes an attachment at the default threshold of `3000` characters or more than `60` lines. Both thresholds are configurable in **Settings > Chat > Input**.
- Added support for pasting ordinary files, not just images.
- User messages longer than `15` lines collapse by default and display their full content immediately when expanded.
- Interrupting a running task requires pressing `Esc` twice within `2` seconds by default, with a prompt after the first press. A single-press option is available in **Settings > Chat > Input**.

### 0.30.7-youngfine.4: Native Push Extensions

- **vivo / iQOO push:** Android now supports an opt-in vivo test-push channel independent of FCM, covering session completion, permission requests, and task notifications. Explicit consent and activation in the app are required; granting the system notification permission alone does not register the channel.
- **Extensible provider architecture:** The Hub centralizes native push provider registration and notification dispatch. Android centralizes provider selection, device registration, token rotation, and retries. FCM, the encrypted Android relay, and iOS APNs/relay remain available; future providers can be added through adapters and registries without adding vendor branches to session logic.
- **Web test controls:** Open **Settings > General > Companion > Push devices** to view devices registered in the current namespace, refresh the list, and send a single-device test push. Tests have a `10`-second cooldown. iOS test sends are not currently supported, and provider acceptance is not confirmation of handset receipt.
- **Privacy:** vivo notifications show only a generic notice, without plaintext chat content, session names, or approval details. The tap target is encrypted with the device key. `AppSecret` must stay on the Hub and must never be bundled in the APK or committed to the repository.
- **Device verification:** On `2026-10-13`, test notifications were received on one vivo phone with the app in the foreground, in the background, and after clearing its background process. A real session-completion notification was also received. These results do not guarantee delivery on every device or after an Android force-stop.

#### vivo Setup and Limits

Android builds need matching `hapiVivoAppId` and `hapiVivoAppKey` values. The application name is `HAPI`, and the package name is `run.hapi.companion`. See [Android vivo setup](android/README.md#vivo-test-push).

Configure the Hub's active `HAPI_HOME/settings.json` file (default: `~/.hapi/settings.json`) with `vivoPushMode: "test"`, `vivoAppId`, `vivoAppKey`, and `vivoAppSecret`, or use the environment variables `HAPI_VIVO_PUSH=test`, `VIVO_APP_ID`, `VIVO_APP_KEY`, and `VIVO_APP_SECRET`. Environment variables take precedence over file settings. The npm-installed binary does not automatically load `.env` files.

The integration currently uses vivo **API single-device test messages**, not production push: at most `1000` messages per application per day, delivery only to currently online devices, and no offline caching. Business notifications are subject to the same limits. Available permissions for unpublished apps or personal developer accounts depend on the vivo console.

Using this vivo integration requires Hub `.4` and the corresponding Android APK. The Runner does not need to upgrade to `.4` solely for this feature. See the [notification guide](docs/guide/notifications.md) for configuration and testing.

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Shared Codex Sessions** - Use Codex from your terminal and phone at the same time. Requires Codex 0.154.0+. [Usage and limits](docs/guide/codex-shared-sessions.md).
- **Native First** - HAPI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Grok Build, OpenCode, Kimi, Copilot, Antigravity, Pi, DeepSeek Harness: different agents, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone's browser or desktop web app, directly connected to the working machine.
- **Voice Control** - Use dictation in native apps, or talk to your AI agent hands-free with the web voice assistant.
- **Workspace Browser** - Opt-in via one or more `hapi runner start --workspace-root <path>` flags: browse scoped file trees from the web and start sessions in allowed subdirectories.

## Usage

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

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md).

## Docs

- [Native apps (iOS / Android)](docs/guide/native-apps.md)
- [Web / PWA](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Supported Agents](docs/guide/agents.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAPI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Native Apps (iOS / Android)

The repository includes SwiftUI/UIKit and Kotlin Compose clients with chat, approvals, session creation, files, dictation, and push notifications. See the [native app guide](docs/guide/native-apps.md) for capabilities, platform differences, and pairing. Build instructions: [iOS](ios/README.md) and [Android](android/README.md). Developer protocol: [client contract](docs/api/client-contract/index.md).

## Build from Source

Requires Bun 1.4.0.

```bash
bun install
bun run build:single-exe
```

## Credits

HAPI is a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
