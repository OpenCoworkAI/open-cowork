import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';

function readDraft(sessionId: string | null): string {
  if (!sessionId) return '';
  return useAppStore.getState().sessionInputDrafts[sessionId] ?? '';
}

function sessionStillExists(sessionId: string): boolean {
  return useAppStore.getState().sessions.some((session) => session.id === sessionId);
}

function writeDraft(sessionId: string | null, value: string): void {
  // Deleting the active session removes its draft, then ChatView unmounts or
  // switches away. Writing the in-memory prompt back would orphan that entry.
  if (!sessionId || !sessionStillExists(sessionId)) return;
  useAppStore.getState().setSessionInputDraft(sessionId, value);
}

export function useSessionInputDraft(sessionId: string | null): [string, (value: string) => void] {
  const [prompt, setPromptState] = useState(() => readDraft(sessionId));
  const sessionIdRef = useRef(sessionId);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  useLayoutEffect(() => {
    const previousId = sessionIdRef.current;
    if (previousId && previousId !== sessionId) {
      writeDraft(previousId, promptRef.current);
    }
    sessionIdRef.current = sessionId;
    setPromptState(readDraft(sessionId));
  }, [sessionId]);

  useEffect(() => {
    return () => {
      writeDraft(sessionIdRef.current, promptRef.current);
    };
  }, []);

  const setPrompt = useCallback((value: string) => {
    promptRef.current = value;
    setPromptState(value);
    writeDraft(sessionIdRef.current, value);
  }, []);

  return [prompt, setPrompt];
}
