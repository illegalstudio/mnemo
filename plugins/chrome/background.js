// Background service worker
// Handles toolbar button click: extract → clipboard → deep link

chrome.action.onClicked.addListener(async (tab) => {
  // Only run on supported sites
  const url = tab.url || "";
  const supported =
    url.includes("claude.ai") ||
    url.includes("chatgpt.com") ||
    url.includes("chat.openai.com");

  if (!supported) {
    // Fallback: try to extract from any page
    await extractAndSend(tab);
    return;
  }

  await extractAndSend(tab);
});

async function extractAndSend(tab) {
  try {
    // Send message to content script to extract HTML
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "extract",
    });

    if (response.error) {
      showBadge("!", "#dc2626");
      console.error("Extraction failed:", response.error);
      return;
    }

    // Copy to clipboard via offscreen document or execCommand
    await copyToClipboard(response.html);

    // Open deep link to trigger Mnemo import
    await chrome.tabs.update(tab.id, {
      url: "mnemo://import",
    });

    // Restore the original URL after a short delay
    setTimeout(async () => {
      try {
        await chrome.tabs.update(tab.id, { url: tab.url });
      } catch {
        // Tab may have been closed
      }
    }, 500);

    showBadge("✓", "#16a34a");
  } catch (e) {
    console.error("Save to Mnemo failed:", e);
    showBadge("!", "#dc2626");
  }
}

function showBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

// Copy text to clipboard from service worker
// Uses offscreen document API (Chrome 109+)
async function copyToClipboard(text) {
  // Try the offscreen approach first
  try {
    if (typeof chrome.offscreen !== "undefined") {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Copy chat HTML to clipboard for Mnemo import",
      });

      await chrome.runtime.sendMessage({
        action: "clipboard-write",
        text,
      });

      await chrome.offscreen.closeDocument();
      return;
    }
  } catch {
    // Offscreen not available or already exists
  }

  // Fallback: inject script into the active tab to copy
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tab?.id) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (html) => {
        navigator.clipboard.writeText(html);
      },
      args: [text],
    });
  }
}
