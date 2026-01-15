import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useIPC } from '../hooks/useIPC';
import { useAppStore } from '../store';
import type { Message, ContentBlock, ToolUseContent, ToolResultContent, QuestionItem } from '../types';
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
} from 'lucide-react';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageCard({ message, isStreaming }: MessageCardProps) {
  const isUser = message.role === 'user';

  return (
    <div className="animate-fade-in">
      {isUser ? (
        // User message - neutral gray background, fit content width with min width
        <div className="message-user p-4 max-w-[90%] min-w-[120px] inline-block">
          {message.content.length === 0 ? (
            <span className="text-text-muted italic">Empty message</span>
          ) : (
            message.content.map((block, index) => (
              <ContentBlockView
                key={index}
                block={block}
                isUser={isUser}
                isStreaming={isStreaming}
              />
            ))
          )}
        </div>
      ) : (
        // Assistant message
        <div className="space-y-3">
          {message.content.map((block, index) => (
            <ContentBlockView
              key={index}
              block={block}
              isUser={isUser}
              isStreaming={isStreaming}
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
}

function ContentBlockView({ block, isUser, isStreaming }: ContentBlockViewProps) {
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
          <p className="text-text-primary whitespace-pre-wrap">
            {text}
            {isStreaming && <span className="inline-block w-2 h-4 bg-accent ml-1 animate-pulse" />}
          </p>
        );
      }
      
      return (
        <div className="prose prose-sm max-w-none text-text-primary">
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match;
                
                if (isInline) {
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
                return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
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

    case 'tool_use':
      return <ToolUseBlock block={block} />;

    case 'tool_result':
      return <ToolResultBlock block={block} />;

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
  // Check if this is AskUserQuestion - render inline question UI
  if (block.name === 'AskUserQuestion') {
    return <AskUserQuestionBlock block={block} />;
  }

  // Check if this is TodoWrite - render todo list UI
  if (block.name === 'TodoWrite') {
    return <TodoWriteBlock block={block} />;
  }

  const [expanded, setExpanded] = useState(false);

  // Get a more descriptive title based on tool name
  const getToolTitle = (name: string) => {
    const titles: Record<string, string> = {
      'Bash': 'Running command',
      'Read': 'Reading file',
      'Write': 'Writing file',
      'Edit': 'Editing file',
      'Glob': 'Searching files',
      'Grep': 'Searching content',
      'WebFetch': 'Fetching URL',
      'WebSearch': 'Searching web',
    };
    return titles[name] || `Using ${name}`;
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-surface">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 bg-surface-muted hover:bg-surface-active transition-colors"
      >
        <div className="w-6 h-6 rounded-lg bg-accent-muted flex items-center justify-center">
          <Terminal className="w-3.5 h-3.5 text-accent" />
        </div>
        <span className="font-medium text-sm text-text-primary">{getToolTitle(block.name)}</span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted ml-auto" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="p-4 space-y-3 bg-surface">
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">Request</p>
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

function ToolResultBlock({ block }: { block: ToolResultContent }) {
  const [expanded, setExpanded] = useState(true);

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
        <span className={`font-medium text-sm ${block.isError ? 'text-error' : 'text-success'}`}>
          {block.isError ? 'Error' : 'Result'}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted ml-auto" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="p-4 bg-surface">
          <pre className="code-block text-xs whitespace-pre-wrap font-mono">
            {block.content}
          </pre>
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
