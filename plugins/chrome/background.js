// Background service worker
// Handles toolbar button click: extract HTML → copy to clipboard

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    // Inject content script if not already present
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch {
      // Already injected or not allowed
    }

    // Send message to content script to extract HTML
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "extract" });
    } catch (e) {
      showBadge("!", "#dc2626");
      console.error("Could not reach content script:", e);
      return;
    }

    if (!response || response.error) {
      showBadge("!", "#dc2626");
      console.error("Extraction failed:", response?.error || "No response");
      return;
    }

    // Copy to clipboard by injecting into the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (html) => {
        navigator.clipboard.writeText(html).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = html;
          ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        });
      },
      args: [response.html],
    });

    showBadge("✓", "#16a34a");
  } catch (e) {
    console.error("Save to Mnemo failed:", e);
    showBadge("!", "#dc2626");
  }
});

function showBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}
