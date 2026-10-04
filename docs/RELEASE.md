# Packaging and releases

Clarity ships one desktop package per platform: an NSIS installer on Windows and a universal DMG on macOS. There is no backend; each install uses the provider profiles entered in the app.

## Publishing a release (GitHub Actions)

1. Bump the version in all three places, to the same value:
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `[package] version` (then run `cargo check` in `src-tauri/` so `Cargo.lock` updates)

   CI fails if these drift apart (`node scripts/check-release-version.mjs v<version>`).
2. Merge to `main`, then tag and push:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`) checks the tag against the app version, builds on `windows-latest` and `macos-latest` (universal: Apple silicon + Intel), and attaches the installers to a **draft** GitHub Release named `Clarity v0.2.0`.
4. Open the draft on GitHub, check the assets, edit the notes, and publish.

To build installers without creating a release, run the Release workflow manually (**Actions → Release → Run workflow**). The installers are kept as workflow artifacts (`clarity-windows-x64`, `clarity-macos-universal`).

### Signing

Builds are currently **unsigned**: macOS Gatekeeper and Windows SmartScreen warn on first launch (the release notes explain how to open the app anyway). Signing and notarization need an Apple Developer account and a Windows code-signing certificate; once those exist, add them as repository secrets and pass them to `tauri-action` (see the Tauri v2 distribution guides).

## Building locally

```bash
npm ci
npm run package:windows   # → src-tauri/target/release/bundle/nsis/
npm run package:macos     # → src-tauri/target/release/bundle/dmg/
```

These regenerate the icons first (`npm run icons`). Platform prerequisites: https://v2.tauri.app/start/prerequisites/

## First run

1. Install and launch Clarity.
2. Create a model profile (OpenAI, Claude, Gemini, or OpenRouter). The API key is stored in the OS keychain.
3. The app collapses into the overlay pill; press the capture shortcut or click the pill to start.
