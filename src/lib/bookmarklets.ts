function copyBlock(): string {
  return `
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(function() {
        alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
      }).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
      });
    }
  `;
}

const universalScript = `
(function(){
  try {
    ${copyBlock()}
    var html = '';
    var source = 'other';
    var host = location.hostname;

    if (host.indexOf('chatgpt.com') >= 0 || host.indexOf('chat.openai.com') >= 0) {
      source = 'chatgpt';
    } else if (host.indexOf('claude.ai') >= 0) {
      source = 'claude';
    } else if (host.indexOf('grok.com') >= 0) {
      source = 'grok';
    } else if (host.indexOf('perplexity.ai') >= 0) {
      source = 'perplexity';
    } else {
      source = 'other';
    }

    var main = document.querySelector('#main-content, main, [role="main"]');
    html = (main || document.body).innerHTML;
    if (!html || html.length < 100) { alert('Could not extract conversation.'); return; }

    var out = '<!-- mnemo:source=' + source + ',url=' + location.href + ',title=' + encodeURIComponent(document.title || 'Chat') + ' -->\\n' + html;
    copyToClipboard(out);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

export function getBookmarkletUrl(script: string): string {
  return "javascript:" + encodeURIComponent(script.replace(/\\s+/g, " ").trim());
}

export const bookmarklets = [
  {
    name: "Copy to Mnemo",
    source: "universal",
    url: getBookmarkletUrl(universalScript),
    instructions: "Works on chatgpt.com and claude.ai. Copies the conversation, then paste in Mnemo with Cmd+V.",
  },
];
