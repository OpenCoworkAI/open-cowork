import { getDefaultTitleFromPrompt } from '../../src/main/session/session-title-utils';
import { maybeGenerateSessionTitle } from '../../src/main/session/session-title-flow';

type HarnessOptions = {
  generatedTitle: string | null;
  latestTitle?: string;
};

export function createTitleFlowHarness(options: HarnessOptions) {
  let updatedTitle: string | null = null;
  let currentTitle = '';
  let latestTitle = options.latestTitle ?? null;
  const attemptedSessions = new Set<string>();
  const sessionId = 'session-1';

  const runFirstMessage = async (prompt: string) => {
    currentTitle = getDefaultTitleFromPrompt(prompt);
    await maybeGenerateSessionTitle({
      sessionId,
      prompt,
      userMessageCount: 1,
      currentTitle,
      hasAttempted: attemptedSessions.has(sessionId),
      generateTitle: async () => options.generatedTitle,
      getLatestTitle: () => latestTitle ?? currentTitle,
      markAttempt: () => {
        attemptedSessions.add(sessionId);
      },
      updateTitle: async (title) => {
        updatedTitle = title;
        currentTitle = title;
      },
      log: () => undefined,
    });
  };

  return {
    runFirstMessage,
    get updatedTitle() {
      return updatedTitle;
    },
  };
}
