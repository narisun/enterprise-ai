/**
 * markdownRenderers.js — Custom ReactMarkdown component overrides.
 *
 * Extracted from OutputCanvas.jsx so the renderer config can be reused
 * across any markdown-rendering surface (output canvas, help guide, etc.)
 * and unit-tested independently.
 *
 * @module lib/markdownRenderers
 */

/* eslint-disable no-unused-vars */
import React from 'react'

/**
 * Custom component map for ReactMarkdown.
 * Provides Quantitix-branded styling for all common markdown elements.
 */
export const MD_COMPONENTS = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-slate-900 mt-0 mb-4 pb-3 border-b border-slate-200">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold text-slate-800 mt-6 mb-3">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-slate-700 mt-4 mb-2">{children}</h3>,
  p:  ({ children }) => <p  className="text-slate-700 leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-3 text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-3 text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em:     ({ children }) => <em className="italic text-slate-700">{children}</em>,
  hr: () => <hr className="border-slate-200 my-4" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-400 pl-4 text-slate-600 italic my-3">{children}</blockquote>
  ),
  code: ({ node, className, children, ...rest }) => {
    const isBlock = Boolean(className)
    return isBlock
      ? <code className="block bg-slate-100 text-slate-800 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre" {...rest}>{children}</code>
      : <code className="bg-slate-100 text-blue-700 px-1.5 py-0.5 rounded text-sm font-mono" {...rest}>{children}</code>
  },
  pre: ({ node, children }) => <pre className="mb-3 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold text-slate-700 px-3 py-2 border border-slate-200">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border border-slate-200 text-slate-700">{children}</td>,
  a:  ({ node, href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-blue-600 underline hover:text-blue-800" {...rest}>
      {children}
    </a>
  ),
  img: ({ node, src, alt, ...rest }) => (
    <img src={src} alt={alt ?? ''} className="max-w-full rounded-lg my-3"
      onError={(e) => { e.currentTarget.style.display = 'none' }} />
  ),
}
