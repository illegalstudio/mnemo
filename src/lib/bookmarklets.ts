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
      var msgs = document.querySelectorAll('[data-message-author-role]');
      if (!msgs.length) { alert('No conversation found.'); return; }
      msgs.forEach(function(el) {
        var role = el.getAttribute('data-message-author-role');
        html += '<div data-role="' + role + '">' + el.innerHTML + '</div>';
      });
    } else if (host.indexOf('claude.ai') >= 0) {
      source = 'claude';
      var userMsgs = document.querySelectorAll('[data-testid="user-message"]');
      var assistantMsgs = document.querySelectorAll('.font-claude-response');
      if (!userMsgs.length && !assistantMsgs.length) { alert('No conversation found.'); return; }
      var allTurns = [];
      userMsgs.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        allTurns.push({ role: 'user', el: el, top: rect.top + window.scrollY });
      });
      assistantMsgs.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        allTurns.push({ role: 'assistant', el: el, top: rect.top + window.scrollY });
      });
      allTurns.sort(function(a, b) { return a.top - b.top; });
      allTurns.forEach(function(turn) {
        html += '<div data-role="' + turn.role + '">' + turn.el.innerHTML + '</div>';
      });
    } else {
      alert('This bookmarklet works on chatgpt.com and claude.ai');
      return;
    }

    if (!html) { alert('Could not extract conversation.'); return; }

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
