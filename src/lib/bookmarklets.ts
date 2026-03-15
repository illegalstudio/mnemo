function copyBlock(): string {
  return `
    function copyMd(md) {
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
    }
  `;
}

// ChatGPT bookmarklet
// User messages become H2 headings, assistant responses are body text
const chatgptScript = `
(function(){
  try {
    ${copyBlock()}
    var msgs = document.querySelectorAll('[data-message-author-role]');
    if (!msgs.length) { alert('No conversation found on this page.'); return; }
    var md = '<!-- mnemo:source=chatgpt,url=' + location.href + ' -->\\n';
    md += '# ' + (document.title || 'ChatGPT Chat') + '\\n\\n';
    msgs.forEach(function(el) {
      var role = el.getAttribute('data-message-author-role');
      var content = el.innerText.trim();
      if (role === 'user') {
        md += '## ' + content + '\\n\\n';
      } else {
        md += content + '\\n\\n---\\n\\n';
      }
    });
    copyMd(md);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Claude bookmarklet
const claudeScript = `
(function(){
  try {
    ${copyBlock()}
    var turns = document.querySelectorAll('[data-testid^="chat-message"]');
    if (!turns.length) turns = document.querySelectorAll('.font-claude-message, .font-user-message');
    if (!turns.length) turns = document.querySelectorAll('article, [role="article"]');
    if (!turns.length) { alert('No conversation found on this page.'); return; }
    var md = '<!-- mnemo:source=claude,url=' + location.href + ' -->\\n';
    md += '# ' + (document.title || 'Claude Chat') + '\\n\\n';
    turns.forEach(function(el) {
      var isHuman = el.querySelector('[data-testid="user-message"]')
        || el.classList.contains('font-user-message')
        || (el.getAttribute('data-testid') || '').indexOf('human') >= 0;
      var content = el.innerText.trim();
      if (!content) return;
      if (isHuman) {
        md += '## ' + content + '\\n\\n';
      } else {
        md += content + '\\n\\n---\\n\\n';
      }
    });
    if (!md.trim()) { alert('Could not extract conversation content.'); return; }
    copyMd(md);
  } catch(e) { alert('Error: ' + e.message); }
})();
`;

// Perplexity bookmarklet
const perplexityScript = `
(function(){
  try {
    ${copyBlock()}
    var answers = document.querySelectorAll('[class*="AnswerContent"], [class*="answer"]');
    if (!answers.length) answers = document.querySelectorAll('article, .prose');
    if (!answers.length) { alert('No content found on this page.'); return; }
    var md = '<!-- mnemo:source=perplexity,url=' + location.href + ' -->\\n';
    md += '# ' + (document.title || 'Perplexity Search') + '\\n\\n';
    answers.forEach(function(el) {
      md += el.innerText.trim() + '\\n\\n---\\n\\n';
    });
    copyMd(md);
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
