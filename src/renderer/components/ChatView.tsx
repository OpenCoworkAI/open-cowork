import { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { MessageCard } from './MessageCard';
import type { Message } from '../types';
import {
  Send,
  Square,
  Plus,
  Loader2,
  Plug,
} from 'lucide-react';

export function ChatView() {
  const {
    activeSessionId,
    sessions,
    messagesBySession,
    partialMessagesBySession,
    activeTurnsBySession,
    pendingTurnsBySession,
    appConfig,
  } = useAppStore();
  const { continueSession, stopSession, isElectron } = useIPC();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<any[]>([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSessionId ? messagesBySession[activeSessionId] || [] : [];
  const pendingTurns = activeSessionId ? pendingTurnsBySession[activeSessionId] || [] : [];
  const partialMessage = activeSessionId ? partialMessagesBySession[activeSessionId] || '' : '';
  const activeTurn = activeSessionId ? activeTurnsBySession[activeSessionId] : null;
  const hasActiveTurn = Boolean(activeTurn);
  const pendingCount = pendingTurns.length;
  const canStop = hasActiveTurn || pendingCount > 0;

  const displayedMessages = useMemo(() => {
    if (!activeSessionId) return messages;
    if (!partialMessage || !activeTurn?.userMessageId) return messages;
    const anchorIndex = messages.findIndex((message) => message.id === activeTurn.userMessageId);
    if (anchorIndex === -1) return messages;

    let insertIndex = anchorIndex + 1;
    while (insertIndex < messages.length) {
      if (messages[insertIndex].role === 'user') break;
      insertIndex += 1;
    }

    const streamingMessage: Message = {
      id: `partial-${activeSessionId}`,
      sessionId: activeSessionId,
      role: 'assistant',
      content: [{ type: 'text', text: partialMessage }],
      timestamp: Date.now(),
    };

    return [
      ...messages.slice(0, insertIndex),
      streamingMessage,
      ...messages.slice(insertIndex),
    ];
  }, [activeSessionId, activeTurn?.userMessageId, messages, partialMessage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateScrollState = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isUserAtBottomRef.current = distanceToBottom <= 80;
    };
    updateScrollState();
    // 用户阅读旧消息时，阻止新消息自动滚动打断视线
    const onScroll = () => updateScrollState();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const messageCount = messages.length;
    const partialLength = partialMessage.length;
    const hasNewMessage = messageCount !== prevMessageCountRef.current;
    const isStreamingTick = partialLength !== prevPartialLengthRef.current && !hasNewMessage;
    const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        messagesEndRef.current?.scrollIntoView({ behavior });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  // Load active MCP connectors
  useEffect(() => {
    if (isElectron && typeof window !== 'undefined' && window.electronAPI) {
      const loadConnectors = async () => {
        try {
          const statuses = await window.electronAPI.mcp.getServerStatus();
          const active = statuses?.filter((s: any) => s.connected && s.toolCount > 0) || [];
          setActiveConnectors(active);
        } catch (err) {
          console.error('Failed to load MCP connectors:', err);
        }
      };
      loadConnectors();
      // Refresh every 5 seconds
      const interval = setInterval(loadConnectors, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron]);

  useEffect(() => {
    const titleEl = titleRef.current;
    if (!titleEl) return;
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      setShowConnectorLabel(!isTruncated);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(() => {
      updateLabelVisibility();
    });
    observer.observe(titleEl);
    return () => observer.disconnect();
  }, [activeSession?.title]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;
    
    if (!currentPrompt.trim() || !activeSessionId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await continueSession(activeSessionId, currentPrompt);
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = () => {
    if (activeSessionId) {
      stopSession(activeSessionId);
    }
  };

  if (!activeSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <span>Loading conversation...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-6 bg-surface/80 backdrop-blur-sm">
        <div />
        <h2 ref={titleRef} className="font-medium text-text-primary text-center truncate max-w-lg">
          {activeSession.title}
        </h2>
        {activeConnectors.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 justify-self-end">
            <Plug className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs text-purple-500 font-medium">
              {activeConnectors.length}
              {showConnectorLabel && (
                <span>
                  {' '}connector{activeConnectors.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
          {displayedMessages.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <p>Start the conversation</p>
            </div>
          ) : (
            displayedMessages.map((message) => {
              const isStreaming = typeof message.id === 'string' && message.id.startsWith('partial-');
              return (
                <div key={message.id}>
                  <MessageCard message={message} isStreaming={isStreaming} />
                </div>
              );
            })
          )}

          {/* Processing indicator */}
          {hasActiveTurn && !partialMessage && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-border max-w-fit">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              <span className="text-sm text-text-secondary">
                Processing...
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <form onSubmit={handleSubmit} className="relative w-full">
            <div className="flex items-end gap-2 p-3 rounded-3xl bg-surface" style={{ border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Enter to send, Shift+Enter for new line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Reply..."
                disabled={isSubmitting}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm py-1.5"
              />

              <div className="flex items-center gap-2">
                {/* Model display */}
                <span className="px-2 py-1 text-xs text-text-muted">
                  {appConfig?.model || 'No model'}
                </span>

                {canStop && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!prompt.trim() && !textareaRef.current?.value.trim()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-text-muted text-center mt-2">
              Open Cowork is AI-powered and may make mistakes. Please double-check responses.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
