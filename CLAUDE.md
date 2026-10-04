# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Clarity is a Tauri v2 + React/TypeScript desktop overlay that captures the screen (all displays or a dragged region) or takes file attachments, and streams answers from a user-chosen AI provider (OpenAI, Anthropic, Gemini, OpenRouter) using the user's own API key. There is no backend. README is in Korean.

## Commands

```bash
npm ci
npm test                                   # vitest run (jsdom), all src/**/*.test.ts(x)
npx vitest run src/lib/sse.test.ts         # single test file
npx vitest run -t "name of test"           # single test by name
npm run lint                               # ESLint (typescript-eslint + react-hooks)
npm run format:check                       # Prettier; `npm run format` to fix
npm run build                              # tsc --noEmit + vite build (this is the typecheck)
npm run dev                                # Vite only, http://127.0.0.1:1420 (no Tauri APIs)
npm run tauri:dev                          # full desktop app (needs Rust + Tauri prerequisites)
npm run package:windows | package:macos    # regenerates icons, then tauri build (nsis / dmg)

cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`: a Node job (lint, format check, tests, build) and a Rust job (fmt, clippy `-D warnings`, tests). The Rust job builds the frontend first because `tauri::generate_context!` embeds `../dist`, and installs the Linux webkit/xcb/pipewire/dbus dev packages listed in the workflow — install the same ones to build Rust locally on Linux.

Prettier config: `printWidth: 100`, `trailingComma: "none"`; Markdown, `src-tauri/`, and `release/` are not formatted.

## Architecture

**Narrow native boundary.** Rust (`src-tauri/src/`) owns only: screen capture (`capture.rs`, via `xcap`, downscaled to ≤1600px JPEG), region capture (`region.rs`), the overlay window (`pill` 184×56 vs `panel` 430×620), the macOS screen-recording permission, the global capture shortcut, OS-keychain storage of API keys (`secrets.rs`), and a streaming HTTP proxy. UI, state, and provider request/response formats live in TypeScript. Every native call goes through a wrapper in `src/lib/tauri.ts`.

**Provider requests go through Rust, not `fetch`.** The CSP blocks external `connect-src`, so `streamNativeHttp` invokes `stream_http_request`, which POSTs and emits raw byte chunks on `clarity-native-http-stream`, tagged with a per-request `requestId`. Aborting the `AbortSignal` calls `cancel_http_request`, which drops the stream via `futures_util::Abortable`; the JS side rejects with a `DOMException` named `AbortError` (check with `isAbortError`). One shared `reqwest` client has a 15s connect and 90s per-read timeout. Rust enforces a URL allowlist in `is_allowed_provider_url` — **adding a provider or changing a base URL requires updating that allowlist**.

**API keys never return to the WebView.** Saving a profile calls `set_api_key` (keyring service `app.clarity.desktop`, account = profile id) and stores the profile as `{ apiKey: "", keyStorage: "keychain" }`. Requests for such profiles carry `auth: { profileId, scheme }` and Rust attaches `Authorization: Bearer` / `x-api-key` / `x-goog-api-key` itself; there is no command that reads a key back. If the keychain is unavailable (or outside Tauri) the key stays in `localStorage` and is sent inline. Plaintext keys from older versions are migrated on startup in `useProfiles`.

**Provider adapters** (`src/lib/visionClient.ts`): per provider a `build*HttpRequest` (URL, headers via `withAuth`, body) and `extract*TextDelta` / `extract*StopReason`; `createProviderStreamParser` + `src/lib/sse.ts` turn SSE text into normalized `StreamEvent`s (`src/types.ts`). Model-specific request params are gated by model-ID prefix: Claude 5-generation models (`isAdaptiveClaudeModel`) reject `temperature` and get `output_config.effort` plus a larger `max_tokens`; some also get server-side refusal fallbacks; GPT-5/o-series get `reasoning.effort` instead of `temperature`; Gemini 3 keeps the default temperature. A new provider means: `ProviderId` + `providerConfigs` in `modelProfiles.ts`, builder/extractor branches and an auth scheme in `visionClient.ts`, the Rust allowlist (and `AuthScheme` in `secrets.rs` if the header differs), and tests.

**Frontend layout.** `App.tsx` only wires hooks to components. State lives in hooks under `src/hooks/` (`useChatStream` holds the `clarityReducer` from `src/lib/appState.ts` plus send/stop/continue; `useProfiles`, `useAttachments`, `useCaptureShortcut`, `useFileDrop`, `useOverlayWindow`, `useScreenCapturePermission`); presentational pieces are in `src/components/`.

**Attachments** (`src/lib/attachments.ts`): each pending attachment is `reading` → `ready` | `error`; only `ready` items are sent. PDFs via `pdfjs-dist`, DOCX via `mammoth`. Limits: 6 pending, 10 MB per file, 20k extracted text chars. A screen capture (full or region) replaces any existing screen attachment.

**Region capture** opens a second window labeled `region` that loads the same bundle at `index.html#region` (`main.tsx` renders `RegionSelector` instead of `App`). Rust keeps full-resolution screenshots in memory; the selector sends the selection as **fractions of the screenshot**, and Rust crops the original — so DPI scaling and monitor coordinates never enter the math. Closing the selector any other way counts as cancel. The `region` window must stay listed in `src-tauri/capabilities/default.json`.

**Global shortcuts** (`src-tauri/src/shortcuts.rs`): full-screen and region capture are registered together from Rust (`set_capture_shortcuts`, `tauri-plugin-global-shortcut`); pressing one shows the overlay and emits `clarity-capture-shortcut` with `{ area: "full" | "region" }`. Accelerators are stored in `localStorage` (`clarity.captureShortcut.v1` default `CommandOrControl+Shift+Space`, `clarity.regionShortcut.v1` default `Alt+Shift+Space`; `""` = off), must differ from each other, and use `KeyboardEvent.code` names (`Ctrl+Shift+KeyK`).

**Persistence** is WebView `localStorage` with versioned keys (`clarity.modelProfiles.v1`, `clarity.activeModelProfileId.v1`, `clarity.overlay.position.v1`, `clarity.captureShortcut.v1`, `clarity.regionShortcut.v1`, `clarity.conversations.v1`; legacy `clarity.openai.apiKey.v1` is migrated in `loadProfileState`).

**Chat history** (`src/lib/conversations.ts`, `useConversations`): up to 30 conversations are saved as text only (no screenshots or file contents) after each completed turn; the latest reopens on launch. Switching chats is blocked while an answer streams so the reply can't land in the wrong conversation (the reducer also ignores `LOAD_CONVERSATION` mid-stream).

**Running outside Tauri.** Wrappers in `src/lib/tauri.ts` check `isTauriRuntime()`; window/permission/shortcut helpers no-op and keychain storage reports unavailable, while capture and provider streaming throw. `npm run dev` in a browser renders the UI but cannot send requests.

## Testing notes

- `App.test.tsx` mocks `./lib/visionClient` and runs without Tauri; `App.shortcut.test.tsx` partially mocks `./lib/tauri` (capture, region, shortcut) on top of the real module.
- jsdom has no `PointerEvent` (coordinates are dropped) or `setPointerCapture`; see `RegionSelector.test.tsx` for the stubs.

## Repo notes

- `release/` contains committed Windows installers that are intentionally preserved — don't delete them or rewrite history to remove them.
- `src-tauri/gen/schemas/` is Tauri-generated (regenerated when plugins change); window permissions are granted in `src-tauri/capabilities/default.json`.
- `npm run icons` regenerates `src-tauri/icons/` from `scripts/generate-icon.mjs`.
