/**
 * CoraChat – Sidebar panel for streaming chat with Cora (Coeadapt AI assistant)
 */

import { useState, useRef, useEffect } from 'react';
import { useCoraChat, type CoraMessage } from '../hooks/useCoraChat';
import {
  MessageSquare,
  Send,
  Square,
  Trash2,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';

interface CoraChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CoraChat({ isOpen, onClose }: CoraChatProps) {
  const {
    messages,
    partial,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    clearHistory,
  } = useCoraChat();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, partial]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-80 border-l border-border flex flex-col bg-surface h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">Cora</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="p-1 rounded hover:bg-surface-hover text-text-muted"
              title="Clear history"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-text-muted text-xs py-8">
            Ask Cora anything about your career journey.
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming partial */}
        {isStreaming && partial && (
          <div className="flex gap-2">
            <div className="bg-surface-hover rounded-lg px-3 py-2 text-sm text-text-primary max-w-[90%]">
              {partial}
              <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom rounded-sm" />
            </div>
          </div>
        )}

        {/* Streaming with no content yet */}
        {isStreaming && !partial && (
          <div className="flex items-center gap-2 text-text-muted text-xs">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Cora is thinking...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-error/10 text-error text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-1">
        <div className="flex items-end gap-2 bg-background rounded-lg border border-border px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Cora..."
            className="flex-1 resize-none bg-transparent text-sm text-text-primary outline-none max-h-24 min-h-[1.5rem]"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="p-1 rounded hover:bg-surface-hover text-text-muted"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-1 rounded hover:bg-surface-hover text-accent disabled:text-text-muted disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: CoraMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-lg px-3 py-2 text-sm max-w-[90%] ${
          isUser
            ? 'bg-accent text-white'
            : 'bg-surface-hover text-text-primary'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
