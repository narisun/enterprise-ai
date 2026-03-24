/**
 * Lightweight markdown renderer.
 * Uses dangerouslySetInnerHTML with a simple parser for the prototype.
 * In production, swap for react-markdown or assistant-ui's markdown component.
 */
export function MarkdownRenderer({ content }) {
  if (!content) return null

  // Simple markdown-to-HTML for the prototype
  const html = simpleMarkdown(content)

  return (
    <div
      className="prose prose-sm prose-slate max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function simpleMarkdown(text) {
  let html = escapeHtml(text)

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>')
  html = '<p>' + html + '</p>'

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')
  html = html.replace(/<p>(<h[1-3]>)/g, '$1')
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1')
  html = html.replace(/(<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p>(<pre>)/g, '$1')
  html = html.replace(/(<\/pre>)<\/p>/g, '$1')

  return html
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
