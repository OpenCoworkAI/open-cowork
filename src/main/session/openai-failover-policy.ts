export type OpenAIFailoverCategory =
  | 'cancelled'
  | 'turn-already-executed'
  | 'codex-cli-unavailable'
  | 'codex-auth'
  | 'codex-resume-state'
  | 'codex-runtime'
  | 'non-codex-error';

export interface OpenAIFailoverDecision {
  shouldFailover: boolean;
  category: OpenAIFailoverCategory;
  reason: string;
}

export interface OpenAIFailoverInput {
  error: unknown;
  hasApiKey: boolean;
  alreadyUsingResponsesFallback: boolean;
  hasTurnOutput: boolean;
  hasTurnSideEffects: boolean;
}

export function decideOpenAIFailoverFromCodex(input: OpenAIFailoverInput): OpenAIFailoverDecision {
  if (!input.hasApiKey) {
    return {
      shouldFailover: false,
      category: 'non-codex-error',
      reason: 'No API key configured for Responses fallback.',
    };
  }

  if (input.alreadyUsingResponsesFallback) {
    return {
      shouldFailover: false,
      category: 'non-codex-error',
      reason: 'Already on Responses fallback runner.',
    };
  }

  const message = normalizeErrorMessage(input.error);
  const lower = message.toLowerCase();

  if (isLikelyCancelledError(lower)) {
    return {
      shouldFailover: false,
      category: 'cancelled',
      reason: 'Session was cancelled by user.',
    };
  }

  if (input.hasTurnOutput || input.hasTurnSideEffects) {
    return {
      shouldFailover: false,
      category: 'turn-already-executed',
      reason: 'Turn already produced output or side effects; skip fallback rerun.',
    };
  }

  const category = classifyCodexFailure(lower);
  if (category === 'non-codex-error') {
    return {
      shouldFailover: false,
      category,
      reason: 'Error is not a recoverable Codex CLI failure.',
    };
  }

  return {
    shouldFailover: true,
    category,
    reason: buildFailoverReason(category),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || '';
  }
  return String(error ?? '');
}

function isLikelyCancelledError(message: string): boolean {
  return (
    message.includes('aborterror') ||
    message.includes('aborted') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

function classifyCodexFailure(message: string): OpenAIFailoverCategory {
  if (!message) {
    return 'codex-runtime';
  }

  if (
    message.includes('codex cli is not installed') ||
    message.includes('not found in path') ||
    message.includes('spawn codex') ||
    message.includes('enoent')
  ) {
    return 'codex-cli-unavailable';
  }

  if (isCodexAuthFailure(message)) {
    return 'codex-auth';
  }

  if (
    message.includes('state db missing rollout path') ||
    message.includes('record_discrepancy') ||
    (message.includes('resume') && message.includes('thread'))
  ) {
    return 'codex-resume-state';
  }

  if (message.includes('codex cli exited with code')) {
    return 'codex-runtime';
  }

  return 'non-codex-error';
}

function isCodexAuthFailure(message: string): boolean {
  if (
    message.includes('codex cli authentication failed') ||
    message.includes('codex auth login')
  ) {
    return true;
  }

  const codexContextSignals = [
    'codex cli',
    'spawn codex',
    'backend-api/codex',
    'chatgpt.com/backend-api/codex',
  ];
  const authSignals = ['unauthorized', 'forbidden', '401', '403', 'invalid token', 'auth'];

  const hasCodexContext = codexContextSignals.some((signal) => message.includes(signal));
  const hasAuthSignal = authSignals.some((signal) => message.includes(signal));

  return hasCodexContext && hasAuthSignal;
}

function buildFailoverReason(category: OpenAIFailoverCategory): string {
  switch (category) {
    case 'codex-cli-unavailable':
      return 'Codex CLI unavailable; using Responses fallback for this turn.';
    case 'codex-auth':
      return 'Codex auth/session invalid; using Responses fallback for this turn.';
    case 'codex-resume-state':
      return 'Codex resume state is inconsistent; using Responses fallback for this turn.';
    case 'codex-runtime':
      return 'Codex runtime error; using Responses fallback for this turn.';
    case 'cancelled':
      return 'Cancelled session.';
    case 'turn-already-executed':
      return 'Turn already executed with output/side effects; skip fallback rerun.';
    case 'non-codex-error':
      return 'Not a recoverable Codex failure.';
  }
}
