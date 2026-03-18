# Save to Mnemo — Chrome Extension

Chrome extension that captures AI chat conversations from Claude and ChatGPT and sends them to the Mnemo desktop app via deep link.

## How It Works

1. You open a chat on **claude.ai** or **chatgpt.com**
2. Click the **Mnemo icon** in the Chrome toolbar
3. The extension extracts the conversation HTML, copies it to clipboard
4. Opens `mnemo://import` which activates the Mnemo app
5. Mnemo reads the clipboard and imports the chat automatically

## Install (Development)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this folder (`plugins/chrome`)
5. The Mnemo icon appears in your toolbar

## Icons

The extension ships with placeholder blue icons. To generate proper icons:

1. Open `generate-icons.html` in a browser
2. Right-click each canvas → "Save Image As"
3. Save as `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

## Build for Distribution

Chrome extensions with Manifest V3 don't need a build step. To create a distributable `.zip`:

```bash
cd plugins/chrome
zip -r mnemo-chrome-extension.zip . -x "*.DS_Store" "generate-icons.html" "README.md"
```

Then upload to the Chrome Web Store or distribute the zip for side-loading.

## Testing

1. Load the unpacked extension as described above
2. Open a chat on [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com)
3. Click the Mnemo toolbar icon
4. The Mnemo app should activate and the chat should appear in your library
5. Check the badge on the icon:
   - **✓ green** = success
   - **! red** = extraction failed

## Troubleshooting

- **Mnemo doesn't open**: Make sure the Mnemo app is installed and has registered the `mnemo://` URL scheme. Run `open mnemo://import` in Terminal to test.
- **Chat not imported**: Check that the clipboard contains the HTML. Try pasting manually into Mnemo with Cmd+V.
- **Extension icon missing**: Make sure the icon PNG files exist in the `icons/` folder.
- **Content script not running**: Reload the extension from `chrome://extensions` and refresh the chat page.

## Supported Sites

| Site | URL Pattern | Status |
|------|-------------|--------|
| Claude | `https://claude.ai/*` | Supported |
| ChatGPT | `https://chatgpt.com/*` | Supported |
| ChatGPT (legacy) | `https://chat.openai.com/*` | Supported |

## Requirements

- Chrome 109+ (for offscreen clipboard API)
- Mnemo desktop app installed with `mnemo://` deep link registered

## Permissions

- `activeTab` — access the current tab to extract HTML
- `clipboardWrite` — write extracted HTML to clipboard
