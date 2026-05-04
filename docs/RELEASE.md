# Packaging

Clarity can be built as one desktop package per platform:

- Windows: NSIS installer from `npm.cmd run package:windows`
- macOS: DMG from `npm run package:macos`

The app no longer needs a deployed backend. Each local install uses the model provider profiles entered in the app.

## Build

Windows:

```powershell
npm.cmd run package:windows
```

Output:

```text
src-tauri/target/release/bundle/nsis/
```

macOS:

```bash
npm run package:macos
```

Output:

```text
src-tauri/target/release/bundle/dmg/
```

For macOS distribution outside your own machine, sign and notarize the DMG with Apple Developer credentials before sharing it.

## Local Flow

1. Install and launch Clarity.
2. Create a model profile for OpenAI, Anthropic Claude, or Google Gemini in the launch panel.
3. The app stores the profile locally and collapses into the overlay pill.
4. Clarity captures locally and sends compressed images through the Tauri shell to the active provider when requested.
