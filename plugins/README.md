# Mnemo Browser Extensions

Browser extensions for capturing AI chat conversations and importing them into Mnemo.

## Chrome / Chromium

The Chrome extension lives in `chrome/src/`. See [chrome/README.md](chrome/README.md) for install and usage instructions.

### Quick start

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `chrome/src`

### Build ZIP for distribution

```bash
./chrome/bin/release
```

## Safari

Safari uses the same source as Chrome, converted via Apple's tool.

### Prerequisites

- **Xcode** (free from the App Store) — required for the conversion and build
- No Apple Developer account needed for local use

### Convert and build

```bash
./bin/build-safari
```

This runs `xcrun safari-web-extension-converter` which:
1. Takes the Chrome extension from `chrome/src/`
2. Generates an Xcode project in `safari/`
3. Wraps it in a native macOS app container (required by Safari)

Then:
1. Open the generated project: `open safari/*.xcodeproj`
2. Build & Run (Cmd+R)
3. Enable in **Safari → Settings → Extensions**

### Why Xcode?

Safari requires extensions to be packaged inside a native app. There's no way around this — Apple mandates it. The converter does all the heavy lifting automatically, you just need to hit Build.

### Notes

- The `safari/` directory is gitignored since it's generated from `chrome/src/`
- If you update the Chrome extension, re-run `./bin/build-safari` to regenerate
- The extension works the same way: click icon → copies HTML → paste in Mnemo with Cmd+V
