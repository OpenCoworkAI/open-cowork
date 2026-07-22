import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { AUTO_TEXT_DIRECTION_PROPS } from '../utils/text-direction';
import { translateInlineI18n } from '../utils/inline-i18n';

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [remarkMath, [remarkGfm, { singleTilde: false }]] as const;

// remark-math emits <code class="language-math math-inline"> (inline) and
// <pre><code class="language-math math-display"> (display). The default schema
// allows only /^language-./ on <code>, stripping the math-* tokens before
// rehypeKatex processes them.
const mathSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Merged into one tuple — findDefinition returns the first match per key,
    // so a second ['className', ...] entry would be silently ignored.
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

// NOTE: rehypeSanitize runs BEFORE rehypeKatex — KaTeX output is unsanitized.
// Safe while trust is false (default), which disables \href, \htmlClass, etc.
// If KaTeX trust is ever enabled, add a second sanitize pass.
const REHYPE_PLUGINS = [
  [rehypeSanitize, mathSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
] as const;

export interface MessageMarkdownProps {
  normalizedText: string;
  isStreaming?: boolean;
  components?: Record<string, unknown>;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  isStreaming,
  components,
}: MessageMarkdownProps) {
  const { t } = useTranslation();
  const displayText = useMemo(() => translateInlineI18n(normalizedText, t), [normalizedText, t]);
  return (
    <div
      {...AUTO_TEXT_DIRECTION_PROPS}
      className="prose-chat max-w-none text-text-primary text-start"
    >
      <ReactMarkdown
        remarkPlugins={
          REMARK_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['remarkPlugins']
        }
        rehypePlugins={
          REHYPE_PLUGINS as unknown as Parameters<typeof ReactMarkdown>[0]['rehypePlugins']
        }
        components={components}
      >
        {displayText}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
    </div>
  );
});
