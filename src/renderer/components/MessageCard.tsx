import { Suspense, lazy, useState, isValidElement, cloneElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import {
  splitTextByFileMentions,
  splitChildrenByFileMentions,
  getFileLinkButtonClassName,
} from '../utils/file-link';
import { resolvePathAgainstWorkspace } from '../../shared/workspace-path';
import {
  normalizeLocalFileMarkdownLinks,
  resolveLocalFilePathFromHref,
} from '../utils/markdown-local-link';
import { normalizeLatexDelimiters } from '../utils/latex-delimiters';
import { shouldUseScreenshotSummary } from '../utils/tool-result-summary';
import type {
  Message,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
  QuestionItem,
  FileAttachmentContent,
} from '../types';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  CheckCircle2,
  HelpCircle,
  ListTodo,
  Loader2,
  XCircle,
  Square,
  CheckSquare,
  Clock,
  FileText,
  Brain,
  Terminal,
  FileCode,
  Pencil,
  Search,
  Globe,
  FolderSearch,
} from 'lucide-react';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
}

const MessageMarkdown = lazy(() =>
  import('./MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

export const MessageCard = memo(function MessageCard({ message, isStreaming }: MessageCardProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const rawContent = message.content as unknown;
  const contentBlocks = Array.isArray(rawContent)
    ? (rawContent as ContentBlock[])
    : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock];
  const [copied, setCopied] = useState(false);

  // Build a set of tool_result IDs that have a matching tool_use (for merging)
  const mergedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of contentBlocks) {
      if (b.type === 'tool_use') {
        const tu = b as ToolUseContent;
        // Find matching result
        const result = contentBlocks.find(
          (r) => r.type === 'tool_result' && (r as ToolResultContent).toolUseId === tu.id
        );
        if (result) ids.add((result as ToolResultContent).toolUseId);
      }
    }
    return ids;
  }, [contentBlocks]);

  // Extract text content for copying
  const getTextContent = () => {
    return contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');
  };

  const handleCopy = async () => {
    const text = getTextContent();
    if (text) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="animate-fade-in">
      {isUser ? (
        // User message - compact styling with smaller padding and radius
        <div className="flex items-start gap-2 justify-end group">
          <div
            className={`message-user px-4 py-3 rounded-[1.65rem] max-w-[80%] min-w-0 break-words ${
              isQueued ? 'opacity-70 border-dashed' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            {isQueued && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" />
                <span>{t('messageCard.queued')}</span>
              </div>
            )}
            {isCancelled && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <XCircle className="w-3 h-3" />
                <span>{t('messageCard.cancelled')}</span>
              </div>
            )}
            {contentBlocks.length === 0 ? (
              <span className="text-text-muted italic">{t('messageCard.emptyMessage')}</span>
            ) : (
              contentBlocks.map((block, index) => (
                <ContentBlockView
                  key={index}
                  block={block}
                  isUser={isUser}
                  isStreaming={isStreaming}
                />
              ))
            )}
          </div>
          <button
            onClick={handleCopy}
            className="mt-1 w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
            title={t('messageCard.copyMessage')}
          >
            {copied ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <Copy className="w-3 h-3 text-text-muted" />
            )}
          </button>
        </div>
      ) : (
        // Assistant message — no bubble, direct content (Claude style)
        <div className="space-y-1.5">
          {contentBlocks.map((block, index) => {
            // Skip tool_result blocks that are merged into their tool_use card
            if (
              block.type === 'tool_result' &&
              mergedResultIds.has((block as ToolResultContent).toolUseId)
            ) {
              return null;
            }
            return (
              <ContentBlockView
                key={index}
                block={block}
                isUser={isUser}
                isStreaming={isStreaming}
                allBlocks={contentBlocks}
                message={message}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

interface ContentBlockViewProps {
  block: ContentBlock;
  isUser: boolean;
  isStreaming?: boolean;
  allBlocks?: ContentBlock[]; // Pass all blocks to find related tool_use
  message?: Message; // Pass the whole message to access previous messages
}

function normalizeCitationMarkdownLinks(markdown: string): string {
  // Cowork citation guidance can emit ~[Title](url)~ markers.
  // Render them as regular links instead of strikethrough links.
  return markdown.replace(/~\[(.+?)\]\(([^)\s]+)\)~/g, '[$1]($2)');
}

const ContentBlockView = memo(function ContentBlockView({
  block,
  isUser,
  isStreaming,
  allBlocks,
  message,
}: ContentBlockViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;

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
      title={t('messageCard.revealInFolder')}
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
          <p className="text-text-primary whitespace-pre-wrap break-words text-left">
            {text}
            {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
          </p>
        );
      }

      return (
        <Suspense
          fallback={
            <div className="prose-chat max-w-none text-text-primary whitespace-pre-wrap break-words">
              {normalizedText}
            </div>
          }
        >
          <MessageMarkdown
            normalizedText={normalizedText}
            isStreaming={isStreaming}
            components={{
              a({ children, href }: { children?: React.ReactNode; href?: string }) {
                const localFilePath = resolveLocalFilePathFromHref(href, currentWorkingDir);
                if (localFilePath) {
                  return (
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          typeof window === 'undefined' ||
                          !window.electronAPI?.showItemInFolder
                        ) {
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
                      title={t('messageCard.revealInFolder')}
                    >
                      {children}
                    </button>
                  );
                }

                return (
                  <a
                    href={href}
                    rel="noreferrer"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!href) {
                        return;
                      }
                      if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                        void window.electronAPI.openExternal(href);
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
              code({
                className,
                children,
                ...props
              }: {
                className?: string;
                children?: React.ReactNode;
              }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match;

                if (isInline) {
                  const raw = String(children);
                  const parts = splitTextByFileMentions(raw);
                  if (parts.length === 1 && parts[0].type === 'file') {
                    return renderFileButton(parts[0].value);
                  }
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-sm"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>
                );
              },
              p({ children }: { children?: React.ReactNode }) {
                return <p className="text-left">{renderChildrenWithFileLinks(children, 'p')}</p>;
              },
              li({ children }: { children?: React.ReactNode }) {
                return <li className="text-left">{renderChildrenWithFileLinks(children, 'li')}</li>;
              },
              table({ children }: { children?: React.ReactNode }) {
                return (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border-collapse">{children}</table>
                  </div>
                );
              },
              th({
                children,
                style,
              }: {
                children?: React.ReactNode;
                style?: React.CSSProperties;
              }) {
                return (
                  <th
                    className="border border-border px-3 py-2 text-sm font-semibold text-text-primary bg-surface-muted"
                    style={style}
                  >
                    {children}
                  </th>
                );
              },
              td({
                children,
                style,
              }: {
                children?: React.ReactNode;
                style?: React.CSSProperties;
              }) {
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
            }}
          />
        </Suspense>
      );
    }

    case 'image': {
      const imageBlock = block as {
        type: 'image';
        source: { type: 'base64'; media_type: string; data: string };
      };
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
      return <ToolUseBlock block={block} allBlocks={allBlocks} message={message} />;

    case 'tool_result':
      return <ToolResultBlock block={block} allBlocks={allBlocks} message={message} />;

    case 'thinking':
      return <ThinkingBlock block={block} />;

    default:
      return null;
  }
});
function getToolIcon(name: string) {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'execute_command') return <Terminal className="w-3.5 h-3.5" />;
  if (n === 'read' || n === 'read_file') return <FileCode className="w-3.5 h-3.5" />;
  if (n === 'write' || n === 'write_file') return <FileText className="w-3.5 h-3.5" />;
  if (n === 'edit' || n === 'edit_file') return <Pencil className="w-3.5 h-3.5" />;
  if (n === 'grep') return <Search className="w-3.5 h-3.5" />;
  if (n === 'glob') return <FolderSearch className="w-3.5 h-3.5" />;
  if (n === 'websearch') return <Globe className="w-3.5 h-3.5" />;
  if (n === 'webfetch') return <Globe className="w-3.5 h-3.5" />;
  return <Terminal className="w-3.5 h-3.5" />;
}

const ToolUseBlock = memo(function ToolUseBlock({
  block,
  allBlocks,
  message,
}: {
  block: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}) {
  const traceStepsBySession = useAppStore((s) => s.traceStepsBySession);
  const messagesBySession = useAppStore((s) => s.messagesBySession);
  const activeTurnsBySession = useAppStore((s) => s.activeTurnsBySession);
  const [expanded, setExpanded] = useState(false);

  // Check if this is AskUserQuestion - render inline question UI
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }

  // Check if this is TodoWrite - render todo list UI
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  // Find matching tool_result: first in same message, then across all session messages
  let toolResult = allBlocks?.find(
    (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
  ) as ToolResultContent | undefined;

  if (!toolResult && message?.sessionId) {
    const allMessages = messagesBySession[message.sessionId] || [];
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const found = (msg.content as ContentBlock[]).find(
        (b) => b.type === 'tool_result' && (b as ToolResultContent).toolUseId === block.id
      );
      if (found) {
        toolResult = found as ToolResultContent;
        break;
      }
    }
  }

  // Determine state: running / success / error
  // Only show spinner if session still has an active turn; otherwise treat as done
  const hasActiveTurn = message?.sessionId
    ? Boolean(activeTurnsBySession[message.sessionId])
    : false;
  const isRunning = !toolResult && hasActiveTurn;
  const isError = toolResult?.isError === true;
  const isSuccess = toolResult && !isError;

  // Get compact label
  const label = getToolLabel(block.name, block.input);
  const isMCPTool = block.name.startsWith('mcp__');
  const mcpServerName = isMCPTool ? block.name.match(/^mcp__(.+?)__/)?.[1] : null;

  // Result summary
  const getSummary = (): string => {
    if (!toolResult) return '';
    if (toolResult.isError) {
      const firstLine = toolResult.content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    const toolName = block.name;
    if (shouldUseScreenshotSummary(toolName, toolResult.content)) return 'Screenshot captured';
    if (toolResult.content.length < 60) return toolResult.content.trim();
    const lines = toolResult.content.trim().split(/\r?\n/);
    return `${lines.length} lines`;
  };

  const hasImages = toolResult?.images && toolResult.images.length > 0;
  const summary = getSummary();

  // Duration from trace steps
  let duration: number | undefined;
  if (message?.sessionId) {
    const steps = traceStepsBySession[message.sessionId] || [];
    const resultStep = steps.find((s) => s.id === block.id && s.type === 'tool_result');
    duration = resultStep?.duration;
  }

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isError
          ? 'border-error/25 bg-error/5'
          : isRunning
            ? 'border-accent/15 bg-accent/5'
            : 'border-border-subtle bg-background/40'
      }`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {/* Status icon */}
        <div
          className={`flex-shrink-0 ${
            isError ? 'text-error' : isRunning ? 'text-accent' : 'text-text-muted'
          }`}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isError ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )}
        </div>

        {/* Tool icon */}
        <div className="flex-shrink-0 text-text-muted">{getToolIcon(block.name)}</div>

        {/* Label */}
        <span className="text-xs font-mono text-text-secondary truncate flex-1 min-w-0">
          {label}
        </span>

        {/* MCP badge */}
        {isMCPTool && mcpServerName && (
          <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-mcp/15 text-mcp flex-shrink-0 font-medium">
            {mcpServerName}
          </span>
        )}

        {/* Summary / duration */}
        {isSuccess && summary && !expanded && (
          <span className="text-[11px] text-text-muted truncate max-w-[180px] flex-shrink-0">
            {summary}
          </span>
        )}
        {duration !== undefined && (
          <span className="text-[10px] text-text-muted flex-shrink-0 tabular-nums">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Chevron */}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 animate-fade-in bg-background/35">
          {/* Input section */}
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
              Input
            </div>
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all bg-surface-muted rounded-lg p-2.5 border border-border-subtle">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>

          {/* Output section */}
          {toolResult && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                Output
              </div>
              <pre
                className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto ${
                  isError ? 'text-error bg-error/5' : 'text-text-secondary bg-surface-muted'
                }`}
              >
                {toolResult.content}
              </pre>

              {/* Images */}
              {hasImages &&
                toolResult.images!.map((image, index) => (
                  <div key={index} className="mt-2 border border-border rounded-lg overflow-hidden">
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Output ${index + 1}`}
                      className="w-full h-auto"
                      style={{ maxHeight: '400px', objectFit: 'contain' }}
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/** Shorten a file path to just filename or last 2 segments */
function shortenPath(p: string): string {
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

/** Get compact label: tool action + key argument */
function getToolLabel(name: string, input: any): string {
  const inp = input || {};
  // MCP tools
  if (name.startsWith('mcp__')) {
    const match = name.match(/^mcp__(.+?)__(.+)$/);
    return match?.[2] || name;
  }

  const nameLower = name.toLowerCase();
  if (nameLower === 'read' || nameLower === 'read_file') {
    const p = inp.file_path || inp.path || '';
    return p ? `Read ${shortenPath(p)}` : 'Read file';
  }
  if (nameLower === 'write' || nameLower === 'write_file') {
    const p = inp.file_path || inp.path || '';
    return p ? `Write ${shortenPath(p)}` : 'Write file';
  }
  if (nameLower === 'edit' || nameLower === 'edit_file') {
    const p = inp.file_path || inp.path || '';
    return p ? `Edit ${shortenPath(p)}` : 'Edit file';
  }
  if (nameLower === 'bash' || nameLower === 'execute_command') {
    const cmd = inp.command || inp.cmd || '';
    if (cmd) {
      const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
      return `$ ${short}`;
    }
    return 'Run command';
  }
  if (nameLower === 'glob') return inp.pattern ? `Glob ${inp.pattern}` : 'Glob';
  if (nameLower === 'grep') return inp.pattern ? `Grep "${inp.pattern}"` : 'Grep';
  if (nameLower === 'websearch') return inp.query ? `Search "${inp.query}"` : 'Web search';
  if (nameLower === 'webfetch') {
    const url = inp.url || '';
    return url ? `Fetch ${url.length > 50 ? url.substring(0, 47) + '...' : url}` : 'Fetch URL';
  }
  return name;
}

// Todo item interface
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  id?: string;
  activeForm?: string;
}

// TodoWrite block - renders a beautiful todo list
const TodoWriteBlock = memo(function TodoWriteBlock({ block }: { block: ToolUseContent }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const todos: TodoItem[] = (block.input as any)?.todos || [];

  // Calculate progress
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const totalCount = todos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const inProgressItem = todos.find((t) => t.status === 'in_progress');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckSquare className="w-4 h-4 text-success" />;
      case 'in_progress':
        return <Loader2 className="w-4 h-4 text-accent animate-spin" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-text-muted" />;
      default: // pending
        return <Square className="w-4 h-4 text-text-muted" />;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-text-muted line-through';
      case 'in_progress':
        return 'text-accent font-medium';
      case 'cancelled':
        return 'text-text-muted line-through opacity-60';
      default:
        return 'text-text-primary';
    }
  };

  if (todos.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 bg-surface-muted hover:bg-surface-active transition-colors"
      >
        <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center">
          <ListTodo className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="flex-1 text-left">
          <span className="font-medium text-sm text-text-primary">
            {t('messageCard.taskProgress')}
          </span>
          {inProgressItem && (
            <span className="text-xs text-text-muted ml-2">
              — {inProgressItem.activeForm || inProgressItem.content}
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-text-muted mr-2">
          {completedCount}/{totalCount}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {/* Progress bar */}
      <div className="h-0.5 bg-surface-muted">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo list */}
      {expanded && (
        <div className="p-3 space-y-1">
          {todos.map((todo, index) => (
            <div
              key={todo.id || index}
              className={`flex items-start gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${
                todo.status === 'in_progress' ? 'bg-accent/5' : ''
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">{getStatusIcon(todo.status)}</div>
              <span className={`text-sm leading-relaxed ${getStatusStyle(todo.status)}`}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// Inline AskUserQuestion component - read-only display for historical messages
function AskUserQuestionBlock({ block }: { block: ToolUseContent }) {
  const { t } = useTranslation();
  // Parse questions from input
  const questions: QuestionItem[] = (block.input as any)?.questions || [];

  const getOptionLetter = (index: number) => String.fromCharCode(65 + index);

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <span className="text-text-muted">{t('messageCard.noQuestions')}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-accent/10 border-b border-accent/20 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
          <HelpCircle className="w-4 h-4 text-accent" />
        </div>
        <div>
          <span className="font-medium text-sm text-text-primary">{t('messageCard.question')}</span>
        </div>
      </div>

      {/* Questions (read-only) */}
      <div className="p-4 space-y-5">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2">
            {q.header && (
              <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded uppercase tracking-wide">
                {q.header}
              </span>
            )}
            <p className="text-text-primary font-medium text-sm">{q.question}</p>
            {q.options && q.options.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {q.options.map((option, optIdx) => (
                  <div
                    key={optIdx}
                    className="w-full p-3 rounded-lg border border-border-subtle bg-surface-muted text-left"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold bg-border-subtle text-text-secondary">
                        {getOptionLetter(optIdx)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-text-primary">{option.label}</span>
                        {option.description && (
                          <p className="text-xs text-text-muted mt-0.5">{option.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Fallback ToolResultBlock — only renders for truly orphan results (no matching tool_use anywhere)
const ToolResultBlock = memo(function ToolResultBlock({
  block,
  allBlocks,
  message,
}: {
  block: ToolResultContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}) {
  const traceStepsBySession = useAppStore((s) => s.traceStepsBySession);
  const messagesBySession = useAppStore((s) => s.messagesBySession);
  const [expanded, setExpanded] = useState(false);

  // If a ToolUseBlock in any message already merges this result, hide this block
  if (message?.sessionId) {
    const allMessages = messagesBySession[message.sessionId] || [];
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      const hasMatchingToolUse = (msg.content as ContentBlock[]).some(
        (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
      );
      if (hasMatchingToolUse) return null;
    }
  }

  // Try to find the tool name from trace steps
  let toolName: string | undefined;
  if (message?.sessionId) {
    const steps = traceStepsBySession[message.sessionId] || [];
    const toolCallStep = steps.find((s) => s.id === block.toolUseId && s.type === 'tool_call');
    if (toolCallStep) toolName = toolCallStep.toolName;
  }
  if (!toolName) {
    const toolUseBlock = allBlocks?.find(
      (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
    ) as ToolUseContent | undefined;
    toolName = toolUseBlock?.name;
  }

  const isMCPTool = toolName?.startsWith('mcp__') || false;
  const displayName = isMCPTool
    ? (toolName || '').match(/^mcp__(.+?)__(.+)$/)?.[2] || toolName || 'tool'
    : toolName || 'tool';

  const getSummary = (): string => {
    if (block.isError) {
      const firstLine = block.content.split(/\r?\n/)[0];
      return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(toolName, block.content)) return 'Screenshot captured';
    if (block.content.length < 60) return block.content.trim();
    const lines = block.content.trim().split(/\r?\n/);
    return `${lines.length} lines`;
  };

  const hasImages = block.images && block.images.length > 0;

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        block.isError ? 'border-error/25 bg-error/5' : 'border-border-subtle bg-background/40'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-hover/50 transition-colors"
      >
        {block.isError ? (
          <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
        )}
        <span
          className={`text-xs font-mono flex-shrink-0 ${block.isError ? 'text-error' : 'text-text-muted'}`}
        >
          {displayName}
        </span>
        <span className="text-[11px] text-text-muted truncate flex-1">{getSummary()}</span>
        {hasImages && (
          <span className="text-[11px] text-text-muted flex-shrink-0">
            +{block.images!.length} img
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-2 animate-fade-in">
          <pre
            className={`text-xs font-mono whitespace-pre-wrap break-all rounded-lg p-2.5 border border-border-subtle max-h-[300px] overflow-y-auto ${
              block.isError ? 'text-error bg-error/5' : 'text-text-secondary bg-surface-muted'
            }`}
          >
            {block.content}
          </pre>
          {block.images && block.images.length > 0 && (
            <div className="mt-2 space-y-2">
              {block.images.map((image, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
// Thinking block — collapsible card (Claude style)
const ThinkingBlock = memo(function ThinkingBlock({
  block,
}: {
  block: { type: 'thinking'; thinking: string };
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = block.thinking || '';
  if (!text) return null;

  // Preview: first ~80 chars
  const preview = text.length > 80 ? text.substring(0, 77) + '...' : text;

  return (
    <div className="rounded-2xl border border-border-subtle bg-background/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-hover/50 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span className="text-xs font-medium text-text-muted flex-shrink-0">
          {t('messageCard.thinking')}
        </span>
        {!expanded && (
          <span className="text-[11px] text-text-muted/60 truncate flex-1 min-w-0 italic">
            {preview}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 animate-fade-in">
          <div className="text-sm text-text-secondary leading-relaxed prose-chat max-w-none">
            <Suspense
              fallback={
                <div className="whitespace-pre-wrap">{text}</div>
              }
            >
              <MessageMarkdown normalizedText={text} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
});

const CodeBlock = memo(function CodeBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">{language}</span>
        <button
          onClick={handleCopy}
          className="w-7 h-7 flex items-center justify-center rounded bg-surface hover:bg-surface-hover transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>
      </div>
      <pre className="code-block">
        <code>{children}</code>
      </pre>
    </div>
  );
});
