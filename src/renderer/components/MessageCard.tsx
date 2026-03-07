import { useState, isValidElement, cloneElement, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import {
  splitTextByFileMentions,
  splitChildrenByFileMentions,
  getFileLinkButtonClassName
} from '../utils/file-link';
import { normalizeLocalFileMarkdownLinks, resolveLocalFilePathFromHref } from '../utils/markdown-local-link';
import { shouldUseScreenshotSummary } from '../utils/tool-result-summary';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent, QuestionItem, FileAttachmentContent } from '../types';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Send,
  ListTodo,
  Loader2,
  XCircle,
  Square,
  CheckSquare,
  Clock,
  FileText,
} from 'lucide-react';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
}

export const MessageCard = memo(function MessageCard({ message, isStreaming }: MessageCardProps) {
  const isUser = message.role === 'user';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const rawContent = message.content as unknown;
  const contentBlocks = Array.isArray(rawContent)
    ? (rawContent as ContentBlock[])
    : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock];
  const [copied, setCopied] = useState(false);

  // Extract text content for copying
  const getTextContent = () => {
    return contentBlocks
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
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
          className={`message-user px-4 py-2.5 max-w-[80%] min-w-0 break-words ${
            isQueued ? 'opacity-70 border-dashed' : ''
          } ${isCancelled ? 'opacity-60' : ''}`}
        >
          {isQueued && (
            <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
              <Clock className="w-3 h-3" />
              <span>排队中</span>
            </div>
          )}
          {isCancelled && (
            <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
              <XCircle className="w-3 h-3" />
              <span>已取消</span>
            </div>
          )}
          {contentBlocks.length === 0 ? (
            <span className="text-text-muted italic">Empty message</span>
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
            title="复制消息"
          >
            {copied ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <Copy className="w-3 h-3 text-text-muted" />
            )}
          </button>
        </div>
      ) : (
        // Assistant message
        <div className="space-y-3">
          {contentBlocks.map((block, index) => (
            <ContentBlockView
              key={index}
              block={block}
              isUser={isUser}
              isStreaming={isStreaming}
              allBlocks={message.content}
              message={message}
            />
          ))}
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

function ContentBlockView({ block, isUser, isStreaming, allBlocks, message }: ContentBlockViewProps) {
  const { activeSessionId, sessions, workingDir } = useAppStore();
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;

  const resolveFilePath = (value: string) => {
    if (/^(?:[A-Za-z]:\\|\\\\|\/)/.test(value)) {
      return value;
    }
    if (!currentWorkingDir) {
      return value;
    }
    return `${currentWorkingDir.replace(/[\\/]+$/, '')}/${value}`;
  };

  const renderFileButton = (value: string, key?: string) => (
    <button
      key={key}
      type="button"
      onClick={async () => {
        if (typeof window === 'undefined' || !window.electronAPI?.showItemInFolder) {
          return;
        }
        const resolvedPath = resolveFilePath(value);
        await window.electronAPI.showItemInFolder(resolvedPath, currentWorkingDir ?? undefined);
      }}
      className={getFileLinkButtonClassName()}
      title="在文件夹中定位"
    >
      {value}
    </button>
  );

  const renderFileMentionParts = (parts: ReturnType<typeof splitChildrenByFileMentions>, keyPrefix: string) =>
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
      const normalizedText = normalizeCitationMarkdownLinks(normalizeLocalFileMarkdownLinks(text));
      
      if (!text) {
        return <span className="text-text-muted italic">(empty text)</span>;
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
        <div className="prose-chat max-w-none text-text-primary">
          <ReactMarkdown
            remarkPlugins={[remarkMath, [remarkGfm, { singleTilde: false }]]}
            rehypePlugins={[rehypeKatex]}
            components={{
              a({ children, href }) {
                const localFilePath = resolveLocalFilePathFromHref(href, currentWorkingDir);
                if (localFilePath) {
                  return (
                    <button
                      type="button"
                      onClick={async () => {
                        if (typeof window === 'undefined' || !window.electronAPI?.showItemInFolder) {
                          return;
                        }
                        await window.electronAPI.showItemInFolder(localFilePath, currentWorkingDir ?? undefined);
                      }}
                      className={getFileLinkButtonClassName()}
                      title="在文件夹中定位"
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
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-accent/40 pl-4 text-text-muted">
                    {children}
                  </blockquote>
                );
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match;

                if (isInline) {
                  const raw = String(children);
                  const parts = splitTextByFileMentions(raw);
                  if (parts.length === 1 && parts[0].type === 'file') {
                    return renderFileButton(parts[0].value);
                  }
                  return (
                    <code className="px-1.5 py-0.5 rounded bg-surface-muted text-accent font-mono text-sm" {...props}>
                      {children}
                    </code>
                  );
                }

                return (
                  <CodeBlock language={match[1]}>
                    {String(children).replace(/\n$/, '')}
                  </CodeBlock>
                );
              },
              p({ children }) {
                return (
                  <p className="text-left">
                    {renderChildrenWithFileLinks(children, 'p')}
                  </p>
                );
              },
              li({ children }) {
                return (
                  <li className="text-left">
                    {renderChildrenWithFileLinks(children, 'li')}
                  </li>
                );
              },
              table({ children }) {
                return (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border-collapse">
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th className="border border-border px-3 py-2 text-left text-sm font-semibold text-text-primary bg-surface-muted">
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="border border-border px-3 py-2 text-sm text-text-primary">
                    {children}
                  </td>
                );
              },
              input({ checked, ...props }) {
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
              strong({ children }) {
                return (
                  <strong>
                    {renderChildrenWithFileLinks(children, 'strong')}
                  </strong>
                );
              },
              em({ children }) {
                return (
                  <em>
                    {renderChildrenWithFileLinks(children, 'em')}
                  </em>
                );
              },
            }}
          >
            {normalizedText}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />
          )}
        </div>
      );
    }

    case 'image': {
      const imageBlock = block as { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
      const { source } = imageBlock;
      const imageSrc = `data:${source.media_type};base64,${source.data}`;

      return (
        <div className={`${isUser ? 'inline-block' : ''}`}>
          <img
            src={imageSrc}
            alt="Pasted content"
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
      return <ToolUseBlock block={block} />;

    case 'tool_result':
      return <ToolResultBlock block={block} allBlocks={allBlocks} message={message} />;

    case 'thinking':
      return (
        <div className="text-sm text-text-muted italic">
          {block.thinking}
        </div>
      );

    default:
      return null;
  }
}

function ToolUseBlock({ block }: { block: ToolUseContent }) {
  const [expanded, setExpanded] = useState(false);

  // Check if this is AskUserQuestion - render inline question UI
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }

  // Check if this is TodoWrite - render todo list UI
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  // Get compact label: tool action + key argument
  const getToolLabel = (name: string, input: any): string => {
    const inp = input || {};
    // MCP tools
    if (name.startsWith('mcp__')) {
      const match = name.match(/^mcp__(.+?)__(.+)$/);
      const toolName = match?.[2] || name;
      return toolName;
    }

    const nameLower = name.toLowerCase();
    // File tools — show path
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
    // Bash — show command snippet
    if (nameLower === 'bash' || nameLower === 'execute_command') {
      const cmd = inp.command || inp.cmd || '';
      if (cmd) {
        const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
        return `$ ${short}`;
      }
      return 'Run command';
    }
    // Search tools
    if (nameLower === 'glob') return inp.pattern ? `Glob ${inp.pattern}` : 'Glob';
    if (nameLower === 'grep') return inp.pattern ? `Grep "${inp.pattern}"` : 'Grep';
    if (nameLower === 'websearch') return inp.query ? `Search "${inp.query}"` : 'Web search';
    if (nameLower === 'webfetch') {
      const url = inp.url || '';
      return url ? `Fetch ${url.length > 50 ? url.substring(0, 47) + '...' : url}` : 'Fetch URL';
    }
    return name;
  };

  const isMCPTool = block.name.startsWith('mcp__');
  const mcpServerName = isMCPTool ? block.name.match(/^mcp__(.+?)__/)?.[1] : null;
  const label = getToolLabel(block.name, block.input);

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-surface-muted transition-colors max-w-full"
      >
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
        <span className="truncate font-mono">{label}</span>
        {isMCPTool && mcpServerName && (
          <span className="px-1 py-0.5 text-[10px] rounded bg-mcp/15 text-mcp flex-shrink-0">
            {mcpServerName}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100" />
        )}
      </button>

      {expanded && (
        <div className="ml-5 mt-1 mb-2">
          <pre className="code-block text-xs p-3 rounded-lg">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Shorten a file path to just filename or last 2 segments */
function shortenPath(p: string): string {
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length <= 2) return segments.join('/');
  return segments.slice(-2).join('/');
}

// Todo item interface
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  id?: string;
  activeForm?: string;
}

// TodoWrite block - renders a beautiful todo list
function TodoWriteBlock({ block }: { block: ToolUseContent }) {
  const [expanded, setExpanded] = useState(true);
  const todos: TodoItem[] = (block.input as any)?.todos || [];

  // Calculate progress
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const inProgressItem = todos.find(t => t.status === 'in_progress');

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
        <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <ListTodo className="w-3.5 h-3.5 text-blue-500" />
        </div>
        <div className="flex-1 text-left">
          <span className="font-medium text-sm text-text-primary">Task Progress</span>
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
          className="h-full bg-gradient-to-r from-blue-500 to-accent transition-all duration-500"
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
              <div className="mt-0.5 flex-shrink-0">
                {getStatusIcon(todo.status)}
              </div>
              <span className={`text-sm leading-relaxed ${getStatusStyle(todo.status)}`}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline AskUserQuestion component - displayed in message flow
function AskUserQuestionBlock({ block }: { block: ToolUseContent }) {
  const { respondToQuestion } = useIPC();
  const { pendingQuestion } = useAppStore();
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  // Parse questions from input
  const questions: QuestionItem[] = (block.input as any)?.questions || [];
  
  // Check if this question is the pending one (waiting for response)
  const isPending = pendingQuestion?.toolUseId === block.id;
  const isAnswered = submitted;
  const isReadOnly = submitted || !isPending;

  const handleOptionToggle = (questionIdx: number, label: string, multiSelect: boolean) => {
    if (isReadOnly) return; // Only allow changes while this question is pending
    
    setSelections(prev => {
      const current = prev[questionIdx] || [];
      if (multiSelect) {
        if (current.includes(label)) {
          return { ...prev, [questionIdx]: current.filter(l => l !== label) };
        } else {
          return { ...prev, [questionIdx]: [...current, label] };
        }
      } else {
        return { ...prev, [questionIdx]: [label] };
      }
    });
  };

  const handleSubmit = () => {
    if (!pendingQuestion || submitted) return;
    
    const answersJson = JSON.stringify(selections);
    console.log('[AskUserQuestionBlock] Submitting answer:', answersJson);
    respondToQuestion(pendingQuestion.questionId, answersJson);
    setSubmitted(true);
  };

  const canSubmit = isPending && !submitted && questions.every((q, idx) => {
    if (q.options && q.options.length > 0) {
      return (selections[idx] || []).length > 0;
    }
    return true;
  });

  const getOptionLetter = (index: number) => String.fromCharCode(65 + index);

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <span className="text-text-muted">No questions</span>
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
          <span className="font-medium text-sm text-text-primary">
            {isAnswered ? 'Questions answered' : isPending ? 'Please answer to continue' : 'Question closed'}
          </span>
        </div>
        {isAnswered && (
          <CheckCircle2 className="w-5 h-5 text-success ml-auto" />
        )}
      </div>

      {/* Questions */}
      <div className="p-4 space-y-5">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2">
            {/* Question header */}
            {q.header && (
              <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded uppercase tracking-wide">
                {q.header}
              </span>
            )}
            
            {/* Question text */}
            <p className="text-text-primary font-medium text-sm">
              {q.question}
            </p>
            
            {/* Options */}
            {q.options && q.options.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {q.options.map((option, optIdx) => {
                  const isSelected = (selections[qIdx] || []).includes(option.label);
                  const letter = getOptionLetter(optIdx);
                  
                  return (
                    <button
                      key={optIdx}
                      onClick={() => handleOptionToggle(qIdx, option.label, q.multiSelect || false)}
                      disabled={isReadOnly}
                      className={`w-full p-3 rounded-lg border text-left transition-all ${
                        isReadOnly
                          ? isSelected
                            ? 'border-accent/50 bg-accent/10 cursor-default'
                            : 'border-border-subtle bg-surface-muted cursor-default opacity-60'
                          : isSelected
                            ? 'border-accent bg-accent/10 hover:bg-accent/15'
                            : 'border-border-subtle bg-surface hover:border-border-default hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                          isSelected
                            ? 'bg-accent text-white'
                            : 'bg-border-subtle text-text-secondary'
                        }`}>
                          {isSelected ? <Check className="w-3.5 h-3.5" /> : letter}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm ${isSelected ? 'text-accent font-medium' : 'text-text-primary'}`}>
                            {option.label}
                          </span>
                          {option.description && (
                            <p className="text-xs text-text-muted mt-0.5">{option.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit button - only show if pending */}
      {isPending && !submitted && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${
              canSubmit
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-surface-muted text-text-muted cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
            Submit Answers
          </button>
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ block, allBlocks, message }: { block: ToolResultContent; allBlocks?: ContentBlock[]; message?: Message }) {
  const { traceStepsBySession } = useAppStore();
  const [expanded, setExpanded] = useState(false);

  // Try to find the tool name from trace steps
  let toolName: string | undefined;

  if (message?.sessionId) {
    const steps = traceStepsBySession[message.sessionId] || [];
    const toolCallStep = steps.find((s) => s.id === block.toolUseId && s.type === 'tool_call');
    if (toolCallStep) {
      toolName = toolCallStep.toolName;
    }
  }

  // Fallback: try to find in allBlocks
  if (!toolName) {
    const toolUseBlock = allBlocks?.find(
      (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
    ) as ToolUseContent | undefined;
    toolName = toolUseBlock?.name;
  }

  const isMCPTool = toolName?.startsWith('mcp__') || false;

  // Compact summary
  const getSummary = (): string => {
    if (block.isError) {
      const firstLine = block.content.split('\n')[0];
      return firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
    }
    if (shouldUseScreenshotSummary(toolName, block.content)) return 'Screenshot captured';
    if (block.content.length < 80) return block.content.trim();
    const lines = block.content.trim().split('\n');
    return `${lines.length} lines`;
  };

  // Compact tool display name
  const getToolDisplayName = (): string => {
    if (isMCPTool) {
      const match = (toolName || '').match(/^mcp__(.+?)__(.+)$/);
      return match?.[2] || toolName || 'tool';
    }
    return toolName || 'tool';
  };

  const hasImages = block.images && block.images.length > 0;
  const summary = getSummary();
  const displayName = getToolDisplayName();

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs hover:bg-surface-muted transition-colors max-w-full"
      >
        {block.isError ? (
          <AlertCircle className="w-3 h-3 text-error flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0" />
        )}
        <span className={`font-mono flex-shrink-0 ${block.isError ? 'text-error' : 'text-text-muted'}`}>
          {displayName}
        </span>
        <span className="text-text-muted truncate opacity-60">{summary}</span>
        {hasImages && (
          <span className="text-text-muted flex-shrink-0">+{block.images!.length} img</span>
        )}
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="ml-5 mt-1 mb-2 space-y-2">
          <pre className="code-block text-xs p-3 rounded-lg whitespace-pre-wrap font-mono">
            {block.content}
          </pre>

          {block.images && block.images.length > 0 && (
            <div className="space-y-2">
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
}
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3">
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-text-muted px-2 py-1 rounded bg-surface">
          {language}
        </span>
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
}
