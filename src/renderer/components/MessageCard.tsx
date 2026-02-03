import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import { splitTextByFileMentions, getFileLinkButtonClassName } from '../utils/file-link';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent, QuestionItem, FileAttachmentContent } from '../types';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Terminal,
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
  Plug,
  FileText,
} from 'lucide-react';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageCard({ message, isStreaming }: MessageCardProps) {
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
          className={`message-user px-4 py-2.5 max-w-[80%] break-words ${
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
}

interface ContentBlockViewProps {
  block: ContentBlock;
  isUser: boolean;
  isStreaming?: boolean;
  allBlocks?: ContentBlock[]; // Pass all blocks to find related tool_use
  message?: Message; // Pass the whole message to access previous messages
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
      onClick={() => {
        if (typeof window !== 'undefined' && window.electronAPI?.showItemInFolder) {
          void window.electronAPI.showItemInFolder(resolveFilePath(value));
        }
      }}
      className={getFileLinkButtonClassName()}
      title="在文件夹中定位"
    >
      {value}
    </button>
  );

  switch (block.type) {
    case 'text': {
      const textBlock = block as { type: 'text'; text: string };
      const text = textBlock.text || '';
      
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
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={{
              a({ children, href }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      if (!href) {
                        return;
                      }
                      if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
                        event.preventDefault();
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
                const mapped = (Array.isArray(children) ? children : [children]).flatMap((child, index) => {
                  if (typeof child === 'string') {
                    const parts = splitTextByFileMentions(child);
                    return parts.map((part, partIndex) => {
                      if (part.type === 'file') {
                        return renderFileButton(part.value, `${index}-${partIndex}`);
                      }
                      return <span key={`${index}-${partIndex}`}>{part.value}</span>;
                    });
                  }
                  return child;
                });
                return <p className="text-left">{mapped}</p>;
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
                return <strong>{children}</strong>;
              },
              em({ children }) {
                return <em>{children}</em>;
              },
            }}
          >
            {text}
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
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border">
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Check if this is AskUserQuestion - render inline question UI
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }

  // Check if this is TodoWrite - render todo list UI
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  // Get a more descriptive title based on tool name
  const getToolTitle = (name: string) => {
    // Check if this is an MCP tool (format: mcp__ServerName__toolname)
    if (name.startsWith('mcp__')) {
      const match = name.match(/^mcp__(.+?)__(.+)$/);
      if (match) {
        const toolName = match[2];
        return `Using ${toolName}`;
      }
      return `Using MCP tool`;
    }
    
    const titles: Record<string, string> = {
      'Bash': 'Running command',
      'Read': 'Reading file',
      'Write': 'Writing file',
      'Edit': 'Editing file',
      'Glob': 'Searching files',
      'Grep': 'Searching content',
      'WebFetch': 'Fetching URL',
      'WebSearch': 'Searching web',
      'TodoRead': 'Reading todo list',
      'TodoWrite': 'Updating todo list',
      'read_file': 'Reading file',
      'write_file': 'Writing file',
      'edit_file': 'Editing file',
      'list_directory': 'Listing directory',
      'glob': 'Searching files',
      'grep': 'Searching content',
      'execute_command': 'Running command',
    };
    return titles[name] || `Using ${name}`;
  };

  // Check if this is an MCP tool
  const isMCPTool = block.name.startsWith('mcp__');
  const mcpServerName = isMCPTool ? block.name.match(/^mcp__(.+?)__/)?.[1] : null;

  return (
    <div className={`rounded-xl border overflow-hidden bg-surface ${
      isMCPTool ? 'border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-transparent' : 'border-border'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${
          isMCPTool 
            ? 'bg-purple-500/10 hover:bg-purple-500/20' 
            : 'bg-surface-muted hover:bg-surface-active'
        }`}
      >
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
          isMCPTool 
            ? 'bg-purple-500/20' 
            : 'bg-accent-muted'
        }`}>
          {isMCPTool ? (
            <Plug className="w-3.5 h-3.5 text-purple-500" />
          ) : (
          <Terminal className="w-3.5 h-3.5 text-accent" />
          )}
        </div>
        <div className="flex-1 text-left">
        <span className="font-medium text-sm text-text-primary">{getToolTitle(block.name)}</span>
          {isMCPTool && mcpServerName && (
            <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-purple-500/20 text-purple-500">
              {mcpServerName}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-surface">
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">{t('messageCard.request')}</p>
            <pre className="code-block text-xs">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
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
  const isAnswered = submitted || !isPending;

  const handleOptionToggle = (questionIdx: number, label: string, multiSelect: boolean) => {
    if (isAnswered) return; // Don't allow changes after submission
    
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
            {isAnswered ? 'Questions answered' : 'Please answer to continue'}
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
                      disabled={isAnswered}
                      className={`w-full p-3 rounded-lg border text-left transition-all ${
                        isAnswered
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
    // Find the tool_call step that matches this tool_use_id
    const toolCallStep = steps.find((s) => s.id === block.toolUseId && s.type === 'tool_call');
    if (toolCallStep) {
      toolName = toolCallStep.toolName;
    }
  }

  // Fallback: try to find in allBlocks (for same message)
  if (!toolName) {
    const toolUseBlock = allBlocks?.find(
      (b) => b.type === 'tool_use' && (b as ToolUseContent).id === block.toolUseId
    ) as ToolUseContent | undefined;
    toolName = toolUseBlock?.name;
  }

  // MCP tools start with mcp__ (double underscore)
  const isMCPTool = toolName?.startsWith('mcp__') || false;

  console.log('[ToolResultBlock] toolUseId:', block.toolUseId, 'toolName:', toolName, 'isMCPTool:', isMCPTool, 'expanded:', expanded);

  // Generate summary for tool results
  const generateSummary = (content: string, isError: boolean): string => {
    if (isError) {
      // Simplify error messages
      if (content.includes('Could not connect to Chrome')) {
        return '✗ Chrome not connected';
      }
      if (content.includes('ECONNREFUSED')) {
        return '✗ Connection refused';
      }
      if (content.includes('timeout')) {
        return '✗ Operation timed out';
      }
      // Generic error
      const firstLine = content.split('\n')[0];
      return `✗ ${firstLine.substring(0, 60)}${firstLine.length > 60 ? '...' : ''}`;
    }

    // Success cases - try to extract meaningful info

    // Chrome DevTools MCP Server responses
    if (content.includes('Successfully navigated to')) {
      const urlMatch = content.match(/Successfully navigated to (.+)/);
      if (urlMatch) {
        const url = urlMatch[1].trim();
        return `✓ Navigated to ${url.length > 50 ? url.substring(0, 50) + '...' : url}`;
      }
      return '✓ Navigation successful';
    }

    if (content.includes('Page created')) {
      return '✓ New page created';
    }

    if (content.includes('Screenshot saved') || content.includes('screenshot')) {
      return '✓ Screenshot captured';
    }

    if (content.includes('Successfully clicked')) {
      return '✓ Element clicked';
    }

    if (content.includes('Successfully typed')) {
      const textMatch = content.match(/Successfully typed "(.+?)"/);
      if (textMatch) {
        const text = textMatch[1];
        return `✓ Typed: ${text.length > 30 ? text.substring(0, 30) + '...' : text}`;
      }
      return '✓ Text entered';
    }

    // List pages result
    if (content.includes('"title"') && content.includes('"url"')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return `✓ Found ${parsed.length} open page${parsed.length !== 1 ? 's' : ''}`;
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    // JSON response - try to summarize
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return `✓ Returned ${parsed.length} item${parsed.length !== 1 ? 's' : ''}`;
        }
        if (typeof parsed === 'object') {
          const keys = Object.keys(parsed);
          if (keys.length <= 3) {
            return `✓ Success (${keys.join(', ')})`;
          }
          return `✓ Success (${keys.length} fields)`;
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    // Generic success - show first line or length
    const lines = content.trim().split('\n');
    if (lines.length === 1 && lines[0].length < 80) {
      return `✓ ${lines[0]}`;
    }

    if (content.length < 100) {
      return `✓ ${content.trim()}`;
    }

    // Long content - show summary
    const firstLine = lines[0].trim();
    if (firstLine.length > 0 && firstLine.length < 60) {
      return `✓ ${firstLine}`;
    }

    return `✓ Success (${content.length} chars, ${lines.length} lines)`;
  };

  const summary = generateSummary(block.content, block.isError || false);
  const hasImages = block.images && block.images.length > 0;

  // Debug: Log the entire block to see what we're receiving
  console.log('[ToolResultBlock] Full block:', {
    toolUseId: block.toolUseId,
    hasImages: hasImages,
    imagesCount: block.images?.length || 0,
    contentLength: block.content?.length || 0,
    imagesMimeTypes: block.images?.map(img => img.mimeType),
    imagesDataLengths: block.images?.map(img => img.data?.length || 0)
  });

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${
          block.isError ? 'bg-error/10 hover:bg-error/20' : 'bg-success/10 hover:bg-success/20'
        }`}
      >
        {block.isError ? (
          <AlertCircle className="w-5 h-5 text-error" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-success" />
        )}
        <span className={`font-medium text-sm flex-1 text-left ${block.isError ? 'text-error' : 'text-success'}`}>
          {summary}
          {hasImages && (
            <span className="ml-2 text-xs text-text-muted">
              📸 {block.images.length} image{block.images.length > 1 ? 's' : ''}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {expanded && (
        <div className="p-4 bg-surface space-y-4">
          <pre className="code-block text-xs whitespace-pre-wrap font-mono">
            {block.content}
          </pre>

          {/* Render images if present */}
          {block.images && block.images.length > 0 && (
            <div className="space-y-3">
              {block.images.map((image, index) => (
                <div key={index} className="border border-border rounded-lg overflow-hidden">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '600px', objectFit: 'contain' }}
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
