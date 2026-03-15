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

// ChatGPT: grab all message elements' HTML
const chatgptScript = `
(function(){
  try {
    ${copyBlock()}
    var msgs = document.querySelectorAll('[data-message-author-role]');
    if (!msgs.length) { alert('No conversation found on this page.'); return; }
    var html = '';
    msgs.forEach(function(el) {
      var role = el.getAttribute('data-message-author-role');
      html += '<div data-role="' + role + '">' + el.innerHTML + '</div>';
    });
    var out = '<!-- mnemo:source=chatgpt,url=' + location.href + ',title=' + encodeURIComponent(document.title || 'ChatGPT Chat') + ' -->\\n' + html;
    copyToClipboard(out);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Claude: grab conversation turns' HTML
const claudeScript = `
(function(){
  try {
    ${copyBlock()}
    var turns = document.querySelectorAll('[data-testid^="chat-message"]');
    if (!turns.length) turns = document.querySelectorAll('.font-claude-message, .font-user-message');
    if (!turns.length) turns = document.querySelectorAll('article, [role="article"]');
    if (!turns.length) { alert('No conversation found on this page.'); return; }
    var html = '';
    turns.forEach(function(el) {
      var isHuman = el.querySelector('[data-testid="user-message"]')
        || el.classList.contains('font-user-message')
        || (el.getAttribute('data-testid') || '').indexOf('human') >= 0;
      var role = isHuman ? 'user' : 'assistant';
      html += '<div data-role="' + role + '">' + el.innerHTML + '</div>';
    });
    if (!html) { alert('Could not extract conversation content.'); return; }
    var out = '<!-- mnemo:source=claude,url=' + location.href + ',title=' + encodeURIComponent(document.title || 'Claude Chat') + ' -->\\n' + html;
    copyToClipboard(out);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Perplexity: grab answer content HTML
const perplexityScript = `
(function(){
  try {
    ${copyBlock()}
    var answers = document.querySelectorAll('[class*="AnswerContent"], [class*="answer"]');
    if (!answers.length) answers = document.querySelectorAll('article, .prose');
    if (!answers.length) { alert('No content found on this page.'); return; }
    var html = '';
    answers.forEach(function(el) {
      html += '<div data-role="assistant">' + el.innerHTML + '</div>';
    });
    var out = '<!-- mnemo:source=perplexity,url=' + location.href + ',title=' + encodeURIComponent(document.title || 'Perplexity Search') + ' -->\\n' + html;
    copyToClipboard(out);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

export function getBookmarkletUrl(script: string): string {
  return "javascript:" + encodeURIComponent(script.replace(/\s+/g, " ").trim());
}

export const bookmarklets = [
  {
    name: "Copy to Mnemo (ChatGPT)",
    source: "chatgpt",
    url: getBookmarkletUrl(chatgptScript),
    instructions: "Use on chatgpt.com, then paste in Mnemo with Cmd+V.",
  },
  {
    name: "Copy to Mnemo (Claude)",
    source: "claude",
    url: getBookmarkletUrl(claudeScript),
    instructions: "Use on claude.ai, then paste in Mnemo with Cmd+V.",
  },
  {
    name: "Copy to Mnemo (Perplexity)",
    source: "perplexity",
    url: getBookmarkletUrl(perplexityScript),
    instructions: "Use on perplexity.ai, then paste in Mnemo with Cmd+V.",
  },
];
