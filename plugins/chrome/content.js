// Content script — runs on claude.ai and chatgpt.com
// Extracts the conversation HTML when requested by the background script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "extract") return;

  try {
    const host = location.hostname;
    let source = "other";
    if (host.includes("claude.ai")) source = "claude";
    else if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) source = "chatgpt";

    const main = document.querySelector("#main-content, main, [role='main']");
    const html = (main || document.body).innerHTML;

    if (!html || html.length < 100) {
      sendResponse({ error: "Could not extract conversation" });
      return;
    }

    const output =
      `<!-- mnemo:source=${source},url=${location.href},title=${encodeURIComponent(document.title || "Chat")} -->\n` +
      html;

    sendResponse({ html: output });
  } catch (e) {
    sendResponse({ error: e.message });
  }
});
