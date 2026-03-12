import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
  shouldGenerateTitle,
} from './session-title-utils';

type TitleFlowDeps = {
  sessionId: string;
  prompt: string;
  userMessageCount: number;
  currentTitle: string;
  hasAttempted: boolean;
  generateTitle: (titlePrompt: string) => Promise<string | null>;
  updateTitle: (title: string) => Promise<void> | void;
  getLatestTitle: () => string | null;
  markAttempt: () => void;
  shouldAbort?: () => boolean;
  log: (message: string, ...args: unknown[]) => void;
};

export async function maybeGenerateSessionTitle(deps: TitleFlowDeps): Promise<void> {
  if (deps.shouldAbort?.()) {
    deps.log('[SessionTitle] Skip: title flow aborted before start', deps.sessionId);
    return;
  }
  const shouldGenerate = shouldGenerateTitle({
    userMessageCount: deps.userMessageCount,
    currentTitle: deps.currentTitle,
    prompt: deps.prompt,
    hasAttempted: deps.hasAttempted,
  });

  if (!shouldGenerate) {
    if (deps.hasAttempted) {
      deps.log('[SessionTitle] Skip: already attempted', deps.sessionId);
      return;
    }
    if (deps.userMessageCount !== 1) {
      deps.log('[SessionTitle] Skip: not first user message', deps.sessionId);
      return;
    }
    deps.log('[SessionTitle] Skip: title already customized', deps.sessionId);
    return;
  }

  deps.log('[SessionTitle] Generating title...', deps.sessionId);

  const titlePrompt = buildTitlePrompt(deps.prompt);
  let generatedTitle: string | null = null;
  try {
    generatedTitle = normalizeGeneratedTitle(await deps.generateTitle(titlePrompt));
  } catch (error) {
    deps.log('[SessionTitle] Generation failed', deps.sessionId, error);
    return;
  }

  if (deps.shouldAbort?.()) {
    deps.log('[SessionTitle] Skip: title flow aborted after generation', deps.sessionId);
    return;
  }

  if (!generatedTitle) {
    deps.log('[SessionTitle] No title generated', deps.sessionId);
    return;
  }

  const latestTitle = deps.getLatestTitle();
  const defaultTitle = getDefaultTitleFromPrompt(deps.prompt);
  if (latestTitle && latestTitle !== deps.currentTitle && latestTitle !== defaultTitle) {
    deps.log('[SessionTitle] Skip: title changed before update', deps.sessionId);
    return;
  }

  await deps.updateTitle(generatedTitle);
  deps.markAttempt();
  deps.log('[SessionTitle] Title updated', deps.sessionId, generatedTitle);
}
