# HAPI Personal Fork

**English** | [简体中文](README.zh-CN.md)

Run official Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness sessions and control them remotely through native iOS / Android apps, Web / PWA, or Telegram Mini App.

This project is a personal fork of [tiann/hapi](https://github.com/tiann/hapi).

## Version and Upstream Baseline

- Current personal release: `@youngfine/hapi@0.33.2-youngfine.1`, published on `2026-10-29`.
- Integrated upstream tag `v0.33.2`, commit `730dfcb2`, on `2026-10-29`, preserving the fork's custom changes. This tag is the upstream baseline for this release.
- Published the npm wrapper and five platform packages: macOS ARM64/x64, Linux ARM64/x64, and Windows x64. They include the CLI, Hub, and embedded Web client. Native iOS and Android changes are included in the source; this release does not include an APK or an iOS app build.

## What's New in 0.33.2-youngfine.1

Version `0.33.2-youngfine.1` integrates upstream `v0.33.2`
(`730dfcb2`), including the previous `v0.33.1` integration.

- Session lists now use the persisted last user-message time, so assistant output does not keep moving sessions. Manual pins remain available; the old fixed-order preference is removed.
- Peer messages accept `queue` (default) and `steer`; steering requires an active Pi, Codex, or Cursor ACP turn. DSH retains queued peer delivery.
- A single composer attachment no longer shows a reorder handle. Android uses the new choice dialogs for theme, language, and the fork's image compression options.
- Sessions can open in separate windows, and manually chosen titles can be locked.
- Codex can fork historical turns while a later turn is running; OpenCode can import local session history.
- Voice drafts persist across session navigation, and tool cards support combined, compact, and detailed display.
- `hapi usage` and `/api/activity` expose persisted agent work and wait times. These activity metrics are separate from token usage. The Hub database schema advances to v29 and backfills session ordering from existing messages; back up `HAPI_HOME` before upgrading.
- Bun 1.4.4 is required for builds. The npm launcher rejects mismatched platform packages and offers version-pinned reinstall commands.
- The fork retains text-context recovery, image compression preferences and draft preparation state, double-Esc interruption, DSH extensions, and opt-in vivo push. Existing native compression controls remain on Android's General settings subpage.

See the [v0.33.2 integration record](docs/upstream-v0.33.2-integration.md) for scope and verification.

## What's New in 0.31.2-youngfine.1

### Web Features to Try

| Update | Where to try it |
|--------|-----------------|
| Terminal output to Agent | Open a session's **Terminal**, then choose **To agent** to append the scrollback to the chat draft. Select text first to use **Selection to agent** instead. Review the draft and add a question before sending. |
| Fixed session order (0.31.2) | Enable **Settings > Display > Fixed session order** in 0.31.2. Version 0.33.2 replaces this preference with ordering by last user-message time. |
| 130% font size | Select **130%** in **Settings > Display > Font size**. |
| External links in a new tab | Enable **Settings > Display > Links > Open external links in a new tab**. |
| Dictation shortcut | Use **Ctrl/Cmd+Shift+D** to start or stop voice input when voice is available. The collapsed composer's primary voice/send control also has a larger hit target. |
| Paste ordinary files | Paste clipboard files into the composer as attachments, including non-image files. |
| Composer undo and redo | Use the editor's undo/redo shortcuts after typing, pasting, or inserting session mentions; the composer now maintains its own edit history. |

### Agents and Reliability

- **Codex:** Added **Auto** (`autoReview`) to the permission picker. It retains the workspace-write sandbox and routes escalation requests to Codex's native auto-review. Completed round durations survive reloads, automatic context compaction has a visible status, and shared WebSockets support larger histories. See [shared Codex sessions](docs/guide/codex-shared-sessions.md).
- **DeepSeek Harness:** Added model selection for new sessions and running sessions through ACP configuration options, with the official `dsh --profile acp` entrypoint as the default.
- **Kimi and OpenCode:** Kimi discovers configured models dynamically; OpenCode supports both v1 and v2 sessions. See [supported agents](docs/guide/agents.md).
- **Chat and Hub:** Improved image-preview stability, immediate attachment removal, draft saving when the page becomes hidden, sidebar rendering, and caching for session enumeration and settings.
- **Android source:** Added session date-range filtering, per-machine/per-agent launch defaults, and scratchlist move, copy, and delete-confirm actions. Build and install an updated client separately to use these native features; see [Android](android/README.md).

## Custom Changes

### 0.31.2-youngfine.1: Attachment Recovery and DSH Integration

- Failed text-context uploads keep the dialog's editable fields. If automatic conversion of pasted text fails, the text is restored at the current selection while preserving session mentions; failed attachment chips are removed so retries do not duplicate them.
- Image drafts retain their upload-preparation decision across reloads, session resume, and scratchlist migration, including when preparation keeps the original image. Restoring the same draft does not repeatedly compress the image.
- Preserved the fork's DSH MCP injection, streamed tool/reasoning/usage updates, and ACP session cleanup changes during the upstream integration.

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
npm install -g @youngfine/hapi@0.33.2-youngfine.1 --registry=https://registry.npmjs.org
hapi hub --relay
hapi runner start --workspace-root ~/git-repository
```

`hapi server` remains supported as an alias.

For an existing deployment, install this version on the Hub and each Runner machine, preserve the existing `HAPI_HOME` and `CLI_API_TOKEN`, and restart the Hub through its existing service manager. Runners normally replace themselves after the CLI binary changes unless `HAPI_DISABLE_VERSION_HANDOFF=1`; see [background service deployment](docs/guide/deployment.md#background-service-deployment) and [installation](docs/guide/installation.md).

Use `hapi <agent> [options]` to start an agent directly, for example `hapi claude`
or `hapi codex`. Scripts must specify the agent explicitly. `hapi --help` shows
HAPI's commands and supported agents.

The hub displays a URL and two QR codes. Then connect a client:

- **Web / PWA (free):** open the web URL in a browser, or scan the web QR code. [Install it as a PWA](docs/guide/pwa.md) for a home-screen app and push notifications.
- **Native apps (paid):** install HAPI from the [App Store](https://apps.apple.com/app/id6805699104) or [Google Play](https://play.google.com/store/apps/details?id=run.hapi.companion), then scan the companion QR. See [Native apps](docs/guide/native-apps.md) for pairing.

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

## Clients

- **Web / PWA (free)** - The full-featured web app, including the remote terminal and voice assistant. Works in any browser and installs as a PWA. See [Web / PWA](docs/guide/pwa.md).
- **Native iOS / Android apps (paid)** - SwiftUI/UIKit and Kotlin Compose clients with chat, approvals, session creation, files, dictation, and native push notifications. See the [native app guide](docs/guide/native-apps.md) for capabilities and pairing.

<a href="https://apps.apple.com/app/id6805699104"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" height="48"></a>
<a href="https://play.google.com/store/apps/details?id=run.hapi.companion"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" height="72"></a>

Developers can build the apps from source: [iOS](ios/README.md), [Android](android/README.md). Protocol: [client contract](docs/api/client-contract/index.md).

## Build from Source

Requires Bun 1.4.4.

```bash
bun install
bun run build:single-exe
```

## Credits

HAPI is a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.
