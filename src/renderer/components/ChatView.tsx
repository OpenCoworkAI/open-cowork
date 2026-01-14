import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { MessageCard } from './MessageCard';
import {
  Send,
  Square,
  Plus,
  ChevronDown,
} from 'lucide-react';

export function ChatView() {
  const { activeSessionId, sessions, messagesBySession, partialMessage, isLoading } = useAppStore();
  const { continueSession, stopSession } = useIPC();
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSessionId ? messagesBySession[activeSessionId] || [] : [];
  const isRunning = activeSession?.status === 'running' || isLoading || isSubmitting;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, partialMessage]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeSessionId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    // Get value from ref to handle both controlled and uncontrolled cases
    const currentPrompt = textareaRef.current?.value || prompt;
    
    if (!currentPrompt.trim() || !activeSessionId || isRunning) return;

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

  if (!activeSession) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-center px-6 bg-surface/80 backdrop-blur-sm">
        <h2 className="font-medium text-text-primary text-center truncate max-w-lg">
          {activeSession.title}
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <p>Start the conversation</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))
          )}
          
          {/* Streaming partial message */}
          {partialMessage && (
            <MessageCard
              message={{
                id: 'partial',
                sessionId: activeSessionId!,
                role: 'assistant',
                content: [{ type: 'text', text: partialMessage }],
                timestamp: Date.now(),
              }}
              isStreaming
            />
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <form onSubmit={handleSubmit} className="relative">
            <div className="flex items-end gap-2 p-3 rounded-2xl border border-border bg-surface">
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
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={isRunning ? 'Running...' : 'Reply...'}
                disabled={isRunning}
                rows={1}
                className="flex-1 resize-none bg-transparent border-none outline-none text-text-primary placeholder:text-text-muted text-sm py-1.5"
              />
              
              <div className="flex items-center gap-2">
                {/* Model selector */}
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text-muted hover:bg-surface-hover transition-colors"
                >
                  <span>Sonnet 4</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                {isRunning ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-error/10 text-error hover:bg-error/20 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!prompt.trim() && !textareaRef.current?.value.trim()}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </form>
          
          <p className="text-xs text-text-muted text-center mt-2">
            Claude is AI and can make mistakes. Please double-check responses.
          </p>
        </div>
      </div>
    </div>
  );
}
