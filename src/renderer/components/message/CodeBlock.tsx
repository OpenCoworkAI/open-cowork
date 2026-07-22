// Fenced code block with syntax highlighting (highlight.js) and copy button
import { useState, useMemo, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import { IconButton } from '../ui';
import hljs from 'highlight.js';

// Sanitize highlight.js output - only allow highlight span tags
const sanitizeHighlight = (html: string): string =>
  html.replace(/<(?!\/?span(?:\s+class="hljs-[^"]*")?\s*\/?>)[^>]*>/g, (match) =>
    match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

interface CodeBlockProps {
  language: string;
  children: string;
}

export const CodeBlock = memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const highlightedHtml = useMemo(() => {
    try {
      const lang = language.toLowerCase();
      let result: string;
      if (hljs.getLanguage(lang)) {
        result = hljs.highlight(children, { language: lang }).value;
      } else {
        result = hljs.highlightAuto(children).value;
      }
      return sanitizeHighlight(result);
    } catch {
      return null;
    }
  }, [children, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail if focus is lost or permission denied
    }
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">{language}</span>
        <IconButton
          size="sm"
          onClick={handleCopy}
          className="bg-surface hover:bg-surface-hover"
          title={copied ? undefined : 'Copy'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-muted" />
          )}
        </IconButton>
      </div>
      <pre className="code-block">
        {highlightedHtml ? (
          // highlight.js sanitizes and escapes input before injecting span tokens
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
});
