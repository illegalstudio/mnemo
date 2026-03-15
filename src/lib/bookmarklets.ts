// ChatGPT bookmarklet
const chatgptScript = `
(function(){
  try {
    var msgs = document.querySelectorAll('[data-message-author-role]');
    if (!msgs.length) { alert('No conversation found on this page.'); return; }
    var md = '# ' + (document.title || 'ChatGPT Chat') + '\\n\\n';
    msgs.forEach(function(el) {
      var role = el.getAttribute('data-message-author-role');
      var label = role === 'user' ? '**User**' : '**ChatGPT**';
      var content = el.innerText.trim();
      md += '## ' + label + '\\n\\n' + content + '\\n\\n---\\n\\n';
    });
    navigator.clipboard.writeText(md).then(function() {
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    }).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    });
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Claude bookmarklet
const claudeScript = `
(function(){
  try {
    var turns = document.querySelectorAll('[data-testid^="chat-message"]');
    if (!turns.length) turns = document.querySelectorAll('.font-claude-message, .font-user-message');
    if (!turns.length) turns = document.querySelectorAll('article, [role="article"]');
    if (!turns.length) { alert('No conversation found on this page.'); return; }
    var md = '# ' + (document.title || 'Claude Chat') + '\\n\\n';
    turns.forEach(function(el) {
      var isHuman = el.querySelector('[data-testid="user-message"]')
        || el.classList.contains('font-user-message')
        || (el.getAttribute('data-testid') || '').indexOf('human') >= 0;
      var label = isHuman ? '**Human**' : '**Claude**';
      var content = el.innerText.trim();
      if (content) md += '## ' + label + '\\n\\n' + content + '\\n\\n---\\n\\n';
    });
    if (!md.trim()) { alert('Could not extract conversation content.'); return; }
    navigator.clipboard.writeText(md).then(function() {
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    }).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    });
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Perplexity bookmarklet
const perplexityScript = `
(function(){
  try {
    var answers = document.querySelectorAll('[class*="AnswerContent"], [class*="answer"]');
    if (!answers.length) answers = document.querySelectorAll('article, .prose');
    if (!answers.length) { alert('No content found on this page.'); return; }
    var md = '# ' + (document.title || 'Perplexity Search') + '\\n\\n';
    answers.forEach(function(el) {
      md += el.innerText.trim() + '\\n\\n---\\n\\n';
    });
    navigator.clipboard.writeText(md).then(function() {
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    }).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('Copied to clipboard! Paste into Mnemo with Cmd+V.');
    });
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
