// Offscreen document for clipboard access from service worker
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "clipboard-write") {
    navigator.clipboard.writeText(request.text).catch(console.error);
  }
});
