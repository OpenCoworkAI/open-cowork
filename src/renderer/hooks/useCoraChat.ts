/**
 * useCoraChat – SSE streaming chat hook for the Cora AI assistant (Coeadapt)
 *
 * Manages thread state, message history, and SSE streaming.
 */

import { useState, useCallback, useRef } from 'react';
import { getCoeadaptApi, type CoraChatMessage } from '../lib/coeadapt-api';

export interface CoraMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function useCoraChat() {
  const [messages, setMessages] = useState<CoraMessage[]>([]);
  const [partial, setPartial] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;

      // Add user message
      const userMsg: CoraMessage = {
        id: `cora-user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setPartial('');
      setError(null);
      setIsStreaming(true);

      let accumulated = '';

      const controller = getCoeadaptApi().streamChat(
        text,
        threadId,
        (msg: CoraChatMessage) => {
          if (msg.type === 'content' && msg.content) {
            accumulated += msg.content;
            setPartial(accumulated);
          } else if (msg.type === 'error') {
            setError(msg.error || 'Unknown error from Cora');
            setIsStreaming(false);
          } else if (msg.type === 'done') {
            // Stream finished – commit accumulated text as assistant message
            if (accumulated) {
              const assistantMsg: CoraMessage = {
                id: `cora-asst-${Date.now()}`,
                role: 'assistant',
                content: accumulated,
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
            }
            setPartial('');
            setIsStreaming(false);
          }
        },
        (err) => {
          setError(err.message);
          setIsStreaming(false);
        },
      );

      abortRef.current = controller;
    },
    [isStreaming, threadId],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    // Commit whatever we have so far
    if (partial) {
      const assistantMsg: CoraMessage = {
        id: `cora-asst-${Date.now()}`,
        role: 'assistant',
        content: partial,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setPartial('');
    }
    setIsStreaming(false);
  }, [partial]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setPartial('');
    setThreadId(undefined);
    setError(null);
  }, []);

  return {
    messages,
    partial,
    isStreaming,
    threadId,
    error,
    sendMessage,
    stopStreaming,
    clearHistory,
  };
}
