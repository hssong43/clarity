# Clarity

Clarity is a personal desktop vision assistant. It runs as a small always-on overlay, captures the current desktop on demand, compresses screenshots locally, and streams contextual Korean answers with your own model API keys.

## Stack

- Tauri v2 + Rust for the lightweight desktop shell and screen capture.
- React + TypeScript + Vite for the overlay and chat UI.
- OpenAI, Anthropic Claude, or Google Gemini vision-capable models.

## Runtime Model

- Create one or more local model profiles for OpenAI, Claude, and Gemini.
- Profiles are stored in this device's local app storage under `clarity.modelProfiles.v1`.
- The active profile ID is stored under `clarity.activeModelProfileId.v1`.
- Existing `clarity.openai.apiKey.v1` values migrate into a default OpenAI profile on first launch.
- Screenshots are compressed locally, then sent through the Tauri desktop shell to the selected provider only when you run an action or ask a question.
- OpenAI requests use `store: false`.

## Local Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Run the desktop app:

   ```powershell
   npm.cmd run tauri:dev
   ```

3. Create a model profile in the first-run panel.

## Packaging

Windows:

```powershell
npm.cmd run package:windows
```

macOS:

```bash
npm run package:macos
```

See `docs/RELEASE.md` for packaging output paths.

## Tests

```powershell
npm.cmd test
cd src-tauri
cargo test
```
