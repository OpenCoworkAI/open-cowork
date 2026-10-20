import type { Api, Model } from '@mariozechner/pi-ai';
import { isDirectMiniMaxBaseUrl } from '../../shared/minimax';

/** Apply the direct Flash contract after the SDK serializes its generic thinking settings. */
export function normalizeMiniMaxPayload(payload: unknown, model: Model<Api>): unknown {
  if (
    model.id !== 'MiniMax-M3.1-Flash' ||
    !isDirectMiniMaxBaseUrl(model.baseUrl) ||
    !payload ||
    typeof payload !== 'object'
  )
    return payload;

  const result = { ...payload } as Record<string, unknown>;
  delete result.service_tier;
  const allowedEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  const effort = (value: unknown) =>
    typeof value === 'string' && allowedEfforts.includes(value) ? value : 'max';
  if (model.api === 'anthropic-messages') {
    result.thinking = { type: 'adaptive' };
    const output = (result.output_config || {}) as Record<string, unknown>;
    result.output_config = { ...output, effort: effort(output.effort) };
  } else if (model.api === 'openai-completions') {
    delete result.thinking;
    delete result.reasoning_split;
    result.reasoning_effort = effort(result.reasoning_effort);
  }
  return result;
}

type PayloadHook = (payload: unknown, model: Model<Api>) => unknown | Promise<unknown>;

/** Match the existing Ollama hook while using each request's model for session hot-swaps. */
export function installMiniMaxPayloadHook(agent: object): boolean {
  if (!('_onPayload' in agent)) return false;
  const target = agent as { _onPayload?: PayloadHook };
  const original = target._onPayload;
  target._onPayload = async (payload, model) => {
    const result = original ? await original.call(agent, payload, model) : payload;
    return normalizeMiniMaxPayload(result === undefined ? payload : result, model);
  };
  return true;
}
