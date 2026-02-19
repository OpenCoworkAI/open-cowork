import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { MessageCard } from './MessageCard';
import type { Message, ContentBlock } from '../types';
import {
  Send,
  Square,
  Plus,
  Loader2,
  Plug,
  X,
} from 'lucide-react';

export function ChatView() {
  const { t } = useTranslation();
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
  const {
    pastedImages, attachedFiles, isDragging,
    handlePaste, handleDragOver, handleDragLeave, handleDrop,
    handleFileSelect, removeImage, removeFile, clearAll,
  } = useFileAttachments(isElectron);
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeConnectors, setActiveConnectors] = useState<any[]>([]);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);
  const prevPartialLengthRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const isScrollingRef = useRef(false);

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

  // Debounced scroll function to prevent scroll conflicts
  const scrollToBottom = useRef((behavior: ScrollBehavior = 'auto', immediate: boolean = false) => {
    // Cancel any pending scroll requests
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (scrollRequestRef.current) {
      cancelAnimationFrame(scrollRequestRef.current);
      scrollRequestRef.current = null;
    }

    const performScroll = () => {
      if (!isUserAtBottomRef.current) return;
      
      // Mark as scrolling to prevent concurrent scrolls
      isScrollingRef.current = true;
      
      messagesEndRef.current?.scrollIntoView({ behavior });
      
      // Reset scrolling flag after a short delay
      setTimeout(() => {
        isScrollingRef.current = false;
      }, behavior === 'smooth' ? 300 : 50);
    };

    if (immediate) {
      performScroll();
    } else {
      // Use RAF + timeout for debouncing
      scrollRequestRef.current = requestAnimationFrame(() => {
        scrollTimeoutRef.current = setTimeout(performScroll, 16); // ~1 frame delay
      });
    }
  }).current;

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

    // Skip scroll if already scrolling (prevent conflicts)
    if (isScrollingRef.current) {
      prevMessageCountRef.current = messageCount;
      prevPartialLengthRef.current = partialLength;
      return;
    }

    if (isUserAtBottomRef.current) {
      if (!isStreamingTick) {
        // New message - use smooth scroll but with debounce
        const behavior: ScrollBehavior = hasNewMessage ? 'smooth' : 'auto';
        scrollToBottom(behavior, false);
      } else {
        // Streaming tick - use instant scroll with debounce
        scrollToBottom('auto', false);
      }
    }

    prevMessageCountRef.current = messageCount;
    prevPartialLengthRef.current = partialLength;
  }, [messages.length, partialMessage]);

  // Additional scroll trigger for content height changes (e.g., TodoWrite expand/collapse)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messagesContainer = messagesContainerRef.current;
    if (!container || !messagesContainer) return;

    const resizeObserver = new ResizeObserver(() => {
      // Don't interfere with ongoing scrolls
      if (!isScrollingRef.current && isUserAtBottomRef.current) {
        // Scroll to bottom when content height changes
        scrollToBottom('auto', false);
      }
    });

    resizeObserver.observe(messagesContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [displayedMessages]); // Re-create observer when messages change to ensure we're observing the right element

  // Cleanup scroll timeouts on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRequestRef.current) {
        cancelAnimationFrame(scrollRequestRef.current);
      }
    };
  }, []);

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
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(!isTruncated && rightColumnWidth >= connectorFullWidth);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(() => {
      updateLabelVisibility();
    });
    observer.observe(titleEl);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [activeSession?.title, activeConnectors.length]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;
    
    if ((!currentPrompt.trim() && pastedImages.length === 0 && attachedFiles.length === 0) || !activeSessionId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Build content blocks
      const contentBlocks: ContentBlock[] = [];

      // Add images first
      pastedImages.forEach(img => {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType as any,
            data: img.base64,
          },
        });
      });

      // Add file attachments
      attachedFiles.forEach(file => {
        contentBlocks.push({
          type: 'file_attachment',
          filename: file.name,
          relativePath: file.path, // Will be processed by backend to copy to .tmp
          size: file.size,
          mimeType: file.type,
          inlineDataBase64: file.inlineDataBase64,
        });
      });

      // Add text if present
      if (currentPrompt.trim()) {
        contentBlocks.push({
          type: 'text',
          text: currentPrompt.trim(),
        });
      }

      // Send message with content blocks
      await continueSession(activeSessionId, contentBlocks);

      // Clean up
      setPrompt('');
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      clearAll();
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
        <span>{t('chat.loadingConversation')}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        ref={headerRef}
        className="relative h-14 border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-6 bg-surface/80 backdrop-blur-sm"
      >
        <div />
        <h2 ref={titleRef} className="font-medium text-text-primary text-center truncate max-w-lg">
          {activeSession.title}
        </h2>
        {activeConnectors.length > 0 && (
          <>
            <div
              ref={connectorMeasureRef}
              aria-hidden="true"
              className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none"
            >
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-purple-500/20">
                <Plug className="w-3.5 h-3.5" />
                <span className="text-xs font-medium whitespace-nowrap">
                  {t('chat.connectorCount', { count: activeConnectors.length })}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 justify-self-end">
              <Plug className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs text-purple-500 font-medium">
                {showConnectorLabel ? (
                  t('chat.connectorCount', { count: activeConnectors.length })
                ) : (
                  activeConnectors.length
                )}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div ref={messagesContainerRef} className="w-full max-w-[1180px] mx-auto py-6 px-4 lg:px-6 space-y-4">
          {displayedMessages.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <p>{t('chat.startConversation')}</p>
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
          
          {/* Processing indicator - show when we have an active turn but no partial message yet */}
          {hasActiveTurn && (!partialMessage || partialMessage.trim() === '') && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface border border-border max-w-fit">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              <span className="text-sm text-text-secondary">
                {t('chat.processing')}
              </span>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface/80 backdrop-blur-sm">
        <div className="px-4 py-4">
          <form
            onSubmit={handleSubmit}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative w-full"
          >
            {/* Image previews */}
            {pastedImages.length > 0 && (
              <div className="grid grid-cols-5 gap-2 mb-3">
                {pastedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img.url}
                      alt={`Pasted ${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg border border-border block"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File attachments */}
            {attachedFiles.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-border group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{file.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="w-6 h-6 rounded-full bg-error/10 hover:bg-error/20 text-error flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className={`flex items-end gap-2 p-3 rounded-3xl bg-surface transition-colors border ${
                isDragging ? 'ring-2 ring-accent bg-accent/5' : ''
              }`}
              style={{ borderColor: 'var(--color-card-border)' }}
            >
              <button
                type="button"
                onClick={handleFileSelect}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                title={t('welcome.attachFiles')}
              >
                <Plus className="w-5 h-5" />
              </button>

              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  // Enter to send, Shift+Enter for new line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                      return;
                    }
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t('chat.typeMessage')}
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
                  disabled={(!prompt.trim() && !textareaRef.current?.value.trim() && pastedImages.length === 0 && attachedFiles.length === 0) || isSubmitting}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
              </div>
            </div>

            <p className="text-xs text-text-muted text-center mt-2">
              {t('chat.aiDisclaimer')}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
