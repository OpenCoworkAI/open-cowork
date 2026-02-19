import { describe, expect, it } from 'vitest';
import { decideOpenAIFailoverFromCodex } from '../src/main/session/openai-failover-policy';

describe('decideOpenAIFailoverFromCodex', () => {
  const baseInput = {
    hasApiKey: true,
    alreadyUsingResponsesFallback: false,
    hasTurnOutput: false,
    hasTurnSideEffects: false,
  };

  it('returns failover for codex auth failure when api key exists and turn has no output', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI authentication failed. Please run `codex auth login` and try again.'),
    });
    expect(decision.shouldFailover).toBe(true);
    expect(decision.category).toBe('codex-auth');
  });

  it('returns failover when codex-context unauthorized is detected', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI request failed: unauthorized'),
    });
    expect(decision.shouldFailover).toBe(true);
    expect(decision.category).toBe('codex-auth');
  });

  it('returns failover when backend-api/codex and 403 are both present', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('POST https://chatgpt.com/backend-api/codex/responses -> 403 Forbidden'),
    });
    expect(decision.shouldFailover).toBe(true);
    expect(decision.category).toBe('codex-auth');
  });

  it('returns failover for codex runtime error signature', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI exited with code 1: unexpected runtime failure'),
    });
    expect(decision.shouldFailover).toBe(true);
    expect(decision.category).toBe('codex-runtime');
  });

  it('returns failover for codex resume-state errors', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI exited with code 1: state db missing rollout path for thread ...'),
    });
    expect(decision.shouldFailover).toBe(true);
    expect(decision.category).toBe('codex-resume-state');
  });

  it('does not failover without api key', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI exited with code 1'),
      hasApiKey: false,
    });
    expect(decision.shouldFailover).toBe(false);
  });

  it('does not failover for cancellation', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('AbortError: The operation was aborted'),
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('cancelled');
  });

  it('does not failover when turn already has output', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI exited with code 1'),
      hasTurnOutput: true,
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('turn-already-executed');
  });

  it('does not failover when turn already has side effects', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('Codex CLI exited with code 1'),
      hasTurnSideEffects: true,
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('turn-already-executed');
  });

  it('does not failover for generic error text that only contains codex word', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('some parser mentions codex token but not cli failure'),
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('non-codex-error');
  });

  it('does not failover for generic unauthorized without codex context', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('upstream unauthorized'),
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('non-codex-error');
  });

  it('does not failover for generic forbidden without codex context', () => {
    const decision = decideOpenAIFailoverFromCodex({
      ...baseInput,
      error: new Error('request failed: forbidden'),
    });
    expect(decision.shouldFailover).toBe(false);
    expect(decision.category).toBe('non-codex-error');
  });
});
