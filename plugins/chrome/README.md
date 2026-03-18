# Save to Mnemo — Browser Extension

Browser extension that captures AI chat conversations from Claude, ChatGPT, Grok, and Perplexity and copies them to clipboard for import into the Mnemo desktop app.

## How It Works

1. Open a chat on **claude.ai**, **chatgpt.com**, **grok.com**, or **perplexity.ai**
2. Click the **Mnemo icon** in the browser toolbar
3. The extension extracts the conversation HTML and copies it to clipboard
4. Badge shows **✓** (green) on success or **!** (red) on failure
5. Switch to Mnemo and press **Cmd+V** to import

## Structure

```
plugins/chrome/
├── src/                    # Extension source (load as unpacked)
│   ├── manifest.json       # Chrome Extension Manifest V3
│   ├── background.js       # Service worker (toolbar click handler)
│   ├── content.js          # Content script (HTML extraction)
│   └── icons/              # Extension icons
├── bin/
│   └── release             # Build distributable ZIP
├── dist/                   # Built ZIP files (gitignored)
└── README.md
```

## Install (Chrome / Chromium)

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `plugins/chrome/src` folder
5. The Mnemo icon appears in your toolbar

## Install (Safari)

Safari supports Chrome extensions via the converter tool:

```bash
xcrun safari-web-extension-converter plugins/chrome/src \
  --project-location plugins/safari \
  --app-name "Save to Mnemo" \
  --bundle-identifier studio.illegal.mnemo.safari-extension
```

Then:
1. Open the generated Xcode project in `plugins/safari`
2. Build & Run (Cmd+R)
3. Enable in Safari → Settings → Extensions

## Build for Distribution

```bash
./bin/release
```

Creates `dist/mnemo-chrome-{version}.zip` ready for Chrome Web Store or side-loading.

## Icons

The extension ships with placeholder blue icons. To generate proper icons:

1. Open `src/generate-icons.html` in a browser
2. Right-click each canvas → "Save Image As"
3. Save as `src/icons/icon16.png`, `src/icons/icon48.png`, `src/icons/icon128.png`

## Supported Sites

| Site | URL Pattern |
|------|-------------|
| Claude | `claude.ai` |
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Grok | `grok.com` |
| Perplexity | `perplexity.ai` |

## Permissions

- `activeTab` — access the current tab to extract HTML
- `clipboardWrite` — write extracted HTML to clipboard
- `scripting` — inject content script on demand

## How It Differs from the Bookmarklet

Both do the same thing (copy HTML to clipboard), but:
- **Extension**: one-click from toolbar, works on any supported site, badge feedback
- **Bookmarklet**: no install needed, works in any browser, but requires manual setup
