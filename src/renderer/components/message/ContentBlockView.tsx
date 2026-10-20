// Dispatches a single ContentBlock to the appropriate sub-renderer
import { Suspense, lazy, isValidElement, cloneElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { PanelErrorBoundary } from '../PanelErrorBoundary';
import {
  splitTextByFileMentions,
  splitChildrenByFileMentions,
  getFileLinkButtonClassName,
} from '../../utils/file-link';
import { resolvePathAgainstWorkspace } from '../../../shared/workspace-path';
import {
  normalizeLocalFileMarkdownLinks,
  resolveLocalFilePathFromHref,
} from '../../utils/markdown-local-link';
import { normalizeLatexDelimiters } from '../../utils/latex-delimiters';
import {
  AUTO_TEXT_DIRECTION_PROPS,
  getTextAlignmentClass,
  getTextDirectionProps,
} from '../../utils/text-direction';
import type { ToolUseContent, ToolResultContent, FileAttachmentContent } from '../../types';
import { FileText } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { ThinkingBlock, escapeThinkTags } from './ThinkingBlock';
import { ToolUseBlock } from './ToolUseBlock';
import { ToolResultBlock } from './ToolResultBlock';
import type { ContentBlockViewProps } from './types';

const MessageMarkdown = lazy(() =>
  import('../MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

// Cowork citation guidance can emit ~[Title](url)~ markers.
// Render them as regular links instead of strikethrough links.
function normalizeCitationMarkdownLinks(markdown: string): string {
  return markdown.replace(/~\[(.+?)\]\(([^)\s]+)\)~/g, '[$1]($2)');
}

export const ContentBlockView = memo(function ContentBlockView({
  block,
  isUser,
  isStreaming,
  allBlocks,
  message,
  textDirection = 'auto',
}: ContentBlockViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const directionProps = getTextDirectionProps(textDirection);
  const alignmentClass = getTextAlignmentClass(textDirection);

  const resolveFilePath = (value: string) => resolvePathAgainstWorkspace(value, currentWorkingDir);

  const renderFileButton = (value: string, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={async () => {
        if (typeof window === 'undefined' || !window.electronAPI?.showItemInFolder) {
          return;
        }
        const resolvedPath = resolveFilePath(value);
        try {
          const revealed = await window.electronAPI.showItemInFolder(
            resolvedPath,
            currentWorkingDir ?? undefined
          );
          if (!revealed) {
            setGlobalNotice({
              id: `message-card-reveal-failed-${Date.now()}`,
              type: 'warning',
              message: t('context.revealFailed'),
            });
          }
        } catch (error) {
          setGlobalNotice({
            id: `message-card-reveal-failed-${Date.now()}`,
            type: 'warning',
            message:
              error instanceof Error && error.message ? error.message : t('context.revealFailed'),
          });
        }
      }}
      className={getFileLinkButtonClassName()}
      title={resolveFilePath(value)}
    >
      {value}
    </button>
  );

  const renderFileMentionParts = (
    parts: ReturnType<typeof splitChildrenByFileMentions>,
    keyPrefix: string
  ) =>
    parts.map((part, partIndex) => {
      const key = `${keyPrefix}-${partIndex}`;
      if (part.type === 'file') {
        return renderFileButton(part.value, key);
      }
      if (part.type === 'text') {
        return <span key={key}>{part.value}</span>;
      }
      if (isValidElement(part.value)) {
        return part.value.key ? part.value : cloneElement(part.value, { key });
      }
      return <span key={key}>{String(part.value)}</span>;
    });

  const renderChildrenWithFileLinks = (children: unknown, keyPrefix: string) => {
    const normalized = Array.isArray(children) ? children : [children];
    const parts = splitChildrenByFileMentions(normalized);
    return renderFileMentionParts(parts, keyPrefix);
  };

  const markdownComponents = useMemo(
    () => ({
      a({ children, href }: { children?: React.ReactNode; href?: string }) {
        const localFilePath = resolveLocalFilePathFromHref(href, currentWorkingDir);
        if (localFilePath) {
          return (
            <button
              type="button"
              onClick={async () => {
                if (typeof window === 'undefined' || !window.electronAPI?.showItemInFolder) {
                  return;
                }
                try {
                  const revealed = await window.electronAPI.showItemInFolder(
                    localFilePath,
                    currentWorkingDir ?? undefined
                  );
                  if (!revealed) {
                    setGlobalNotice({
                      id: `message-card-reveal-failed-${Date.now()}`,
                      type: 'warning',
                      message: t('context.revealFailed'),
                    });
                  }
                } catch (error) {
                  setGlobalNotice({
                    id: `message-card-reveal-failed-${Date.now()}`,
                    type: 'warning',
                    message:
                      error instanceof Error && error.message
                        ? error.message
                        : t('context.revealFailed'),
                  });
                }
              }}
              className={getFileLinkButtonClassName()}
              title={localFilePath}
            >
              {children}
            </button>
          );
        }

        const safeHref = href && /^(?:https?:|mailto:|#)/i.test(href) ? href : undefined;
        return (
          <a
            href={safeHref}
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              if (safeHref && typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                void window.electronAPI.openExternal(safeHref);
              }
            }}
            className="text-accent hover:text-accent-hover"
          >
            {children}
          </a>
        );
      },
      blockquote({ children }: { children?: React.ReactNode }) {
        return (
          <blockquote className="border-l-2 border-accent/40 pl-4 text-text-muted">
            {children}
          </blockquote>
        );
      },
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
        const match = /language-([\w+#.-]+)/.exec(className || '');
        const isInline = !match;

        if (isInline) {
          const raw = String(children);
          const parts = splitTextByFileMentions(raw);
          if (parts.length === 1 && parts[0]?.type === 'file') {
            return renderFileButton(parts[0].value);
          }
          return (
            <code
              dir="ltr"
              style={{ unicodeBidi: 'isolate' }}
              className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-sm"
              {...props}
            >
              {children}
            </code>
          );
        }

        return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
      },
      p({ children }: { children?: React.ReactNode }) {
        return (
          <p {...directionProps} className={alignmentClass}>
            {renderChildrenWithFileLinks(children, 'p')}
          </p>
        );
      },
      li({ children }: { children?: React.ReactNode }) {
        const content = renderChildrenWithFileLinks(children, 'li');
        // The marker follows the list item's own direction. Manual RTL would
        // place an outside marker on the right while text-left keeps the words
        // on the left, so the marker stays LTR and the item text carries the
        // selected direction.
        if (textDirection === 'auto') {
          return (
            <li {...directionProps} className={alignmentClass}>
              {content}
            </li>
          );
        }
        return (
          <li dir="ltr" className={alignmentClass}>
            <span {...directionProps}>{content}</span>
          </li>
        );
      },
      table({ children }: { children?: React.ReactNode }) {
        return (
          <div {...AUTO_TEXT_DIRECTION_PROPS} className="overflow-x-auto my-3">
            <table className="min-w-full border-collapse">{children}</table>
          </div>
        );
      },
      th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
        return (
          <th
            className="border border-border px-3 py-2 text-sm font-semibold text-text-primary bg-surface-muted"
            style={style}
          >
            {children}
          </th>
        );
      },
      td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
        return (
          <td className="border border-border px-3 py-2 text-sm text-text-primary" style={style}>
            {children}
          </td>
        );
      },
      input({ checked, ...props }: { checked?: boolean }) {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 accent-accent"
            {...props}
          />
        );
      },
      strong({ children }: { children?: React.ReactNode }) {
        return <strong>{renderChildrenWithFileLinks(children, 'strong')}</strong>;
      },
      em({ children }: { children?: React.ReactNode }) {
        return <em>{renderChildrenWithFileLinks(children, 'em')}</em>;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentWorkingDir, textDirection, setGlobalNotice, t]
  );

  switch (block.type) {
    case 'text': {
      const textBlock = block as { type: 'text'; text: string };
      const text = textBlock.text || '';
      const normalizedText = normalizeCitationMarkdownLinks(
        normalizeLocalFileMarkdownLinks(normalizeLatexDelimiters(text))
      );

      if (!text) {
        return <span className="text-text-muted italic">{t('messageCard.emptyText')}</span>;
      }

      // Simple text display for user messages, Markdown for assistant
      if (isUser) {
        return (
          <p
            {...directionProps}
            className={`text-text-primary whitespace-pre-wrap break-words ${alignmentClass}`}
          >
            {text}
            {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
          </p>
        );
      }

      return (
        <PanelErrorBoundary
          name="MessageMarkdown"
          fallback={
            <div
              {...directionProps}
              className={`prose-chat max-w-none text-text-primary whitespace-pre-wrap break-words ${alignmentClass}`}
            >
              {normalizedText}
            </div>
          }
        >
          <Suspense
            fallback={
              <div
                {...directionProps}
                className={`prose-chat max-w-none text-text-primary whitespace-pre-wrap break-words ${alignmentClass}`}
              >
                {normalizedText}
              </div>
            }
          >
            <MessageMarkdown
              normalizedText={escapeThinkTags(normalizedText)}
              isStreaming={isStreaming}
              components={markdownComponents}
              textDirection={textDirection}
            />
          </Suspense>
        </PanelErrorBoundary>
      );
    }

    case 'image': {
      const imageBlock = block as {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      };
      if (!imageBlock.source?.media_type || !imageBlock.source?.data) {
        return null;
      }
      const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
      if (!ALLOWED_IMAGE_TYPES.has(imageBlock.source.media_type)) {
        return null;
      }
      const { source } = imageBlock;
      const imageSrc = `data:${source.media_type};base64,${source.data}`;

      return (
        <div className={`${isUser ? 'inline-block' : ''}`}>
          <img
            src={imageSrc}
            alt={t('messageCard.pastedContentAlt')}
            className="w-full max-w-full rounded-lg border border-border"
            style={{ maxHeight: '600px', objectFit: 'contain' }}
          />
        </div>
      );
    }

    case 'file_attachment': {
      const fileBlock = block as FileAttachmentContent;

      return (
        <div className="flex max-w-full min-w-0 items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border overflow-hidden">
          <FileText className="w-4 h-4 text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{fileBlock.filename}</p>
          </div>
        </div>
      );
    }

    case 'tool_use':
      return (
        <ToolUseBlock block={block as ToolUseContent} allBlocks={allBlocks} message={message} />
      );

    case 'tool_result':
      return (
        <ToolResultBlock
          block={block as ToolResultContent}
          allBlocks={allBlocks}
          message={message}
        />
      );

    case 'thinking':
      return (
        <ThinkingBlock
          block={block as { type: 'thinking'; thinking: string }}
          textDirection={textDirection}
        />
      );

    default:
      return null;
  }
});
